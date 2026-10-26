#!/usr/bin/env python3
"""Gera o template Zabbix 7.0 do gerador Stemac (controlador DSE7320) lido pelo gateway DSE892.

Saída: template_dse892_gerador.yaml (mesma pasta). Os UUIDs são derivados do nome do objeto
(uuid5 com bits de v4), então reexecutar o script gera o mesmo arquivo e o reimport atualiza em vez de duplicar.
"""
import pathlib
import uuid

import yaml

NS = uuid.UUID("6f1d3c2a-8a51-4c47-9d0e-2b7a0c5e9f10")
TPL = "DSE892 Gerador Stemac by SNMP"
INST = ".1.3.6.1.4.1.41385.1.3.1.1"   # instrumentTable (dseInstrumentEntry)
CTRL = ".1.3.6.1.4.1.41385.1.3.3.1"   # controlTable
# Valores-sentinela da GenComm (0x7FFFFFF8..0x7FFFFFFF = sem sensor / fora de faixa / erro)
SENTINEL_MAX = "2147483639"


def uid(name):
    # O Zabbix só aceita UUIDv4: reaproveita os bits do uuid5 marcando versão 4
    return uuid.UUID(bytes=uuid.uuid5(NS, name).bytes, version=4).hex


def instrument(col, key, name, units, mult=None, signed=False, value_type="FLOAT", delay="1m",
               tags=("component", "gerador"), triggers=None, history="90d"):
    pre = [{
        "type": "IN_RANGE",
        "parameters": ["-2147483647" if signed else "0", SENTINEL_MAX],
        "error_handler": "DISCARD_VALUE",
    }]
    if mult:
        pre.append({"type": "MULTIPLIER", "parameters": [mult]})
    item = {
        "uuid": uid(key),
        "name": name,
        "type": "SNMP_AGENT",
        "snmp_oid": f"{INST}.{col}.{{$DSE.INSTANCE}}",
        "key": key,
        "delay": delay,
        "history": history,
        "value_type": value_type,
        "units": units,
        "preprocessing": pre,
        "tags": [{"tag": tags[0], "value": tags[1]}],
    }
    if triggers:
        item["triggers"] = triggers
    return item


def trig(name, expr, priority, desc="", recovery=None):
    t = {"uuid": uid("trg:" + name), "expression": expr, "name": name, "priority": priority}
    if recovery:
        t["recovery_mode"] = "RECOVERY_EXPRESSION"
        t["recovery_expression"] = recovery
    if desc:
        t["description"] = desc
    return t


def k(key):
    return f"/{TPL}/{key}"


items = []

# --- Rede (entrada) ---
for col, ph in ((24, "L1-N"), (25, "L2-N"), (26, "L3-N"), (27, "L1-L2"), (28, "L2-L3"), (29, "L3-L1")):
    items.append(instrument(col, f"dse.mains.volt[{ph}]", f"Rede: tensão {ph}", "V", "0.1",
                            tags=("component", "rede")))
items.append(instrument(23, "dse.mains.freq", "Rede: frequência", "Hz", "0.1", tags=("component", "rede")))

# --- Gerador (saída) ---
for col, ph in ((7, "L1-N"), (8, "L2-N"), (9, "L3-N"), (19, "L1-L2"), (20, "L2-L3"), (21, "L3-L1")):
    items.append(instrument(col, f"dse.gen.volt[{ph}]", f"Gerador: tensão {ph}", "V", "0.1"))
items.append(instrument(18, "dse.gen.freq", "Gerador: frequência", "Hz", "0.1"))
for col, ph in ((10, "L1"), (11, "L2"), (12, "L3")):
    items.append(instrument(col, f"dse.gen.current[{ph}]", f"Gerador: corrente {ph}", "A", "0.1"))
items.append(instrument(52, "dse.gen.power", "Gerador: potência ativa total", "W", signed=True))
items.append(instrument(56, "dse.gen.va", "Gerador: potência aparente total", "VA"))
items.append(instrument(64, "dse.gen.pf", "Gerador: fator de potência médio", "", "0.01", signed=True))
items.append(instrument(92, "dse.gen.kwh", "Gerador: energia acumulada", "kWh", "0.1", delay="10m"))

