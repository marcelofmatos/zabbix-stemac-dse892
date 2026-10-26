<?php declare(strict_types = 0);

namespace Modules\Atalhos\Actions;

use CControllerDashboardWidgetView,
	CControllerResponseData;

class WidgetView extends CControllerDashboardWidgetView {

	protected function doAction(): void {
		$this->setResponse(new CControllerResponseData([
			'name' => $this->getInput('name', $this->widget->getDefaultName()),
			'links' => self::parseLinks($this->fields_values['links']),
			'user' => [
				'debug_mode' => $this->getDebugMode()
			]
		]));
	}

	/**
	 * Converte as linhas "Nome | URL" em links. Só aceita URL relativa do próprio Zabbix ou https://
	 * (descarta javascript:, data: etc.).
	 */
	private static function parseLinks(string $texto): array {
		$links = [];

		foreach (preg_split('/\R/', $texto) as $linha) {
			$partes = array_map('trim', explode('|', $linha, 2));

			if (count($partes) !== 2 || $partes[0] === '' || $partes[1] === '') {
				continue;
			}

			[$nome, $url] = $partes;

			if (preg_match('#^(https://|zabbix\.php\?|/(?!/))#i', $url)) {
				$links[] = ['nome' => $nome, 'url' => $url];
			}
		}

		return $links;
	}
}
