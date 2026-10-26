<?php declare(strict_types = 0);

namespace Modules\GeradorMovel\Actions;

use API,
	CControllerResponseData;

/**
 * Página do gerador para celular.
 */
class GeradorMovel extends GeradorMovelBase {

	// Gráficos do template, na ordem da página.
	private const GRAFICOS = [
		'Tensão de entrada (rede) - 3 fases',
		'Tensão de saída (gerador) - 3 fases',
		'Corrente da carga - 3 fases'
	];

	protected function doAction(): void {
		$data = self::getEstado($this->getHostid());

		if ($data['hostid'] !== null) {
			$data['graficos'] = self::getGraficos($data['hostid']);
		}

		$response = new CControllerResponseData($data);
		$response->setTitle('Gerador');
		$this->setResponse($response);
	}

	private static function getGraficos(string $hostid): array {
		$graphids = array_column(API::Graph()->get([
			'output' => ['graphid', 'name'],
			'hostids' => [$hostid],
			'filter' => ['name' => self::GRAFICOS]
		]), 'graphid', 'name');

		$graficos = [];

		foreach (self::GRAFICOS as $nome) {
			if (array_key_exists($nome, $graphids)) {
				$graficos[] = ['graphid' => $graphids[$nome], 'nome' => $nome];
			}
		}

		return $graficos;
	}
}
