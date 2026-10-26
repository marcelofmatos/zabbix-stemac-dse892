#!/usr/bin/env python3
"""Cria/atualiza no Zabbix os comandos manuais do gerador (DSE7320 via gateway DSE892).

Os comandos são scripts Webhook (rodam no próprio Zabbix server, sem binários extras) que
fazem POST em co_inst_button.cgi do DSE892, o mesmo que os botões da tela web.
Idempotente: atualiza scripts/grupos que já existem pelo nome.

Uso: python3 criar_comandos.py
Variáveis de ambiente (ou no ../.env, ver ../.env.example):
  ZABBIX_URL    URL do frontend, ex.: https://zabbix.example.com
  ZABBIX_TOKEN  token de API (Super admin)
  ZABBIX_HOST   nome técnico do host do gerador (padrão "Gerador")
  ZABBIX_CA_FILE  CA para validar o HTTPS do Zabbix (opcional, ex.: CA interna)
  ZABBIX_INSECURE=1  não valida o certificado (só para teste; expõe o token a MITM)
  DSE_HTTP_URL, DSE_HTTP_USER, DSE_HTTP_PW  acesso web ao DSE892
"""
import json
import os
import pathlib
import ssl
import urllib.request

ARQ_ENV = pathlib.Path(__file__).parent.parent.joinpath(".env")
ENV = dict(l.split("=", 1) for l in (ARQ_ENV.read_text().splitlines() if ARQ_ENV.exists() else [])
           if l and not l.startswith("#"))
ENV.update(os.environ)
API = ENV["ZABBIX_URL"].rstrip("/") + "/api_jsonrpc.php"
TOKEN = ENV["ZABBIX_TOKEN"]
HOST = ENV.get("ZABBIX_HOST", "Gerador")
HOSTGROUP = "Gerador - comandos"
USRGRP = "Operadores do gerador"
# Bloqueio de comandos (o Zabbix não tem "desativar script"):
# - o script recusa no servidor (parâmetro "bloqueio"), o que vale para qualquer usuário. Super admin
#   ignora a restrição por grupo de usuários do script;
# - e fica ligado a um grupo sem membros, para sumir do menu de quem não é Super admin.
# Para reativar, tirar o comando de BLOQUEADOS e rodar de novo.
USRGRP_BLOQUEADO = "Gerador - comandos bloqueados"
# Ex.: BLOQUEADOS = {"3 - Dar partida (requer Manual)", "4 - Modo Teste (com carga)"}
MOTIVO_BLOQUEIO = "controlador em manutenção: comando bloqueado até o reparo."
BLOQUEADOS = set()
if ENV.get("ZABBIX_INSECURE") == "1":
    CTX = ssl._create_unverified_context()
else:
    CTX = ssl.create_default_context(cafile=ENV.get("ZABBIX_CA_FILE") or None)

# Códigos de controle GenComm aceitos pelo DSE892 (lista ControlsAvailable do 7320).
# 35705 ("start engine if in manual or test mode") NÃO aparece nessa lista: ainda não validado em campo.
COMMANDS = [
    ("1 - Stop (desligar motor)", "35700", "0",
     "Coloca o controlador em STOP. Se o motor estiver girando ele PARA, e se estiver alimentando a carga "
     "durante falta de rede, a carga passa para os nobreaks."),
    ("2 - Modo Manual", "35702", "0",
     "Coloca o controlador em MANUAL. Não dá partida sozinho, e numa falta de rede NÃO parte automaticamente."),
    ("3 - Dar partida (requer Manual)", "35705", "0",
     "DÁ PARTIDA NO MOTOR (só funciona em Manual ou Teste). Comando ainda não validado em campo: "
     "execute com alguém no local."),
    ("4 - Modo Teste (com carga)", "35703", "0",
     "TESTE COM CARGA: o motor parte e ASSUME A CARGA do PoP. Faça só com alguém no local."),
    ("5 - Modo Auto", "35701", "1",
     "Coloca o controlador em AUTO: parte sozinho se detectar falta de rede. Bloqueado automaticamente se o "
     "controlador estiver lendo a rede como anormal."),
]

