# DESIGN.md · Control de Obra

Guía de estilo verificada contra `src/css/styles.css` y `src/css/nav-shell.css` (septiembre 2026). Cada valor de este documento existe en `:root`; `node scripts/qa/design-tokens-check.mjs` comprueba que no haya tokens sin uso ni valores crudos repetidos. Si cambias el CSS, actualiza esta guía y corre el script.

## 1. Registro

Producto de trabajo (app de gestión): el diseño sirve a la tarea. Escena: un gerente en laptop revisando cobranza por la mañana y un residente en el celular, a pleno sol, capturando la bitácora con una mano. Por eso: tema claro, contraste alto, áreas táctiles de 44 px, sin decoración que compita con los datos.

Estrategia de color: contenida. Neutros fríos (slate) con un solo acento (azul `--accent`) que marca lo interactivo, y tres colores de estado (ok, warn, danger) que sólo aparecen cuando hay algo que decir. El azul marino `--primary` es la marca (botón principal, títulos).

## 2. Tokens

### 2.1 Referencia (capa 1)

| Token | Valor | Token | Valor |
|---|---|---|---|
| `--ref-slate-50` | #f8fafc | `--ref-slate-100` | #f1f5f9 |
| `--ref-slate-200` | #e2e8f0 | `--ref-slate-300` | #cbd5e1 |
| `--ref-slate-500` | #64748b | `--ref-slate-600` | #475569 |
| `--ref-slate-800` | #1e293b | `--ref-slate-900` | #0f172a |
| `--ref-navy-700` | #1e3a5f | `--ref-sky-100` | #e0f2fe |
| `--ref-sky-600` | #0284c7 | `--ref-sky-700` | #0369a1 |
| `--ref-emerald-100` | #d1fae5 | `--ref-emerald-700` | #047857 |
| `--ref-amber-100` | #fef3c7 | `--ref-amber-700` | #b45309 |
| `--ref-red-100` | #fee2e2 | `--ref-red-700` | #b91c1c |
| `--ref-purple-100` | #f3e8ff | `--ref-purple-600` | #9333ea |
| `--ref-blue-100` | #dbeafe | `--ref-blue-600` | #2563eb |
| `--ref-white` | #ffffff | | |

### 2.2 Semánticos (capa 2): los únicos que se usan en componentes

| Token | Referencia | Uso |
|---|---|---|
| `--bg` | slate-50 | fondo de página |
| `--surface` | white | tarjetas, modales, sidebar |
| `--surface-2` | slate-100 | fondos secundarios, hover, encabezados de tabla |
| `--line` / `--line-strong` | slate-200 / slate-300 | bordes, divisores, bordes de input |
| `--ink` | slate-800 | texto principal |
| `--ink-muted` | slate-600 | texto secundario, etiquetas de formulario |
| `--ink-subtle` | slate-500 | metadatos ≥ 12 px, placeholders cortos |
| `--primary` / `--primary-ink` / `--primary-hover` | navy-700 / white / slate-900 | botón principal, marca |
| `--accent` / `--accent-ink` / `--accent-soft` / `--accent-fill` | sky-700 / white / sky-100 / sky-600 | enlaces, ítem activo, texto interactivo; `-fill` sólo para rellenos gráficos |
| `--ok`, `--ok-soft` | emerald-700 / 100 | pagado, cumplido, a tiempo |
| `--warn`, `--warn-soft` | amber-700 / 100 | parcial, pendiente, hito externo |
| `--danger`, `--danger-soft` | red-700 / 100 | vencido, error, acción destructiva |
| `--info`, `--info-soft` | blue-600 / 100 | informativo |
| `--violet`, `--violet-soft` | purple-600 / 100 | categoría Calidad |
| `--ring`, `--ring-soft` | sky-600 / rgba | foco visible y halo de input |

### 2.3 Contraste medido (WCAG 2.1, luminancia relativa)

