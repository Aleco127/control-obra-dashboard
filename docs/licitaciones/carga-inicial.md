# Carga inicial de históricos al banco de precios (US-828)

**Fecha:** 4 de octubre de 2026 · **Empresa:** 1 (Supernova Arquitectos) · **Hecha por:** agente D (épica D), rama `lic/epica-d`
**Datos reales:** se quedan en producción (no son de prueba).

## Cómo se cargó

- Mismo camino que la pestaña **Banco de precios › Importar de OPUS**: `BancoPrecios.leerOpusInsumos()` →
  `conciliarInsumos()` → `mapaImportacion()` → RPC `importar_opus_insumos` (migración 097), ejecutado con
  `scripts/licitaciones/cargar-historicos.mjs` y la sesión de Ricardo (nivel 100).
- Archivos: los `.opus-insumos.json` exportados por el bridge (US-827) en `C:\dev\Codex\output\insumos\`. BanRegio se
  carga desde `banregio.opus-insumos.json` (exportado de una COPIA de `BanRegio.mdf` el 4-oct-2026; ver su sección).
- Antes de la carga el banco ya tenía la siembra de referencia de US-824 (70 insumos, 71 precios `referencia`).
- **Idempotente:** la licitación se busca por código (si existe sólo se llenan campos vacíos); la RPC reescribe los
  precios, PU y matrices de ESA licitación sin duplicar. Corrido cuatro veces; las dos últimas dejan exactamente los
  mismos conteos (0 insumos nuevos, mismos precios).
- **Regla de conciliación de la carga** (no había a quién preguntar): un parecido por descripción se ligó a un insumo
  existente sólo con similitud ≥ 0.80 (trigramas, igual que `pg_trgm`) **y** la misma unidad. Los demás parecidos
  entraron como insumos nuevos y quedan listados abajo para que Ricardo decida con «Fusionar con otro» en la ficha
  del insumo. Una clave de OPUS ya ligada en una importación anterior se respeta en las siguientes (alias).
- Fecha de cada precio = fecha de la propuesta; plaza según la obra. Precios sin IVA.
- Los proyectos privados **Remodelación Fachada Ortiz Mena** y **Casa habitación 20x40** NO se cargaron.

## Licitaciones creadas

| Id | Código | Plaza | Fecha de la propuesta | Estatus | Fuente de los datos |
|---|---|---|---|---|---|
| 93 | MC-2617057-057 · Archivo Municipal II Etapa | Cd. Cuauhtémoc | 2026-09-14 | presentada | memoria de la licitación 057 |
| 94 | MC-2617064-064 · Riego y paisajismo Polideportivo III | Cd. Cuauhtémoc | 2026-09-17 | **ganada** (fallo 22-sep-2026, $2,010,515.56) | memoria de la 064 (acta de fallo) |
| 95 | LO-67-010-908029999-N-12-2026 · ICHIFE N-12 partida 4 (Paquimé) | Casas Grandes | 2026-04-30 | presentada | `licitagen/licitaciones/ichife-n12-p1-p4-p6/bases.json` |
| 96 | IBR-TRT-CUU-8721-2026-AI · Sucursal Banregio CR 152 | Cd. Cuauhtémoc | 2026-03-31 | presentada | `licitagen/licitaciones/banregio-cuauhtemoc/bases.json` y `BanRegio.mdf` |

Valores que **no se conocen con certeza** y quedaron neutros (anotados en `notas` de cada licitación):

- Resultado del fallo del 057, de ICHIFE N-12 y de BanRegio: estatus «presentada» (no se sabe si se ganaron o perdieron).
- Monto propuesto del 057: vacío. El `.mdf` actual (importe $2,496,759.80) ya no es el de la apertura del 14-sep
  (la memoria registra $3,017,652.47 el 8-sep).
- Montos propuestos de ICHIFE y BanRegio: vacíos. En BanRegio el `.mdf` da $4,208,793.94 sin IVA, pero su última
  actualización de precios es del 10-abr-2026, posterior a la presentación (31-mar): no hay certeza de que sea lo
  entregado. Ganador: sólo en la 064.
- Fecha de los precios de BanRegio: 2026-03-31 (la presentación de las bases y del propio `.mdf`), aunque algunos
  precios se tocaron hasta el 10-abr-2026.
- Inicio real de la 064: vacío (las bases decían 22-sep; el contrato se firmó el 2-oct).
- Horas de presentación y fallo de ICHIFE y BanRegio: aproximadas (las bases sólo dan el día).
- Fecha de la propuesta de ICHIFE: se usó la de las bases (30-abr-2026); el `.mdf` dice 22-abr-2026.
- BanRegio: modalidad «privada» (convocante Inmobiliaria Banregio, S.A.).

## Verificación (contra los conteos reales del PRD corregido)

| Proyecto | Esperado (recursos / conceptos / componentes) | Cargado | Precios | PU de conceptos |
|---|---|---|---|---|
| Archivo Municipal 057 | 137 / 57 / 321 | **137 / 57 / 321** (315 de conceptos + 6 de cuadrillas) | 134 | 57 |
| Polideportivo 064 | 198 / 34 / 180 | **198 / 34 / 180** (172 + 8) | 193 | 34 |
| ICHIFE N-12 | 46 / 12 / 63 | **46 / 12 / 63** | 45 | 11 |
| BanRegio CR 152 (catálogo, primera carga) | 0 / 193 sin matriz / 0 | **0 / 193 / 0** | 0 | 0 |
| BanRegio (`BanRegio.mdf`, reemplaza a la anterior en la licitación 96) | 404 / 195 / 989 | **404 / 195 / 989** (937 + 52 de cuadrillas y auxiliares) | 354 | 194 |

Recursos sin precio guardado (a propósito): las cuadrillas compuestas `C#1` y `C# 2` y el auxiliar `F'C 200`
(su precio sale de su matriz, guardada en `insumo_componentes`), la herramienta nativa `HM` `(%)mo` (costo 0 en OPUS:
vale el % de la mano de obra de cada matriz) y dos materiales con precio 0 en OPUS (`BASE` del 064 y `MAT 16` de
ICHIFE). El concepto `RETARB1` de ICHIFE tiene PU 0 y no guarda PU. BanRegio es sólo catálogo: sus 193 conceptos
entran sin PU (los APU reales están en `BanRegio.mdf`, que no se exportó).

