// Precios de una licitación (US-829 y US-833): funciones puras de src/js/licitacion-precios.js. Sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LP = require('../../src/js/licitacion-precios.js');
const BP = require('../../src/js/banco-precios.js');

const HOY = '2026-10-05';

test('propuesta del banco: último de la plaza; si no hay, el último general marcado de otra plaza; datos de mano de obra', () => {
  const precios = [
    { id: 1, precio: 700, fecha: '2026-03-31', plaza: 'cuauhtemoc', fuente: 'opus', datos: { salario_base: 380, sbc: 398.73, fsr: 1.8465, mano_obra: { factor_salario_base: 1.049281, categoria_fasar: 'JOR8HR', usa_hoja_fsr: false } } },
    { id: 2, precio: 760, fecha: '2026-09-01', plaza: 'chihuahua', fuente: 'referencia', datos: {} },
  ];
  const p = LP.propuestaDeInsumo(precios, 'cuauhtemoc');
  assert.equal(p.precio_banco, 700); assert.equal(p.fecha_banco, '2026-03-31'); assert.equal(p.plaza_banco, 'cuauhtemoc');
  assert.equal(p.fuente_banco, 'opus'); assert.equal(p.de_otra_plaza, false);
  assert.deepEqual(p.datos.mano_obra, { salario_base: 380, sbc: 398.73, fsr: 1.8465, factor_salario_base: 1.049281, usa_hoja_fsr: false, categoria_fasar: 'JOR8HR' });
  const q = LP.propuestaDeInsumo(precios, 'juarez');
  assert.equal(q.precio_banco, 760); assert.equal(q.de_otra_plaza, true);
  assert.equal(LP.propuestaDeInsumo([], 'cuauhtemoc').precio_banco, null);
});

test('ámbar: más de 180 días o de otra plaza', () => {
  assert.deepEqual(LP.estadoFila({ precio_banco: 10, fecha_banco: '2026-09-01', plaza_banco: 'cuauhtemoc' }, 'cuauhtemoc', HOY).ambar, false);
  const viejo = LP.estadoFila({ precio_banco: 10, fecha_banco: '2026-03-31', plaza_banco: 'cuauhtemoc' }, 'cuauhtemoc', HOY);
  assert.equal(viejo.dias, 188); assert.equal(viejo.viejo, true); assert.equal(viejo.ambar, true);
  const otra = LP.estadoFila({ precio_banco: 10, fecha_banco: '2026-09-01', plaza_banco: 'chihuahua' }, 'cuauhtemoc', HOY);
  assert.equal(otra.otraPlaza, true); assert.equal(otra.ambar, true); assert.deepEqual(otra.motivos, ['otra plaza']);
  assert.equal(LP.estadoFila({ precio_banco: 10, fecha_banco: '2026-04-08', plaza_banco: 'chihuahua' }, null, HOY).otraPlaza, false, 'sin plaza en la licitación no hay «otra plaza»');
  assert.equal(LP.estadoFila({ precio_banco: null, fecha_banco: null }, 'cuauhtemoc', HOY).sinPrecio, true);
});

test('ajuste en lote: sobre el precio del banco, a 2 decimales; rechaza -100 o menos', () => {
  const r = LP.ajustarPorcentaje([{ id: 1, precio: 120, precio_banco: 100 }, { id: 2, precio: 33.33, precio_banco: null }], 5);
  assert.deepEqual(r, [{ id: 1, precio: 105, ajuste_pct: 5, manual: false }, { id: 2, precio: 35, ajuste_pct: 5, manual: false }]);
  assert.equal(LP.ajustarPorcentaje([{ id: 1, precio_banco: 701.67 }], -3)[0].precio, 680.62);
  assert.throws(() => LP.ajustarPorcentaje([{ id: 1, precio_banco: 1 }], -100));
  assert.throws(() => LP.ajustarPorcentaje([{ id: 1, precio_banco: 1 }], 'x'));
});

