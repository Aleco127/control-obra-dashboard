#!/bin/sh
# Prueba de restauración (US-229): descifra el último respaldo, lo descomprime y cuenta filas de 10 tablas clave.
# Uso: sh restore-test.sh [archivo.gpg]. Resultado en docs/infra/respaldos.md (pegar la salida) y en /docker/control-obra-dashboard/backups/restore-test.log
set -eu
DEST=/docker/control-obra-dashboard/backups
F="${1:-$(ls -t "$DEST"/obra_*.json.gz.gpg | head -1)}"
W=$(mktemp -d)
gpg --batch --quiet --passphrase-file /root/.obra_backup_pass -o "$W/b.tgz" -d "$F"
tar -C "$W" -xzf "$W/b.tgz"
echo "$(date -u +%FT%TZ) restauración de prueba de $(basename "$F")"
for t in control_obra.empresas control_obra.obras control_obra.gastos control_obra.pagos_recibidos control_obra.cuentas_por_cobrar control_obra.catalogo_conceptos control_obra.socios control_obra.obra_usuarios public.empresa_subscriptions public.subscription_payments; do
  f="$W/$t.json"
  if [ -f "$f" ]; then c=$(python3 -c "import json,sys;print(len(json.load(open('$f'))))" 2>/dev/null || echo "?"); echo "  $t: $c filas"; else echo "  $t: FALTA"; fi
done | tee -a "$DEST/restore-test.log"
rm -rf "$W"
