<?php declare(strict_types = 0);

namespace Modules\GeradorMovel\Actions;

use API,
	CController,
	CControllerResponseFatal,
	CCsrfTokenHelper,
	CMacrosResolverHelper,
	CRoleHelper,
	CSeverityHelper,
	CWebUser;

/**
 * Coleta comum às ações da página: mesmo contrato "dados" do WidgetView do módulo painel-gerador
 * (copiado de lá para não alterar o painel).
 */
abstract class GeradorMovelBase extends CController {


	// Chaves do template "DSE892 Gerador Stemac by SNMP".
	private const ITEM_KEYS = [
		'dse.mains.volt[L1-N]', 'dse.mains.volt[L2-N]', 'dse.mains.volt[L3-N]', 'dse.mains.freq',
		'dse.gen.volt[L1-N]', 'dse.gen.volt[L2-N]', 'dse.gen.volt[L3-N]', 'dse.gen.freq',
		'dse.gen.current[L1]', 'dse.gen.current[L2]', 'dse.gen.current[L3]', 'dse.gen.power',
		'dse.engine.rpm', 'dse.fuel.level', 'dse.battery.volt', 'dse.engine.coolant.temp',
		'dse.engine.oil.pressure', 'dse.engine.hours', 'dse.engine.starts',
		'dse.mode.text', 'dse.trap.description', 'dse.gw.uptime'
	];

	private const MACROS = [
		'vmin' => ['macro' => '{$DSE.MAINS.VMIN}', 'padrao' => 100],
		'amin' => ['macro' => '{$DSE.GEN.LOAD.AMIN}', 'padrao' => 5]
	];

	private const SCRIPT_MENU_PATH = 'Gerador';
	private const SCRIPT_PARAM_BLOQUEIO = 'bloqueio';

	// Prefixo do nome do script -> comando do painel.
	private const SCRIPT_COMANDOS = [
		'1' => 'stop',
		'2' => 'manual',
		'3' => 'partida',
		'4' => 'teste',
		'5' => 'auto'
	];

	protected function init(): void {
		$this->disableCsrfValidation();
	}

	protected function checkInput(): bool {
		$ret = $this->validateInput([
			'hostid' => 'db hosts.hostid'
		]);

		if (!$ret) {
			$this->setResponse(new CControllerResponseFatal());
		}

		return $ret;
	}

	protected function checkPermissions(): bool {
		return $this->getUserType() >= USER_TYPE_ZABBIX_USER;
	}

	/**
	 * Host pedido, se o usuário tiver acesso a ele; sem hostid na URL, o primeiro host visível com o
	 * template (achado pela chave de um item dele, pois usuário comum não lê templates). Senão null.
	 */
	protected function getHostid(): ?string {
		if (!$this->hasInput('hostid')) {
			$itens = API::Item()->get([
				'output' => ['hostid'],
				'filter' => ['key_' => 'dse.gw.uptime'],
				'templated' => false,
				'limit' => 1
			]);

			return $itens ? $itens[0]['hostid'] : null;
		}

		$hosts = API::Host()->get([
			'output' => ['hostid'],
			'hostids' => [$this->getInput('hostid')]
		]);

		return $hosts ? $hosts[0]['hostid'] : null;
	}

	protected static function getEstado(?string $hostid): array {
		if ($hostid === null) {
			return ['hostid' => null];
		}

		return [
			'hostid' => $hostid,
			'dados' => [
				'agora' => time(),
				'macros' => self::getMacros($hostid),
				'itens' => self::getItens($hostid),
				'problemas' => self::getProblemas($hostid),
				'scripts' => self::getScripts($hostid)
			],
			'csrf_token' => CCsrfTokenHelper::get('scriptexec'),
			'severidades' => self::getSeveridades()
		];
	}

	private static function getMacros(string $hostid): array {
		$resolvidas = CMacrosResolverHelper::resolveWidgetTopHostsTextColumns(
			array_map(static fn(array $macro): string => $macro['macro'], self::MACROS),
			[$hostid]
		);

		$macros = [];

		foreach (self::MACROS as $nome => $macro) {
			$valor = $resolvidas[$nome][$hostid];
			$macros[$nome] = is_numeric($valor) ? $valor + 0 : $macro['padrao'];
		}

		return $macros;
	}

	private static function getItens(string $hostid): array {
		$db_items = API::Item()->get([
			'output' => ['key_', 'lastvalue', 'lastclock'],
			'hostids' => [$hostid],
			'filter' => ['key_' => self::ITEM_KEYS]
		]);

		$itens = [];

		foreach ($db_items as $item) {
			$sem_dado = $item['lastclock'] == 0;

			$itens[$item['key_']] = [
				'valor' => $sem_dado ? null : $item['lastvalue'],
				'clock' => $sem_dado ? null : (int) $item['lastclock']
			];
		}

		return $itens;
	}

	private static function getProblemas(string $hostid): array {
		$db_problems = API::Problem()->get([
			'output' => ['name', 'severity'],
			'hostids' => [$hostid],
			'source' => EVENT_SOURCE_TRIGGERS,
			'object' => EVENT_OBJECT_TRIGGER
		]);

		$problemas = [];

		foreach ($db_problems as $problem) {
			$problemas[] = ['nome' => $problem['name'], 'severidade' => (int) $problem['severity']];
		}

		return $problemas;
	}

	private static function getScripts(string $hostid): array {
		if (!CWebUser::checkAccess(CRoleHelper::ACTIONS_EXECUTE_SCRIPTS)) {
			return [];
		}

		$scripts_by_host = API::Script()->getScriptsByHosts([['hostid' => $hostid]]);
		$scripts = [];

		foreach ($scripts_by_host[$hostid] ?? [] as $script) {
			if ($script['scope'] != ZBX_SCRIPT_SCOPE_HOST || $script['type'] == ZBX_SCRIPT_TYPE_URL
					|| trim($script['menu_path'], '/') !== self::SCRIPT_MENU_PATH
					|| !preg_match('/^\s*([1-5])\s*-/', $script['name'], $match)) {
				continue;
			}

			$scripts[self::SCRIPT_COMANDOS[$match[1]]] = array_intersect_key($script, array_flip([
				'scriptid', 'confirmation', 'manualinput', 'manualinput_prompt', 'manualinput_validator_type',
				'manualinput_validator', 'manualinput_default_value'
			]));
		}

		if (!$scripts) {
			return $scripts;
		}

		// getScriptsByHosts não devolve os parâmetros; o motivo do bloqueio fica no parâmetro "bloqueio".
		$db_scripts = API::Script()->get([
			'output' => ['scriptid', 'parameters'],
			'scriptids' => array_column($scripts, 'scriptid'),
			'preservekeys' => true
		]);

		foreach ($scripts as &$script) {
			$parametros = array_column($db_scripts[$script['scriptid']]['parameters'] ?? [], 'value', 'name');
			$script['bloqueio'] = $parametros[self::SCRIPT_PARAM_BLOQUEIO] ?? '';
		}
		unset($script);

		return $scripts;
	}

	private static function getSeveridades(): array {
		$severidades = [];

		for ($severity = TRIGGER_SEVERITY_NOT_CLASSIFIED; $severity < TRIGGER_SEVERITY_COUNT; $severity++) {
			$severidades[$severity] = [
				'nome' => CSeverityHelper::getName($severity),
				'classe' => CSeverityHelper::getStatusStyle($severity)
			];
		}

		return $severidades;
	}
}
