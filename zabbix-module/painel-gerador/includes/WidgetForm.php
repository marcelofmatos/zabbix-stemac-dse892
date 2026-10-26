<?php declare(strict_types = 0);

namespace Modules\PainelGerador\Includes;

use Zabbix\Widgets\CWidgetForm;

use Zabbix\Widgets\Fields\{
	CWidgetFieldMultiSelectHost,
	CWidgetFieldMultiSelectOverrideHost
};

/**
 * Formulário do widget "Painel do gerador".
 */
class WidgetForm extends CWidgetForm {

	public function addFields(): self {
		return $this
			->addField($this->isTemplateDashboard()
				? null
				: (new CWidgetFieldMultiSelectHost('hostids', _('Host')))->setMultiple(false)
			)
			->addField(
				new CWidgetFieldMultiSelectOverrideHost()
			);
	}
}
