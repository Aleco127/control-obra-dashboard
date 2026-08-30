#!/bin/sh
# Respaldo diario lógico de Control de Obra (US-229). Corre por cron en el VPS a las 03:30.
# Exporta cada tabla propia (esquema control_obra y tablas propias de public) en JSON vía PostgREST con la service key,
# comprime, cifra con gpg (passphrase en /root/.obra_backup_pass, 600) y conserva 14 diarios + 8 semanales en
# /docker/control-obra-dashboard/backups (decisión Q5: los respaldos viven en el VPS). Nunca imprime llaves.
set -eu
DEST=/docker/control-obra-dashboard/backups; mkdir -p "$DEST"
ENV() { docker exec ai-builder-backend printenv "$1" 2>/dev/null || true; }
URL=$(ENV SUPABASE_URL); SK=$(ENV SUPABASE_SERVICE_KEY)
[ -n "$URL" ] && [ -n "$SK" ] || { echo "faltan SUPABASE_URL/SERVICE_KEY"; exit 1; }
[ -f /root/.obra_backup_pass ] || { openssl rand -base64 32 > /root/.obra_backup_pass; chmod 600 /root/.obra_backup_pass; echo "passphrase nueva en /root/.obra_backup_pass: respáldala fuera del VPS"; }
STAMP=$(date -u +%Y%m%d)
WORK=$(mktemp -d)
TABLAS_CO="obras empresas obra_usuarios obra_roles clientes proveedores catalogo_conceptos programas_obra actividades_programa lineas_base actividades_linea_base cuentas_por_cobrar pagos_recibidos pagos_proveedores gastos gastos_admin_distribucion ordenes_compra estimaciones estimacion_partidas cotizaciones cotizacion_partidas catalogo_conceptos_cot plantillas_cotizacion facturas_recibidas cfdis_emitidos documentos fotos_obra bitacora_obra rfis punch_list seguridad materiales materiales_movimientos subcontratos subcontratos_pagos empleados asistencia nomina nomina_distribucion eventos_calendario socios socios_historial movimientos_socio repartos reparto_detalle finanzas_config categorias_gasto conciliaciones cierres_mensuales obra_modificaciones declaraciones_mensuales config_pac empresa_modulos empresa_config audit_log obra_auditoria obra_asignaciones recursos_proyecto asignaciones_recurso calendario_proyecto movimientos_fiscales retenciones dias_no_laborales categorias_deduccion ui_events tokens_correo"
TABLAS_PUB="subscription_plans empresa_subscriptions subscription_payments openpay_planes email_log platform_admins platform_sessions platform_errors error_occurrences login_attempts config_templates repse_declaraciones repse_contratos repse_documentos repse_config_recordatorios sua_declaraciones sua_conceptos sua_documentos sua_parametros"
n=0; fallas=0
dump() { # esquema tabla
  out="$WORK/$1.$2.json"
  code=$(curl -s -o "$out" -w "%{http_code}" --max-time 120 "$URL/rest/v1/$2?select=*" -H "apikey: $SK" -H "Authorization: Bearer $SK" -H "Accept-Profile: $1" -H "Range: 0-999999" || echo 000)
  if [ "$code" = "200" ] || [ "$code" = "206" ]; then n=$((n+1)); else fallas=$((fallas+1)); echo "  $1.$2 -> $code"; rm -f "$out"; fi
}
for t in $TABLAS_CO; do dump control_obra "$t"; done
for t in $TABLAS_PUB; do dump public "$t"; done
# app_secrets no se respalda en claro: sólo sus claves
curl -s "$URL/rest/v1/app_secrets?select=key,updated_at" -H "apikey: $SK" -H "Authorization: Bearer $SK" > "$WORK/public.app_secrets.keys.json" || true
tar -C "$WORK" -czf "$DEST/obra_$STAMP.json.gz" .
gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file /root/.obra_backup_pass -o "$DEST/obra_$STAMP.json.gz.gpg" "$DEST/obra_$STAMP.json.gz"
rm -f "$DEST/obra_$STAMP.json.gz"; rm -rf "$WORK"
size=$(du -h "$DEST/obra_$STAMP.json.gz.gpg" | cut -f1)
echo "$(date -u +%FT%TZ) respaldo obra_$STAMP.json.gz.gpg tablas=$n fallas=$fallas tamaño=$size"
# Retención: 14 diarios; los domingos se copian a semanal/ (8)
mkdir -p "$DEST/semanal"
[ "$(date -u +%u)" = "7" ] && cp "$DEST/obra_$STAMP.json.gz.gpg" "$DEST/semanal/"
ls -t "$DEST"/obra_*.json.gz.gpg 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -t "$DEST"/semanal/obra_*.json.gz.gpg 2>/dev/null | tail -n +9 | xargs -r rm -f
[ "$fallas" -gt 5 ] && exit 1 || exit 0
