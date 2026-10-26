<?php declare(strict_types = 0);

namespace Modules\PainelGerador\Actions;

use API,
	CControllerDashboardWidgetView,
	CControllerResponseData,
	CCsrfTokenHelper,
	CMacrosResolverHelper,
	CRoleHelper,
	CSeverityHelper,
	CWebUser;

class WidgetView extends CControllerDashboardWidgetView {

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

	protected function doAction(): void {
		$data = [
			'name' => $this->getInput('name', $this->widget->getDefaultName()),
			'hostid' => null,
			'user' => [
				'debug_mode' => $this->getDebugMode()
			]
		];

		$hostid = $this->getHostid();

		if ($hostid !== null) {
			$data = [
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
			] + $data;
		}

		$this->setResponse(new CControllerResponseData($data));
	}

	private function getHostid(): ?string {
		$hostids = $this->fields_values['override_hostid'];

		if (!$hostids && !$this->isTemplateDashboard()) {
			$hostids = $this->fields_values['hostids'];
		}

		if (!$hostids) {
			return null;
		}

		// Confirma que o usuário tem acesso ao host.
		$hosts = API::Host()->get([
			'output' => ['hostid'],
			'hostids' => $hostids
		]);

		return $hosts ? $hosts[0]['hostid'] : null;
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
