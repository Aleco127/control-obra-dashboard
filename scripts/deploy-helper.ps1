# Script para desplegar whisperwind-dashboard a Hostinger VPS

$VPS_HOST = "root@213.210.13.36"
$PROJECT_NAME = "whisperwind-dashboard"
$LOCAL_BUILD_DIR = "C:\dev\Claude_projects\whisperwind-dashboard\dist"

# Buscar ubicación del proyecto en el VPS
Write-Host "Buscando proyecto en VPS..." -ForegroundColor Cyan
$projectLocation = ssh $VPS_HOST "find /root -name 'docker-compose.yaml' -type f 2>/dev/null | head -5"

Write-Host "Ubicaciones encontradas:" -ForegroundColor Yellow
Write-Host $projectLocation

# Listar proyectos docker compose activos
Write-Host "`nProyectos Docker Compose activos:" -ForegroundColor Cyan
ssh $VPS_HOST "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"

Write-Host "`nBuscando directorio del proyecto whisperwind-dashboard..." -ForegroundColor Cyan
ssh $VPS_HOST "docker inspect whisperwind-dashboard | grep -i 'source' | head -5"