| Combinación | Ratio | Cumple |
|---|---|---|
| `--ink` sobre `--bg` | 14.2 : 1 | AAA |
| `--ink` sobre `--surface` | 14.9 : 1 | AAA |
| `--ink-muted` sobre `--surface` | 7.6 : 1 | AAA |
| `--ink-subtle` sobre `--surface` | 4.7 : 1 | AA (texto normal, límite) |
| `--accent` sobre `--surface` | 5.9 : 1 | AA |
| `--ok` sobre `--surface` | 5.5 : 1 | AA |
| `--warn` sobre `--surface` | 5.0 : 1 | AA |
| `--danger` sobre `--surface` | 6.5 : 1 | AA |
| `--primary-ink` sobre `--primary` | 11.5 : 1 | AAA |

Regla: `--ink-subtle` nunca en párrafos ni en texto menor de 12 px. Las clases Tailwind heredadas (`text-gray-400`, `text-green-400`, etc.) se redirigen a estos tokens en `styles.css` para que el código viejo cumpla sin reescribirlo.

### 2.4 Espaciado, radios, sombras, z-index, tipografía

| Grupo | Tokens |
|---|---|
| Espaciado (escala 4 px) | `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-10` 40 |
| Radios | `--radius-sm` 8 · `--radius-md` 12 · `--radius-lg` 16 · `--radius-pill` 999 |
| Sombras | `--shadow-1` (tarjeta en reposo) · `--shadow-2` (hover, botón principal) · `--shadow-3` (modal, drawer, paleta) |
| Z-index | dropdown 20 · sticky 30 · sidebar 40 · backdrop 50 · drawer 60 · modal 100 · toast 110 · tooltip 120 · loader 130 |
| Tipografía | `--fs-xs` 11 · `--fs-sm` 13 · `--fs-base` 15 · `--fs-lg` 18; títulos de módulo 20 px (`text-xl` de Tailwind), display en tarjetas 22 a 24 px |
| Área táctil | `--tap` 44 px (botones, inputs, ítems de bottom nav) |
| Barra de módulos | `--sb-w` 224 (ancho expandido; 240 en el portal) · `--sb-w-col` 64 (colapsado) · `--backdrop` rgba(15,23,42,.5) (fondo de hojas) · `--dur-1` 150 ms · `--dur-2` 250 ms |

Familia tipográfica: la del sistema (Tailwind `font-sans`). Una sola familia con contraste de peso (400 cuerpo, 500 botones, 600 nav activo, 700 títulos y cifras).

## 3. Componentes y estados

Estados: reposo · hover · foco · deshabilitado. El foco siempre es `outline:2px solid var(--ring); outline-offset:2px` (`:focus-visible`), en todos los componentes.

