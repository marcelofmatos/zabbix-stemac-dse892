<?php declare(strict_types = 0);

/**
 * Página do gerador para celular: o JS desenha a página a partir dos dados.
 * JS e CSS incluídos só aqui (sem "assets" no manifest, que carregaria em todas as páginas).
 *
 * @var CView $this
 * @var array $data
 */

// O CSS já recebe ?<mtime> do CHtmlPageHeader; os scripts recebem a versão do módulo.
$this->addCssFile($this->getAssetsPath().'/css/gerador-movel.css');

$html_page = (new CHtmlPage())->setTitle('Gerador');

if ($data['hostid'] === null) {
	$html_page
		->addItem((new CTableInfo())->setNoDataMessage('Host não encontrado ou sem permissão de acesso.'))
		->show();
}
else {
	$versao = APP::ModuleManager()->getActionModule()->getVersion();

	$html_page
		->addItem((new CDiv())->addClass('gerador-movel'))
		->show();

	(new CTag('script', true))
		->setAttribute('src', 'modules/painel-gerador/assets/js/painel-estado.js?v='.$versao)
		->show();

	(new CTag('script', true))
		->setAttribute('src', $this->getAssetsPath().'/js/gerador-movel.js?v='.$versao)
		->show();

	// Textos vêm do equipamento (trap, nomes de problemas): escapa < > & ' " para não fechar o <script>.
	$dados_js = json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

	(new CScriptTag('new CGeradorMovel(document.querySelector(".gerador-movel"), '.$dados_js.');'))
		->setOnDocumentReady()
		->show();
}
