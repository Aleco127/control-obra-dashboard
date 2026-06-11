# Control de Obra - SUPERNOVA ARQUITECTOS

Sistema de control y gestion de obras de construccion.

## Estructura del Proyecto

```
control-obra-dashboard/
├── src/                    # Codigo fuente
│   └── index.html          # Aplicacion principal (SPA)
├── docker/                 # Configuracion de Docker
│   └── docker-compose.yml  # Definicion de servicios
├── docs/                   # Documentacion
│   └── API.md              # Documentacion de API
├── scripts/                # Scripts de utilidad
│   └── deploy.sh           # Script de despliegue
└── README.md               # Este archivo
```

## Tecnologias

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **UI Framework**: TailwindCSS
- **Backend**: Supabase (PostgreSQL + Auth)
- **Hosting**: VPS Hostinger con Docker
- **Charts**: Chart.js
- **Export**: jsPDF, XLSX.js

## Modulos

### Principal
- Dashboard con KPIs financieros
- Resumen de obras activas

### Proyectos
- Obras: Gestion de proyectos de construccion
- Presupuesto: Control presupuestal por obra
- Programa: Cronograma y actividades (Gantt)
- Gastos: Registro y seguimiento de gastos
- Ordenes: Ordenes de compra
- Cotizaciones: Generacion de cotizaciones
- Estimaciones: Control de avance fisico/financiero

### Operacion
- Bitacora: Registro diario de obra
- Materiales: Inventario y movimientos
- Subcontratos: Gestion de subcontratistas
- Calendario: Eventos y recordatorios

### Calidad
- RFIs: Solicitudes de informacion
- Punch List: Lista de pendientes
- Seguridad: Control de seguridad en obra

### Contabilidad
- Panel Contable: Dashboard financiero
- Facturas: Control de facturas recibidas
- Retenciones: Gestion de retenciones
- CFDIs: Facturas emitidas

### Archivos
- Documentos: Gestion documental
- Fotos: Galeria fotografica por obra

### Personal
- Empleados: Gestion de personal
- Nomina: Control de pagos
- Asistencia: Registro de asistencia
- Clientes: Directorio de clientes
- Proveedores: Directorio de proveedores

## Despliegue

### Requisitos
- Docker y Docker Compose
- Acceso SSH al VPS

### Comandos

```bash
# Desplegar al VPS
./scripts/deploy.sh

# O manualmente
scp src/index.html root@213.210.13.36:/docker/control-obra-dashboard/html/index.html
```

## Variables de Entorno (Supabase)

Configuradas en el archivo HTML:
- `SUPABASE_URL`: URL del proyecto Supabase
- `SUPABASE_ANON_KEY`: Llave anonima para acceso publico

## Acceso

- **URL**: https://obra.srv1090924.hstgr.cloud
- **VPS**: srv1090924.hstgr.cloud (213.210.13.36)

## Licencia

Privado - SUPERNOVA ARQUITECTOS