const LIC = { id: 9, codigo: 'QA-LP-001', nombre: 'Prueba de lista', plaza: 'cuauhtemoc', presentacion: '2026-10-20T17:30:00Z', inicio_obra: '2026-11-02' };
const INS = {
  1: { id: 1, clave: 'MO-PEON', descripcion: 'Peón', unidad: 'JOR', tipo: 'mano_obra' },
  2: { id: 2, clave: 'CEM', descripcion: 'Cemento gris CPC 30R', unidad: 'SACO', tipo: 'material' },
  3: { id: 3, clave: 'C#1', descripcion: 'Cuadrilla', unidad: 'jor', tipo: 'mano_obra', compuesto: true },
  4: { id: 4, clave: "F'C 200", descripcion: 'Concreto hecho en obra', unidad: 'm3', tipo: 'auxiliar', compuesto: true },
  5: { id: 5, clave: 'FLETE', descripcion: 'Flete', unidad: 'pza', tipo: 'flete' },
  6: { id: 6, clave: 'HM', descripcion: 'Herramienta menor', unidad: '(%)mo', tipo: 'herramienta' },
  7: { id: 7, clave: 'cem', descripcion: 'Cemento repetido', unidad: 'KG', tipo: 'material' },
  8: { id: 8, clave: 'ARENA', descripcion: 'Arena', unidad: 'M3', tipo: 'material' },
};
const FILAS = [
  { id: 11, insumo_id: 1, precio: 750, fecha_banco: '2026-09-30', orden: 1, datos: { mano_obra: { salario_base: 380, sbc: 398.73, fsr: 1.8465, factor_salario_base: 1.049281, categoria_fasar: 'JOR8HR' } } },
  { id: 12, insumo_id: 2, precio: 235.5, fecha_banco: '2026-08-15', orden: 2, datos: { material: { tipo_material: 1, origen: 1 } } },
  { id: 13, insumo_id: 3, precio: 900, orden: 3, datos: {} },
  { id: 14, insumo_id: 4, precio: 1800, orden: 4, datos: {} },
  { id: 15, insumo_id: 5, precio: 1200, orden: 5, datos: {} },
  { id: 16, insumo_id: 6, precio: 0, orden: 6, datos: {} },
  { id: 17, insumo_id: 7, precio: 4, orden: 7, datos: {} },
  { id: 18, insumo_id: 8, precio: 0, orden: 8, datos: {} },
];

test('archivo opus-insumos/v1: tipos, unidades, sin IVA, mano de obra coherente y omitidos con motivo', () => {
  const { doc, omitidos } = LP.documentoOpus(LIC, FILAS, INS, new Date('2026-10-05T18:00:00Z'));
  assert.equal(doc.formato, 'opus-insumos/v1');
  assert.equal(doc.generado, '2026-10-05T12:00:00-06:00');
  assert.deepEqual(BP.validarOpusInsumos(doc), [], 'lo acepta el validador del banco (reimportable)');
  assert.doesNotThrow(() => BP.leerOpusInsumos(JSON.stringify(doc)));
  assert.deepEqual(doc.recursos.map((r) => r.clave), ['MO-PEON', 'CEM', 'FLETE', 'HM']);
  assert.deepEqual(omitidos.map((o) => [o.clave, o.motivo]), [['C#1', 'compuesto'], ["F'C 200", 'compuesto'], ['cem', 'clave_repetida'], ['ARENA', 'sin_precio']]);
  const mo = doc.recursos[0];
  assert.equal(mo.tipo, 'mano_obra'); assert.equal(mo.unidad, 'JOR'); assert.equal(mo.precio, 750);
  assert.equal(Math.round(mo.mano_obra.salario_base * mo.mano_obra.fsr * 100) / 100, 750, 'precio = ROUND(SB × FSR, 2)');
  assert.equal(mo.mano_obra.fsr, 1.8465); assert.equal(mo.mano_obra.categoria_fasar, 'JOR8HR');
  assert.ok(Math.abs(mo.mano_obra.sbc - mo.mano_obra.salario_base * 1.049281) < 0.01);
  assert.deepEqual(doc.recursos[1].material, { tipo_material: 1, origen: 1, marca: null, proveedor: null });
  assert.equal(doc.recursos[2].tipo, 'flete');
  assert.equal(doc.recursos[3].precio, 0, 'la herramienta nativa (%)mo va con precio 0');
  for (const r of doc.recursos) {
    assert.ok(LP.TIPOS_OPUS.includes(r.tipo)); assert.equal(typeof r.precio, 'number'); assert.equal(r.moneda, 'MXN');
    assert.ok(r.unidad, 'el bridge exige unidad en un alta');
  }
  assert.equal(doc.proyecto.numero_concurso, 'QA-LP-001'); assert.equal(doc.proyecto.ciudad, 'Cd. Cuauhtémoc');
  assert.equal(doc.fechas.presentacion, '2026-10-20T11:30:00');
  assert.deepEqual(doc.resumen.recursos_por_tipo, { mano_obra: 1, material: 1, flete: 1, herramienta: 1 });
  assert.equal(doc.fechas.ultima_actualizacion_precios, '2026-09-30T00:00:00');
  assert.ok(!/Ã/.test(JSON.stringify(doc)));
});

