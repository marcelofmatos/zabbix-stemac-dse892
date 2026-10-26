# Arquitetura e fluxos

## Arquitetura

```mermaid
flowchart LR
    subgraph Site["Local do gerador"]
        CTRL["Controlador DSE7320"]
        GW["Gateway DSE892<br/>SNMP + web"]
        CTRL -- "RS485 GenComm" --> GW
    end
    subgraph Zabbix["Zabbix 7.0"]
        SRV["Zabbix server<br/>poller SNMP + webhooks"]
        TRAP["Receptor de traps<br/>porta 162"]
        WEB["Frontend<br/>imagem zabbix-stemac-dse892<br/>módulos em /usr/share/zabbix/modules"]
        DB[("Banco")]
        TRAP --> SRV
        SRV --> DB
        WEB --> DB
    end
    USER["Operador<br/>navegador ou app PWA"]
    SRV -- "SNMP v2c GET 161" --> GW
    GW -- "dseEventTrap 162" --> TRAP
    SRV -- "HTTP POST co_inst_button.cgi<br/>comandos" --> GW
    USER -- "HTTPS" --> WEB
    WEB -- "Script.execute" --> SRV
    GHCR[("GHCR<br/>ghcr.io/marcelofmatos/zabbix-stemac-dse892")]
    GHCR -. "docker pull" .-> WEB
```

| Peça | Onde está | Papel |
|---|---|---|
| Template | `zabbix/template_dse892_gerador.yaml` | itens SNMP, traps, triggers, gráficos, dashboard |
| Scripts Webhook | criados por `zabbix/criar_comandos.py` | comandos ao controlador pela web do DSE892 |
| `painel-gerador` | widget | lê itens, problemas e scripts permitidos do host e desenha o painel |
| `gerador-movel` | página `gerador.movel` | mesmos dados do painel, layout de celular; reusa `painel-estado.js` |
| `pwa-zabbix` | módulo comum | manifest e metas de app em todas as páginas |
| `atalhos` | widget | links para dashboards |
| Imagem | `Dockerfile` | frontend oficial + os quatro módulos; entrypoint loga a versão e chama o oficial |
| CI/CD | `.github/workflows/release-and-build.yml` | testes, tag SemVer, release e push da imagem no GHCR |

## Fluxo 1 — Coleta

```mermaid
sequenceDiagram
    participant Z as Zabbix server
    participant G as DSE892
    participant C as DSE7320
    loop contínuo
        G->>C: leitura GenComm via RS485
        C-->>G: instrumentos e estado
    end
    loop a cada 1 min
        Z->>G: SNMP GET instrumentTable e controlTable
        G-->>Z: valores brutos ou NULL
        Z->>Z: descarta sentinelas e aplica escala
        Z->>Z: avalia triggers com guarda de leitura válida
    end
```

## Fluxo 2 — Eventos por trap

```mermaid
sequenceDiagram
    participant C as DSE7320
    participant G as DSE892
    participant T as Receptor de traps
    participant Z as Zabbix server
    participant O as Operação
    C->>G: alarme ou mudança de estado
    G->>T: dseEventTrap
    T->>Z: trap associado à interface SNMP do host
    Z->>Z: itens dependentes extraem descrição, tipo, subtipo e módulo
    alt descrição indica shutdown ou electrical trip
        Z->>O: problema Desastre
    else demais eventos
        Z->>Z: só histórico
    end
```

## Fluxo 3 — Comando pelo painel

```mermaid
sequenceDiagram
    actor U as Operador
    participant P as Painel ou página móvel
    participant F as Frontend Zabbix
    participant S as Zabbix server
    participant G as DSE892
    U->>P: toca STOP, MANUAL, AUTO...
    P->>F: Script.execute
    F->>U: confirmação e digite GERADOR
    U->>F: confirma
    F->>S: executa o webhook se o usuário tiver permissão
    alt comando bloqueado
        S-->>F: erro BLOQUEADO com o motivo
    else Auto com rede anormal
        S->>G: lê a rede pelo controlador
        S-->>F: recusa
    else liberado
        S->>G: POST co_inst_button.cgi com o código GenComm
        G-->>S: OK
    end
    F-->>P: resultado
    P->>F: atualiza o estado
```

## Fluxo 4 — Release e build da imagem

```mermaid
flowchart LR
    A["Run workflow<br/>patch, minor ou major"] --> T["Job test<br/>Node, Python, PHP<br/>template gerado = versionado"]
    T --> R["Job release<br/>próxima tag SemVer<br/>GitHub Release com changelog"]
    R --> B["Job build<br/>docker build com APP_VERSION"]
    B --> P[("GHCR<br/>X.Y.Z, X.Y, X, latest")]
    P --> D["Stack do Zabbix<br/>troca a imagem do frontend"]
```
