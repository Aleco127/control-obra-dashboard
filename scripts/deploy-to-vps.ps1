# Script para desplegar whisperwind-dashboard al VPS de Hostinger

$VPS_HOST = "213.210.13.36"
$VPS_USER = "root"
$PROJECT_DIR = "/root/whisperwind-app"
$LOCAL_PROJECT_DIR = "C:\Users\aleja\iCloudDrive\Claude_projects\whisperwind-dashboard"

Write-Host "=== Desplegando Whisperwind Dashboard al VPS ===" -ForegroundColor Cyan
Write-Host ""

# Paso 1: Crear directorio en VPS si no existe
Write-Host "1. Creando directorio en VPS..." -ForegroundColor Yellow
ssh "$VPS_USER@$VPS_HOST" "mkdir -p $PROJECT_DIR"

# Paso 2: Subir archivos necesarios
Write-Host "2. Subiendo archivos al VPS..." -ForegroundColor Yellow

# Subir directorio docker completo
Write-Host "   - Subiendo configuración Docker..." -ForegroundColor Gray
scp -r "$LOCAL_PROJECT_DIR\docker" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"

# Subir código fuente
Write-Host "   - Subiendo código fuente..." -ForegroundColor Gray
scp -r "$LOCAL_PROJECT_DIR\src" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"

# Subir public
Write-Host "   - Subiendo archivos públicos..." -ForegroundColor Gray
scp -r "$LOCAL_PROJECT_DIR\public" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"

# Subir archivos de configuración
Write-Host "   - Subiendo archivos de configuración..." -ForegroundColor Gray
scp "$LOCAL_PROJECT_DIR\package.json" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"
scp "$LOCAL_PROJECT_DIR\package-lock.json" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"
scp "$LOCAL_PROJECT_DIR\tsconfig.json" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"
scp "$LOCAL_PROJECT_DIR\tsconfig.app.json" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"
scp "$LOCAL_PROJECT_DIR\tsconfig.node.json" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"
scp "$LOCAL_PROJECT_DIR\vite.config.ts" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"
scp "$LOCAL_PROJECT_DIR\tailwind.config.ts" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"
scp "$LOCAL_PROJECT_DIR\index.html" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"
scp "$LOCAL_PROJECT_DIR\postcss.config.js" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"
scp "$LOCAL_PROJECT_DIR\components.json" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"
scp "$LOCAL_PROJECT_DIR\.env" "${VPS_USER}@${VPS_HOST}:${PROJECT_DIR}/"

# Paso 3: Detener proyecto existente
Write-Host "3. Deteniendo proyecto existente..." -ForegroundColor Yellow
ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR/docker && docker-compose down 2>/dev/null || true"

# Paso 4: Construir y levantar proyecto
Write-Host "4. Construyendo y levantando proyecto..." -ForegroundColor Yellow
ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR/docker && CACHEBUST=$(date +%s) docker-compose up -d --build"

# Paso 5: Verificar estado
Write-Host ""
Write-Host "5. Verificando estado del proyecto..." -ForegroundColor Yellow
ssh "$VPS_USER@$VPS_HOST" "docker ps | grep whisperwind"

Write-Host ""
Write-Host "=== Despliegue Completado ===" -ForegroundColor Green
Write-Host "Dashboard disponible en: http://213.210.13.36:8080" -ForegroundColor Cyan
Write-Host "Webhook disponible en: http://213.210.13.36:3000" -ForegroundColor Cyan