# --- Motor ---
items.append(instrument(2, "dse.engine.oil.pressure", "Motor: pressão do óleo", "kPa", tags=("component", "motor")))
items.append(instrument(3, "dse.engine.coolant.temp", "Motor: temperatura do líquido de arrefecimento", "°C",
                        signed=True, tags=("component", "motor")))
combustivel = instrument(4, "dse.fuel.level", "Motor: nível de combustível", "%", tags=("component", "motor"))
# Tanque adaptado: o sensor marca {$DSE.FUEL.EMPTY} % vazio e {$DSE.FUEL.FULL} % cheio; reescala para 0–100 %.
combustivel["preprocessing"].append({
    "type": "JAVASCRIPT",
    "parameters": ["var v = (value - {$DSE.FUEL.EMPTY}) * 100 / ({$DSE.FUEL.FULL} - {$DSE.FUEL.EMPTY});\n"
                   "return Math.min(Math.max(v, 0), 100);"],
})
combustivel["description"] = ("Nível real do tanque: (leitura do controlador − {$DSE.FUEL.EMPTY}) × 100 / "
                              "({$DSE.FUEL.FULL} − {$DSE.FUEL.EMPTY}), limitado a 0–100 %.")
items.append(combustivel)
items.append(instrument(5, "dse.battery.volt", "Motor: tensão da bateria de partida", "V", "0.1",
                        tags=("component", "motor"), triggers=[
                            trig("Gerador: DSE892 sem leitura do controlador",
                                 f"max({k('dse.battery.volt')},3m)=0", "HIGH",
                                 "Bateria lida como 0: o DSE892 perdeu o DSE7320 (RS485) e devolve NULL, "
                                 "que o Zabbix grava como 0. Demais triggers do controlador ficam suspensas."),
                        ]))
items.append(instrument(6, "dse.engine.rpm", "Motor: rotação", "rpm", tags=("component", "motor"), triggers=[
    trig("Gerador: motor em funcionamento",
         f"min({k('dse.engine.rpm')},2m)>0", "WARNING",
         "Motor girando. Esperado durante falta de rede ou teste programado.",
         f"max({k('dse.engine.rpm')},5m)=0"),
]))
items.append(instrument(91, "dse.engine.hours", "Motor: tempo de funcionamento", "s",
                        value_type="UNSIGNED", delay="10m", tags=("component", "motor")))
items.append(instrument(95, "dse.engine.starts", "Motor: número de partidas", "",
                        value_type="UNSIGNED", delay="10m", tags=("component", "motor")))

# --- Controle / gateway ---
# Modo a cada 10 s: o painel só libera PARTIDA depois de ler Manual/Teste.
items.append({
    "uuid": uid("dse.mode"), "name": "Controlador: modo de operação (código)", "type": "SNMP_AGENT",
    "snmp_oid": f"{CTRL}.2.{{$DSE.INSTANCE}}", "key": "dse.mode", "delay": "10s",
    "value_type": "UNSIGNED", "tags": [{"tag": "component", "value": "controle"}],
})
items.append({
    "uuid": uid("dse.mode.text"), "name": "Controlador: modo de operação", "type": "SNMP_AGENT",
    "snmp_oid": f"{CTRL}.3.{{$DSE.INSTANCE}}", "key": "dse.mode.text", "delay": "10s",
    "history": "30d", "value_type": "CHAR",
    "preprocessing": [{"type": "DISCARD_UNCHANGED_HEARTBEAT", "parameters": ["1h"]}],
    "tags": [{"tag": "component", "value": "controle"}],
    "triggers": [trig("Gerador: controlador fora do modo automático ({ITEM.LASTVALUE1})",
                      f"find({k('dse.mode.text')},,\"iregexp\",\"auto\")=0 and length(last({k('dse.mode.text')}))>0",
                      "HIGH", "Fora do modo Auto o gerador não parte sozinho numa falta de rede.")],
})
items.append({
    "uuid": uid("dse.uptime"), "name": "Gateway DSE892: uptime", "type": "SNMP_AGENT",
    "snmp_oid": ".1.3.6.1.2.1.1.3.0", "key": "dse.gw.uptime", "delay": "1m", "units": "uptime",
    "value_type": "UNSIGNED", "preprocessing": [{"type": "MULTIPLIER", "parameters": ["0.01"]}],
    "tags": [{"tag": "component", "value": "gateway"}],
    "triggers": [
        trig("Gateway DSE892 reiniciou", f"last({k('dse.gw.uptime')})<600", "INFO"),
        trig("Gateway DSE892 sem resposta SNMP há 10 min", f"nodata({k('dse.gw.uptime')},10m)=1", "HIGH"),
    ],
})
# --- Traps ---
# Sem a MIB DSE-892 no snmptrapd: os OIDs chegam numéricos
# ("SNMPv2-SMI::enterprises.41385.1.1.1.1.6 = ..."), por isso as regex usam o número.
TRAP_KEY = 'snmptrap["41385\\.1\\.1\\.2"]'


