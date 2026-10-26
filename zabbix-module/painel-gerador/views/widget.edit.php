<?php declare(strict_types = 0);

/**
 * Formulário de edição do widget "Painel do gerador".
 *
 * @var CView $this
 * @var array $data
 */

(new CWidgetFormView($data))
	->addField(array_key_exists('hostids', $data['fields'])
		? new CWidgetFieldMultiSelectHostView($data['fields']['hostids'])
		: null
	)
	->addField($data['templateid'] === null
		? new CWidgetFieldMultiSelectOverrideHostView($data['fields']['override_hostid'])
		: null
	)
	->show();
