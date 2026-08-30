#!/bin/bash
# Despliegue de Control de Obra (US-230): build → copia de dist/ al VPS → verificación → aviso.
# Uso: bash scripts/deploy.sh            (desde la raíz del repo, Git Bash o WSL)
#      bash scripts/deploy.sh --sin-build (sube dist/ tal cual)
set -e
VPS="root@213.210.13.36"
RUTA="/docker/control-obra-dashboard/html"
URL="https://app.supernovarquitectos.com"
cd "$(dirname "$0")/.."

if [ "$1" != "--sin-build" ]; then
  echo "▶ Build"
  node scripts/build-ayuda.mjs >/dev/null
  node scripts/build.mjs | tail -2
fi
BUILD=$(node -e "console.log(require('./dist/build.json').build)")
echo "▶ Subiendo build $BUILD a $VPS:$RUTA"
# Conservar la versión anterior para rollback
ssh -o StrictHostKeyChecking=no "$VPS" "rm -rf $RUTA-anterior && cp -r $RUTA $RUTA-anterior && mkdir -p $RUTA"
tar -C dist -czf /tmp/obra-dist.tgz .
scp -o StrictHostKeyChecking=no /tmp/obra-dist.tgz "$VPS:/tmp/obra-dist.tgz"
# Extraer encima (los archivos con hash viejos se limpian; status.json y docs/ se conservan)
ssh -o StrictHostKeyChecking=no "$VPS" "cd $RUTA && find js css -maxdepth 1 -type f -name '*.*.js' -o -maxdepth 1 -type f -name '*.*.css' 2>/dev/null | xargs -r rm -f; tar -xzf /tmp/obra-dist.tgz -C $RUTA && rm /tmp/obra-dist.tgz && cp $RUTA-anterior/status.json $RUTA/ 2>/dev/null; true"
echo "▶ Verificando"
code=$(curl -s -o /tmp/obra-index.html -w "%{http_code}" "$URL/?deploy=$BUILD")
grep -q "name=\"build\" content=\"$BUILD\"" /tmp/obra-index.html && ok=1 || ok=0
sw=$(curl -s -o /dev/null -w "%{http_code}" "$URL/sw.js")
if [ "$code" = "200" ] && [ "$ok" = "1" ] && [ "$sw" = "200" ]; then
  echo "✅ Desplegado build $BUILD en $URL (sw.js $sw)"
else
  echo "❌ Verificación falló (http $code, build en página: $ok, sw $sw). Rollback: ssh $VPS 'rm -rf $RUTA && mv $RUTA-anterior $RUTA'"
  exit 1
fi
if command -v python >/dev/null 2>&1 && [ -f scripts/qa/audit-ui.py ] && [ "$2" = "--audit" ]; then
  python scripts/qa/audit-ui.py --url "$URL" --out docs/qa/deploy-$BUILD --smoke || echo "⚠ auditoría con avisos"
fi