def trap_field(col, key, name, value_type="CHAR"):
    """Item dependente que extrai uma coluna da eventEntry (varbind do dseEventTrap)."""
    return {
        "uuid": uid(key), "name": name, "type": "DEPENDENT", "key": key, "delay": "0",
        "history": "90d", "value_type": value_type,
        "preprocessing": [{
            "type": "REGEX",
            "parameters": [rf"41385\.1\.1\.1\.1\.{col}(?:\.\d+)* = (?:\w+: )?\"?([^\"\n]*)", r"\1"],
            "error_handler": "DISCARD_VALUE",
        }],
        "master_item": {"key": TRAP_KEY},
        "tags": [{"tag": "component", "value": "trap"}],
    }


items.append({
    "uuid": uid("dse.trap"), "name": "Trap: evento DSE (dseEventTrap)", "type": "SNMP_TRAP",
    "key": TRAP_KEY, "value_type": "LOG", "history": "90d",
    "description": "Trap dseEventTrap (.1.3.6.1.4.1.41385.1.1.2.1) com a eventEntry nos varbinds.",
    # Sem trigger genérica: o DSE manda trap em todo evento (troca de modo, partida, teste)
    # e o polling já cobre rede/motor/modo. Só a parada por alarme vira problema.
    "tags": [{"tag": "component", "value": "trap"}],
})
items.append(trap_field(6, "dse.trap.description", "Trap: descrição do evento"))
items.append(trap_field(1, "dse.trap.type", "Trap: tipo do evento", "UNSIGNED"))
items.append(trap_field(2, "dse.trap.subtype", "Trap: subtipo do evento", "UNSIGNED"))
items.append(trap_field(8, "dse.trap.module", "Trap: módulo de origem"))
items.append({
    "uuid": uid("snmptrap.fallback"), "name": "Trap: não reconhecido (fallback)", "type": "SNMP_TRAP",
    "key": "snmptrap.fallback", "value_type": "LOG", "history": "30d",
    "description": "Traps do DSE892 que não casaram com outro item (coldStart etc.).",
    "tags": [{"tag": "component", "value": "trap"}],
})

# Com o RS485 caído o DSE892 devolve NULL (gravado como 0): sem esta guarda, a perda de
# comunicação viraria "combustível crítico", "falta de rede" etc.
LINK_OK = f"last({k('dse.battery.volt')})>0"

