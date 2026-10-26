// Injeta manifest e metas de app (Android/iPhone) em todas as páginas do Zabbix.
(() => {
	const base = 'modules/pwa-zabbix/assets/';
	const elementos = [
		['link', {rel: 'manifest', href: `${base}pwa.webmanifest`}],
		['link', {rel: 'apple-touch-icon', href: `${base}icons/apple-touch-icon.png`}],
		['meta', {name: 'theme-color', content: '#0a466a'}],
		['meta', {name: 'apple-mobile-web-app-capable', content: 'yes'}],
		['meta', {name: 'mobile-web-app-capable', content: 'yes'}],
		['meta', {name: 'apple-mobile-web-app-title', content: 'Zabbix'}],
		['meta', {name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent'}]
	];

	for (const [tag, atributos] of elementos) {
		const el = document.createElement(tag);

		for (const [nome, valor] of Object.entries(atributos)) {
			el.setAttribute(nome, valor);
		}

		document.head.appendChild(el);
	}
})();
