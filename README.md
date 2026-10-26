# zabbix-stemac-dse892

Monitoramento e operação no **Zabbix 7.0** de um grupo gerador (Stemac ou outro) com controlador
**Deep Sea DSE7320**, lido pelo gateway **Deep Sea DSE892** via SNMP.

| Componente | Pasta | O que faz |
|---|---|---|
| Template `DSE892 Gerador Stemac by SNMP` | [`zabbix/`](zabbix/) | 37 itens (rede, gerador, motor, modo, traps), 12 triggers, 3 gráficos e dashboard do host |
| Comandos do controlador | [`zabbix/criar_comandos.py`](zabbix/criar_comandos.py) | Scripts Webhook Stop / Manual / Partida / Teste / Auto, com confirmação e grupo restrito |
| Widget **Painel do gerador** | [`zabbix-module/painel-gerador/`](zabbix-module/painel-gerador/) | Diagrama unifilar, modo, alarme, motor, tanque e botões de comando |
| Página **Gerador (celular)** | [`zabbix-module/gerador-movel/`](zabbix-module/gerador-movel/) | O mesmo painel em coluna única para celular, com gráficos |
| **PWA** | [`zabbix-module/pwa-zabbix/`](zabbix-module/pwa-zabbix/) | Torna o frontend do Zabbix instalável como app no celular |
| Widget **Atalhos** | [`zabbix-module/atalhos/`](zabbix-module/atalhos/) | Lista de links "Nome \| URL" para as dashboards principais |

Arquitetura e fluxos com diagramas: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

> ⚠️ **Os comandos ligam, desligam e trocam o modo de um gerador real.** Teste com alguém no
> local, restrinja o grupo de usuários e use por sua conta e risco.

## Requisitos

- Zabbix 7.0 (server com SNMP e, para traps, o receptor `zabbix-snmptraps` ou equivalente).
- DSE892 com o controlador cadastrado em *Configuration → Modules*, **com SNMP instance definida**.
- Python 3 com `pyyaml` (só para regenerar o template); Node.js (só para os testes de JS).

## 1. Configurar o DSE892

Menu web → **Configuration**:

| Tela | Configuração |
|---|---|
| SNMP | destino de trap = IP do receptor de traps do Zabbix, porta 162 · community de leitura · community de escrita (diferente da de leitura) |
| Modules → Config | módulo do controlador (ex.: RS485, ID 1, 19200 bps) com **SNMP instance 1** |
| Module events | eventos com trap habilitado |

Pegadinhas:
- **Sem SNMP instance a MIB fica vazia** (só `system` e a `eventEntry` zerada).
- A tela *Modules* **não edita** um módulo existente: é preciso excluir, recadastrar e dar **Reboot**
  (~5 s, não afeta o controlador nem o gerador).
- A community de **escrita** dá acesso à `keypressTable`, que **comanda o controlador**. Não a reutilize
  nem a compartilhe.

## 2. Template

```bash
cd zabbix
python3 gerar_template.py      # gera template_dse892_gerador.yaml (UUIDs determinísticos)
```

Importe [`zabbix/template_dse892_gerador.yaml`](zabbix/template_dse892_gerador.yaml) em
*Data collection → Templates → Import*. Reimportar **atualiza** o template, em vez de duplicar.
Vincule-o a um host com **interface SNMP v2c** apontando para o DSE892 e defina `{$SNMP_COMMUNITY}`.

**Itens** (OID `.1.3.6.1.4.1.41385.1.3.1.1.<coluna>.{$DSE.INSTANCE}`):

| Grupo | Itens (coluna da `instrumentTable`) | Escala |
|---|---|---|
| Rede | tensão L-N (24–26), L-L (27–29), frequência (23) | ×0,1 |
| Gerador | tensão L-N (7–9), L-L (19–21), frequência (18), corrente L1–L3 (10–12) | ×0,1 |
| Gerador | potência ativa W (52), aparente VA (56), FP médio (64, ×0,01), energia kWh (92, ×0,1) | — |
| Motor | óleo kPa (2), temperatura °C (3), combustível % (4), bateria V (5, ×0,1), rotação (6), horímetro s (91), partidas (95) | — |
| Controle | modo código / texto (`controlTable` `.3.3.1.2` / `.3`) | — |
| Gateway | `sysUpTime` | — |
| Traps | `snmptrap["41385\.1\.1\.2"]` (`dseEventTrap`) e dependentes: descrição, tipo, subtipo, módulo; `snmptrap.fallback` | — |