Comprobación de matrices: recalculando cada matriz con los precios de su propia licitación (`recalcularMatriz`), las
**296 matrices con costo directo reproducen el original** (057: 57/57, 064: 34/34, ICHIFE: 11/11, BanRegio: 194/194,
tolerancia 0.1 % o 5 centavos). BanRegio exigió reconocer la herramienta «(%)mo» también cuando OPUS la tipifica como
mano de obra («HERRAMIENTA M»).

## Estado del banco después de la carga (empresa 1)

| Concepto | Cantidad |
|---|---|
| Insumos | **680** (material 604, mano de obra 46, equipo 25, flete 3, herramienta 2) |
| Precios | 797 (726 `opus` + 71 `referencia`) |
| Conceptos históricos | 304 (296 con PU) |
| Componentes de matrices | 1,485 en conceptos + 66 en cuadrillas y auxiliares |
| Licitaciones con importación | 4 (cinco archivos: BanRegio entra con su versión con APU) |

La métrica del PRD (≥ 300 insumos y ≥ 4 proyectos) se cumple: 680 insumos y 4 proyectos. 32 insumos no tienen precio
ni aparecen en una matriz (recursos con costo 0 que los proyectos traían cargados sin usar).

## Duplicados fusionados

1. **`CAMI` → `REF-EQ-VOLTEO-7M3`** (Camión de volteo de 7 m³, HR; similitud 0.87). El Archivo Municipal lo ligó a la
   referencia y el Polideportivo lo había creado aparte en la primera corrida. Fusionado con `fusionar_insumos`
   (bitácora en `insumo_fusiones`): 1 precio movido, 1 descartado por repetido, 3 componentes movidos. Esto motivó dos
   correcciones: alias de claves de OPUS entre importaciones y que reimportar borre los precios de la licitación que
   ya no salen del archivo.

