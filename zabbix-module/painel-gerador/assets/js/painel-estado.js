/*
 * Lógica pura do painel do gerador: transforma os dados lidos pelo PHP
 * no estado a ser desenhado. Sem dependência de DOM ou do Zabbix.
 */
var PainelGeradorEstado = (() => {
	const MAX_IDADE_S = 300;
	// Itens coletados a cada 1 min. dse.mode.text não serve: descarta repetidos (heartbeat de 1 h).
	const ITENS_ESSENCIAIS = ['dse.battery.volt', 'dse.mains.volt[L1-N]', 'dse.engine.rpm'];
	const REDE_FREQ_MIN = 55;
	const REDE_FREQ_MAX = 65;
	const GERADOR_FREQ_MIN = 45;
	const COMBUSTIVEL = {critico: 20, atencao: 50};
	const BATERIA = {critico: 11, atencao: 12};
	const TEMPERATURA = {critico: 95, atencao: 85};

	// Fragmentos dos nomes das triggers do template "DSE892 Gerador Stemac by SNMP"
	// (gerador/zabbix/gerar_template.py): precisam coincidir com eles.
	const PROBLEMA_FALTA_REDE = 'falta de rede';
	const PROBLEMA_SEM_LEITURA = 'sem leitura do controlador';

	const DICA_PARTIDA = 'Coloque em Manual para dar partida';
	const DICA_AUTO = 'O controlador está lendo a rede como anormal e o script vai recusar a mudança para Auto';

	// Número ou string numérica -> número; qualquer outra coisa -> null (nunca NaN)
	const numero = v => {
		if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
			return null;
		}
		const n = Number(v);

		return Number.isFinite(n) ? n : null;
	};

	const texto = v => (v === null || v === undefined) ? '' : String(v);

	const faixaMenor = (valor, critico, atencao) => {
		if (valor === null) {
			return null;
		}

		return valor < critico ? 'critico' : (valor < atencao ? 'atencao' : 'ok');
	};

	const faixaMaior = (valor, critico, atencao) => {
		if (valor === null) {
			return null;
		}

		return valor >= critico ? 'critico' : (valor >= atencao ? 'atencao' : 'ok');
	};

	const modoDe = valor => {
		const m = texto(valor).toLowerCase();

		if (m.includes('stop')) {
			return 'stop';
		}
		if (m.includes('man')) {
			return 'manual';
		}
		if (m.includes('auto')) {
			return 'auto';
		}
		if (m.includes('test')) {
			return 'teste';
		}

		return 'desconhecido';
	};

	const redeAnormal = (volts, freq, vmin) => freq === null || freq < REDE_FREQ_MIN || freq > REDE_FREQ_MAX
		|| volts.some(v => v === null || v < vmin);

	// Estimativa: sem leitura direta de qual fonte alimenta a carga
	const estimarFonte = (girando, genFreq, correntes, amin) => {
		const maxCorrente = Math.max(...correntes.map(c => c ?? 0));

		return girando && genFreq !== null && genFreq > GERADOR_FREQ_MIN && maxCorrente > amin ? 'gerador' : 'rede';
	};

	const alarmeDe = problemas => ({
		severidade: Math.max(-1, ...problemas.map(p => numero(p.severidade) ?? -1)),
		total: problemas.length
	});

	const avaliarComunicacao = (itens, agora, problemaCom) => {
		const clocks = ITENS_ESSENCIAIS
			.filter(chave => itens[chave])
			.map(chave => numero(itens[chave].clock));
		const recente = c => c !== null && agora !== null && agora - c <= MAX_IDADE_S;

		if (clocks.length === 0 || !clocks.every(recente)) {
			return {ok: false, motivo: 'sem dados recentes'};
		}
		if (problemaCom(PROBLEMA_SEM_LEITURA)) {
			return {ok: false, motivo: 'DSE892 sem leitura do controlador'};
		}

		return {ok: true, motivo: null};
	};

	const estadoBotoes = (scripts, modo, problemaCom) => {
		const botao = cmd => {
			const visivel = Boolean(scripts[cmd]);
			const estado = {visivel, habilitado: visivel, travado: false, dica: null};

			if (!visivel) {
				return estado;
			}

			// Bloqueio vem do parâmetro "bloqueio" do script e prevalece sobre as demais regras.
			const bloqueio = texto(scripts[cmd].bloqueio);

			if (bloqueio !== '') {
				return {visivel, habilitado: false, travado: true, dica: `Bloqueado: ${bloqueio}`};
			}
			if (cmd === 'partida' && modo !== 'manual' && modo !== 'teste') {
				estado.habilitado = false;
				estado.dica = DICA_PARTIDA;
			}
			if (cmd === 'auto' && problemaCom(PROBLEMA_FALTA_REDE)) {
				estado.travado = true;
				estado.dica = DICA_AUTO;
			}

			return estado;
		};

		return {
			stop: botao('stop'),
			manual: botao('manual'),
			partida: botao('partida'),
			teste: botao('teste'),
			auto: botao('auto')
		};
	};

	const estadoMotor = (val, girando) => {
		const combustivel = val('dse.fuel.level');
		const bateria = val('dse.battery.volt');
		const temperatura = val('dse.engine.coolant.temp');
		const oleo = val('dse.engine.oil.pressure');
		const horas = val('dse.engine.hours');

		return {
			combustivel: {valor: combustivel, faixa: faixaMenor(combustivel, COMBUSTIVEL.critico, COMBUSTIVEL.atencao)},
			bateria: {valor: bateria, faixa: faixaMenor(bateria, BATERIA.critico, BATERIA.atencao)},
			temperatura: {valor: temperatura, faixa: faixaMaior(temperatura, TEMPERATURA.critico, TEMPERATURA.atencao)},
			oleo: {valor: oleo, semLeitura: oleo === 0 && !girando},
			horas: horas === null ? null : Math.round(horas / 3600 * 10) / 10,
			partidas: val('dse.engine.starts')
		};
	};

	function calcular(dados) {
		dados = dados || {};
		const itens = dados.itens || {};
		const problemas = dados.problemas || [];
		const macros = dados.macros || {};
		const vmin = numero(macros.vmin) ?? 100;
		const amin = numero(macros.amin) ?? 5;

		const val = chave => itens[chave] ? numero(itens[chave].valor) : null;
		const trio = fmt => ['L1', 'L2', 'L3'].map(f => val(fmt(f)));
		const problemaCom = trecho => problemas.some(p => texto(p.nome).toLowerCase().includes(trecho));

		const redeVolts = trio(f => `dse.mains.volt[${f}-N]`);
		const redeFreq = val('dse.mains.freq');
		const genFreq = val('dse.gen.freq');
		const rpm = val('dse.engine.rpm');
		const correntes = trio(f => `dse.gen.current[${f}]`);
		const potencia = val('dse.gen.power');
		const girando = rpm !== null && rpm > 0;
		const modo = modoDe(itens['dse.mode.text'] ? itens['dse.mode.text'].valor : null);

		return {
			rede: {volts: redeVolts, freq: redeFreq, anormal: redeAnormal(redeVolts, redeFreq, vmin)},
			gerador: {volts: trio(f => `dse.gen.volt[${f}-N]`), freq: genFreq, rpm, girando},
			carga: {correntes, kw: potencia === null ? null : potencia / 1000},
			fonte: estimarFonte(girando, genFreq, correntes, amin),
			modo,
			alarme: alarmeDe(problemas),
			motor: estadoMotor(val, girando),
			comunicacao: avaliarComunicacao(itens, numero(dados.agora), problemaCom),
			botoes: estadoBotoes(dados.scripts || {}, modo, problemaCom)
		};
	}

	// Emoji do alarme pela severidade do Zabbix: 4-5 (Alta, Desastre), 2-3 (Atenção, Média), 0-1.
	function emojiAlarme(severidade) {
		return severidade >= 4 ? '🚨' : severidade >= 2 ? '⚠️' : 'ℹ️';
	}

	return {calcular, emojiAlarme};
})();

if (typeof module !== 'undefined' && module.exports) {
	module.exports = PainelGeradorEstado;
}
