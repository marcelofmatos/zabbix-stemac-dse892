<?php declare(strict_types = 0);

namespace Modules\Atalhos\Includes;

use Zabbix\Widgets\CWidgetForm;
use Zabbix\Widgets\Fields\CWidgetFieldTextArea;

class WidgetForm extends CWidgetForm {

	// Uma linha por link: "Nome | URL".
	private const LINKS_PADRAO = <<<'TXT'
Gerador | zabbix.php?action=gerador.movel
Problemas | zabbix.php?action=problem.view
Dashboards | zabbix.php?action=dashboard.list
TXT;

	public function addFields(): self {
		return $this->addField(
			(new CWidgetFieldTextArea('links', _('Links (Nome | URL, um por linha)')))->setDefault(self::LINKS_PADRAO)
		);
	}
}
