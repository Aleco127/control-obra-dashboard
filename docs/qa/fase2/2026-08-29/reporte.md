# Auditoría de UI · 2026-08-29

URL: http://localhost:8765/index.html

## Chequeos estáticos (src/index.html)

- `confirm(` nativos: **0**
- `aria-label`: 252
- `label[for]`: 698
- `onclick=` inline: 668
- clases `text-pink/rose` (color sin semántica): **6**
- píldoras `Auto-sync 3s`: **0**

## Viewport desktop

| Módulo | Overflow X | Botones icono sin nombre | Inputs sin etiqueta | Errores consola | axe AA | Montos en alerta sin motivo | Captura |
|---|---|---|---|---|---|---|---|
| Dashboard | no | 0 | 0 | 0 | 0 | 0 | desktop_d.png |
| Obras | no | 0 | 0 | 0 | 0 | 0 | desktop_o.png |
| Ficha de obra | no | 0 | 0 | 0 | 0 | 0 | desktop_ficha.png |
| Programa | no | 0 | 0 | 0 | 4 | 0 | desktop_w.png |
| Pagos | no | 0 | 0 | 0 | 0 | 0 | desktop_pc.png |
| Pagos · Por pagar | no | 0 | 0 | 0 | 0 | 0 | desktop_pagar.png |
| Pagos · Flujo | no | 0 | 0 | 0 | 0 | 0 | desktop_flujo.png |
| Compras y gastos | no | 0 | 0 | 0 | 1 | 0 | desktop_g.png |
| Bitácora | no | 0 | 0 | 0 | 1 | 0 | desktop_b.png |
| Clientes | no | 0 | 0 | 0 | 3 | 0 | desktop_l.png |
| Proveedores | no | 0 | 4 | 0 | 3 | 1 | desktop_v.png |
| Nómina | no | 0 | 0 | 0 | 3 | 0 | desktop_n.png |
| Panel fiscal | no | 0 | 0 | 0 | 0 | 0 | desktop_cb.png |
| Cierres | no | 0 | 0 | 0 | 0 | 0 | desktop_ci.png |
| Socios | no | 0 | 0 | 0 | 0 | 0 | desktop_so.png |
| Reportes | no | 0 | 0 | 0 | 0 | 0 | desktop_q.png |
| Configuración | no | 0 | 1 | 0 | 4 | 0 | desktop_z.png |

### desktop · Programa
- axe serious: color-contrast (4) Elements must meet minimum color contrast ratio thresholds → `.bg-amber-600`

### desktop · Compras y gastos
- axe critical: aria-required-children (1) Certain ARIA roles must contain particular children → `.kpi-strip`

### desktop · Bitácora
- axe serious: color-contrast (1) Elements must meet minimum color contrast ratio thresholds → `.bg-green-600`

### desktop · Clientes
- axe serious: color-contrast (3) Elements must meet minimum color contrast ratio thresholds → `.bg-green-600`

### desktop · Proveedores
- axe critical: select-name (3) Select element must have an accessible name → `.sm\:w-40:nth-child(1)`
- monto en color de alerta sin motivo visible: 1Con CLABE o cuenta

### desktop · Nómina
- axe serious: color-contrast (3) Elements must meet minimum color contrast ratio thresholds → `.bg-emerald-600`

### desktop · Configuración
- axe critical: image-alt (1) Images must have alternative text → `img`
- axe critical: label (2) Form elements must have labels → `#prefNotif`
- axe critical: select-name (1) Select element must have an accessible name → `#prefMoneda`

## Viewport mobile

