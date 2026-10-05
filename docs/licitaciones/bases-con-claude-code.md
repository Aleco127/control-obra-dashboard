# Cargar las bases de una licitación con Claude Code (US-819)

Claude Code lee las bases en la PC del usuario y deja un archivo `licitacion-bases/v1` que el panel importa. No hay
función de borde ni llave de Anthropic: Claude Code corre con la cuenta del usuario y el panel sólo recibe el JSON.
La captura manual (pestañas **Bases** y **Requisitos** de la ficha) sigue siendo el camino principal; esto sólo ahorra
teclear.

## 1. Formato

- Esquema versionado: [`licitacion-bases.schema.json`](licitacion-bases.schema.json) (`"formato": "licitacion-bases/v1"`).
- Ejemplo completo: [`ejemplo-licitacion-bases.json`](ejemplo-licitacion-bases.json) (ICHIFE N-12).
- Toma los campos de `licitagen/schemas/bases.schema.json` (`concurso`, `fechas`, `economicos`, `requisitos_empresa`,
  `partidas`, `documentos_requeridos`, `anexos_convocante`, `notas_importantes`, `criterios_evaluacion`) y agrega:
  - `requisitos[]`: `anexo_id`, `sobre` (`legal` · `tecnico` · `economico`; lo que va «fuera de sobre» es `legal`),
    `descripcion`, `origen` (`expediente` · `se_genera` · `opus` · `dependencia`), `requiere_firma`,
    `categoria_expediente` (sólo si el origen es `expediente`; una de las 16 categorías del Expediente) y `pagina`.
  - `causas_desechamiento[]`, `concurso.nombre`, `concurso.plaza` (`cuauhtemoc`, `chihuahua`, `juarez`, `parral`,
    `casas_grandes`, `otra`) y `fuente` (archivo, quién lo generó, fecha).
  - `paginas`: página del PDF de donde salió cada dato, por ruta (`{"fechas.presentacion_propuestas": 5}`).
- Fechas `AAAA-MM-DD` o `AAAA-MM-DDTHH:MM` en hora de México. Si el texto no permite una fecha exacta: `null` y el
  texto en `notas_importantes`. Montos sin IVA, como número.
- Si sólo viene `documentos_requeridos` (archivos viejos de LicitaGen), el panel los convierte en requisitos
  (`tecnica` → `tecnico`, `economica` → `economico`).

## 2. Instrucción para Claude Code

> Lee `<ruta>\BASES.pdf` (y las actas de junta si las hay). Genera `bases.json` que cumpla
> `control-obra-dashboard/docs/licitaciones/licitacion-bases.schema.json` (mira el ejemplo junto a él). Un requisito por
> anexo o punto que pida la convocante, en el orden de las bases, con su página. No inventes datos: lo que no esté en
> las bases va en `null`. Valida con `node scripts/licitaciones/importar-bases.mjs bases.json --codigo <código>`
> (sin `OBRA_TOKEN` sólo valida).

Para PDF escaneados sin texto, Claude Code puede usar el OCR local de LicitaGen (`licitagen/python`) o leer las
páginas como imagen.

## 3. Importar en el panel (camino normal)

Licitaciones › ficha › **Bases** › **Importar bases** → elegir el `.json`.

1. El panel valida contra el esquema y muestra los errores en español con la ruta del dato
   (`fechas.fallo: la fecha debe escribirse AAAA-MM-DD…`). Con errores no se importa nada.
2. Pantalla de revisión: cada dato con su valor **actual** y el **propuesto** y la página. Lo que ya es igual sale
   marcado «Igual» y no se manda; lo que desmarques se queda como está.
3. Requisitos: sólo se agregan los anexos que faltan (sin distinguir mayúsculas); los que ya existen no se tocan,
   aunque los hayas editado.
4. Nada se guarda hasta **Aplicar**. Se usan `guardar_licitacion` (las bases se combinan con lo que ya había) e
   `importar_requisitos`.

## 4. Alterno: cargarlo directo por RPC con la sesión del usuario

```bash
# Sólo revisar (no guarda nada):
OBRA_TOKEN=<token de tu sesión> node scripts/licitaciones/importar-bases.mjs bases.json --codigo MC-2617064-064
# Guardar (crea la licitación si no existe con --crear):
OBRA_TOKEN=<token> node scripts/licitaciones/importar-bases.mjs bases.json --codigo MC-2617064-064 --crear --aplicar
```

- `OBRA_TOKEN` es el token de la sesión abierta en el panel (consola del navegador:
  `JSON.parse(localStorage.obra_session).token`). Las RPC exigen nivel ≥ 80, igual que en el panel.
- El script usa las mismas funciones puras que la pantalla (`validarBases`, `propuestaDeBases`, `datosDeRevision` de
  `src/js/licitaciones.js`), así que el resultado es idéntico. Sin `--aplicar` imprime la revisión y no guarda.
- Nunca guardes el token en un archivo del repo (es público).

## 5. A futuro: lectura con llave de Anthropic

Una función de borde que lea el PDF con la API producirá **este mismo formato** y abrirá la misma pantalla de revisión
(`Licitaciones.revisarBases(objeto)`); no se construye en este PRD.
