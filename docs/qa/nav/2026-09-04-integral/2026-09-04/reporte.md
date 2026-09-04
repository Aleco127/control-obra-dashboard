# Auditoría de UI · 2026-09-04

URL: http://127.0.0.1:8765/index.html?app=1

## Chequeos estáticos (src/index.html)

- `confirm(` nativos: **0**
- `aria-label`: 270
- `label[for]`: 681
- `onclick=` inline: 684
- clases `text-pink/rose` (color sin semántica): **6**
- píldoras `Auto-sync 3s`: **0**

## Viewport desktop

| Módulo | Overflow X | Botones icono sin nombre | Inputs sin etiqueta | Errores consola | axe AA | Montos en alerta sin motivo | Captura |
|---|---|---|---|---|---|---|---|
| Dashboard | no | 0 | 0 | 0 | 0 | 0 | desktop_d.png |
| Obras | no | 0 | 0 | 0 | 0 | 0 | desktop_o.png |
| Programa | no | 0 | 0 | 0 | 1 | 0 | desktop_w.png |
| Bitácora | no | 0 | 0 | 0 | 0 | 0 | desktop_b.png |
| Fotos | no | 0 | 0 | 0 | 0 | 0 | desktop_f.png |
| Documentos | no | 0 | 0 | 0 | 0 | 0 | desktop_k.png |
| c | no | 0 | 2 | 0 | 3 | 0 | desktop_c.png |
| r | no | 0 | 0 | 0 | 0 | 0 | desktop_r.png |
| u | no | 0 | 0 | 0 | 0 | 0 | desktop_u.png |
| y | no | 0 | 0 | 0 | 0 | 0 | desktop_y.png |
| Compras y gastos | no | 0 | 0 | 0 | 0 | 0 | desktop_g.png |
| Pagos | no | 0 | 0 | 0 | 0 | 0 | desktop_pc.png |
| Presupuesto | no | 0 | 0 | 0 | 0 | 0 | desktop_p.png |
| ct | no | 0 | 1 | 0 | 0 | 0 | desktop_ct.png |
| es | no | 0 | 0 | 0 | 0 | 0 | desktop_es.png |
| s | no | 0 | 4 | 0 | 3 | 0 | desktop_s.png |
| m | no | 0 | 4 | 0 | 3 | 0 | desktop_m.png |
| e | no | 0 | 1 | 0 | 0 | 0 | desktop_e.png |
| Nómina | no | 0 | 0 | 0 | 0 | 0 | desktop_n.png |
| t | no | 0 | 0 | 0 | 0 | 0 | desktop_t.png |
| Proveedores | no | 0 | 1 | 0 | 0 | 0 | desktop_v.png |
| Clientes | no | 0 | 0 | 0 | 0 | 0 | desktop_l.png |
| Panel fiscal | no | 0 | 0 | 0 | 0 | 0 | desktop_cb.png |
| Facturas | no | 0 | 1 | 0 | 0 | 0 | desktop_fc.png |
| ce | no | 0 | 1 | 0 | 1 | 0 | desktop_ce.png |
| Reportes | no | 0 | 0 | 0 | 0 | 0 | desktop_q.png |
| Configuración | no | 0 | 1 | 0 | 0 | 0 | desktop_z.png |
| h | no | 3 | 1 | 0 | 3 | 0 | desktop_h.png |

### desktop · Programa
- axe serious: color-contrast (1) Elements must meet minimum color contrast ratio thresholds → `.bg-teal-600`

### desktop · c
- axe serious: color-contrast (1) Elements must meet minimum color contrast ratio thresholds → `.bg-cyan-600`
- axe critical: select-name (2) Select element must have an accessible name → `#calTipoFilter`

### desktop · s
- axe critical: select-name (3) Select element must have an accessible name → `#scEstatus`

### desktop · m
- axe critical: select-name (3) Select element must have an accessible name → `#mtCat`

### desktop · ce
- axe serious: color-contrast (1) Elements must meet minimum color contrast ratio thresholds → `.bg-amber-500`

### desktop · h
- botón sin nombre: `<button onclick="toggleUserStatus('139d3f99-8902-4d7f-bbd1-34ec0181a0d2',true)" class="p-1 hover:bg-slate-100 rounded te`
- botón sin nombre: `<button onclick="toggleUserStatus('03ed3a34-8863-447f-835d-e309cc2037b9',true)" class="p-1 hover:bg-slate-100 rounded te`
- botón sin nombre: `<button onclick="toggleUserStatus('f6dbc163-8f00-4438-86df-45322623849a',true)" class="p-1 hover:bg-slate-100 rounded te`
- axe critical: button-name (3) Buttons must have discernible text → `.border-white\/5:nth-child(1) > td:nth-child(5) > .text-amber-400.hover\:bg-slate-100.p-1`

## Viewport mobile

