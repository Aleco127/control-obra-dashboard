#!/bin/sh
# Monitoreo de Control de Obra (US-228). Corre cada 5 minutos por cron en el VPS.
# Revisa app, admin, PostgREST de Supabase, Edge Functions y el certificado; escribe html/status.json (página pública de estado)
# y avisa por Telegram sólo cuando un servicio cambia de estado (caído o recuperado). Credenciales en /root/.obra_telegram.env
# (TELEGRAM_BOT, TELEGRAM_CHAT), nunca en el repo.
set -u
STATE_DIR=/docker/control-obra-dashboard/monitor; mkdir -p "$STATE_DIR"
STATUS_JSON=/docker/control-obra-dashboard/html/status.json
[ -f /root/.obra_telegram.env ] && . /root/.obra_telegram.env
ANON="sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y"
SB="https://cpjdlaiarmxojiyhhpxt.supabase.co"

check() { # nombre url esperado [extra curl args...]
  name="$1"; url="$2"; want="$3"; shift 3
  start=$(date +%s%N)
  code=$(curl -s -o /tmp/mon_body -w "%{http_code}" --max-time 20 "$@" "$url" 2>/dev/null || echo 000)
  ms=$(( ($(date +%s%N) - start) / 1000000 ))
  ok=0
  case "$want" in
    200) [ "$code" = "200" ] && ok=1 ;;
    body:*) [ "$code" = "200" ] && grep -q "${want#body:}" /tmp/mon_body && ok=1 ;;
    any:*) echo "$code" | grep -Eq "${want#any:}" && ok=1 ;;
  esac
  prev=$(cat "$STATE_DIR/$name.state" 2>/dev/null || echo 1)
  echo "$ok" > "$STATE_DIR/$name.state"
  if [ "$ok" != "$prev" ]; then
    if [ "$ok" = "1" ]; then msg="✅ Control de Obra: $name recuperado ($code, ${ms} ms)"; else msg="🔴 Control de Obra: $name CAÍDO (http $code, ${ms} ms) $url"; fi
    [ -n "${TELEGRAM_BOT:-}" ] && curl -s -o /dev/null --max-time 10 -X POST "https://api.telegram.org/bot$TELEGRAM_BOT/sendMessage" -d "chat_id=${TELEGRAM_CHAT:-}" --data-urlencode "text=$msg"
    echo "$(date -u +%FT%TZ) $msg" >> "$STATE_DIR/eventos.log"
  fi
  RESULTS="$RESULTS{\"nombre\":\"$name\",\"ok\":$([ "$ok" = 1 ] && echo true || echo false),\"http\":\"$code\",\"ms\":$ms},"
}

RESULTS=""
check app "https://app.supernovarquitectos.com/?monitor=1" "body:Control de Obra"
check admin "https://app.supernovarquitectos.com/admin.html" 200
check ayuda "https://app.supernovarquitectos.com/ayuda/index.html" 200
check supabase_rest "$SB/rest/v1/subscription_plans?select=slug&limit=1" "body:gratis" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
check fn_send_email "$SB/functions/v1/send-email" "any:^(401|400)$" -X POST -H "Content-Type: application/json" -d '{}'
check fn_auth "$SB/functions/v1/auth" "any:^(400)$" -X POST -H "Content-Type: application/json" -d '{"action":"x"}'
check fn_jobs "$SB/functions/v1/jobs" "any:^(401)$" -X POST -H "Content-Type: application/json" -d '{}'
# Certificado: días restantes
exp=$(echo | openssl s_client -connect app.supernovarquitectos.com:443 -servername app.supernovarquitectos.com 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
dias=$(( ( $(date -d "$exp" +%s 2>/dev/null || echo 0) - $(date +%s) ) / 86400 ))
prev=$(cat "$STATE_DIR/cert.state" 2>/dev/null || echo 1); ok=$([ "$dias" -gt 10 ] && echo 1 || echo 0); echo "$ok" > "$STATE_DIR/cert.state"
if [ "$ok" != "$prev" ] && [ -n "${TELEGRAM_BOT:-}" ]; then curl -s -o /dev/null -X POST "https://api.telegram.org/bot$TELEGRAM_BOT/sendMessage" -d "chat_id=${TELEGRAM_CHAT:-}" --data-urlencode "text=$([ "$ok" = 1 ] && echo '✅' || echo '🔴') Control de Obra: certificado vence en $dias días"; fi
RESULTS="$RESULTS{\"nombre\":\"certificado\",\"ok\":$([ "$ok" = 1 ] && echo true || echo false),\"http\":\"$dias dias\",\"ms\":0}"
# Respaldo del día presente?
ult=$(ls -t /docker/control-obra-dashboard/backups/*.json.gz.gpg 2>/dev/null | head -1)
edad=$(( ( $(date +%s) - $(stat -c %Y "$ult" 2>/dev/null || echo 0) ) / 3600 ))
bok=$([ -n "$ult" ] && [ "$edad" -lt 30 ] && echo true || echo false)
RESULTS="$RESULTS,{\"nombre\":\"respaldo_diario\",\"ok\":$bok,\"http\":\"hace ${edad} h\",\"ms\":0}"
printf '{"actualizado":"%s","servicios":[%s]}\n' "$(date -u +%FT%TZ)" "$RESULTS" > "$STATUS_JSON"