test('Excel legible de la lista: encabezados en español y montos numéricos', () => {
  const f = LP.filasExcelLista([{ insumo_id: 2, precio: 240, precio_banco: 235.5, fecha_banco: '2026-03-01', plaza_banco: 'chihuahua', fuente_banco: 'opus', ajuste_pct: 2, manual: false, cantidad: 12.5 }], INS, 'cuauhtemoc', HOY)[0];
  assert.equal(f.Clave, 'CEM'); assert.equal(f['Precio para OPUS (sin IVA)'], 240); assert.equal(f['Precio del banco'], 235.5);
  assert.equal(f.Plaza, 'Chihuahua'); assert.equal(f.Ajuste, '2 %'); assert.match(f.Aviso, /otra plaza/); assert.match(f.Aviso, /218 días/);
});

// Catálogo como lo exporta OPUS: título, encabezados en la fila 6 y precios en cero
const CATALOGO = [
  [null, null, null, null, null, 'DIRECCION DE INMUEBLES'],
  ['PROYECTO:', 'ADAPTACION DE SUCURSAL CD. CUAUHTEMOC CR 152', null, null, null, null],
  ['CLAVE', 'CONCEPTO', 'UNIDAD', 'CANT', 'P.U.', 'IMPORTE'],
  ['01-PRE', 'PRELIMINARES', null, null, null, null],
  ['01-PRE-105', 'TRAZO DE EJES Y CORRER NIVELES DE PISO INTERIORES POR MEDIOS MANUALES.', 'M2', 244.71, 0, 0],
  ['01-PRE-130', 'SUM. Y COLOC. DE CARTON CORRUGADO EN ROLLO PARA PROTECCION DE PISOS', 'M2', 244.71, 0, 0],
  ['05-ALB', 'ALBA�ILERIAS', null, null, null, null],
  ['05-ALB-900', 'MURO DE BLOCK DE CONCRETO 15X20X40 ASENTADO CON MORTERO CEMENTO ARENA', 'M2', 30, 0, 0],
  ['05-ALB-999', 'CONCEPTO SIN NADA PARECIDO EN EL BANCO DE PRECIOS', 'PZA', 2, 0, 0],
];
const HIST = [
  { id: 101, clave: '01-PRE-105', descripcion: 'TRAZO DE EJES Y CORRER NIVELES DE PISO INTERIORES POR MEDIOS MANUALES. INCLUYE MATERIAL', unidad: 'M2' },
  { id: 102, clave: '1.11', descripcion: 'Corte y demolición de firme', unidad: 'M2' },
  { id: 103, clave: 'TEMP5', descripcion: 'MURO DE BLOCK DE CONCRETO 15X20X40 ASENTADO CON MORTERO CEMENTO-ARENA 1:4', unidad: 'm2' },
  { id: 104, clave: '01-PRE-130', descripcion: 'Retiro de escombro a tiro autorizado', unidad: 'VJE' },
];

test('leerCatalogo: encabezados de OPUS, precios en cero y partidas', () => {
  const c = LP.leerCatalogo(CATALOGO);
  assert.equal(c.conceptos.length, 4); assert.equal(c.sinPrecios, true);
  assert.equal(c.proyecto, 'ADAPTACION DE SUCURSAL CD. CUAUHTEMOC CR 152');
  assert.deepEqual(c.conceptos.map((x) => x.clave), ['01-PRE-105', '01-PRE-130', '05-ALB-900', '05-ALB-999']);
  assert.equal(c.conceptos[0].cantidad, 244.71); assert.equal(c.conceptos[0].unidad, 'M2');
  assert.throws(() => LP.leerCatalogo([['hola'], ['mundo']]));
});

test('emparejar: por clave (si la descripción se parece), luego por descripción; lo demás desde cero', () => {
  const c = LP.leerCatalogo(CATALOGO).conceptos;
  const e = LP.emparejarCatalogo(c, HIST, { conAntecedente: new Set([101, 103]) });
  assert.equal(e[0].historico.id, 101); assert.equal(e[0].metodo, 'clave');
  assert.equal(e[1].historico, null, 'misma clave pero otra cosa (retiro de escombro): no cuenta');
  assert.equal(e[2].historico.id, 103); assert.equal(e[2].metodo, 'descripcion'); assert.ok(e[2].puntaje >= LP.UMBRAL_DESCRIPCION);
  assert.equal(e[2].unidad_distinta, false, 'm2 y M2 son la misma unidad');
  assert.equal(e[3].historico, null);
});

