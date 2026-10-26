#!/usr/bin/env python3
"""Testa o JavaScript dos comandos do gerador (criar_comandos.py) com o gateway simulado.

Roda o mesmo JS do webhook no node, com HttpRequest falso, e verifica:
- Auto é BLOQUEADO quando o controlador lê a rede anormal (estado de 2026-10-23);
- Auto passa com a rede normal;
- Stop envia o código 35700 sem consultar a rede;
- confirmação diferente de GERADOR não envia nada.

Uso: python3 test_comandos.py   (precisa de node no PATH)
"""
import json
import pathlib
import re
import subprocess
import sys
import tempfile

JS = re.search(r'JS = r"""(.*?)"""', pathlib.Path(__file__).with_name("criar_comandos.py").read_text(), re.S).group(1)

ANORMAL = {"22": 0, "23": 202, "24": 146, "25": 132}     # leitura real de 2026-10-23
NORMAL = {"22": 600, "23": 1270, "24": 1265, "25": 1271}

CASES = [
    # nome, modbus, parâmetros, espera erro (trecho), chamadas esperadas
    ("auto_bloqueado", ANORMAL, {"button": "35701", "check_mains": "1", "confirm": "GERADOR"},
     "BLOQUEADO", ["co_inst_mod_data.cgi moduleID=0"]),
    ("auto_liberado", NORMAL, {"button": "35701", "check_mains": "1", "confirm": "GERADOR"},
     None, ["co_inst_mod_data.cgi moduleID=0", "co_inst_button.cgi moduleID=0&button=35701"]),
    ("stop", ANORMAL, {"button": "35700", "check_mains": "0", "confirm": "GERADOR"},
     None, ["co_inst_button.cgi moduleID=0&button=35700"]),
    ("confirmacao_errada", NORMAL, {"button": "35700", "check_mains": "0", "confirm": "gerador"},
     "Confirmação inválida", []),
    # comando bloqueado recusa no servidor (Super admin ignora o grupo de usuários do script)
    ("partida_bloqueada", NORMAL, {"button": "35705", "check_mains": "0", "confirm": "GERADOR",
                                   "bloqueio": "controlador com AC Comms Fail"},
     "BLOQUEADO", []),
]

HARNESS = """
global.btoa = function (s) { return Buffer.from(s).toString('base64'); };
var calls = [], MOD;
function HttpRequest() {
    this.addHeader = function () {};
    this.getStatus = function () { return 200; };
    this.post = function (u, b) {
        calls.push(u.replace('http://192.0.2.10/', '') + ' ' + b);
        return u.indexOf('co_inst_mod_data') >= 0 ? JSON.stringify({modbus: MOD}) : 'ok';
    };
}
function run(value) { %s }
var out = [];
CASES.forEach(function (c) {
    calls = []; MOD = c.modbus; var err = null;
    try { run(JSON.stringify(c.params)); } catch (e) { err = String(e); }
    out.push({name: c.name, err: err, calls: calls});
});
console.log(JSON.stringify(out));
"""

base = {"url": "http://192.0.2.10/", "user": "u", "pass": "p", "vmin": "100", "label": "teste", "bloqueio": ""}
cases_js = json.dumps([{"name": n, "modbus": m, "params": {**base, **p}} for n, m, p, _, _ in CASES])
with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
    f.write(f"var CASES = {cases_js};\n" + HARNESS % JS)
results = json.loads(subprocess.run(["node", f.name], capture_output=True, text=True, check=True).stdout)

fail = 0
for (name, _, _, want_err, want_calls), r in zip(CASES, results):
    ok = (r["calls"] == want_calls) and ((want_err is None and r["err"] is None) or
                                         (want_err is not None and r["err"] and want_err in r["err"]))
    fail += not ok
    print(("PASS" if ok else "FAIL"), name, "| erro:", r["err"], "| chamadas:", r["calls"])
print(f"{len(CASES) - fail}/{len(CASES)} passed")
sys.exit(1 if fail else 0)