Además, cada coincidencia exacta por clave + unidad + tipo entre proyectos es un duplicado que **no** se creó
(Polideportivo reutilizó 121 insumos del Archivo; ICHIFE reutilizó las 4 cuadrillas de referencia `C-*`), y los
parecidos ligados de las tablas siguientes son duplicados evitados contra la siembra de referencia.

Nota: hay dos insumos con clave `HM`: la herramienta nativa de OPUS (`(%)mo`, costo 0) y la de la skill (`%MO`,
costo 1.00). Son modelados distintos de lo mismo y no se fusionaron (la unidad cambia el significado de la cantidad).

## BanRegio.mdf (agregado el 4-oct-2026, aprobado por Ricardo)

**Exportación.** El original (`Proyectos\BanRegio.mdf`, MD5 `08fe6929f79da666554439ddac29ee18`; `.ldf`
`9eded326826d5b58485f0faec398f531`) no se tocó: se copiaron `.mdf` y `.ldf` a `C:\dev\Codex\output\insumos\work\`
y se exportó la copia con `POST /opus/export-insumos` (`db_name` propio, se desadjuntó al terminar). El MD5 del
original es el mismo antes y después. JSON: UTF-8 sin BOM, sin mojibake (0 textos reparados). Nota: el original ya
estaba adjunto en `(localdb)\OpusLocal` como `OpusCodex_BanRegio` desde antes (no lo adjunté yo y no lo desadjunté);
la copia de exportación no quedó adjunta.

**Qué es.** El mismo concurso que la licitación 96, en su versión con análisis de precios: mismo número
(`IBR-TRT-CUU-8721-2026-Al`), mismo objeto («Adaptación de local para Sucursal Banregio Cd. Cuauhtémoc CR 152»),
ciudad Cuauhtémoc, presentación 31-mar-2026 e inicio y fin 13-abr / 17-jul-2026 iguales a las bases. De sus 195
conceptos, 187 tienen la misma descripción que el catálogo CR 152 (181 con la misma cantidad); OPUS dejó 136 con clave
temporal `TEMP*n`. Ocho conceptos son extras del `.mdf` (tapial, costillas de cristal, placa de acero, compuertas…) y
seis del catálogo no están en el `.mdf` (09-CAN-010, 09-CAN-075, 10-HER-557, 11-HID-030, 11-HID-040, 11-HID-534).
También es la referencia del «FSR método BanRegio» de la skill. **Decisión:** se cargó ligado a la licitación 96, en
lugar del catálogo sin precios (el script ya no carga `banregio-cuauhtemoc-CR-152.opus-insumos.json`; sólo lo usa para
las claves). Los conceptos con clave temporal toman la clave y la unidad del catálogo cuando la descripción coincide:
**187 de los 193 conceptos del catálogo ganaron matriz**; los 8 extras entran con su clave del `.mdf`.

**Contenido del JSON:** 404 recursos (371 materiales, 28 mano de obra —22 de ellos cuadrillas o auxiliares con
matriz propia—, 4 equipos, 1 flete), 195 conceptos (195 con matriz, 194 con PU), 989 componentes (52 de matrices
auxiliares). Costo directo $3,438,754.35; importe $4,208,793.94 sin IVA.

**Resultado:** 401 insumos nuevos, 3 ligados a insumos existentes (BLOCK15 → BLOCK, KIT SANT W B → KIT SANI,
MO0015 → MO-ESP), 354 precios (50 recursos sin precio: compuestos, la herramienta «(%)mo» y recursos con costo 0),
195 conceptos (8 nuevos), 937 componentes de conceptos y 52 de cuadrillas. Dos corridas seguidas sin cambios.

**Correcciones que salieron de esta carga:**
1. La cuadrilla `C#1` de BanRegio («1 Cabo + 1 Peón») chocaba por clave con la `C#1` del Archivo Municipal («Peón +
   Ayudante G»), que es otra cuadrilla. Las claves de cuadrillas son locales de cada proyecto: un compuesto que coincide
   por clave con descripción distinta se renombra con sufijo del proyecto (`C#1-BR`) en recursos y componentes.
