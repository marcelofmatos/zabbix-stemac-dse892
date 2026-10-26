'use strict';

const assert = require('assert');
const Estado = require('../painel-gerador/assets/js/painel-estado.js');

const AGORA = 1792810000;
const CMDS = ['stop', 'manual', 'partida', 'teste', 'auto'];

const script = () => ({
	scriptid: '6', confirmation: 'ok', manualinput: '1', manualinput_prompt: 'p',
	manualinput_validator_type: '0', manualinput_validator: '^GERADOR$', manualinput_default_value: '',
	bloqueio: ''
});

const todosScripts = () => Object.fromEntries(CMDS.map(c => [c, script()]));

const item = (valor, atraso = 60) => ({valor, clock: AGORA - atraso});

// Monta os itens a partir de um mapa chave -> valor
const itens = (mapa, atraso) => Object.fromEntries(
	Object.entries(mapa).map(([k, v]) => [k, item(v, atraso)])
);

const base = (extra = {}) => ({
	'dse.mains.volt[L1-N]': 127, 'dse.mains.volt[L2-N]': 127, 'dse.mains.volt[L3-N]': 127,
	'dse.mains.freq': 60,
	'dse.gen.volt[L1-N]': 0, 'dse.gen.volt[L2-N]': 0, 'dse.gen.volt[L3-N]': 0,
	'dse.gen.freq': 0,
	'dse.gen.current[L1]': 0, 'dse.gen.current[L2]': 0, 'dse.gen.current[L3]': 0,
	'dse.gen.power': 0, 'dse.engine.rpm': 0, 'dse.fuel.level': 80, 'dse.battery.volt': 13,
	'dse.engine.coolant.temp': 40, 'dse.engine.oil.pressure': 0, 'dse.engine.hours': 3600,
	'dse.engine.starts': 10, 'dse.mode.text': 'Auto',
	...extra
});

const dados = (mapa, extra = {}) => ({
	agora: AGORA, macros: {vmin: 100, amin: 5}, itens: itens(mapa),
	problemas: [], scripts: todosScripts(), ...extra
});

function semNaN(obj, caminho = 'r') {
	if (typeof obj === 'number') {
		assert.ok(!Number.isNaN(obj), 'NaN em ' + caminho);
	}
	else if (obj && typeof obj === 'object') {
		Object.entries(obj).forEach(([k, v]) => semNaN(v, caminho + '.' + k));
	}
}

