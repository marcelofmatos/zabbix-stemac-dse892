<?php
namespace {
	$parse = new ReflectionMethod(Modules\Atalhos\Actions\WidgetView::class, 'parseLinks');

	$entrada = implode("\n", [
		'Gerador | zabbix.php?action=host.dashboard.view&hostid=10001',
		'Ext | https://chamados.example.com/',
		'Raiz | /zabbix.php?action=problem.view',
		'XSS | javascript:alert(1)',
		'Data | data:text/html,<b>x</b>',
		'ProtoRel | //evil.example.com',
		'Http | http://inseguro.example.com',
		'sem url |',
		'linha sem separador',
		'',
		'  Espaços  |  zabbix.php?action=dashboard.view&dashboardid=38  '
	]);

	$esperado = [
		['nome' => 'Gerador', 'url' => 'zabbix.php?action=host.dashboard.view&hostid=10001'],
		['nome' => 'Ext', 'url' => 'https://chamados.example.com/'],
		['nome' => 'Raiz', 'url' => '/zabbix.php?action=problem.view'],
		['nome' => 'Espaços', 'url' => 'zabbix.php?action=dashboard.view&dashboardid=38']
	];

	$obtido = $parse->invoke(null, $entrada);

	if ($obtido === $esperado) {
		echo "PASS parseLinks: aceita relativos e https, rejeita javascript:, data:, //, http e linhas inválidas\n";
		exit(0);
	}

	echo "FAIL parseLinks\n", var_export($obtido, true), "\n";
	exit(1);
}
