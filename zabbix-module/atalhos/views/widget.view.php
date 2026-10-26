<?php declare(strict_types = 0);

/**
 * @var CView $this
 * @var array $data
 */

if ($data['links']) {
	$lista = (new CList())->addClass('atalhos');

	foreach ($data['links'] as $link) {
		$lista->addItem(new CLink($link['nome'], $link['url']));
	}
}
else {
	$lista = (new CTableInfo())->setNoDataMessage(_('Nenhum link configurado'));
}

(new CWidgetView($data))
	->addItem($lista)
	->show();
