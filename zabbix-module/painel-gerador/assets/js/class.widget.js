class CWidgetPainelGerador extends CWidget {

	static ATUALIZAR_APOS_DIALOGOS_S = 2;
	static VERIFICAR_DIALOGOS_MS = 500;

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

	#espera_dialogos = null;

	onDeactivate() {
		this.#pararEsperaDialogos();
	}

	onDestroy() {
		this.#pararEsperaDialogos();
	}

	setContents(response) {
		super.setContents(response);

		if (response.dados === undefined) {
			return;
		}

		const raiz = this._body.querySelector('.painel-gerador');
		const estado = PainelGeradorEstado.calcular(response.dados);

		if (!estado.comunicacao.ok) {
			raiz.appendChild(this.#el('div', 'pg-comunicacao',
				`Sem comunicação com o gerador: ${estado.comunicacao.motivo}. Valores podem estar desatualizados.`
			));
		}

		const corpo = this.#el('div', 'pg-corpo');
		const cabecalho_diagrama = this.#el('div', 'pg-moldura-cabecalho');

		cabecalho_diagrama.append(this.#subtitulo('🔌 Diagrama'), this.#linkMovel(response.hostid));
		corpo.append(
			this.#moldura('pg-moldura-diagrama', cabecalho_diagrama, this.#diagrama(estado)),
			this.#moldura('pg-moldura-controle', '🚦 Estado',
				this.#modos(estado.modo), this.#alarme(estado.alarme, response),
				this.#subtitulo('⚙️ Motor'), this.#motor(estado.motor),
				this.#subtitulo('🎛️ Comandos'), this.#botoes(estado, response)
			)
		);
		raiz.appendChild(corpo);
	}

	// titulo: texto do subtítulo ou um cabeçalho já montado.
	#moldura(classe, titulo, ...conteudo) {
		const moldura = this.#el('section', `pg-moldura ${classe}`);

		moldura.append(typeof titulo === 'string' ? this.#subtitulo(titulo) : titulo, ...conteudo);

		return moldura;
	}

	// Página "Gerador (celular)" do mesmo host (módulo gerador-movel).
	#linkMovel(hostid) {
		const link = this.#el('a', 'pg-link-movel', '📱 Versão celular');
		const url = new URL('zabbix.php', location.href);

		url.searchParams.set('action', 'gerador.movel');
		url.searchParams.set('hostid', hostid);
		link.setAttribute('href', url.href);

		return link;
	}

	#subtitulo(texto) {
		return this.#el('div', 'pg-subtitulo', texto);
	}

	#diagrama(estado) {
		const {rede, gerador, carga, fonte} = estado;

		// Classe de cada trecho do barramento (fonte -> chave -> carga).
		const trecho = {
			rede: rede.anormal ? 'pg-falha' : (fonte === 'rede' ? 'pg-energizado' : 'pg-morto'),
			gerador: fonte === 'gerador' ? 'pg-energizado' : 'pg-morto'
		};

		const blocos = {
			rede: this.#bloco('pg-rede', 'REDE', this.#iconeRede(),
				rede.anormal ? ['LEITURA ANORMAL', 'pg-selo-falha'] : ['NORMAL', 'pg-selo-ok'],
				['Tensão', 'V', rede.volts], [['Frequência', rede.freq, 1, 'Hz']]
			),
			gerador: this.#bloco('pg-gerador', 'GERADOR', this.#iconeGerador(),
				gerador.girando ? ['GIRANDO', 'pg-selo-ok'] : ['PARADO', 'pg-selo-neutro'],
				['Tensão', 'V', gerador.volts],
				[['Frequência', gerador.freq, 1, 'Hz'], ['Rotação', gerador.rpm, 0, 'rpm']]
			),
			carga: this.#bloco('pg-carga', 'CARGA', this.#iconeCarga(),
				[`${fonte === 'rede' ? '🔌 alimentada pela REDE' : '⚡ alimentada pelo GERADOR'} (estimado)`,
					trecho[fonte] === 'pg-falha' ? 'pg-selo-falha' : 'pg-selo-ok'
				],
				['Corrente', 'A', carga.correntes], [['Potência', carga.kw, 2, 'kW']]
			)
		};

		blocos[fonte].classList.add('pg-ativo');

		if (rede.anormal) {
			blocos.rede.classList.add('pg-anormal');
			blocos.rede.appendChild(this.#el('div', 'pg-nota', 'leitura do controlador'));
		}

		const unifilar = this.#el('div', 'pg-unifilar');
		const diagrama = this.#el('div', 'pg-diagrama');

		unifilar.append(blocos.rede, blocos.gerador, this.#barramento(fonte, trecho), blocos.carga);
		diagrama.appendChild(unifilar);

		return diagrama;
	}

	// Seletor segmentado: as 4 posições sempre visíveis, a ativa destacada.
	#modos(modo_atual) {
		const modos = this.#el('div', 'pg-segmentado');

		for (const [modo, rotulo] of CWidgetPainelGerador.MODOS) {
			modos.appendChild(this.#el('span', modo === modo_atual ? 'pg-segmento pg-aceso' : 'pg-segmento', rotulo));
		}

		return modos;
	}

	#alarme({severidade, total}, {severidades, hostid}) {
		const alarme = this.#el('div', 'pg-alarme');

		if (severidade === -1) {
			alarme.appendChild(this.#el('span', 'pg-badge status-green', '✅ Sem problemas'));

			return alarme;
		}

		// Link para os mesmos problemas: os do host, incluindo suprimidos (a contagem também os inclui).
		const link = this.#el('a', `pg-badge ${severidades[severidade].classe}`,
			`${PainelGeradorEstado.emojiAlarme(severidade)} ${severidades[severidade].nome} · ${total} ${total === 1 ? 'problema' : 'problemas'} ›`
		);
		const url = new URL('zabbix.php', location.href);

		url.searchParams.set('action', 'problem.view');
		url.searchParams.set('filter_set', 1);
		url.searchParams.set('hostids[]', hostid);
		url.searchParams.set('show_suppressed', 1);
		link.setAttribute('href', url.href);
		alarme.appendChild(link);

		return alarme;
	}

	#motor(motor) {
		const tabela = this.#el('div', 'pg-medidas');

		tabela.append(
			...this.#medida('⛽ Combustível', this.#formatar(motor.combustivel.valor, 0, '%'), motor.combustivel.faixa),
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

		const tanque = this.#el('div', 'pg-tanque-coluna');

		tanque.append(this.#tanque(motor.combustivel),
			this.#el('span', 'pg-tanque-valor', this.#formatar(motor.combustivel.valor, 0, '%'))
		);

		const bloco = this.#el('div', 'pg-motor');

		bloco.append(tanque, tabela);

		return bloco;
	}

	#botoes(estado, response) {
		const barra = this.#el('div', 'pg-botoes');

		for (const [cmd, rotulo] of CWidgetPainelGerador.BOTOES) {
			const botao_estado = estado.botoes[cmd];

			if (!botao_estado.visivel) {
				continue;
			}

			const script = response.dados.scripts[cmd];
			// O title fica no invólucro: botão desabilitado não mostra dica em todos os navegadores.
			const involucro = this.#el('span', '');
			const botao = this.#el('button', 'pg-botao');

			const tecla = this.#el('span', 'pg-tecla');

			tecla.appendChild(this.#iconeTecla(cmd));
			botao.append(tecla, this.#el('span', 'pg-rotulo', rotulo));
			botao.type = 'button';
			botao.disabled = !botao_estado.habilitado;

			if (botao_estado.dica !== null) {
				involucro.title = botao_estado.dica;
			}

			if (botao_estado.travado) {
				tecla.appendChild(this.#el('span', 'pg-cadeado zi-lock'));
			}

			botao.addEventListener('click', () => {
				Script.execute(script.scriptid, script.confirmation, botao, response.hostid, null,
					response.csrf_token, script.manualinput, script.manualinput_prompt,
					script.manualinput_validator_type, script.manualinput_validator,
					script.manualinput_default_value
				);

				this.#atualizarAposDialogos();
			});

			involucro.appendChild(botao);
			barra.appendChild(involucro);
		}

		return barra;
	}

	/*
	 * Confirmação, "digite GERADOR" e o resultado da execução são overlays do frontend: a atualização pós-comando
	 * espera todos fecharem (a atualização periódica de 30 s segue normalmente).
	 */
	#atualizarAposDialogos() {
		this.#pararEsperaDialogos();

		this.#espera_dialogos = setInterval(() => {
			if (overlays_stack.length > 0) {
				return;
			}

			this.#pararEsperaDialogos();

			if (this._state === WIDGET_STATE_ACTIVE) {
				this._startUpdating({delay_sec: CWidgetPainelGerador.ATUALIZAR_APOS_DIALOGOS_S});
			}
		}, CWidgetPainelGerador.VERIFICAR_DIALOGOS_MS);
	}

	#pararEsperaDialogos() {
		if (this.#espera_dialogos !== null) {
			clearInterval(this.#espera_dialogos);
			this.#espera_dialogos = null;
		}
	}

	/*
	 * Grade única por bloco (rótulo | L1 | L2 | L3 | unidade): a grandeza por fase e os pares
	 * (Frequência, Rotação, Potência) ficam com rótulos e valores alinhados nas mesmas colunas.
	 */
	#bloco(classe, titulo, icone, [selo, selo_classe], [grandeza, unidade, fases], pares) {
		const bloco = this.#el('div', `pg-bloco ${classe}`);
		const cabecalho = this.#el('div', 'pg-cabecalho');
		const grade = this.#el('div', 'pg-grade');

		cabecalho.append(icone, this.#el('span', 'pg-titulo', titulo), this.#el('span', `pg-selo ${selo_classe}`, selo));

		grade.append(
			this.#el('span', ''),
			...['L1', 'L2', 'L3'].map(fase => this.#el('span', 'pg-fase', fase)),
			this.#el('span', ''),
			this.#el('span', 'pg-rotulo', grandeza),
			...fases.map(valor => this.#el('span', 'pg-numero', this.#formatar(valor, 1, ''))),
			this.#el('span', 'pg-unidade', unidade)
		);

		for (const [rotulo, valor, casas, un] of pares) {
			const celula = this.#el('span', 'pg-numero', this.#formatar(valor, casas, ''));

			grade.append(this.#el('span', 'pg-rotulo', rotulo), celula,
				this.#el('span', 'pg-unidade pg-unidade-par', valor === null ? '' : un)
			);
		}

		bloco.append(cabecalho, grade);

		return bloco;
	}

	#tanque({valor, faixa}) {
		// Área interna do tanque (viewBox 36x64): de y=5 a y=59.
		const topo = 5;
		const altura = 54;
		const nivel = valor === null ? 0 : Math.min(Math.max(valor, 0), 100) / 100 * altura;
		const tanque = this.#svg('svg', {class: 'pg-tanque', viewBox: '0 0 36 64'});

		tanque.append(
			this.#svg('rect', {x: 5, y: topo + altura - nivel, width: 26, height: nivel, rx: 2,
				class: faixa === null ? '' : `pg-nivel-${faixa}`
			}),
			this.#svg('rect', {x: 2, y: 2, width: 32, height: 60, rx: 6, class: 'pg-tanque-contorno'}),
			// Marcas = limites COMBUSTIVEL de painel-estado.js (crítico 20, atenção 50); manter iguais.
			...[20, 50].map(pct => {
				const y = topo + altura * (1 - pct / 100);

				return this.#svg('line', {x1: 2, y1: y, x2: 10, y2: y, class: 'pg-tanque-marca'});
			})
		);

		return tanque;
	}

	#medida(rotulo, valor, faixa) {
		const celula = this.#el('span', '');

		celula.appendChild(this.#el('span', faixa === null ? '' : CWidgetPainelGerador.FAIXA_CLASSE[faixa], valor));

		return [this.#el('span', 'pg-rotulo', rotulo), celula];
	}

	/*
	 * Barramento sem viewBox: colunas em % (rede 25%, carga 50%, gerador 75%) e cada chave num <svg> aninhado
	 * em px, para a chave não deformar quando o widget muda de largura.
	 */
	#barramento(fonte, trecho) {
		const svg = this.#svg('svg', {class: 'pg-barramento'});

		for (const [origem, x, inclinacao] of [['rede', '25%', -12], ['gerador', '75%', 12]]) {
			const classe = trecho[origem];
			const chave = this.#svg('svg', {x, y: 0, overflow: 'visible'});
			const fechada = fonte === origem;

			// Contatos a 14px da caixa de cima: a chave não encosta na borda.
			chave.append(
				this.#svg('line', {x1: 0, y1: 0, x2: 0, y2: 14, class: classe}),
				this.#svg('line', {x1: 0, y1: 14, x2: fechada ? 0 : inclinacao, y2: fechada ? 36 : 32, class: classe}),
				this.#svg('line', {x1: 0, y1: 36, x2: 0, y2: 50, class: classe}),
				this.#svg('circle', {cx: 0, cy: 14, r: 3, class: 'pg-contato'}),
				this.#svg('circle', {cx: 0, cy: 36, r: 3, class: 'pg-contato'})
			);

			svg.append(chave, this.#svg('line', {x1: x, y1: 50, x2: '50%', y2: 50, class: classe}));
		}

		svg.appendChild(this.#svg('line', {x1: '50%', y1: 50, x2: '50%', y2: 70, class: trecho[fonte]}));

		return svg;
	}

	#iconeRede() {
		const svg = this.#svg('svg', {class: 'pg-icone-svg', viewBox: '0 0 24 24'});

		svg.append(
			this.#svg('circle', {cx: 12, cy: 12, r: 10}),
			this.#svg('path', {d: 'M5 12 Q8.5 5 12 12 T19 12'})
		);

		return svg;
	}

	#iconeGerador() {
		const svg = this.#svg('svg', {class: 'pg-icone-svg', viewBox: '0 0 24 24'});
		const letra = this.#svg('text', {x: 12, y: 16.5, 'text-anchor': 'middle', class: 'pg-icone-letra'});

		letra.textContent = 'G';
		svg.append(this.#svg('circle', {cx: 12, cy: 12, r: 10}), letra);

		return svg;
	}

	#iconeCarga() {
		const svg = this.#svg('svg', {class: 'pg-icone-svg', viewBox: '0 0 24 24'});

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
		const svg = this.#svg('svg', {class: 'pg-tecla-icone', viewBox: '0 0 24 24', fill: 'none',
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
