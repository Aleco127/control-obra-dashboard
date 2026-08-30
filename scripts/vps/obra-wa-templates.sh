#!/bin/sh
# US-240: crea en la cuenta de Twilio de Zook las plantillas de WhatsApp de Control de Obra y pide su aprobación a Meta.
# Guarda los Content SID en public.app_secrets (wa_tpl_cobro_vencido, wa_tpl_aprobacion). Nunca imprime llaves.
# Uso: sh obra-wa-templates.sh            (crear + solicitar aprobación)
#      sh obra-wa-templates.sh estado     (consultar estado de aprobación)
set -e
ENV() { docker exec ai-builder-backend printenv "$1" 2>/dev/null || true; }
SID=$(ENV TWILIO_ACCOUNT_SID); TOK=$(ENV TWILIO_AUTH_TOKEN); URL=$(ENV SUPABASE_URL); SK=$(ENV SUPABASE_SERVICE_KEY)
[ -n "$SID" ] && [ -n "$TOK" ] && [ -n "$URL" ] && [ -n "$SK" ] || { echo "faltan TWILIO_*/SUPABASE_* en el contenedor de Zook"; exit 1; }
getsecret() { curl -s "$URL/rest/v1/app_secrets?key=eq.$1&select=value" -H "apikey: $SK" -H "Authorization: Bearer $SK" | jq -r '.[0].value // empty'; }
putsecret() { curl -s -o /dev/null -w "  $1 -> %{http_code}\n" -X POST "$URL/rest/v1/app_secrets" -H "apikey: $SK" -H "Authorization: Bearer $SK" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" -d "$(jq -cn --arg k "$1" --arg v "$2" '{key:$k,value:$v,updated_at:(now|todate)}')"; }

crear() { # crear clave nombre cuerpo
  existente=$(getsecret "$1")
  if [ -n "$existente" ]; then
    st=$(curl -s -u "$SID:$TOK" "https://content.twilio.com/v1/Content/$existente/ApprovalRequests" | jq -r '.whatsapp.status // "unsubmitted"')
    if [ "$st" = "approved" ] || [ "$st" = "pending" ] || [ "$st" = "received" ]; then echo "  $1 ya existe ($st)"; return 0; fi
    echo "  $1 estaba en $st: se recrea"; curl -s -o /dev/null -u "$SID:$TOK" -X DELETE "https://content.twilio.com/v1/Content/$existente"
  fi
  csid=$(curl -s -u "$SID:$TOK" -X POST https://content.twilio.com/v1/Content -H "Content-Type: application/json" \
    -d "$(jq -cn --arg n "$2" --arg b "$3" '{friendly_name:$n, language:"es_MX", variables:{"1":"Supernova Arquitectos","2":"Casa Juárez","3":"$10,000.00"}, types:{"twilio/text":{body:$b}}}')" | jq -r '.sid // empty')
  [ -n "$csid" ] || { echo "  no se pudo crear $2"; return 1; }
  curl -s -o /dev/null -w "  aprobación $2 -> %{http_code}\n" -u "$SID:$TOK" -X POST "https://content.twilio.com/v1/Content/$csid/ApprovalRequests/whatsapp" -H "Content-Type: application/json" -d "$(jq -cn --arg n "$2" '{name:$n, category:"UTILITY"}')"
  putsecret "$1" "$csid"
}

if [ "$1" = "estado" ]; then
  for k in wa_tpl_cobro_vencido wa_tpl_aprobacion; do
    csid=$(getsecret "$k"); [ -n "$csid" ] || { echo "  $k: sin crear"; continue; }
    echo "  $k: $(curl -s -u "$SID:$TOK" "https://content.twilio.com/v1/Content/$csid/ApprovalRequests" | jq -r '.whatsapp.status // "sin solicitud"') $(curl -s -u "$SID:$TOK" "https://content.twilio.com/v1/Content/$csid/ApprovalRequests" | jq -r '.whatsapp.rejection_reason // ""')"
  done
  exit 0
fi
echo "creando plantillas:"
crear wa_tpl_cobro_vencido obra_cobro_vencido "Control de Obra: {{1}} tiene un cobro vencido en la obra {{2}} por {{3}}. Revisa el plan de pagos y da seguimiento con tu cliente."
crear wa_tpl_aprobacion obra_aprobacion_pendiente "Control de Obra: {{1}} tiene una compra por aprobar en la obra {{2}} por {{3}}. Entra a la aplicación para aprobarla o rechazarla."
echo "listo; la aprobación de Meta tarda de minutos a 24 h. Consulta con: sh obra-wa-templates.sh estado"
