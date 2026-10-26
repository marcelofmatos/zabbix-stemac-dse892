# Frontend oficial do Zabbix 7.0 com os módulos deste repositório já instalados em
# /usr/share/zabbix/modules (sem bind mount). Depois de subir, ative os módulos em
# Administration → General → Modules (o estado ativo/inativo fica no banco).
# Outra variante da base (nginx, mysql, alpine): --build-arg ZABBIX_WEB_IMAGE=... / ZABBIX_TAG=...
ARG ZABBIX_WEB_IMAGE=zabbix/zabbix-web-apache-pgsql
ARG ZABBIX_TAG=ubuntu-7.0-latest
FROM ${ZABBIX_WEB_IMAGE}:${ZABBIX_TAG}

COPY zabbix-module/painel-gerador/ /usr/share/zabbix/modules/painel-gerador/
COPY zabbix-module/gerador-movel/ /usr/share/zabbix/modules/gerador-movel/
COPY zabbix-module/pwa-zabbix/ /usr/share/zabbix/modules/pwa-zabbix/
COPY zabbix-module/atalhos/ /usr/share/zabbix/modules/atalhos/
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/zabbix-stemac-entrypoint.sh

ARG APP_VERSION=dev
ARG GIT_COMMIT=unknown
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="zabbix-stemac-dse892" \
      org.opencontainers.image.description="Frontend do Zabbix 7.0 com os módulos do gerador DSE7320/DSE892 (painel, página móvel, PWA, atalhos)" \
      org.opencontainers.image.source="https://github.com/marcelofmatos/zabbix-stemac-dse892" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}"

# Mantém usuário, CMD e HEALTHCHECK da base; só antepõe a linha de versão no log.
ENTRYPOINT ["zabbix-stemac-entrypoint.sh"]
