<?php declare(strict_types = 0);

namespace Modules\GeradorMovel\Actions;

use CControllerResponseData;

/**
 * Estado do gerador em JSON, para a página se atualizar sem recarregar.
 */
class GeradorMovelDados extends GeradorMovelBase {

	protected function doAction(): void {
		$this->setResponse(new CControllerResponseData([
			'main_block' => json_encode(self::getEstado($this->getHostid()))
		]));
	}
}
