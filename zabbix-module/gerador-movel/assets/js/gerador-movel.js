/*
 * Página do gerador para celular. O estado vem de PainelGeradorEstado.calcular (módulo painel-gerador);
 * as regras de desenho seguem o widget "Painel do gerador" (class.widget.js).
 */
class CGeradorMovel {

	static ATUALIZAR_MS = 10000;
	// Maior que a coleta do modo (10 s), para a página já mostrar o modo novo.
	static ATUALIZAR_APOS_DIALOGOS_MS = 11000;
	static VERIFICAR_DIALOGOS_MS = 500;
	static GRAFICO_ALTURA = 320;

	// Comando e rótulo; o símbolo vem de #iconeTecla. Grade de 3: modos na 1ª linha, motor na 2ª.
	static BOTOES = [
		['stop', 'STOP'],
		['manual', 'MANUAL'],
		['auto', 'AUTO'],
		['partida', 'PARTIDA'],
		['teste', 'TESTE']
	];

	static MODOS = [
		['stop', 'Stop'],
		['manual', 'Manual'],
		['auto', 'Auto'],
		['teste', 'Teste']
	];

	static FAIXA_CLASSE = {
		ok: 'status-green',
		atencao: 'status-yellow',
		critico: 'status-red'
	};

	#hostid;
	#conteudo;
	#falha;
	#falha_desde = null;
	#imagens = [];
	#timer = null;
	#espera_dialogos = null;

	constructor(raiz, {hostid, dados, csrf_token, severidades, graficos}) {
		if (typeof PainelGeradorEstado === 'undefined') {
			raiz.appendChild(this.#el('div', 'gm-aviso',
				'Não foi possível carregar painel-estado.js: o módulo "Painel do gerador" (painel-gerador) precisa estar instalado e ativo.'
			));

			return;
		}

		this.#hostid = hostid;
		this.#conteudo = this.#el('div', 'gm-conteudo');
		this.#falha = this.#el('div', 'gm-comunicacao');
		this.#falha.hidden = true;

		raiz.append(this.#falha, this.#conteudo);

		if (graficos.length > 0) {
			raiz.appendChild(this.#graficos(graficos));
		}

		this.#desenhar({hostid, dados, csrf_token, severidades});
		this.#agendar(CGeradorMovel.ATUALIZAR_MS);
	}

	#agendar(atraso_ms) {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.#atualizar(), atraso_ms);
	}

	async #atualizar() {
		// Não redesenha com diálogo de comando aberto: o botão é o elemento de origem do diálogo.
		if (overlays_stack.length > 0) {
			this.#agendar(CGeradorMovel.VERIFICAR_DIALOGOS_MS);

			return;
		}

		const url = new URL('zabbix.php', location.href);

		url.searchParams.set('action', 'gerador.movel.dados');
		url.searchParams.set('hostid', this.#hostid);

		let resposta;

		try {
			resposta = await fetch(url, {credentials: 'same-origin', cache: 'no-store'});
		}
		catch {
			this.#mostrarFalha(false);
			this.#agendar(CGeradorMovel.ATUALIZAR_MS);

			return;
		}

		let json = null;

		// Sessão expirada: o Zabbix devolve a tela de login em HTML com status 200.
		if (resposta.ok && (resposta.headers.get('Content-Type') || '').includes('application/json')) {
			try {
				json = await resposta.json();
			}
			catch {
				// Tratado abaixo como sessão expirada.
			}
		}

		if (json === null) {
			this.#mostrarFalha(resposta.ok);
			this.#agendar(CGeradorMovel.ATUALIZAR_MS);

			return;
		}

		// Um diálogo pode ter aberto durante a requisição: descarta e busca de novo quando fechar.
		if (overlays_stack.length > 0) {
			this.#agendar(CGeradorMovel.VERIFICAR_DIALOGOS_MS);

			return;
		}

		this.#falha_desde = null;
		this.#falha.hidden = true;
		this.#desenhar(json);
		this.#agendar(CGeradorMovel.ATUALIZAR_MS);
	}

