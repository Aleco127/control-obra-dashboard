# Auditoría de UI · 2026-08-28

URL: https://obra.srv1090924.hstgr.cloud/index.html

## Chequeos estáticos (src/index.html)

- `confirm(` nativos: **0**
- `aria-label`: 249
- `label[for]`: 719
- `onclick=` inline: 679

## Viewport desktop

| Módulo | Overflow X | Botones icono sin nombre | Inputs sin etiqueta | Errores consola | Captura |
|---|---|---|---|---|---|
| Dashboard | no | 0 | 0 | 0 | desktop_d.png |
| Obras | no | 0 | 0 | 0 | desktop_o.png |
| Ficha de obra | no | 0 | 0 | 0 | desktop_ficha.png |
| Pagos | no | 0 | 0 | 0 | desktop_pc.png |
| Programa | no | 0 | 0 | 0 | desktop_w.png |

## Viewport mobile

| Módulo | Overflow X | Botones icono sin nombre | Inputs sin etiqueta | Errores consola | Captura |
|---|---|---|---|---|---|
| Dashboard | no | 0 | - | 0 | Page.evaluate: ReferenceError: R is not defined
    at eval (eval at evaluate (:302:30), <anonymous>:1:67)
    at UtilityScript.evaluate (<anonymous>:309:18)
    at UtilityScript.<anonymous> (<anonymous>:1:44) |
| Obras | no | 0 | - | 0 | Page.evaluate: ReferenceError: R is not defined
    at eval (eval at evaluate (:302:30), <anonymous>:1:67)
    at UtilityScript.evaluate (<anonymous>:309:18)
    at UtilityScript.<anonymous> (<anonymous>:1:44) |
| Ficha de obra | no | 0 | - | 0 | Page.evaluate: ReferenceError: abrirFichaObra is not defined
    at eval (eval at evaluate (:302:30), <anonymous>:1:5)
    at UtilityScript.evaluate (<anonymous>:309:18)
    at UtilityScript.<anonymous> (<anonymous>:1:44) |
| Pagos | no | 0 | - | 0 | Page.evaluate: ReferenceError: R is not defined
    at eval (eval at evaluate (:302:30), <anonymous>:1:68)
    at UtilityScript.evaluate (<anonymous>:309:18)
    at UtilityScript.<anonymous> (<anonymous>:1:44) |
| Programa | no | 0 | - | 0 | Page.evaluate: ReferenceError: irAModuloConObra is not defined
    at eval (eval at evaluate (:302:30), <anonymous>:1:5)
    at UtilityScript.evaluate (<anonymous>:309:18)
    at UtilityScript.<anonymous> (<anonymous>:1:44) |

## Resumen

- Errores de consola/página en total: **0**
- confirm( nativos: **0** (meta 0)