| Componente | Clase | Reposo | Hover | Deshabilitado |
|---|---|---|---|---|
| Botón primario | `.btn.btn-p` | fondo `--primary`, texto `--primary-ink`, radio sm, alto 44 | `--primary-hover` + `--shadow-2` | opacidad .55, sin sombra |
| Botón secundario | `.btn.btn-s` | fondo `--surface-2`, borde `--line`, texto `--ink-muted` | fondo `--line` | opacidad .55 |
| Botón destructivo | `.btn.btn-danger` | fondo `--danger`, texto blanco | rojo más oscuro | opacidad .55 |
| Botón de icono | `.btn-icon` | 44 × 44, texto `--ink-subtle`, sin fondo; siempre `aria-label` | fondo `--surface-2`, texto `--ink` | opacidad .55 |
| Input / select / textarea | `.inp` | borde `--line-strong`, alto 44, placeholder `--ink-subtle`; 16 px en móvil | borde `--ring` + halo `--ring-soft` en foco | readonly: fondo `--surface-2` |
| Tabla | `.table-modern` en `.table-wrap` (overflow-x) | encabezado `--bg` en mayúsculas 11 px, filas separadas por `--surface-2` | fila `--bg` | |
| Tarjeta | `.g` (bloque) / `.card` | `--surface`, borde `--line`, `--shadow-1`, radio md | `.card`: borde `--line-strong` + `--shadow-2` | |
| Modal | `.modal` + contenido `.g` o `.mdl-c` | fondo rgba(15,23,42,.6), z modal; en < 640 px ocupa el ancho completo anclado abajo | | |
| Dialog de confirmación | `dialog.dlg` (`Dialog.confirm`) | título, texto, icono de tono; foco inicial en Cancelar | | botón destructivo usa `--danger` |
| Toast | `#toastContainer` (`Toast.*`) | esquina inferior derecha, z toast, `aria-live=polite`; tonos green/red/amber/blue 700 con texto blanco | | |
| Badge | `.badge-red` / `.badge-amber` / `.badge-new` | fondo `-soft` + texto de estado, 9 px, píldora | | |
| Estado vacío | `.empty` (`EmptyState()`) | icono 40 px `--ink-subtle`, título 18 px, cuerpo ≤ 42ch, acción primaria + secundaria | | |
| Drawer (ficha lateral) | `.drawer` | 520 px (100 vw en móvil), `--shadow-3`, `role=dialog` | | |
| Bottom nav | `#mobileBottomNav .mbn-item` | 5 posiciones + botón central `.mbn-plus` (52 px, `--primary`) | activo `--accent` | |
| Matriz semanal | `.wk` | celda 44 px; programada `--accent-soft`; hito externo `--warn-soft` con borde discontinuo; terminada `--ok-soft`; semana actual con línea `--accent` | | |
| Línea de tiempo de cobranza | `.cob-track .cob-mark` | marcador 18 px: ok `--ok`, parcial `--warn`, en ventana `--accent-fill`, vencida `--danger` | escala 1.25 | |
| Paleta de comandos | `.cmdk` (Ctrl+K) | caja 620 px, lista con grupos; ítem seleccionado `--accent-soft` | | |
| Barra de módulos (NavShell) | `.nvs` y derivadas, ver §3.1 | ítem `--ink-muted` 40 px (44 en móvil); grupo `<button aria-expanded>` con chevrón | `--surface-2` + `--ink` | candado `.nvs-locked`: `--ink-subtle` + ícono `.nvs-lock` |

### 3.1 Barra de módulos: `src/css/nav-shell.css` (US-604)

Un solo archivo de estilos para la barra que pinta `js/nav-shell.js` en la constructora (`index.html`, `.nvs-constructora`) y en el portal del cliente (`portal.html`, `.nvs-cliente`). Sólo usa tokens: `design-tokens-check.mjs` falla si aparece un color crudo o si el portal no declara en su `:root` algún token que el archivo consume (el portal no carga `styles.css`, por eso repite los nombres con sus propios valores). Contraste anotado en la cabecera del archivo: activo `--accent` sobre `--accent-soft` 5.2:1; reposo `--ink-muted` sobre `--surface` 7.6:1; badge blanco sobre `--danger` 6.5:1; `--ink-subtle` sólo sobre `--surface` (sobre `--surface-2` baja a 4.3:1).