**Macros:**

| Macro | Padrão | Uso |
|---|---|---|
| `{$DSE.INSTANCE}` | 1 | SNMP instance do módulo no DSE892 |
| `{$DSE.MAINS.VMIN}` | 100 | Tensão L-N mínima da rede (V) |
| `{$DSE.GEN.LOAD.AMIN}` | 5 | Corrente que indica gerador com carga (A) |
| `{$DSE.FUEL.LOW}` / `{$DSE.FUEL.CRIT}` | 50 / 20 | Combustível baixo / crítico (%) |
| `{$DSE.FUEL.FULL}` | 100 | Leitura do sensor com o tanque cheio. Para tanque adaptado (ex.: marca 63 % cheio), defina no host e o item reescala para 0–100 % |
| `{$DSE.BATT.MIN}` | 11 | Bateria de partida mínima (V) |
| `{$DSE.COOLANT.MAX}` | 95 | Temperatura máxima do motor (°C) |

**Triggers:** temperatura alta e combustível crítico (Desastre); combustível baixo, bateria baixa,
falta de rede, gerador assumiu a carga, controlador fora do Auto, gateway sem SNMP e DSE892 sem
leitura do controlador (Alta); motor em funcionamento (Atenção); gateway reiniciou (Info).

**Traps sem ruído:** o DSE892 manda trap em **todo** evento (troca de modo, teste semanal...). Só a
parada por alarme (`shutdown`, `electrical trip`...) vira problema (Desastre). O resto fica no
histórico dos itens `Trap: *`. O receptor não precisa da MIB: as regex usam os OIDs numéricos.

**Valores ausentes:** sentinelas GenComm (≥ `0x7FFFFFF8`) são descartadas. Quando o DSE892 não tem o
valor (sensor ausente ou RS485 caído), responde `NULL`, que o Zabbix grava como **0**. Por isso as
triggers do controlador têm a guarda `last(bateria) > 0`, e a perda de leitura tem trigger própria.

## 3. Comandos do controlador

```bash
cp .env.example .env   # preencha ZABBIX_URL, ZABBIX_TOKEN, ZABBIX_HOST e o acesso web ao DSE892
python3 zabbix/criar_comandos.py      # idempotente
python3 zabbix/test_comandos.py       # testa a lógica dos webhooks, sem tocar no equipamento
```

Cria scripts **Webhook**, que rodam no Zabbix server e fazem `POST co_inst_button.cgi` no DSE892 (o
mesmo dos botões da web). As credenciais ficam nas macros do host `{$DSE.WEB.URL}`, `{$DSE.WEB.USER}`
e `{$DSE.WEB.PASS}` (secreta).

| Comando | Código GenComm | Observação |
|---|---|---|
| 1 - Stop (desligar motor) | 35700 | |
| 2 - Modo Manual | 35702 | Não parte sozinho |
| 3 - Dar partida (requer Manual) | 35705 | **Não validado em campo**: não consta na lista de controles do gateway |
| 4 - Modo Teste (com carga) | 35703 | Motor parte e assume a carga |
| 5 - Modo Auto | 35701 | Antes de enviar, lê a rede pelo controlador e recusa se freq. ∉ 55–65 Hz ou L-N < `{$DSE.MAINS.VMIN}` |

- Cada comando pede **confirmação** e exige **digitar `GERADOR`**.
- Visíveis só no grupo de hosts **"Gerador - comandos"** e executáveis só pelo grupo de usuários
  **"Operadores do gerador"**. Adicione os operadores a ele.
- **Bloqueio** (ex.: controlador em manutenção): coloque o nome em `BLOQUEADOS` no script e rode de
  novo. O webhook passa a recusar no servidor, o que vale até para Super admin, que ignora a restrição
  por grupo. O painel mostra o botão com cadeado.

## 4. Módulos de frontend

**Imagem Docker** (recomendado): `ghcr.io/marcelofmatos/zabbix-stemac-dse892` é o frontend oficial
`zabbix/zabbix-web-apache-pgsql:ubuntu-7.0-latest` com os quatro módulos já em
`/usr/share/zabbix/modules/`. Troque só a imagem do serviço web; as variáveis de ambiente são as mesmas:

```yaml
services:
  zabbix-web:
    image: ghcr.io/marcelofmatos/zabbix-stemac-dse892:1   # ou a versão exata, ex.: 1.0.0
    environment:
      - DB_SERVER_HOST=postgres
      - POSTGRES_USER=zabbix
      - POSTGRES_PASSWORD=...
      - ZBX_SERVER_HOST=zabbix-server
```

- A primeira linha do log mostra a versão: `zabbix-stemac-dse892 1.0.0 iniciando`.
- Tags: `X.Y.Z`, `X.Y`, `X` e `latest`. Para voltar atrás, aponte para a versão anterior.
- Outra base (nginx, MySQL): `docker build --build-arg ZABBIX_WEB_IMAGE=zabbix/zabbix-web-nginx-mysql
  --build-arg ZABBIX_TAG=ubuntu-7.0-latest -t meu-zabbix-web .`
- **Releases:** *Actions → 🚀 Release and build → Run workflow* (patch, minor ou major). O workflow
  [`release-and-build.yml`](.github/workflows/release-and-build.yml) roda os testes, cria a tag e a
  release e publica a imagem no GHCR.

**Sem a imagem:** copie as pastas de [`zabbix-module/`](zabbix-module/) para
`/usr/share/zabbix/modules/` do frontend.

Nos dois casos, depois em *Administration → General → Modules*: **Scan directory** e ative os
módulos. O estado ativo fica no banco, então trocar a versão da imagem não exige ativar de novo.

- **Painel do gerador** (`painel-gerador`): widget já incluído na dashboard do template
  ("Gerador - visão geral"). Também pode ser adicionado a qualquer dashboard, escolhendo o host.
  A posição das chaves no diagrama é **estimada**, porque o DSE892 não informa os contatores.
- **Gerador (celular)** (`gerador-movel`): `zabbix.php?action=gerador.movel[&hostid=…]`. Sem
  `hostid`, abre o primeiro host visível com o template. Atualiza a cada 30 s. **Depende do
  `painel-gerador`** ativo (usa o `painel-estado.js` dele). Requer navegador com `:has()` (Chrome
  105+, iOS 15.4+).
- **PWA** (`pwa-zabbix`): injeta o manifest e as metas de app em todas as páginas. No celular:
  "Instalar app" (Chrome) ou "Adicionar à Tela de Início" (Safari). O atalho "Gerador" do ícone abre
  a página móvel. Ajuste `start_url`, nome e cores em `assets/pwa.webmanifest`.
- **Atalhos** (`atalhos`): widget com um link por linha (`Nome | URL`). Aceita só `https://`,
  `zabbix.php?…` ou caminhos `/…`.

## 5. Testes

```bash
cd zabbix-module
node tests/test_estado.js        # lógica de estado do painel
tests/run_atalhos.sh             # parser do widget Atalhos (PHP em container; PHP_CMD para trocar)
python3 ../zabbix/test_comandos.py
```

## Referência da MIB DSE-892

Base `.1.3.6.1.4.1.41385.1`, tabelas indexadas pela SNMP instance. A MIB oficial pode ser baixada
do próprio DSE892 (*Configuration → Filesystem*) ou vista em
[Observium MIB DSE-892](https://mibs.observium.org/mib/DSE-892/).

| OID | Objeto | Conteúdo |
|---|---|---|
| `.1.1.1.1.1–8` | `dseEventEntry` | último evento: tipo, subtipo, parâmetros, horário, descrição, módulo |
| `.1.1.2.1` | `dseEventTrap` | trap de evento |
| `.1.3.1.1.x` | `instrumentTable` | ~197 colunas. Valores brutos GenComm: aplicar a escala |
| `.1.3.3.1.2/3` | `controlTable` | `mode` / `modeText` |
| `.1.3.4.1.2` | `keypressTable` | **escrita**: envia teclas ao controlador |

Do MIB-II, o DSE892 só implementa `system`.

## Licença

[MIT](LICENSE). O ícone da mão na tecla MANUAL é o "pointer" do [Lucide](https://lucide.dev) (ISC).