top_triggers = [
    trig("Gerador: temperatura do motor alta (> {$DSE.COOLANT.MAX} °C)",
         f"min({k('dse.engine.coolant.temp')},3m)>{{$DSE.COOLANT.MAX}} and {LINK_OK}", "DISASTER"),
    trig("Gerador: combustível crítico (< {$DSE.FUEL.CRIT}%)",
         f"last({k('dse.fuel.level')})<{{$DSE.FUEL.CRIT}} and {LINK_OK}", "DISASTER"),
    trig("Gerador: combustível baixo (< {$DSE.FUEL.LOW}%)",
         f"avg({k('dse.fuel.level')},15m)<{{$DSE.FUEL.LOW}} and {LINK_OK}", "HIGH"),
    trig("Gerador: bateria de partida baixa (< {$DSE.BATT.MIN} V)",
         f"max({k('dse.battery.volt')},10m)<{{$DSE.BATT.MIN}} and {LINK_OK}", "HIGH"),
    trig("Gerador: falta de rede (tensão de entrada < {$DSE.MAINS.VMIN} V)",
         "(" + " or ".join(f"max({k(f'dse.mains.volt[{p}]')},2m)<{{$DSE.MAINS.VMIN}}"
                           for p in ("L1-N", "L2-N", "L3-N")) + f") and {LINK_OK}",
         "HIGH", "Alguma fase da rede abaixo do mínimo por 2 min.",
         " and ".join(f"min({k(f'dse.mains.volt[{p}]')},5m)>={{$DSE.MAINS.VMIN}}" for p in ("L1-N", "L2-N", "L3-N"))),
    {**trig("Gerador: parada por alarme (trap): {ITEM.LASTVALUE1}",
            f"find({k('dse.trap.description')},10m,\"iregexp\",\"shutdown|electrical trip|parada|desligamento\")=1",
            "DISASTER", "O DSE7320 reportou shutdown/electrical trip por trap. Fechar manualmente após verificar."),
     "manual_close": "YES"},
    trig("Gerador: assumiu a carga (gerando com rede em falta)",
         f"min({k('dse.engine.rpm')},2m)>0 and max({k('dse.gen.current[L1]')},2m)>{{$DSE.GEN.LOAD.AMIN}}",
         "HIGH", "", f"max({k('dse.engine.rpm')},5m)=0"),
]


def graph(name, keys):
    colors = ["E53935", "1E88E5", "43A047"]
    return {
        "uuid": uid("graph:" + name), "name": name,
        "graph_items": [{"sortorder": str(i), "color": c, "item": {"host": TPL, "key": key}}
                        for i, (key, c) in enumerate(zip(keys, colors))],
    }


G_MAINS = "Tensão de entrada (rede) - 3 fases"
G_GEN = "Tensão de saída (gerador) - 3 fases"
G_LOAD = "Corrente da carga - 3 fases"


def w_item(x, y, w, h, name, key):
    return {"type": "item", "name": name, "x": str(x), "y": str(y), "width": str(w), "height": str(h),
            "fields": [{"type": "ITEM", "name": "itemid.0", "value": {"host": TPL, "key": key}}]}


def w_gauge(x, y, w, h, name, key, lo, hi, thresholds):
    fields = [{"type": "ITEM", "name": "itemid.0", "value": {"host": TPL, "key": key}},
              {"type": "STRING", "name": "min", "value": lo},
              {"type": "STRING", "name": "max", "value": hi}]
    for i, (color, value) in enumerate(thresholds):
        fields += [{"type": "STRING", "name": f"thresholds.{i}.color", "value": color},
                   {"type": "STRING", "name": f"thresholds.{i}.threshold", "value": value}]
    return {"type": "gauge", "name": name, "x": str(x), "y": str(y), "width": str(w), "height": str(h),
            "fields": fields}


def w_graph(x, y, w, h, gname):
    return {"type": "graph", "name": gname, "x": str(x), "y": str(y), "width": str(w), "height": str(h),
            "fields": [{"type": "GRAPH", "name": "graphid.0", "value": {"host": TPL, "name": gname}}]}


def abaixo(dy, widgets):
    """Desloca widgets dy linhas para baixo (para empilhar seções numa mesma página)."""
    return [{**w, "y": str(int(w["y"]) + dy)} for w in widgets]


