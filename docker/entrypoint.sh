#!/bin/sh
# Primeira linha do log = versão da imagem; depois segue o entrypoint oficial do frontend.
echo "zabbix-stemac-dse892 ${APP_VERSION:-dev} iniciando"
exec docker-entrypoint.sh "$@"