| Módulo | Overflow X | Botones icono sin nombre | Inputs sin etiqueta | Errores consola | axe AA | Montos en alerta sin motivo | Captura |
|---|---|---|---|---|---|---|---|
| Dashboard | no | 0 | 0 | 0 | 1 | 0 | mobile_d.png |
| Obras | no | 0 | 0 | 0 | 0 | 0 | mobile_o.png |
| Ficha de obra | no | 0 | 0 | 0 | 0 | 0 | mobile_ficha.png |
| Programa | no | 0 | 0 | 0 | 4 | 0 | mobile_w.png |
| Pagos | no | 0 | 0 | 0 | 1 | 0 | mobile_pc.png |
| Pagos · Por pagar | no | 0 | 0 | 0 | 2 | 0 | mobile_pagar.png |
| Pagos · Flujo | no | 0 | 0 | 0 | 1 | 0 | mobile_flujo.png |
| Compras y gastos | no | 0 | 0 | 0 | 2 | 0 | mobile_g.png |
| Bitácora | no | 0 | 0 | 0 | 1 | 0 | mobile_b.png |
| Clientes | no | 0 | 0 | 0 | 3 | 0 | mobile_l.png |
| Proveedores | no | 0 | 4 | 0 | 4 | 1 | mobile_v.png |
| Nómina | no | 0 | 0 | 0 | 1 | 0 | mobile_n.png |
| Panel fiscal | no | 0 | 0 | 0 | 2 | 0 | mobile_cb.png |
| Cierres | no | 0 | 0 | 0 | 0 | 0 | mobile_ci.png |
| Socios | no | 0 | 0 | 0 | 1 | 0 | mobile_so.png |
| Reportes | no | 0 | 0 | 0 | 0 | 0 | mobile_q.png |
| Configuración | no | 0 | 1 | 0 | 4 | 0 | mobile_z.png |

### mobile · Dashboard
- axe serious: scrollable-region-focusable (1) Scrollable region must have keyboard access → `.kpi-strip`

### mobile · Programa
- axe serious: color-contrast (4) Elements must meet minimum color contrast ratio thresholds → `.bg-amber-600`

### mobile · Pagos
- axe serious: scrollable-region-focusable (1) Scrollable region must have keyboard access → `.kpi-strip`

### mobile · Pagos · Por pagar
- axe serious: scrollable-region-focusable (2) Scrollable region must have keyboard access → `#c > .kpi-strip`

### mobile · Pagos · Flujo
- axe serious: scrollable-region-focusable (1) Scrollable region must have keyboard access → `.kpi-strip`

### mobile · Compras y gastos
- axe critical: aria-required-children (1) Certain ARIA roles must contain particular children → `.kpi-strip`
- axe serious: scrollable-region-focusable (1) Scrollable region must have keyboard access → `.kpi-strip`

### mobile · Bitácora
- axe serious: color-contrast (1) Elements must meet minimum color contrast ratio thresholds → `.bg-green-600`

### mobile · Clientes
- axe serious: color-contrast (3) Elements must meet minimum color contrast ratio thresholds → `.bg-green-600`

### mobile · Proveedores
- axe serious: scrollable-region-focusable (1) Scrollable region must have keyboard access → `.kpi-strip`
- axe critical: select-name (3) Select element must have an accessible name → `.sm\:w-40:nth-child(1)`
- monto en color de alerta sin motivo visible: 1Con CLABE o cuenta

### mobile · Nómina
- axe serious: color-contrast (1) Elements must meet minimum color contrast ratio thresholds → `.bg-emerald-600`

### mobile · Panel fiscal
- axe serious: scrollable-region-focusable (2) Scrollable region must have keyboard access → `.kpi-strip`

### mobile · Socios
- axe serious: scrollable-region-focusable (1) Scrollable region must have keyboard access → `.kpi-strip`

### mobile · Configuración
- axe critical: image-alt (1) Images must have alternative text → `img`
- axe critical: label (2) Form elements must have labels → `#prefNotif`
- axe critical: select-name (1) Select element must have an accessible name → `#prefMoneda`

## Resumen

- Errores de consola/página en total: **0**
- Violaciones axe WCAG 2 A/AA en total: **46**
- confirm( nativos: **0** (meta 0)
- Auto-sync: **0** (meta 0)