test('resumen de PU, matriz elegida y sugerencia con los mismos sobrecostos', () => {
  const pus = [
    { id: 1, pu: 20, fecha: '2026-03-31', plaza: 'cuauhtemoc', licitacion_id: 96, costo_directo: 16 },
    { id: 2, pu: 25, fecha: '2026-09-14', plaza: 'cuauhtemoc', licitacion_id: 93, costo_directo: 20 },
    { id: 3, pu: 0, fecha: '2026-10-01', plaza: 'cuauhtemoc', licitacion_id: 95, costo_directo: 0 },
  ];
  const r = LP.resumenPUs(pus);
  assert.equal(r.reciente.pu, 25); assert.equal(r.min, 20); assert.equal(r.max, 25); assert.equal(r.n, 2);
  assert.equal(LP.licitacionDeMatriz(pus, [96]), 96, 'el PU más reciente con matriz');
  assert.equal(LP.licitacionDeMatriz(pus, [93, 96]), 93);
  assert.equal(LP.licitacionDeMatriz(pus, []), null);
  const s = LP.sugerenciaDe({ concepto: { clave: 'X', descripcion: 'X', unidad: 'M2', cantidad: 10 }, historico: { id: 1, clave: 'X' }, metodo: 'clave', puntaje: 1 }, r, { total: 22, sinPrecio: 0 });
  assert.equal(s.antecedente, true); assert.equal(s.cd_vigente, 22); assert.equal(s.pu_sugerido, 27.5); assert.equal(s.importe_sugerido, 275);
  const sin = LP.sugerenciaDe({ concepto: { clave: 'Y', descripcion: 'Y', unidad: 'PZA', cantidad: 1 }, historico: null, metodo: null }, null, null);
  assert.equal(sin.antecedente, false); assert.equal(sin.pu_sugerido, null);
  assert.deepEqual(LP.resumenSugerencias([s, sin]), { total: 2, con_antecedente: 1, desde_cero: 1, por_clave: 1, por_descripcion: 0, importe: 275 });
  assert.equal(LP.filasExcelSugerencias([sin])[0].Antecedente, 'Analizar desde cero');
});

test('explotar insumos del catálogo: cantidad × componente; las cuadrillas se abren en sus componentes', () => {
  const emp = [{ concepto: { cantidad: 10 }, historico: { id: 1 } }, { concepto: { cantidad: 2 }, historico: { id: 2 } }, { concepto: { cantidad: 5 }, historico: null }];
  const matrices = { 1: [{ insumo_id: 50, cantidad: 0.5 }, { insumo_id: 90, cantidad: 0.1 }], 2: [{ insumo_id: 50, cantidad: 1 }] };
  const aux = { 90: [{ insumo_id: 60, cantidad: 1 }, { insumo_id: 61, cantidad: 0.2 }] };
  assert.deepEqual(LP.explotarInsumos(emp, matrices, aux, new Set([90])), { 50: 7, 60: 1, 61: 0.2 });
});

test('migración 107: RLS nivel 80, vista con lista explícita, trigger de empresa y de fusión', () => {
  const sql = readFileSync(new URL('../../migrations/107_licitacion_precios.sql', import.meta.url), 'utf8');
  assert.match(sql, /get_session_nivel\(\)\) >= 80/);
  assert.match(sql, /CREATE OR REPLACE VIEW public\.licitacion_precios WITH \(security_invoker = true\)/);
  assert.match(sql, /trg_banco_empresa/); assert.match(sql, /AFTER INSERT ON control_obra\.insumo_fusiones/);
  assert.match(sql, /UNIQUE \(licitacion_id, insumo_id\)/);
  const js = readFileSync(new URL('../../src/js/licitacion-precios.js', import.meta.url), 'utf8');
  const cols = js.match(/from\('licitacion_precios'\)\.select\('([^']+)'\)/)[1].split(',');
  const vista = sql.match(/AS\s+SELECT ([\s\S]*?)\s+FROM control_obra\.licitacion_precios;/)[1].split(',').map((c) => c.trim());
  for (const c of cols) assert.ok(vista.includes(c), `la vista expone ${c}`);
});

test('carga diferida: licitacion-precios.js va en LAZY_ARCHIVOS y en MOD_ARCHIVO, no en el arranque', () => {
  const build = readFileSync(new URL('../../scripts/build.mjs', import.meta.url), 'utf8');
  assert.ok(build.includes("{ key: 'lcp', file: 'licitacion-precios.js' }"));
  const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes("lcp:{src:'js/licitacion-precios.js'"));
  assert.ok(!html.includes('<script src="js/licitacion-precios'));
  const lic = readFileSync(new URL('../../src/js/licitaciones.js', import.meta.url), 'utf8');
  assert.ok(lic.includes("conModuloArchivo('lcp')"), 'la pestaña Precios pide el módulo');
});