RED, YELLOW, GREEN = "E53935", "FFB300", "43A047"
PAINEL_ALTURA = 9
dashboard = {
    "uuid": uid("dashboard"),
    "name": "Gerador - visão geral",
    # Página única: o painel em cima, os gráficos de tensão e corrente logo abaixo e, por fim, os indicadores.
    "pages": [{"widgets": [
        # widget do módulo painel-gerador (zabbix-module/); host vem do contexto
        {"type": "painelgerador", "name": "Painel do gerador", "x": "0", "y": "0", "width": "72",
         "height": str(PAINEL_ALTURA)},
    ] + abaixo(PAINEL_ALTURA, [
        # gráficos: tensão de entrada x saída, corrente da carga
        w_graph(0, 0, 36, 8, G_MAINS),
        w_graph(36, 0, 36, 8, G_GEN),
        w_graph(0, 8, 72, 7, G_LOAD),
        # indicadores: estado e motor
        w_item(0, 15, 12, 4, "Modo do controlador", "dse.mode.text"),
        w_item(12, 15, 12, 4, "Rotação do motor", "dse.engine.rpm"),
        w_gauge(24, 15, 12, 4, "Combustível", "dse.fuel.level", "0", "100",
                [(RED, "0"), (YELLOW, "20"), (GREEN, "50")]),
        w_gauge(36, 15, 12, 4, "Bateria de partida", "dse.battery.volt", "0", "16",
                [(RED, "0"), (YELLOW, "11"), (GREEN, "12")]),
        w_gauge(48, 15, 12, 4, "Temperatura do motor", "dse.engine.coolant.temp", "0", "120",
                [(GREEN, "0"), (YELLOW, "85"), (RED, "95")]),
        w_item(60, 15, 12, 4, "Último evento (trap)", "dse.trap.description"),
        # indicadores: rede x gerador
        w_item(0, 19, 12, 3, "Frequência da rede", "dse.mains.freq"),
        w_item(12, 19, 12, 3, "Frequência do gerador", "dse.gen.freq"),
        w_item(24, 19, 12, 3, "Potência ativa", "dse.gen.power"),
        w_item(36, 19, 12, 3, "Energia gerada", "dse.gen.kwh"),
        w_item(48, 19, 12, 3, "Horas de motor", "dse.engine.hours"),
        w_item(60, 19, 12, 3, "Partidas", "dse.engine.starts"),
    ])}],
}

export = {"zabbix_export": {
    "version": "7.0",
    "template_groups": [{"uuid": uid("group"), "name": "Templates/Power"}],
    "templates": [{
        "uuid": uid(TPL),
        "template": TPL,
        "name": TPL,
        "description": "Grupo gerador Stemac com controlador DSE7320, lido pelo gateway Deep Sea DSE892 "
                       "(MIB DSE-892, enterprise 41385). Requer o módulo cadastrado no DSE892 com "
                       "'SNMP instance' = {$DSE.INSTANCE}. Doc: https://github.com/marcelofmatos/zabbix-stemac-dse892",
        "vendor": {"name": "Marcelo Matos", "version": "1.0.0"},
        "groups": [{"name": "Templates/Power"}],
        "items": items,
        "macros": [
            {"macro": "{$DSE.INSTANCE}", "value": "1", "description": "SNMP instance do módulo no DSE892"},
            {"macro": "{$DSE.MAINS.VMIN}", "value": "100", "description": "Tensão fase-neutro mínima da rede (V)"},
            {"macro": "{$DSE.GEN.LOAD.AMIN}", "value": "5", "description": "Corrente que indica gerador com carga (A)"},
            {"macro": "{$DSE.FUEL.LOW}", "value": "50"},
            {"macro": "{$DSE.FUEL.CRIT}", "value": "20"},
            {"macro": "{$DSE.FUEL.FULL}", "value": "100",
             "description": "Leitura do sensor (%) com o tanque cheio. 100 = sem correção"},
            {"macro": "{$DSE.FUEL.EMPTY}", "value": "0",
             "description": "Leitura do sensor (%) com o tanque vazio. 0 = sem correção"},
            {"macro": "{$DSE.BATT.MIN}", "value": "11"},
            {"macro": "{$DSE.COOLANT.MAX}", "value": "95"},
        ],
        "tags": [{"tag": "class", "value": "power"}, {"tag": "target", "value": "dse892"}],
        "dashboards": [dashboard],
    }],
    "triggers": top_triggers,
    "graphs": [
        graph(G_MAINS, [f"dse.mains.volt[{p}]" for p in ("L1-N", "L2-N", "L3-N")]),
        graph(G_GEN, [f"dse.gen.volt[{p}]" for p in ("L1-N", "L2-N", "L3-N")]),
        graph(G_LOAD, [f"dse.gen.current[{p}]" for p in ("L1", "L2", "L3")]),
    ],
}}

out = pathlib.Path(__file__).with_name("template_dse892_gerador.yaml")
out.write_text(yaml.safe_dump(export, allow_unicode=True, sort_keys=False, width=200))
print(out)