JS = r"""
var p = JSON.parse(value);
if (p.bloqueio) {
    throw 'BLOQUEADO: ' + p.bloqueio;
}
var base = p.url.replace(/\/+$/, '');
var auth = 'Authorization: Basic ' + btoa(p.user + ':' + p.pass);

function post(path, body) {
    var req = new HttpRequest();
    req.addHeader(auth);
    req.addHeader('Content-Type: application/x-www-form-urlencoded');
    var out = req.post(base + '/' + path, body);
    if (req.getStatus() !== 200) {
        throw 'DSE892 respondeu HTTP ' + req.getStatus() + ' em ' + path;
    }
    return out;
}

// Trava do Auto: em Auto o 7320 dá partida se achar que a rede caiu.
// Usa a leitura do próprio controlador (IDs da descrição GenComm: 22 = freq, 23..25 = L-N, escala 0,1).
if (p.check_mains === '1') {
    var m = JSON.parse(post('co_inst_mod_data.cgi', 'moduleID=0')).modbus;
    var freq = m['22'], volts = [m['23'], m['24'], m['25']];
    var vmin = Number(p.vmin) * 10;
    var ok = freq >= 550 && freq <= 650 && volts.every(function (v) {
        return v >= vmin && v < 0x7FFFFFF0;
    });
    if (!ok) {
        throw 'BLOQUEADO: o controlador está lendo a rede como anormal (' + (freq / 10) + ' Hz, L-N '
            + volts.map(function (v) { return v / 10; }).join(' / ')
            + ' V). Em Auto ele daria partida e assumiria a carga. Corrija a medição de rede antes.';
    }
}

post('co_inst_button.cgi', 'moduleID=0&button=' + p.button);
return 'Comando "' + p.label + '" enviado ao DSE892 (código ' + p.button + ').';
"""


def z(method, params):
    req = urllib.request.Request(API, json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode(),
                                 {"Content-Type": "application/json-rpc", "Authorization": "Bearer " + TOKEN})
    out = json.load(urllib.request.urlopen(req, context=CTX))
    if "error" in out:
        raise SystemExit(f"{method}: {out['error']}")
    return out["result"]


host = z("host.get", {"filter": {"host": [HOST]}, "output": ["hostid"], "selectMacros": ["hostmacroid", "macro"]})[0]
hid = host["hostid"]

# Grupo de hosts só com o Gerador: limita onde os comandos aparecem
g = z("hostgroup.get", {"filter": {"name": [HOSTGROUP]}, "output": ["groupid"]})
gid = g[0]["groupid"] if g else z("hostgroup.create", {"name": HOSTGROUP})["groupids"][0]
z("hostgroup.massadd", {"groups": [{"groupid": gid}], "hosts": [{"hostid": hid}]})

# Grupo de usuários: só os membros executam (permissão de escrita no grupo do Gerador)
u = z("usergroup.get", {"filter": {"name": [USRGRP]}, "output": ["usrgrpid"]})
rights = {"hostgroup_rights": [{"id": gid, "permission": 3}]}
if u:
    ugid = u[0]["usrgrpid"]
    z("usergroup.update", {"usrgrpid": ugid, **rights})
else:
    ugid = z("usergroup.create", {"name": USRGRP, **rights})["usrgrpids"][0]

b = z("usergroup.get", {"filter": {"name": [USRGRP_BLOQUEADO]}, "output": ["usrgrpid"]})
ugid_bloqueado = b[0]["usrgrpid"] if b else z("usergroup.create", {"name": USRGRP_BLOQUEADO})["usrgrpids"][0]

# Credenciais do DSE892 como macros do host (senha secreta)
macros = {"{$DSE.WEB.URL}": (ENV["DSE_HTTP_URL"], 0), "{$DSE.WEB.USER}": (ENV["DSE_HTTP_USER"], 0),
          "{$DSE.WEB.PASS}": (ENV["DSE_HTTP_PW"], 1)}
existing = {m["macro"]: m["hostmacroid"] for m in host["macros"]}
for macro, (value, mtype) in macros.items():
    body = {"value": value, "type": mtype, "description": "Acesso web do DSE892 (comandos do gerador)"}
    if macro in existing:
        z("usermacro.update", {"hostmacroid": existing[macro], **body})
    else:
        z("usermacro.create", {"hostid": hid, "macro": macro, **body})

scripts = {s["name"]: s["scriptid"] for s in z("script.get", {"output": ["scriptid", "name"], "filter": {"menu_path": "Gerador"}})}
for label, button, check, warning in COMMANDS:
    body = {
        "name": label, "type": 5, "scope": 2, "menu_path": "Gerador", "command": JS, "timeout": "30s",
        "groupid": gid, "usrgrpid": ugid_bloqueado if label in BLOQUEADOS else ugid, "host_access": 3,
        "description": warning,
        "confirmation": f"{warning}\n\nConfirma '{label}' em {{HOST.NAME}}?",
        "manualinput": 0, "manualinput_prompt": "", "manualinput_validator": "",
        "parameters": [
            {"name": "url", "value": "{$DSE.WEB.URL}"}, {"name": "user", "value": "{$DSE.WEB.USER}"},
            {"name": "pass", "value": "{$DSE.WEB.PASS}"}, {"name": "button", "value": button},
            {"name": "label", "value": label}, {"name": "check_mains", "value": check},
            {"name": "vmin", "value": "{$DSE.MAINS.VMIN}"},
            {"name": "bloqueio", "value": MOTIVO_BLOQUEIO if label in BLOQUEADOS else ""},
        ],
    }
    if label in scripts:
        z("script.update", {"scriptid": scripts[label], **body})
        print("atualizado:", label)
    else:
        print("criado:", label, z("script.create", body)["scriptids"][0])
print(f"hostgroup {HOSTGROUP}={gid}  usergroup {USRGRP}={ugid}")