const cenarios = {
	'dados reais: rede com leitura anormal, motor parado, modo Stop'() {
		const r = Estado.calcular(dados(base({
			'dse.mains.volt[L1-N]': 20.2, 'dse.mains.volt[L2-N]': 14.6, 'dse.mains.volt[L3-N]': 13.2,
			'dse.mains.freq': 0,
			'dse.gen.volt[L1-N]': 5.9, 'dse.gen.volt[L2-N]': 5.9, 'dse.gen.volt[L3-N]': 6.0,
			'dse.gen.current[L1]': 28, 'dse.gen.current[L2]': 28, 'dse.gen.current[L3]': 28,
			'dse.gen.power': 75, 'dse.fuel.level': 59, 'dse.battery.volt': 13,
			'dse.engine.coolant.temp': 64, 'dse.engine.oil.pressure': 0,
			'dse.engine.hours': 1805164, 'dse.engine.starts': 1195, 'dse.mode.text': 'Stop'
		}), {
			problemas: [
				{nome: 'Gerador: falta de rede (tensão de entrada < 100 V)', severidade: 4},
				{nome: 'Gerador: controlador fora do modo automático (Stop)', severidade: 4},
				{nome: 'Gerador: combustível baixo (< 50%)', severidade: 4}
			]
		}));
		assert.deepStrictEqual(r.rede.volts, [20.2, 14.6, 13.2]);
		assert.strictEqual(r.rede.anormal, true);
		assert.deepStrictEqual(r.gerador.volts, [5.9, 5.9, 6]);
		assert.strictEqual(r.gerador.girando, false);
		assert.deepStrictEqual(r.carga.correntes, [28, 28, 28]);
		assert.strictEqual(r.carga.kw, 0.075);
		assert.strictEqual(r.fonte, 'rede');
		assert.strictEqual(r.modo, 'stop');
		assert.deepStrictEqual(r.alarme, {severidade: 4, total: 3});
		assert.deepStrictEqual(r.motor.combustivel, {valor: 59, faixa: 'ok'});
		assert.strictEqual(r.motor.combustivel.faixa, 'ok');
		assert.strictEqual(r.motor.bateria.faixa, 'ok');
		assert.strictEqual(r.motor.temperatura.faixa, 'ok');
		assert.strictEqual(r.motor.oleo.semLeitura, true);
		assert.strictEqual(r.motor.horas, 501.4);
		assert.strictEqual(r.motor.partidas, 1195);
		assert.strictEqual(r.botoes.partida.habilitado, false);
		assert.strictEqual(typeof r.botoes.partida.dica, 'string');
		assert.strictEqual(r.botoes.auto.travado, true);
		assert.strictEqual(r.botoes.auto.habilitado, true);
		assert.strictEqual(typeof r.botoes.auto.dica, 'string');
		assert.strictEqual(r.botoes.stop.habilitado, true);
		assert.strictEqual(r.comunicacao.ok, true);
		assert.strictEqual(r.comunicacao.motivo, null);
	},
	'faixas de combustivel (10 critico, 45 atencao, 50 e 59 ok)'() {
		const f = v => Estado.calcular(dados(base({'dse.fuel.level': v}))).motor.combustivel.faixa;
		assert.strictEqual(f(45), 'atencao');
		assert.strictEqual(f(10), 'critico');
		assert.strictEqual(f(50), 'ok');
		assert.strictEqual(f(59), 'ok');
	},
	'faixas de bateria e temperatura'() {
		const b = v => Estado.calcular(dados(base({'dse.battery.volt': v}))).motor.bateria.faixa;
		assert.deepStrictEqual([b(10.9), b(11.5), b(12)], ['critico', 'atencao', 'ok']);
		const t = v => Estado.calcular(dados(base({'dse.engine.coolant.temp': v}))).motor.temperatura.faixa;
		assert.deepStrictEqual([t(95), t(85), t(84.9)], ['critico', 'atencao', 'ok']);
	},
	'rede normal'() {
		const r = Estado.calcular(dados(base()));
		assert.strictEqual(r.rede.anormal, false);
		assert.strictEqual(r.modo, 'auto');
		assert.strictEqual(r.botoes.auto.travado, false);
		assert.strictEqual(r.botoes.auto.dica, null);
		assert.strictEqual(r.alarme.severidade, -1);
		assert.strictEqual(r.alarme.total, 0);
	},
	'gerador em carga'() {
		const r = Estado.calcular(dados(base({
			'dse.engine.rpm': 1800, 'dse.gen.freq': 60, 'dse.engine.oil.pressure': 350,
			'dse.gen.current[L1]': 30, 'dse.gen.current[L2]': 30, 'dse.gen.current[L3]': 30
		})));
		assert.strictEqual(r.fonte, 'gerador');
		assert.strictEqual(r.gerador.girando, true);
		assert.strictEqual(r.motor.oleo.semLeitura, false);
	},
	'motor girando sem carga'() {
		const r = Estado.calcular(dados(base({
			'dse.engine.rpm': 1800, 'dse.gen.freq': 60,
			'dse.gen.current[L1]': 2, 'dse.gen.current[L2]': 2, 'dse.gen.current[L3]': 2
		})));
		assert.strictEqual(r.fonte, 'rede');
	},
	'sem comunicacao'() {
		const velho = Estado.calcular({...dados(base()), itens: itens(base(), 900)});
		assert.deepStrictEqual(velho.comunicacao, {ok: false, motivo: 'sem dados recentes'});
		const dse = Estado.calcular(dados(base(), {
			problemas: [{nome: 'Gerador: DSE892 sem leitura do controlador', severidade: 4}]
		}));
		assert.deepStrictEqual(dse.comunicacao, {ok: false, motivo: 'DSE892 sem leitura do controlador'});
	},
	'usuario sem scripts'() {
		const r = Estado.calcular(dados(base({'dse.mode.text': 'Manual'}), {scripts: {}}));
		CMDS.forEach(c => {
			assert.strictEqual(r.botoes[c].visivel, false, c);
			assert.strictEqual(r.botoes[c].habilitado, false, c);
		});
	},
	'modo Manual'() {
		const r = Estado.calcular(dados(base({'dse.mode.text': 'Manual'})));
		assert.strictEqual(r.modo, 'manual');
		assert.strictEqual(r.botoes.partida.habilitado, true);
		assert.strictEqual(r.botoes.partida.dica, null);
	},
	'modo Test on load'() {
		const r = Estado.calcular(dados(base({'dse.mode.text': 'Test on Load'})));
		assert.strictEqual(r.modo, 'teste');
		assert.strictEqual(r.botoes.partida.habilitado, true);
	},
	'rede anormal por frequencia com tensoes normais'() {
		const f = hz => Estado.calcular(dados(base({'dse.mains.freq': hz}))).rede.anormal;
		assert.deepStrictEqual([f(54), f(66), f(55), f(65)], [true, true, false, false]);
	},
	'vmin customizado via macros'() {
		const d = dados(base({'dse.mains.volt[L1-N]': 110}));
		assert.strictEqual(Estado.calcular(d).rede.anormal, false);
		d.macros = {vmin: 120, amin: 5};
		assert.strictEqual(Estado.calcular(d).rede.anormal, true);
	},
	'limites da estimativa de fonte (amin e frequencia)'() {
		const fonte = (amp, hz) => Estado.calcular(dados(base({
			'dse.engine.rpm': 1800, 'dse.gen.freq': hz,
			'dse.gen.current[L1]': amp, 'dse.gen.current[L2]': 0, 'dse.gen.current[L3]': 0
		}))).fonte;
		assert.deepStrictEqual([fonte(5, 60), fonte(5.1, 60), fonte(30, 45), fonte(30, 45.1)],
			['rede', 'gerador', 'rede', 'gerador']);
	},
	'severidades mistas: maior vence'() {
		const r = Estado.calcular(dados(base(), {problemas: [
			{nome: 'a', severidade: 2}, {nome: 'b', severidade: 5}, {nome: 'c', severidade: 3}
		]}));
		assert.deepStrictEqual(r.alarme, {severidade: 5, total: 3});
	},
	'partida desabilitada em auto e desconhecido mesmo com script'() {
		['Auto', 'Xyz'].forEach(m => {
			const b = Estado.calcular(dados(base({'dse.mode.text': m}))).botoes.partida;
			assert.strictEqual(b.visivel, true);
			assert.strictEqual(b.habilitado, false);
			assert.strictEqual(typeof b.dica, 'string');
		});
	},
	'item sem clock nao quebra nem conta como recente'() {
		const d = dados(base());
		Object.values(d.itens).forEach(i => delete i.clock);
		const r = Estado.calcular(d);
		semNaN(r);
		assert.deepStrictEqual(r.comunicacao, {ok: false, motivo: 'sem dados recentes'});
	},
	'arredondamento de horas'() {
		const h = s => Estado.calcular(dados(base({'dse.engine.hours': s}))).motor.horas;
		assert.deepStrictEqual([h(5400), h(3599)], [1.5, 1]);
	},
	'item essencial velho com os demais recentes'() {
		const d = dados(base());
		d.itens['dse.battery.volt'].clock = AGORA - 900;
		assert.deepStrictEqual(Estado.calcular(d).comunicacao, {ok: false, motivo: 'sem dados recentes'});
	},
	'item nao essencial velho nao derruba a comunicacao'() {
		const d = dados(base());
		d.itens['dse.engine.starts'].clock = AGORA - 900;
		assert.strictEqual(Estado.calcular(d).comunicacao.ok, true);
	},
	'travado e dica do auto so quando o botao e visivel'() {
		const d = dados(base(), {problemas: [{nome: 'Gerador: falta de rede', severidade: 4}]});
		delete d.scripts.auto;
		const b = Estado.calcular(d).botoes.auto;
		assert.deepStrictEqual(b, {visivel: false, habilitado: false, travado: false, dica: null});
	},
	'mode.text velho (2 h, descarte de repetidos) com essenciais recentes'() {
		const d = dados(base());
		d.itens['dse.mode.text'].clock = AGORA - 7200;
		assert.deepStrictEqual(Estado.calcular(d).comunicacao, {ok: true, motivo: null});
	},
	'rpm velho derruba a comunicacao'() {
		const d = dados(base());
		d.itens['dse.engine.rpm'].clock = AGORA - 900;
		assert.deepStrictEqual(Estado.calcular(d).comunicacao, {ok: false, motivo: 'sem dados recentes'});
	},
	'comando bloqueado: visivel, desabilitado, com cadeado e motivo'() {
		const d = dados(base({'dse.mode.text': 'Manual'}));
		d.scripts.partida.bloqueio = 'gerador em manutenção';
		const b = Estado.calcular(d).botoes.partida;
		assert.deepStrictEqual(b, {
			visivel: true, habilitado: false, travado: true, dica: 'Bloqueado: gerador em manutenção'
		});
	},
	'bloqueio prevalece sobre a trava do auto e da partida'() {
		const d = dados(base(), {problemas: [{nome: 'Gerador: falta de rede', severidade: 4}]});
		d.scripts.auto.bloqueio = 'x';
		d.scripts.partida.bloqueio = 'y';
		const r = Estado.calcular(d);
		assert.deepStrictEqual(r.botoes.auto, {visivel: true, habilitado: false, travado: true, dica: 'Bloqueado: x'});
		assert.deepStrictEqual(r.botoes.partida, {visivel: true, habilitado: false, travado: true, dica: 'Bloqueado: y'});
	},
	'bloqueio vazio ou ausente nao bloqueia'() {
		const d = dados(base());
		delete d.scripts.stop.bloqueio;
		const r = Estado.calcular(d);
		['stop', 'manual', 'teste'].forEach(c => assert.deepStrictEqual(r.botoes[c],
			{visivel: true, habilitado: true, travado: false, dica: null}, c));
	},
	'valores ausentes'() {
		[Estado.calcular({agora: AGORA, itens: {}}), Estado.calcular({})].forEach(r => {
			semNaN(r);
			assert.deepStrictEqual(r.rede.volts, [null, null, null]);
			assert.strictEqual(r.rede.anormal, true);
			assert.strictEqual(r.carga.kw, null);
			assert.strictEqual(r.motor.horas, null);
			assert.strictEqual(r.motor.combustivel.faixa, null);
			assert.strictEqual(r.modo, 'desconhecido');
			assert.strictEqual(r.comunicacao.ok, false);
			assert.strictEqual(r.comunicacao.motivo, 'sem dados recentes');
			assert.strictEqual(r.fonte, 'rede');
			CMDS.forEach(c => assert.strictEqual(r.botoes[c].visivel, false));
		});
	},
	'strings numericas e nulos'() {
		const d = dados(base());
		d.itens['dse.mains.volt[L1-N]'] = {valor: '127.5', clock: AGORA};
		d.itens['dse.fuel.level'] = {valor: null, clock: AGORA};
		d.itens['dse.battery.volt'] = {valor: 'abc', clock: AGORA};
		const r = Estado.calcular(d);
		semNaN(r);
		assert.strictEqual(r.rede.volts[0], 127.5);
		assert.strictEqual(r.motor.combustivel.valor, null);
		assert.strictEqual(r.motor.bateria.valor, null);
	},

	'emoji do alarme por severidade': () => {
		assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map(Estado.emojiAlarme), ['ℹ️', 'ℹ️', '⚠️', '⚠️', '🚨', '🚨']);
	}
};

let falhas = 0;
Object.entries(cenarios).forEach(([nome, fn]) => {
	try {
		fn();
		console.log('PASS ' + nome);
	}
	catch (e) {
		falhas++;
		console.log('FAIL ' + nome + '\n     ' + e.message);
	}
});
console.log(falhas ? falhas + ' cenario(s) falharam' : 'todos os cenarios passaram');
process.exit(falhas ? 1 : 0);