| Pieza | Clase | Reposo | Activo / abierto | Notas |
|---|---|---|---|---|
| Contenedor | `.nvs` (`.nvs-col` colapsado) | columna, `--fs-sm`, gap 8 | | en `< 768` sube a `--fs-base` y todo botón mide ≥ `--tap` |
| Marca | `.nvs-marca` + `.nvs-marca-nombre` / `.nvs-marca-sub` | logo 36 px en `--surface-2`; nombre `--primary` 700 hasta 2 líneas; sub `--ink-muted` 11 px | | sin «Control de Obra v3» |
| Obra activa | `.nvs-ctx` (`.nvs-ctx-btn`, `.nvs-ctx-bar`, `.nvs-sem-ok/warn/danger`) | tarjeta `--bg` con borde `--line`, radio md; barra de avance 4 px `--accent-fill` | título a `--accent` al pasar el cursor | acción «Cambiar» `.nvs-ctx-accion` en `--accent` |
| Eyebrow | `.nvs-eyebrow` | 11 px 700 mayúsculas `--ink-subtle` | | «Mi trabajo», títulos de la hoja |
| Ítem | `.nvs-item` (`.nvs-ic`, `.nvs-tx`) | `--ink-muted` 500, 40 px, radio sm | `.active`: `--accent-soft` + `--accent` 600 y `aria-current="page"` | hover `--surface-2` + `--ink`; dentro de un grupo mide 36 px |
| Badge | `.nvs-badge` / `.nvs-badge.nvs-dot` | píldora `--danger` con texto `--primary-ink` 11 px 700; punto de 8 px | | colapsado y barra inferior: punto en la esquina |
| Candado | `.nvs-item.nvs-locked` + `.nvs-lock` | texto `--ink-subtle`, ícono 14 px | | el grupo entero: `.nvs-grupo-locked` |
| Grupo | `section.nvs-grupo` > `button.nvs-grupo-h[aria-expanded]` + `.nvs-grupo-items` | cabecera `--ink` 600 con chevrón `--ink-subtle` | cerrado: chevrón a -90°; si contiene el activo, punto `--accent` (`.nvs-grupo-punto`) | `.nvs-sep` dibuja un divisor arriba; `.nvs-mas` muestra los secundarios |
| Pie | `.nvs-pie` > `.nvs-accion` (`.nvs-danger`, `.nvs-kbd`) | acciones `--ink-muted`; atajo en `kbd` con borde `--line-strong` | | «Salir» en `--danger` con hover `--danger-soft` |
| Colapsado | `.nvs-col` | sólo íconos centrados a 44 px; nombres en `title`/`aria-label` | grupo con activo: punto `--accent` arriba a la derecha | flyout `.nvs-fly` (surface, `--shadow-3`, z dropdown) al pasar el cursor, con foco (`:focus-within`) o con `.nvs-abierto`; el anfitrión debe dejar `overflow:visible` en `#nv` |
| Barra inferior | `.nvs-bottom` > `.nvs-item.nvs-bottom-item`, `.nvs-bottom-plus`, `.nvs-bottom-mas` | fija abajo, `--surface`, borde `--line`, ítems ≥ 44 px con etiqueta 11 px `--ink-muted` | activo `--accent` | `+` de 52 px en `--primary`; se oculta a partir de 768 px (constructora) o 900 px (cliente); dentro de `#mobileBottomNav` pierde posición y borde propios |
| Hoja de módulos | `.nvs-sheet-backdrop` + `.nvs-sheet` (`.nvs-sheet-grupo`, `.nvs-sheet-grid`, `.nvs-sheet-pie`) | hoja inferior con asa, radio lg arriba, `--shadow-3`, rejilla de 3 columnas con celdas de 72 px | celda activa `--accent-soft`; fijados con ★ `--warn` | reemplaza el sidebar a pantalla completa (US-613); `.ac` la abre |

Foco: `outline 2px var(--ring)` hacia dentro (`outline-offset:-2px`) para que el scroll del aside no lo recorte. Movimiento: 150/250 ms; `prefers-reduced-motion` pone `transition:none` en todo lo que se anima. Las reglas viejas de `styles.css` (`.cat-*`, `.nav-item`, `.sb.col .cat-*`) están marcadas `/* legado: quitar en US-616 */`.

## 4. Reglas

- Ningún color crudo nuevo en `index.html`; usar tokens o las clases Tailwind ya redirigidas. Excepciones aceptadas: gráficas Chart.js y PDF (jsPDF) que necesitan hex.
- Prohibido: bordes laterales de acento (`border-left` > 1 px como decoración), texto con gradiente, tarjetas idénticas en rejilla como única estructura, `confirm()` nativo, iconos sin nombre accesible.
- Movimiento: transiciones de 150 a 300 ms con curvas ease-out; `prefers-reduced-motion` las anula.
- Copy: español con acentos, botones verbo + objeto, errores con causa y remedio (`humanizeError`), sin guiones largos.
- Responsive: `< 768` sidebar oculto y bottom nav; `< 640` modales a pantalla completa y formularios a una columna; tablas en `.table-wrap` (nunca desbordan el body); inputs a 16 px.