2. El alias de claves entre importaciones ahora exige la misma unidad: `AGUA` (lt) y `REVO` (hr) de BanRegio se habían
   ligado a `AGUA` (M3) y a la revolvedora por jornada; se corrigió y la recarga movió sus precios.
3. 17 conceptos del catálogo CR 152 se habían duplicado por la unidad en minúsculas (`pza` contra `PZA`); se borraron
   los duplicados vacíos y ahora se reutiliza el concepto del catálogo.

## Parecidos por proyecto

Coincidencias con aviso de descripción distinta: `MO-PEON` («Peon» en OPUS contra «Peón / ayudante general» en la
referencia; es el mismo, se dejó ligado).

#### MC-2617057-057

Ligados a un insumo existente (similitud ≥ 0.80 y misma unidad):

| Clave OPUS | Descripción | Unidad | Insumo del banco | Similitud |
|---|---|---|---|---|
| AREG | Arena de rio | M3 | REF-ARENA-RIO · Arena de río | 1 |
| CB12 | Cable THW-LS cal. 12 CU | M | REF-THW-12 · Cable THW-LS cal. 12 | 0.9 |
| CB2 | Cable THW-LS cal. 2 CU | M | REF-THW-2 · Cable THW-LS cal. 2 | 0.895 |
| CB6 | Cable THW-LS cal. 6 CU | M | REF-THW-6 · Cable THW-LS cal. 6 | 0.895 |
| EMT12 | Tubo conduit EMT de 1/2" | M | REF-EMT-12 · Tubo conduit EMT de 1/2" | 1 |
| EMT2 | Tubo conduit EMT de 2" | M | REF-EMT-2 · Tubo conduit EMT de 2" | 1 |
| EMT34 | Tubo conduit EMT de 3/4" | M | REF-EMT-34 · Tubo conduit EMT de 3/4" | 1 |
| EXTA | Extintor automatico de PQS con detector de humo | PZA | REF-EXT-AUTO-PQS · Extintor automático PQS con detector | 0.854 |
| PVC3 | Tubo de PVC hidraulico de 3" ced. 40 | M | REF-PVC-HID-3 · Tubo PVC hidráulico de 3" ced. 40 | 1 |
| PVC4 | Tubo de PVC sanitario de 4" | M | REF-PVC-SAN-4 · Tubo PVC sanitario de 4" | 1 |
| TBRH | Panel de yeso resistente a la humedad de 1/2" | M2 | REF-PANEL-YESO-RH · Panel de yeso de 1/2" resistente a la humedad | 1 |
| AND | Andamio tubular, renta | JOR | REF-EQ-ANDAMIO · Andamio tubular (renta) | 1 |
| CAMI | Camion de volteo de 7 m3 | HR | REF-EQ-VOLTEO-7M3 · Camión de volteo de 7 m³ | 0.87 |
| RETRO | Retroexcavadora | HR | REF-EQ-RETRO · Retroexcavadora | 1 |
| REVO | Revolvedora de 1 saco | JOR | REF-EQ-REVOLVEDORA · Revolvedora de 1 saco (renta) | 0.846 |

Parecidos que entraron como insumos nuevos (revisar con «Fusionar»):

