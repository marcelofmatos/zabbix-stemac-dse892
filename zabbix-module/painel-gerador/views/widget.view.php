<?php declare(strict_types = 0);

/**
 * Visão do widget "Painel do gerador": o JS desenha o painel a partir das variáveis.
 *
 * @var CView $this
 * @var array $data
 */

$view = new CWidgetView($data);

if ($data['hostid'] === null) {
	$view->addItem((new CTableInfo())->setNoDataMessage('Selecione o host'));
}
else {
	$view
		->addItem((new CDiv())->addClass('painel-gerador'))
		->setVar('dados', $data['dados'])
		->setVar('hostid', $data['hostid'])
		->setVar('csrf_token', $data['csrf_token'])
		->setVar('severidades', $data['severidades']);
}

$view->show();