	// Mantém o último estado na tela, avisa e desabilita os comandos até a próxima atualização bem-sucedida.
	#mostrarFalha(sessao_expirada) {
		this.#falha_desde ??= new Date();

		if (sessao_expirada) {
			const link = this.#el('a', 'gm-link', 'Entrar novamente');

			link.setAttribute('href', 'index.php');
			this.#falha.replaceChildren('Sessão expirada. ', link);
		}
		else {
			const desde = this.#falha_desde.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});

			this.#falha.textContent = `Atualização falhou desde ${desde} — dados podem estar desatualizados.`;
		}

		this.#falha.hidden = false;

		for (const botao of this.#conteudo.querySelectorAll('.gm-botao')) {
			botao.disabled = true;
		}
	}

	#desenhar(resposta) {
		if (resposta.hostid === null) {
			this.#conteudo.replaceChildren(this.#el('div', 'gm-aviso', 'Host não encontrado ou sem permissão de acesso.'));

			return;
		}

		const estado = PainelGeradorEstado.calcular(resposta.dados);
		const itens = [this.#topo(resposta.dados.agora)];

		if (!estado.comunicacao.ok) {
			itens.push(this.#el('div', 'gm-comunicacao',
				`Sem comunicação com o gerador: ${estado.comunicacao.motivo}. Valores podem estar desatualizados.`
			));
		}

		// Um cartão só, como a coluna de controle do painel: o modo atual fica junto das teclas que o mudam.
		const controle = this.#secao('⚙️ Motor', this.#motor(estado.motor),
			this.#el('h2', 'gm-subtitulo', '🚦 Estado'), this.#modos(estado.modo),
			this.#badges(estado, resposta.severidades),
			this.#el('h2', 'gm-subtitulo', '🎛️ Comandos'), ...this.#botoes(estado, resposta)
		);

		controle.classList.add('gm-controle');
		itens.push(
			this.#unifilar(estado),
			controle
		);

		this.#conteudo.replaceChildren(...itens);
		this.#recarregarGraficos(resposta.dados.agora);
	}

	#topo(agora) {
		const topo = this.#el('div', 'gm-topo');
		const link = this.#el('a', 'gm-link', '🖥️ Versão completa');
		const url = new URL('zabbix.php', location.href);

		url.searchParams.set('action', 'host.dashboard.view');
		url.searchParams.set('hostid', this.#hostid);
		link.setAttribute('href', url.href);

		topo.append(
			this.#el('span', 'gm-hora', `Atualizado às ${new Date(agora * 1000).toLocaleTimeString('pt-BR')}`),
			link
		);

		return topo;
	}

	#secao(titulo, ...conteudo) {
		const secao = this.#el('section', 'gm-secao');

		secao.append(this.#el('h2', 'gm-subtitulo', titulo), ...conteudo);

		return secao;
	}

	// Seletor segmentado: as 4 posições sempre visíveis, a ativa destacada.
	#modos(modo_atual) {
		const modos = this.#el('div', 'gm-segmentado');

		for (const [modo, rotulo] of CGeradorMovel.MODOS) {
			modos.appendChild(this.#el('span', modo === modo_atual ? 'gm-segmento gm-aceso' : 'gm-segmento', rotulo));
		}

		return modos;
	}

	// Alarme e fonte da carga lado a lado, centralizados.
	#badges(estado, severidades) {
		const badges = this.#el('div', 'gm-badges');

		badges.append(this.#alarme(estado.alarme, severidades), this.#seloFonte(estado));

		return badges;
	}

	#alarme({severidade, total}, severidades) {
		if (severidade === -1) {
			return this.#el('span', 'gm-badge status-green', '✅ Sem problemas');
		}

		// Link para os mesmos problemas: os do host, incluindo suprimidos (a contagem também os inclui).
		const link = this.#el('a', `gm-badge ${severidades[severidade].classe}`,
			`${PainelGeradorEstado.emojiAlarme(severidade)} ${severidades[severidade].nome} · ${total} ${total === 1 ? 'problema' : 'problemas'} ›`
		);
		const url = new URL('zabbix.php', location.href);

		url.searchParams.set('action', 'problem.view');
		url.searchParams.set('filter_set', 1);
		url.searchParams.set('hostids[]', this.#hostid);
		url.searchParams.set('show_suppressed', 1);
		link.setAttribute('href', url.href);

		return link;
	}

	// Sem desenho de barramento: o selo indica a fonte (vermelho se a fonte estimada for a rede anormal).
	#seloFonte({fonte, rede}) {
		const falha = fonte === 'rede' && rede.anormal;

		return this.#el('span', `gm-badge gm-selo ${falha ? 'gm-selo-falha' : 'gm-selo-ok'}`,
			`${fonte === 'rede' ? '🔌 Carga alimentada pela REDE' : '⚡ Carga alimentada pelo GERADOR'} (estimado)`
		);
	}

	// Diagrama unifilar na vertical, aproveitando a largura: REDE -> chave -> CARGA <- chave <- GERADOR.
	#unifilar({rede, gerador, carga, fonte}) {
		// Classe de cada trecho (fonte -> chave -> carga), a mesma regra do painel.
		const trecho = {
			rede: rede.anormal ? 'gm-falha' : (fonte === 'rede' ? 'gm-energizado' : 'gm-morto'),
			gerador: fonte === 'gerador' ? 'gm-energizado' : 'gm-morto'
		};

		const cartoes = {
			rede: this.#cartao('REDE', this.#iconeRede(), rede.anormal ? ['LEITURA ANORMAL', 'gm-selo-falha'] : ['NORMAL', 'gm-selo-ok'],
				['Tensão', 'V', rede.volts], [['Frequência', rede.freq, 1, 'Hz']]
			),
			gerador: this.#cartao('GERADOR', this.#iconeGerador(), gerador.girando ? ['GIRANDO', 'gm-selo-ok'] : ['PARADO', 'gm-selo-neutro'],
				['Tensão', 'V', gerador.volts],
				[['Frequência', gerador.freq, 1, 'Hz'], ['Rotação', gerador.rpm, 0, 'rpm']]
			),
			carga: this.#cartao('CARGA', this.#iconeCarga(), null, ['Corrente', 'A', carga.correntes], [['Potência', carga.kw, 2, 'kW']])
		};

		cartoes[fonte].classList.add('gm-ativo');

		if (rede.anormal) {
			cartoes.rede.classList.add('gm-anormal');
			cartoes.rede.appendChild(this.#el('div', 'gm-nota', 'leitura do controlador'));
		}

		const unifilar = this.#el('div', 'gm-unifilar');

		unifilar.append(cartoes.rede, this.#chave(trecho.rede, fonte === 'rede'), cartoes.carga,
			this.#chave(trecho.gerador, fonte === 'gerador'), cartoes.gerador
		);

		return unifilar;
	}

	// Chave entre dois cartões, centralizada: fechada na fonte que alimenta a carga, aberta (inclinada) na outra.
	#chave(classe, fechada) {
		const svg = this.#svg('svg', {class: 'gm-ligacao', viewBox: '-20 0 40 50', preserveAspectRatio: 'xMidYMid meet'});

		svg.append(
			this.#svg('line', {x1: 0, y1: 0, x2: 0, y2: 14, class: classe}),
			this.#svg('line', {x1: 0, y1: 14, x2: fechada ? 0 : 12, y2: fechada ? 36 : 32, class: classe}),
			this.#svg('line', {x1: 0, y1: 36, x2: 0, y2: 50, class: classe}),
			this.#svg('circle', {cx: 0, cy: 14, r: 3, class: 'gm-contato'}),
			this.#svg('circle', {cx: 0, cy: 36, r: 3, class: 'gm-contato'})
		);

		return svg;
	}

	// Grade rótulo | L1 | L2 | L3 | unidade; os pares (Frequência, Rotação, Potência) alinham com L1.
	#cartao(titulo, icone, selo, [grandeza, unidade, fases], pares) {
		const cartao = this.#el('section', 'gm-cartao');
		const cabecalho = this.#el('div', 'gm-cabecalho');
		const grade = this.#el('div', 'gm-grade');

		const nome = this.#el('h2', 'gm-titulo');

		nome.append(icone, titulo);
		cabecalho.appendChild(nome);

		if (selo !== null) {
			cabecalho.appendChild(this.#el('span', `gm-selo ${selo[1]}`, selo[0]));
		}

		grade.append(
			this.#el('span', ''),
			...['L1', 'L2', 'L3'].map(fase => this.#el('span', 'gm-fase', fase)),
			this.#el('span', ''),
			this.#el('span', 'gm-rotulo', grandeza),
			...fases.map(valor => this.#el('span', 'gm-numero', this.#formatar(valor, 1, ''))),
			this.#el('span', 'gm-unidade', unidade)
		);

		for (const [rotulo, valor, casas, un] of pares) {
			grade.append(this.#el('span', 'gm-rotulo', rotulo),
				this.#el('span', 'gm-numero', this.#formatar(valor, casas, '')),
				this.#el('span', 'gm-unidade gm-unidade-par', valor === null ? '' : un)
			);
		}

		cartao.append(cabecalho, grade);

		return cartao;
	}

	#motor(motor) {
		const tabela = this.#el('div', 'gm-medidas');

		tabela.append(
			...this.#medida('🔋 Bateria', this.#formatar(motor.bateria.valor, 1, 'V'), motor.bateria.faixa),
			...this.#medida('🌡️ Temperatura', this.#formatar(motor.temperatura.valor, 0, '°C'),
				motor.temperatura.faixa
			),
			...this.#medida('🛢️ Óleo',
				motor.oleo.semLeitura ? 'sem leitura' : this.#formatar(motor.oleo.valor, 0, 'kPa'), null
			),
			...this.#medida('⏱️ Horas', this.#formatar(motor.horas, 1, 'h'), null),
			...this.#medida('🔁 Partidas', this.#formatar(motor.partidas, 0, ''), null)
		);

		const tanque = this.#el('div', 'gm-tanque-coluna');

		tanque.append(this.#tanque(motor.combustivel),
			this.#el('span', 'gm-tanque-valor', this.#formatar(motor.combustivel.valor, 0, '%')),
			this.#el('span', 'gm-rotulo', '⛽ Combustível')
		);

		const bloco = this.#el('div', 'gm-motor');

		bloco.append(tanque, tabela);

		return bloco;
	}

	#tanque({valor, faixa}) {
		// Área interna do tanque (viewBox 36x64): de y=5 a y=59.
		const topo = 5;
		const altura = 54;
		const nivel = valor === null ? 0 : Math.min(Math.max(valor, 0), 100) / 100 * altura;
		const tanque = this.#svg('svg', {class: 'gm-tanque', viewBox: '0 0 36 64'});

		tanque.append(
			this.#svg('rect', {x: 5, y: topo + altura - nivel, width: 26, height: nivel, rx: 2,
				class: faixa === null ? '' : `gm-nivel-${faixa}`
			}),
			this.#svg('rect', {x: 2, y: 2, width: 32, height: 60, rx: 6, class: 'gm-tanque-contorno'}),
			// Marcas = limites COMBUSTIVEL de painel-estado.js (crítico 20, atenção 50); manter iguais.
			...[20, 50].map(pct => {
				const y = topo + altura * (1 - pct / 100);

				return this.#svg('line', {x1: 2, y1: y, x2: 10, y2: y, class: 'gm-tanque-marca'});
			})
		);

		return tanque;
	}

	#medida(rotulo, valor, faixa) {
		const celula = this.#el('span', 'gm-valor');

		celula.appendChild(this.#el('span', faixa === null ? '' : CGeradorMovel.FAIXA_CLASSE[faixa], valor));

		return [this.#el('span', 'gm-rotulo', rotulo), celula];
	}

	// Grade de botões e, abaixo, os motivos (bloqueio/dica) agrupados: no celular não há "title" ao passar o mouse.
	#botoes(estado, resposta) {
		const grade = this.#el('div', 'gm-botoes');
		const motivos = new Map();

		for (const [cmd, rotulo] of CGeradorMovel.BOTOES) {
			const botao_estado = estado.botoes[cmd];

			if (!botao_estado.visivel) {
				continue;
			}

			const script = resposta.dados.scripts[cmd];
			const botao = this.#el('button', 'gm-botao');

			const tecla = this.#el('span', 'gm-tecla');

			tecla.appendChild(this.#iconeTecla(cmd));
			botao.append(tecla, this.#el('span', 'gm-botao-rotulo', rotulo));
			botao.type = 'button';
			botao.disabled = !botao_estado.habilitado;

			if (botao_estado.travado) {
				tecla.appendChild(this.#el('span', 'gm-cadeado zi-lock'));
			}

			if (botao_estado.dica !== null) {
				botao.setAttribute('title', botao_estado.dica);
				motivos.set(botao_estado.dica, [...(motivos.get(botao_estado.dica) || []), rotulo]);
			}

			botao.addEventListener('click', () => {
				Script.execute(script.scriptid, script.confirmation, botao, resposta.hostid, null,
					resposta.csrf_token, script.manualinput, script.manualinput_prompt,
					script.manualinput_validator_type, script.manualinput_validator,
					script.manualinput_default_value
				);

				this.#atualizarAposDialogos();
			});

			grade.appendChild(botao);
		}

		if (grade.childElementCount === 0) {
			return [this.#el('div', 'gm-nota-comandos', 'Sem permissão para comandos.')];
		}

		const lista = this.#el('ul', 'gm-motivos');

		for (const [dica, rotulos] of motivos) {
			const item = this.#el('li', '');

			item.append(this.#el('strong', '', rotulos.join(', ')), document.createTextNode(`: ${dica}`));
			lista.appendChild(item);
		}

		return motivos.size > 0 ? [grade, lista] : [grade];
	}

	/*
	 * Confirmação, "digite GERADOR" e o resultado da execução são overlays do frontend: a atualização
	 * pós-comando espera todos fecharem.
	 */
	#atualizarAposDialogos() {
		clearInterval(this.#espera_dialogos);

		this.#espera_dialogos = setInterval(() => {
			if (overlays_stack.length > 0) {
				return;
			}

			clearInterval(this.#espera_dialogos);
			this.#agendar(CGeradorMovel.ATUALIZAR_APOS_DIALOGOS_MS);
		}, CGeradorMovel.VERIFICAR_DIALOGOS_MS);
	}

	#graficos(graficos) {
		const secao = this.#secao('📈 Gráficos (6 h)');

		for (const {graphid, nome} of graficos) {
			const img = this.#el('img', 'gm-grafico');

			img.setAttribute('alt', nome);
			img.dataset.graphid = graphid;
			this.#imagens.push(img);
			secao.appendChild(img);
		}

		return secao;
	}

	// Largura = a da imagem na página; trocar o src mantém a imagem anterior até a nova carregar.
	#recarregarGraficos(agora) {
		for (const img of this.#imagens) {
			const url = new URL('chart2.php', location.href);

			url.searchParams.set('graphid', img.dataset.graphid);
			url.searchParams.set('width', Math.max(img.clientWidth, 100));
			url.searchParams.set('height', CGeradorMovel.GRAFICO_ALTURA);
			url.searchParams.set('outer', 1);
			url.searchParams.set('from', 'now-6h');
			url.searchParams.set('to', 'now');
			url.searchParams.set('_', agora);
			img.setAttribute('src', url.href);
		}
	}

	// Mesmos ícones dos blocos do Painel do gerador.
	#iconeRede() {
		const svg = this.#svg('svg', {class: 'gm-icone-svg', viewBox: '0 0 24 24'});

		svg.append(
			this.#svg('circle', {cx: 12, cy: 12, r: 10}),
			this.#svg('path', {d: 'M5 12 Q8.5 5 12 12 T19 12'})
		);

		return svg;
	}

	#iconeGerador() {
		const svg = this.#svg('svg', {class: 'gm-icone-svg', viewBox: '0 0 24 24'});
		const letra = this.#svg('text', {x: 12, y: 16.5, 'text-anchor': 'middle', class: 'gm-icone-letra'});

		letra.textContent = 'G';
		svg.append(this.#svg('circle', {cx: 12, cy: 12, r: 10}), letra);

		return svg;
	}

	#iconeCarga() {
		const svg = this.#svg('svg', {class: 'gm-icone-svg', viewBox: '0 0 24 24'});

		svg.append(
			this.#svg('rect', {x: 4, y: 3, width: 16, height: 18, rx: 1}),
			this.#svg('line', {x1: 4, y1: 9, x2: 20, y2: 9}),
			this.#svg('line', {x1: 4, y1: 15, x2: 20, y2: 15}),
			this.#svg('line', {x1: 7, y1: 6, x2: 10, y2: 6}),
			this.#svg('line', {x1: 7, y1: 12, x2: 10, y2: 12}),
			this.#svg('line', {x1: 7, y1: 18, x2: 10, y2: 18})
		);

		return svg;
	}

	// Símbolo da tecla, como no painel do controlador (cores fixas: a face da tecla é sempre clara).
	// A mão é o "pointer" do Lucide (ISC).
	#iconeTecla(cmd) {
		const svg = this.#svg('svg', {class: 'gm-tecla-icone', viewBox: '0 0 24 24', fill: 'none',
			'stroke-linecap': 'round', 'stroke-linejoin': 'round'
		});
		const traco = {stroke: '#333333', 'stroke-width': 1.8};

		switch (cmd) {
			case 'stop':
				svg.append(this.#svg('circle', {cx: 12, cy: 12, r: 11, fill: '#d32f2f'}),
					this.#svg('circle', {cx: 12, cy: 12, r: 5, stroke: '#ffffff', 'stroke-width': 2.5})
				);
				break;

			case 'partida':
				svg.append(this.#svg('circle', {cx: 12, cy: 12, r: 11, fill: '#1e7d4f'}),
					this.#svg('line', {x1: 12, y1: 6.5, x2: 12, y2: 17.5, stroke: '#ffffff', 'stroke-width': 2.5})
				);
				break;

			case 'manual':
				svg.append(...[
					'M22 14a8 8 0 0 1-8 8',
					'M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
					'M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1',
					'M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10',
					'M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'
				].map(d => this.#svg('path', {d, ...traco})));
				break;

			case 'auto': {
				const texto = this.#svg('text', {x: 12, y: 14.4, 'text-anchor': 'middle', fill: '#333333',
					'font-size': 6.5, 'font-weight': 'bold'
				});

				texto.textContent = 'AUTO';
				svg.append(this.#svg('rect', {x: 1.5, y: 7, width: 21, height: 10, rx: 1.5, ...traco}), texto);
				break;
			}

			case 'teste':
				// Torre de transmissão riscada: teste com carga.
				svg.append(
					this.#svg('path', {d: 'M12 4.5 8.5 19.5M12 4.5l3.5 15M7.5 8h9M9.5 12.5h5M9 16l6-3.5', ...traco}),
					this.#svg('circle', {cx: 12, cy: 12, r: 10.5, stroke: '#d32f2f', 'stroke-width': 2}),
					this.#svg('line', {x1: 4.6, y1: 4.6, x2: 19.4, y2: 19.4, stroke: '#d32f2f', 'stroke-width': 2})
				);
				break;
		}

		return svg;
	}

	#svg(tag, atributos) {
		const el = document.createElementNS('http://www.w3.org/2000/svg', tag);

		for (const [nome, valor] of Object.entries(atributos)) {
			el.setAttribute(nome, valor);
		}

		return el;
	}

	#formatar(valor, casas, unidade) {
		if (valor === null) {
			return '—';
		}

		const numero = Number(valor).toFixed(casas);

		return unidade === '' ? numero : `${numero} ${unidade}`;
	}

	#el(tag, classe, texto = null) {
		const el = document.createElement(tag);

		if (classe !== '') {
			el.className = classe;
		}

		if (texto !== null) {
			el.textContent = texto;
		}

		return el;
	}
}