| Clave OPUS | Descripción | Unidad | Candidato | Unidad cand. | Similitud |
|---|---|---|---|---|---|
| CAL | Cal hidratada, saco de 20 kg | SACO | REF-CAL-HID · Cal hidratada (saco) | SACO | 0.679 |
| CEM | Cemento gris CPC 30R, saco de 50 kg | SACO | REF-CEM-CPC30R · Cemento CPC 30R (saco 50 kg) | SACO | 0.765 |
| CONC | Concreto premezclado f'c=200 kg/cm2 | M3 | REF-CONC-150 · Concreto premezclado f'c=150 kg/cm² | M3 | 0.718 |
| LAMG | Lamina galvanizada cal. 24 4"x10" | pza | REF-LAM-GALV24 · Lámina galvanizada cal. 24 | M2 | 0.813 |
| LAML | Lamina lisa pintro cal. 26 | pza | REF-LAM-RN100 · Lámina Rn 100/35 cal. 26 pintro | M2 | 0.6 |
| LAMR | Lamina Rn 100/35 cal. 26 pintro color blanco 4" x 10" | M2 | REF-LAM-RN100 · Lámina Rn 100/35 cal. 26 pintro | M2 | 0.646 |
| PINV | Pintura vinil-acrilica mate Comex | LT | REF-PINT-VINIL · Pintura vinil-acrílica | LT | 0.676 |
| POST | Poste metalico de 3 1/2" cal. 26, 3.05 m | PZA | REF-POSTE-312 · Poste metálico 3 1/2" cal. 26 | PZA | 0.794 |
| PTR15 | PTR de 2" x 2" cal. 14 6.1 m | pza | REF-PTR-2X2-14 · PTR de 2" x 2" cal. 14 | M | 0.783 |
| PTR2 | PTR de 2"1/4 x 2"1/4 cal. 16 | pza | REF-PTR-2X2-14 · PTR de 2" x 2" cal. 14 | M | 0.696 |
| TBRC | Panel de yeso de 1/2" | pza | REF-PANEL-YESO-12 · Panel de yeso de 1/2" | M2 | 1 |
| C#1 | Peon +Ayudante G | jor | MO-PEON · Peón / ayudante general | JOR | 0.652 |
| MO-AYUDG | Ayudante General | jor | MO-PEON · Peón / ayudante general | JOR | 0.773 |

#### MC-2617064-064

Ligados a un insumo existente (similitud ≥ 0.80 y misma unidad):

| Clave OPUS | Descripción | Unidad | Insumo del banco | Similitud |
|---|---|---|---|---|
| AREG | Arena de rio | M3 | REF-ARENA-RIO · Arena de río | 1 |
| CB12 | Cable THW-LS cal. 12 CU | M | REF-THW-12 · Cable THW-LS cal. 12 | 0.9 |
| CB2 | Cable THW-LS cal. 2 CU | M | REF-THW-2 · Cable THW-LS cal. 2 | 0.895 |
| CB6 | Cable THW-LS cal. 6 CU | M | REF-THW-6 · Cable THW-LS cal. 6 | 0.895 |
| EMT12 | Tubo conduit EMT de 1/2" | M | REF-EMT-12 · Tubo conduit EMT de 1/2" | 1 |
| EMT2 | Tubo conduit EMT de 2" | M | REF-EMT-2 · Tubo conduit EMT de 2" | 1 |
| EMT34 | Tubo conduit EMT de 3/4" | M | REF-EMT-34 · Tubo conduit EMT de 3/4" | 1 |
| EXTA | Extintor automatico de PQS con detector de humo | PZA | REF-EXT-AUTO-PQS · Extintor automático PQS con detector | 0.854 |
| PVC3 | Tubo de PVC hidraulico de 3" ced. 40 | M | REF-PVC-HID-3 · Tubo PVC hidráulico de 3" ced. 40 | 1 |
| PVC4 | Tubo de PVC sanitario de 4" | M | REF-PVC-SAN-4 · Tubo PVC sanitario de 4" | 1 |
| TBRH | Panel de yeso resistente a la humedad de 1/2" | M2 | REF-PANEL-YESO-RH · Panel de yeso de 1/2" resistente a la humedad | 1 |
| AND | Andamio tubular, renta | JOR | REF-EQ-ANDAMIO · Andamio tubular (renta) | 1 |
| BAIL | Compactador tipo bailarina, renta | JOR | REF-EQ-BAILARINA · Compactador tipo bailarina (renta) | 1 |
| RETRO | Retroexcavadora Retroexcavadora | HR | REF-EQ-RETRO · Retroexcavadora | 1 |
| REVO | Revolvedora de 1 saco | JOR | REF-EQ-REVOLVEDORA · Revolvedora de 1 saco (renta) | 0.846 |
| ROTO | Rotomartillo, renta | JOR | REF-EQ-ROTOMARTILLO · Rotomartillo (renta) | 1 |
| SOLDA | Equipo de soldadura 250 A, renta | JOR | REF-EQ-SOLDADORA · Equipo de soldadura (renta) | 0.813 |

