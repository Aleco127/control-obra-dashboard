# Auditoría de UI · 2026-08-29

URL: https://obra.srv1090924.hstgr.cloud/

## Chequeos estáticos (src/index.html)

- `confirm(` nativos: **0**
- `aria-label`: 257
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
| Programa | no | 0 | 0 | 0 | 2 | 0 | desktop_w.png |
| Pagos | no | 0 | 0 | 0 | 0 | 0 | desktop_pc.png |
| Pagos · Por pagar | no | 0 | 0 | 0 | 0 | 0 | desktop_pagar.png |
| Pagos · Flujo | no | 0 | 0 | 0 | 0 | 0 | desktop_flujo.png |
| Compras y gastos | no | 0 | 0 | 0 | 0 | 0 | desktop_g.png |
| Bitácora | no | 0 | 0 | 0 | 0 | 0 | desktop_b.png |
| Clientes | no | 0 | 0 | 0 | 2 | 0 | desktop_l.png |
| Proveedores | no | 0 | 1 | 0 | 0 | 0 | desktop_v.png |
| Nómina | no | 0 | 0 | 0 | 2 | 0 | desktop_n.png |
| Panel fiscal | no | 0 | 0 | 0 | 0 | 0 | desktop_cb.png |
| Cierres | no | 0 | 0 | 0 | 0 | 0 | desktop_ci.png |
| Socios | no | 0 | 0 | 0 | 0 | 0 | desktop_so.png |
| Reportes | no | 0 | 0 | 0 | 0 | 0 | desktop_q.png |
| Configuración | no | 0 | 0 | 0 | 1 | 0 | desktop_z.png |

### desktop · Programa
- axe serious: color-contrast (2) Elements must meet minimum color contrast ratio thresholds → `.bg-orange-600`

### desktop · Clientes
- axe serious: color-contrast (2) Elements must meet minimum color contrast ratio thresholds → `div[onclick="abrirCliente(7)"] > .min-w-0.flex-1 > .gap-2.mb-1.items-center > .bg-slate-600\/50.py-0\.5.px-2`

### desktop · Nómina
- axe serious: color-contrast (2) Elements must meet minimum color contrast ratio thresholds → `#seccionPeriodos > .overflow-hidden.shadow.rounded-xl > .overflow-x-auto > table > tbody > tr:nth-child(1) > .text-green-600.text-right`

### desktop · Configuración
- axe critical: label (1) Form elements must have labels → `#prefBackup`

## Viewport mobile

| Módulo | Overflow X | Botones icono sin nombre | Inputs sin etiqueta | Errores consola | axe AA | Montos en alerta sin motivo | Captura |
|---|---|---|---|---|---|---|---|
| Dashboard | no | 0 | 0 | 0 | 0 | 0 | mobile_d.png |
| Obras | no | 0 | 0 | 0 | 0 | 0 | mobile_o.png |
| Ficha de obra | no | 0 | 0 | 0 | 0 | 0 | mobile_ficha.png |
| Programa | no | 0 | 0 | 0 | 2 | 0 | mobile_w.png |
| Pagos | no | 0 | 0 | 0 | 0 | 0 | mobile_pc.png |
| Pagos · Por pagar | no | 0 | 0 | 0 | 0 | 0 | mobile_pagar.png |
| Pagos · Flujo | no | 0 | 0 | 0 | 0 | 0 | mobile_flujo.png |
| Compras y gastos | no | 0 | 0 | 0 | 0 | 0 | mobile_g.png |
| Bitácora | no | 0 | 0 | 0 | 0 | 0 | mobile_b.png |
| Clientes | no | 0 | 0 | 0 | 2 | 0 | mobile_l.png |
| Proveedores | no | 0 | 1 | 0 | 0 | 0 | mobile_v.png |
| Nómina | no | 0 | 0 | 0 | 0 | 0 | mobile_n.png |
| Panel fiscal | no | 0 | 0 | 0 | 1 | 0 | mobile_cb.png |
| Cierres | no | 0 | 0 | 0 | 0 | 0 | mobile_ci.png |
| Socios | no | 0 | 0 | 0 | 0 | 0 | mobile_so.png |
| Reportes | no | 0 | 0 | 0 | 0 | 0 | mobile_q.png |
| Configuración | no | 0 | 0 | 0 | 1 | 0 | mobile_z.png |

### mobile · Programa
- axe serious: color-contrast (2) Elements must meet minimum color contrast ratio thresholds → `.bg-orange-600`

### mobile · Clientes
- axe serious: color-contrast (2) Elements must meet minimum color contrast ratio thresholds → `div[onclick="abrirCliente(7)"] > .min-w-0.flex-1 > .gap-2.mb-1.items-center > .bg-slate-600\/50.py-0\.5.px-2`

### mobile · Panel fiscal
- axe serious: scrollable-region-focusable (1) Scrollable region must have keyboard access → `.table-wrap`

### mobile · Configuración
- axe critical: label (1) Form elements must have labels → `#prefBackup`

## Resumen

- Errores de consola/página en total: **0**
- Violaciones axe WCAG 2 A/AA en total: **13**
- confirm( nativos: **0** (meta 0)
- Auto-sync: **0** (meta 0)
