#!/usr/bin/env python3
"""Testa o JavaScript do item dse.trap.alarm (gerar_template.TRAP_ALARME_JS) com traps no formato do DSE892, no node."""
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import gerar_template  # noqa: E402  (gera o YAML ao importar; é determinístico)


def trap(tipo, desc, sub=0):
    return ("2026-10-28T10:55:56+0000 UDP: [192.0.2.10]:1350->[192.0.2.1]:1162\n"
            "DISMAN-EVENT-MIB::sysUpTimeInstance = 37796413\n"
            "SNMPv2-MIB::snmpTrapOID.0 = SNMPv2-SMI::enterprises.41385.1.1.2.1\n"
            f"SNMPv2-SMI::enterprises.41385.1.1.1.1.1 = {tipo}\n"
            f"SNMPv2-SMI::enterprises.41385.1.1.1.1.2 = {sub}\n"
            "SNMPv2-SMI::enterprises.41385.1.1.1.1.6 = " + desc + "\n"
            "SNMPv2-SMI::enterprises.41385.1.1.1.1.8 = \"Gerador\" ")


CASOS = [
    ("alarme", trap(12, '"Defeito no Retificador"'), "Defeito no Retificador"),
    ("manutencao", trap(12, "4D 61 6E 75 74 65 6E E7 E3 6F   [Manuten..o]", 178), None),
    ("stop_limpa", trap(150, '"Stop Mode"'), ""),
    ("restart_limpa", trap(2, '"Restart"', 1), ""),
    ("shutdown_ignora", trap(7, '"Shutdown"', 13), None),
    ("auto_ignora", trap(150, '"Auto Mode"', 1), None),
    ("tipo_112_nao_e_12", trap(112, '"Defeito"'), None),
]

RUNNER = """
const casos = JSON.parse(process.argv[1]);
const fn = new Function('value', process.argv[2]);
console.log(JSON.stringify(casos.map(v => { try { return fn(v); } catch (e) { return null; } })));
"""

saida = json.loads(subprocess.run(
    ["node", "-e", RUNNER, json.dumps([c[1] for c in CASOS]), gerar_template.TRAP_ALARME_JS],
    capture_output=True, text=True, check=True).stdout)
falhas = 0
for (nome, _, esperado), obtido in zip(CASOS, saida):
    ok = obtido == esperado
    falhas += not ok
    print("PASS" if ok else "FAIL", nome, "| esperado:", repr(esperado), "| obtido:", repr(obtido))
print(f"{len(CASOS) - falhas}/{len(CASOS)} passed")
sys.exit(1 if falhas else 0)