#### LO-67-010-908029999-N-12-2026

Ligados a un insumo existente (similitud ≥ 0.80 y misma unidad):

| Clave OPUS | Descripción | Unidad | Insumo del banco | Similitud |
|---|---|---|---|---|
| MAT-ADAPT-15 | Adaptador de tierra 15kV | pza | REF-ADAPT-TIERRA-15KV · Adaptador de tierra 15 kV | 0.821 |
| MAT-RED-NYLON | Red nylon/polietileno alta densidad | m2 | REF-RED-NYLON · Red de nylon / polietileno de alta densidad | 0.973 |
| MAT-XLP-1/0 | Conductor XLP 1/0 15kV | ml | REF-XLP-10-15KV · Conductor XLP 1/0 15 kV | 0.8 |
| EQ-COMP | Compactador tipo bailarina | jor | REF-EQ-BAILARINA · Compactador tipo bailarina (renta) | 0.818 |
| EQ-RETRO | Retroexcavadora Cat 320D | jor | REF-EQ-RETRO-320D · Retroexcavadora Cat 320D (renta) | 0.862 |

Parecidos que entraron como insumos nuevos (revisar con «Fusionar»):

| Clave OPUS | Descripción | Unidad | Candidato | Unidad cand. | Similitud |
|---|---|---|---|---|---|
| MAT 18 | Conductor XLP calibre 1/0 para 15 kV | M | REF-XLP-10-15KV · Conductor XLP 1/0 15 kV | ML | 0.657 |
| MAT 20 | Adaptadores de tierra para 15 kV (6 piezas) | PZA | REF-ADAPT-TIERRA-15KV · Adaptador de tierra 15 kV | PZA | 0.61 |
| MAT-CODO-15KV | Codo 15kV terminacion enchufable | pza | REF-CODO-15KV · Codo 15 kV de terminación enchufable | PZA | 0.795 |
| MAT-CONC-150 | Concreto f c=150 kg/cm2 mezclado en obra | m3 | REF-CONC-150 · Concreto premezclado f'c=150 kg/cm² | M3 | 0.6 |
| MAT-ELEC-CU | Electrodo de cobre 3/4 pulg L=3.00m | pza | REF-ELECTRODO-34 · Electrodo de cobre de 3/4" L=3.0 m | PZA | 0.703 |
| MAT-MALLA-15 | Malla ciclon galv cal.10.5 h=1.50m | ml | REF-MALLA-CIC-150 · Malla ciclónica cal. 10.5 h=1.50 m | ML | 0.632 |
| MAT-SOLD-CAD | Soldadura Cad-Weld carga #90 standard | pza | REF-CADWELD-90 · Soldadura Cad-Weld carga #90 | PZA | 0.765 |
| EQ-GRUA | Grua 5T para maniobras | jor | REF-EQ-GRUA-5T · Grúa de 5 t para maniobras (renta) | JOR | 0.6 |
| EQ-ROMP | Rompedora electrica 25kg | jor | REF-EQ-ROMPEDORA-25 · Rompedora eléctrica de 25 kg (renta) | JOR | 0.639 |

#### IBR-TRT-CUU-8721-2026-AI (BanRegio.mdf)

Ligados a un insumo existente (similitud ≥ 0.80 y misma unidad):

| Clave OPUS | Descripción | Unidad | Insumo del banco | Similitud |
|---|---|---|---|---|
| BLOCK15 | Block 15 x 20 x 40 | pza | BLOCK · block 15 x 20 x 40 | 1 |
| KIT SANT W B | Paquete para instalación de sanitario con brida fl marca Coflex | pza | KIT SANI · Paquete para instalación de sanitario con brida COFLEX | 0.847 |
| MO0015 | Oficial Especializado | jor | MO-ESP · Oficial Especializado | 1 |

