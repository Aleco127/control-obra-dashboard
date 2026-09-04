# Auditoría de UI · 2026-09-04

URL: https://app.supernovarquitectos.com/?app=1

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
| Compras y gastos | no | 0 | 0 | 0 | 0 | 0 | desktop_g.png |
| Pagos | no | 0 | 0 | 0 | 0 | 0 | desktop_pc.png |
| Programa | no | 0 | 0 | 0 | 1 | 0 | desktop_w.png |

### desktop · Programa
- axe serious: color-contrast (1) Elements must meet minimum color contrast ratio thresholds → `.bg-teal-600`

## Viewport mobile

| Módulo | Overflow X | Botones icono sin nombre | Inputs sin etiqueta | Errores consola | axe AA | Montos en alerta sin motivo | Captura |
|---|---|---|---|---|---|---|---|
| Dashboard | no | 0 | 0 | 0 | 0 | 0 | mobile_d.png |
| Obras | no | 0 | 0 | 0 | 0 | 0 | mobile_o.png |
| Compras y gastos | no | 0 | 0 | 0 | 0 | 0 | mobile_g.png |
| Pagos | no | 0 | 0 | 0 | 0 | 0 | mobile_pc.png |
| Programa | no | 0 | 0 | 0 | 1 | 0 | mobile_w.png |

### mobile · Programa
- axe serious: color-contrast (1) Elements must meet minimum color contrast ratio thresholds → `.bg-teal-600`

## Resumen

- Errores de consola/página en total: **0**
- Violaciones axe WCAG 2 A/AA en total: **2**
- confirm( nativos: **0** (meta 0)
- Auto-sync: **0** (meta 0)
