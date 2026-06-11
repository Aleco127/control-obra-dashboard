#!/bin/bash
# Script de despliegue para Control de Obra

# Configuracion
VPS_HOST="root@213.210.13.36"
VPS_PATH="/docker/control-obra-dashboard/html"
LOCAL_FILE="src/index.html"

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "=========================================="
echo "  SUPERNOVA - Control de Obra Deployment"
echo "=========================================="

# Verificar que existe el archivo
if [ ! -f "$LOCAL_FILE" ]; then
    echo -e "${RED}Error: No se encuentra $LOCAL_FILE${NC}"
    exit 1
fi

echo "Desplegando $LOCAL_FILE a $VPS_HOST:$VPS_PATH..."

# Copiar archivo al VPS
scp "$LOCAL_FILE" "$VPS_HOST:$VPS_PATH/index.html"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Desplegado exitosamente!${NC}"
    echo "URL: https://obra.srv1090924.hstgr.cloud"
else
    echo -e "${RED}Error en el despliegue${NC}"
    exit 1
fi