Parecidos que entraron como insumos nuevos (revisar con «Fusionar»):

| Clave OPUS | Descripción | Unidad | Candidato | Unidad cand. | Similitud |
|---|---|---|---|---|---|
| ARENA | Arena | m3 | REF-ARENA-FINA · Arena fina | M3 | 0.6 |
| BLOCK15T | Block termico 15 x 20 x 40 | pza | BLOCK · block 15 x 20 x 40 | PZA | 0.68 |
| CABLE #12 | CABLE Cu CAL. 12 AWG THW LS 600V | mL | REF-THW-12 · Cable THW-LS cal. 12 | M | 0.621 |
| CABLE DES 10 | CABLE Cu. DESNUDO CAL.10 | mL | CB10 · Cable cal. 10 CU | M | 0.619 |
| F'C100 HO | Concreto Hecho en Obra f'c 100 | m3 | F'C 200 · Concreto echo en obra f'c 200 kg cm2 | m3 | 0.6 |
| F'C200 HO | Concreto Hecho en Obra f'c 200 | m3 | F'C 200 · Concreto echo en obra f'c 200 kg cm2 | m3 | 0.73 |
| F'C250 HO | Concreto Hecho en Obra f'c 250 | m3 | F'C 200 · Concreto echo en obra f'c 200 kg cm2 | m3 | 0.6 |
| H002 | PTR 1-1/2"x1-1/2" CAL. 14 | pza | REF-PTR-2X2-14 · PTR de 2" x 2" cal. 14 | M | 0.667 |
| INT QOB115 | INTERRUPTOR TERMOMAGNETICO QOB115 | pza | ITM15 · Interruptor termomagnetico de 1x15A | PZA | 0.619 |
| INT QOB120 | INTERRUPTOR TERMOMAGNETICO QOB120 | pza | ITM15 · Interruptor termomagnetico de 1x15A | PZA | 0.619 |
| INT T130 | INTERRUPTOR TERMOMAGNETICO QOB130 | pza | ITM15 · Interruptor termomagnetico de 1x15A | PZA | 0.619 |
| INT T220 | INTERRUPTOR TERMOMAGNETICO QOB220 | pza | ITM15 · Interruptor termomagnetico de 1x15A | PZA | 0.619 |
| INT T230 | INTERRUPTOR TERMOMAGNETICO QOB230 | pza | ITM15 · Interruptor termomagnetico de 1x15A | PZA | 0.619 |
| INT T350 | INTERRUPTOR TERMOMAGNETICO QOB350 | pza | ITM15 · Interruptor termomagnetico de 1x15A | PZA | 0.619 |
| INT T370 | INTERRUPTOR TERMOMAGNETICO QOB370 | pza | ITM15 · Interruptor termomagnetico de 1x15A | PZA | 0.619 |
| LG CAL22 | Lámina galvanizada cal. 22 | kg | REF-LAM-GALV24 · Lámina galvanizada cal. 24 | M2 | 0.857 |
| LG CAL24 | Lámina galvanizada cal. 24 | kg | REF-LAM-GALV24 · Lámina galvanizada cal. 24 | M2 | 1 |
| T PVC 4 | tubo pvc sanitario 4 x 3 mts | pza | REF-PVC-SAN-4 · Tubo PVC sanitario de 4" | M | 0.656 |
| C#2 | Cuadrilla #2 .25 Oficial + 1 peon | jor | C-DEMO · Cuadrilla de demolición (1 oficial + 2 peones) | JOR | 0.643 |
| MO0005 | Electricista | jor | MO-ELE · Oficial electricista | JOR | 0.65 |
| MO0013 | Oficial Herrero | jor | MO-HER · Oficial herrero-soldador | JOR | 0.64 |

## Cómo repetirla

```bash
cd control-obra-dashboard
set -a; . ./.env; set +a          # BANCO_TOKEN u OBRA_QA_TOKEN de un usuario nivel >= 80 de la empresa
node scripts/licitaciones/cargar-historicos.mjs --dry-run        # simula la conciliación
node scripts/licitaciones/cargar-historicos.mjs --reporte carga.json
```
