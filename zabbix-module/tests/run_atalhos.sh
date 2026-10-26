#!/usr/bin/env bash
# Roda o teste do parser do widget atalhos num PHP em container (sem PHP no host).
# PHP_CMD troca o interpretador, ex.: PHP_CMD='docker exec -i zabbix-frontend php'.
set -euo pipefail
cd "$(dirname "$0")/.."
{
	cat tests/test_atalhos.php
	# WidgetView.php usa "namespace X;": vira bloco para conviver com os stubs no mesmo arquivo.
	sed -e '1s/^<?php.*$//' -e 's/^namespace Modules\\Atalhos\\Actions;/namespace Modules\\Atalhos\\Actions {/' \
		atalhos/actions/WidgetView.php
	echo '}'
	sed '1s/^<?php//' tests/test_atalhos_casos.php
} | ${PHP_CMD:-docker run --rm -i php:8.2-cli php}