| Módulo | Overflow X | Botones icono sin nombre | Inputs sin etiqueta | Errores consola | axe AA | Montos en alerta sin motivo | Captura |
|---|---|---|---|---|---|---|---|
| Dashboard | no | 0 | 0 | 0 | 0 | 0 | mobile_d.png |
| Obras | no | 0 | 0 | 0 | 0 | 0 | mobile_o.png |
| Programa | no | 0 | 0 | 0 | 1 | 0 | mobile_w.png |
| Bitácora | no | 0 | 0 | 0 | 0 | 0 | mobile_b.png |
| Fotos | no | 0 | 0 | 0 | 0 | 0 | mobile_f.png |
| Documentos | no | 0 | 0 | 0 | 0 | 0 | mobile_k.png |
| c | no | 0 | 2 | 0 | 4 | 0 | mobile_c.png |
| r | no | 0 | 0 | 0 | 0 | 0 | mobile_r.png |
| u | no | 0 | 0 | 0 | 0 | 0 | mobile_u.png |
| y | no | 0 | 0 | 0 | 0 | 0 | mobile_y.png |
| Compras y gastos | no | 0 | 0 | 0 | 0 | 0 | mobile_g.png |
| Pagos | no | 0 | 0 | 0 | 0 | 0 | mobile_pc.png |
| Presupuesto | no | 0 | 0 | 0 | 1 | 0 | mobile_p.png |
| ct | no | 0 | 1 | 0 | 0 | 0 | mobile_ct.png |
| es | no | 0 | 0 | 0 | 0 | 0 | mobile_es.png |
| s | no | 0 | 4 | 0 | 3 | 0 | mobile_s.png |
| m | no | 0 | 4 | 0 | 3 | 0 | mobile_m.png |
| e | no | 0 | 1 | 0 | 0 | 0 | mobile_e.png |
| Nómina | no | 0 | 0 | 0 | 0 | 0 | mobile_n.png |
| t | no | 0 | 0 | 0 | 0 | 0 | mobile_t.png |
| Proveedores | no | 0 | 1 | 0 | 0 | 0 | mobile_v.png |
| Clientes | no | 0 | 0 | 0 | 0 | 0 | mobile_l.png |
| Panel fiscal | no | 0 | 0 | 0 | 1 | 0 | mobile_cb.png |
| Facturas | no | 0 | 1 | 0 | 0 | 0 | mobile_fc.png |
| ce | no | 0 | 1 | 0 | 2 | 0 | mobile_ce.png |
| Reportes | no | 0 | 0 | 0 | 0 | 0 | mobile_q.png |
| Configuración | no | 0 | 1 | 0 | 0 | 0 | mobile_z.png |
| h | no | 3 | 1 | 0 | 3 | 0 | mobile_h.png |

### mobile · Programa
- axe serious: color-contrast (1) Elements must meet minimum color contrast ratio thresholds → `.bg-teal-600`

### mobile · c
- axe serious: color-contrast (1) Elements must meet minimum color contrast ratio thresholds → `.bg-cyan-600`
- axe serious: scrollable-region-focusable (1) Scrollable region must have keyboard access → `.overflow-x-auto`
- axe critical: select-name (2) Select element must have an accessible name → `#calTipoFilter`

### mobile · Presupuesto
- axe serious: scrollable-region-focusable (1) Scrollable region must have keyboard access → `.overflow-x-auto`

### mobile · s
- axe critical: select-name (3) Select element must have an accessible name → `#scEstatus`

### mobile · m
- axe critical: select-name (3) Select element must have an accessible name → `#mtCat`

### mobile · Panel fiscal
- axe serious: scrollable-region-focusable (1) Scrollable region must have keyboard access → `.table-wrap`

### mobile · ce
- axe serious: color-contrast (1) Elements must meet minimum color contrast ratio thresholds → `.bg-amber-500`
- axe serious: scrollable-region-focusable (1) Scrollable region must have keyboard access → `.overflow-x-auto`

### mobile · h
- botón sin nombre: `<button onclick="toggleUserStatus('139d3f99-8902-4d7f-bbd1-34ec0181a0d2',true)" class="p-1 hover:bg-slate-100 rounded te`
- botón sin nombre: `<button onclick="toggleUserStatus('03ed3a34-8863-447f-835d-e309cc2037b9',true)" class="p-1 hover:bg-slate-100 rounded te`
- botón sin nombre: `<button onclick="toggleUserStatus('f6dbc163-8f00-4438-86df-45322623849a',true)" class="p-1 hover:bg-slate-100 rounded te`
- axe critical: button-name (3) Buttons must have discernible text → `.border-white\/5:nth-child(1) > td:nth-child(5) > .text-amber-400.hover\:bg-slate-100.p-1`

## Resumen

- Errores de consola/página en total: **0**
- Violaciones axe WCAG 2 A/AA en total: **32**
- confirm( nativos: **0** (meta 0)
- Auto-sync: **0** (meta 0)
