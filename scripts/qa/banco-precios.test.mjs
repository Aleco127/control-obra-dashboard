// Banco de precios (épica D): funciones puras de src/js/banco-precios.js y, con tokens en el entorno, las RPC de las
// migraciones 096 a 099 contra la API real (PostgREST como anon + x-obra-token). Lo que crea lleva el prefijo QA-BP-
// y se borra al final. Repo público: nunca pegar tokens aquí (set -a; . ./.env; set +a).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BP = require('../../src/js/banco-precios.js');

test('TIPOS coincide con el CHECK de insumos de 096 (incluye flete)', () => {
  const sql = readFileSync(new URL('../../migrations/096_banco_precios_catalogo.sql', import.meta.url), 'utf8');
  const m = sql.match(/insumos_tipo_check\s+CHECK \(tipo IN \(([^)]*)\)/);
  assert.ok(m, 'la migración define insumos_tipo_check');
  assert.deepEqual([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(), Object.keys(BP.TIPOS).sort());
});

test('variación anual: último contra el más reciente con al menos 365 días', () => {
  const p = [
    { id: 1, fecha: '2025-03-01', precio: 210, plaza: 'cuauhtemoc' },
    { id: 2, fecha: '2025-09-01', precio: 220, plaza: 'cuauhtemoc' },
    { id: 3, fecha: '2026-03-01', precio: 232, plaza: 'cuauhtemoc' },
  ];
  assert.deepEqual(BP.variacionAnual(p), { pct: 10.48, desde: '2025-03-01', hasta: '2026-03-01', precio_desde: 210 });
  assert.equal(BP.variacionAnual(p.slice(1)), null, 'sin un año de historia no hay variación anual');
  assert.equal(BP.variacionAnual([]), null);
});

test('series por plaza ordenadas por fecha; compra se distingue de propuesta', () => {
  const s = BP.seriesPorPlaza([
    { id: 2, fecha: '2026-02-01', precio: 5, plaza: 'chihuahua', fuente: 'compra' },
    { id: 1, fecha: '2026-01-01', precio: 4, plaza: 'chihuahua', fuente: 'opus' },
    { id: 3, fecha: '2026-01-15', precio: 6, plaza: 'parral', fuente: 'cotizacion' },
  ]);
  assert.deepEqual(Object.keys(s).sort(), ['chihuahua', 'parral']);
  assert.deepEqual(s.chihuahua.map((x) => [x.fecha, x.grupo]), [['2026-01-01', 'propuesta'], ['2026-02-01', 'compra']]);
  assert.equal(BP.grupoFuente('referencia'), 'propuesta');
});

test('referencia-2026 (US-824): grupos con plaza y fecha, tabulador de 10, 4 cuadrillas, HM %MO 1.00', async () => {
  const ref = JSON.parse(readFileSync(new URL('../licitaciones/referencia-2026.json', import.meta.url), 'utf8'));
  const { filasReferencia } = await import('../licitaciones/sembrar-referencia.mjs');
  const filas = filasReferencia(ref);
  assert.ok(filas.every((f) => f.fuente === 'referencia' && BP.PLAZAS[f.plaza] && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha) && f.precio > 0 && BP.TIPOS[f.tipo]));
  const tab = filas.filter((f) => f.tipo === 'mano_obra' && f.clave.startsWith('MO-'));
  assert.equal(tab.length, 10);
  assert.ok(tab.every((f) => Math.abs(f.datos.salario_base * f.datos.fsr - f.precio) < 0.01), 'costo por jornada = SB × FSR');
  assert.deepEqual(filas.filter((f) => f.clave.startsWith('C-')).map((f) => f.clave), ['C-DEMO', 'C-ALB', 'C-INST', 'C-ELEC-MT']);
  const hm = filas.find((f) => f.clave === 'HM');
  assert.deepEqual([hm.tipo, hm.unidad, hm.precio], ['herramienta', '%MO', 1]);
  const eq = filas.filter((f) => f.tipo === 'equipo');
  assert.equal(eq.length, 15);
  assert.ok(eq.every((f) => ['JOR', 'HR'].includes(f.unidad)), 'renta de equipo por jornada u hora');
  // Una llave (clave + unidad + tipo + fecha + plaza) no se repite: correr dos veces no duplica
  const llaves = filas.map((f) => [f.clave, f.unidad, f.tipo, f.fecha, f.plaza].join('|'));
  assert.equal(new Set(llaves).size, llaves.length);
});

// ---- US-825: conciliación ------------------------------------------------------------------------------------------
test('similitud igual a pg_trgm similarity()', () => {
  // valores medidos en la BD con extensions.similarity
  assert.equal(Math.round(BP.similitud('cemento gris portland', 'cemento gris portlan') * 1e6) / 1e6, 0.869565);
  assert.equal(Math.round(BP.similitud('retiro de escombro', 'acarreo de escombro fuera de obra') * 1e6) / 1e6, 0.333333);
  assert.equal(Math.round(BP.similitud('Peón', 'peon ayudante general') * 1e6) / 1e6, 0.227273, 'sin acentos ni mayúsculas');
  assert.equal(BP.similitud('', 'algo'), 0);
});

const EXISTENTES = [
  { id: 1, clave: 'MO-PEON', descripcion: 'Peón / ayudante general', unidad: 'JOR', tipo: 'mano_obra' },
  { id: 2, clave: 'REF-CEM', descripcion: 'Cemento gris portland CPC 30R saco 50 kg', unidad: 'SACO', tipo: 'material' },
  { id: 3, clave: 'ACAR', descripcion: 'Arena fina', unidad: 'M3', tipo: 'material' },
  { id: 4, clave: 'REF-CEM-B', descripcion: 'Cemento gris portland CPC 30R saco 50 kg', unidad: 'SACO', tipo: 'equipo' },
];
test('conciliarInsumos: tres cubetas (coincide · parecido ≥ 0.6 · nuevo) y omitidos', () => {
  const r = BP.conciliarInsumos([
    { clave: 'mo-peon ', descripcion: 'Peon', unidad: 'jor', tipo: 'mano_obra' },
    { clave: 'CEM-OPUS', descripcion: 'Cemento gris portland CPC-30R (saco de 50 kg)', unidad: 'SACO', tipo: 'material' },
    { clave: 'ACAR', descripcion: 'Retiro de escombro', unidad: 'M3', tipo: 'material' },
    { clave: 'TUBO', descripcion: 'Tubo PVC hidráulico 3"', unidad: 'M', tipo: 'material' },
    { clave: 'X1', descripcion: 'Raro', unidad: 'PZA', tipo: 'otro_9' },
    { clave: '', descripcion: 'Sin clave', unidad: 'PZA', tipo: 'material' },
  ], EXISTENTES);
  assert.deepEqual(r.coincide.map((x) => [x.recurso.clave, x.insumo.id, x.aviso]), [['mo-peon ', 1, 'descripcion_distinta'], ['ACAR', 3, 'descripcion_distinta']]);
  assert.equal(r.parecido.length, 1);
  assert.equal(r.parecido[0].candidato.id, 2, 'sólo candidatos del mismo tipo (el 4 es equipo)');
  assert.ok(r.parecido[0].puntaje >= 0.6);
  assert.deepEqual(r.nuevo.map((x) => x.recurso.clave), ['TUBO']);
  assert.deepEqual(r.omitidos.map((x) => x.motivo), ['tipo', 'sin_clave']);
});
test('mapaImportacion: nada se fusiona solo; un parecido entra sólo si el usuario lo confirmó', () => {
  const conc = BP.conciliarInsumos([
    { clave: 'MO-PEON', descripcion: 'Peón / ayudante general', unidad: 'JOR', tipo: 'mano_obra' },
    { clave: 'CEM-OPUS', descripcion: 'Cemento gris portland CPC 30R saco de 50 kg', unidad: 'SACO', tipo: 'material' },
  ], EXISTENTES);
  assert.deepEqual(BP.mapaImportacion(conc, {}), { 'mo-peon': 1 });
  assert.deepEqual(BP.mapaImportacion(conc, { 'cem-opus': 'nuevo' }), { 'mo-peon': 1 });
  assert.deepEqual(BP.mapaImportacion(conc, { 'cem-opus': 2 }), { 'mo-peon': 1, 'cem-opus': 2 });
  assert.deepEqual(BP.mapaImportacion(conc, { 'cem-opus': 3 }), { 'mo-peon': 1 }, 'no acepta un id que no fue candidato');
});
test('leerOpusInsumos valida formato, listas y mojibake; fecha y plaza de la propuesta', () => {
  assert.throws(() => BP.leerOpusInsumos('{"formato":"otro"}'), /opus-insumos\/v1/);
  assert.throws(() => BP.leerOpusInsumos('no es json'), /JSON/);
  assert.throws(() => BP.leerOpusInsumos('{"formato":"opus-insumos/v1","recursos":[{"descripcion":"colocaciÃ³n"}],"conceptos":[],"componentes":[]}'), /acentos dañados/);
  const doc = BP.leerOpusInsumos('﻿{"formato":"opus-insumos/v1","recursos":[],"conceptos":[],"componentes":[],"proyecto":{"ciudad":"Cuauhtemoc, Chihuahua"},"fechas":{"presentacion":"2026-09-14T13:30:00"}}');
  assert.equal(BP.fechaPropuesta(doc), '2026-09-14');
  assert.equal(BP.plazaSugerida(doc), 'cuauhtemoc');
  assert.equal(BP.fechaPropuesta({ fechas: { presentacion: null, ultima_actualizacion_precios: '2026-04-28T15:51:37' } }), '2026-04-28');
});
test('excelAOpusInsumos: respaldo con el Excel de explosión de insumos (secciones por tipo)', () => {
  const doc = BP.excelAOpusInsumos([
    ['EXPLOSIÓN DE INSUMOS'], [],
    ['Clave', 'Descripción', 'Unidad', 'Cantidad', 'Costo', 'Importe'],
    ['MATERIALES'],
    ['CEM', 'Cemento', 'SACO', 10, 235, 2350],
    ['MANO DE OBRA'],
    ['MO-PEON', 'Peón', 'JOR', 5, '$664.74', 3323.7],
    ['EQUIPO'],
    ['CAMI', 'Camión', 'HR', 2, 680, 1360],
    ['', 'Total', '', '', '', 7033.7],
  ], 'explosion.xlsx');
  assert.equal(doc.formato, 'opus-insumos/v1');
  assert.deepEqual(doc.recursos.map((r) => [r.clave, r.tipo, r.precio]), [['CEM', 'material', 235], ['MO-PEON', 'mano_obra', 664.74], ['CAMI', 'equipo', 680]]);
  assert.deepEqual([doc.conceptos.length, doc.componentes.length], [0, 0]);
  assert.throws(() => BP.excelAOpusInsumos([['a', 'b']], 'x.xlsx'), /encabezados/);
});

// ---- US-826: matrices ----------------------------------------------------------------------------------------------
test('recalcularMatriz reproduce el concepto 1.11 del Archivo Municipal y la composición', () => {
  // Del contrato opus-insumos-v1: 115.06 + 182.43 + 18.01 + 60 = 375.50
  const comps = [
    { insumo_id: 1, cantidad: 0.13, tipo: 'mano_obra', unidad: 'JOR' },
    { insumo_id: 2, cantidad: 0.26, tipo: 'mano_obra', unidad: 'JOR' },
    { insumo_id: 3, cantidad: 0.12, tipo: 'material', unidad: 'M3' },
    { insumo_id: 4, cantidad: 0.04, tipo: 'equipo', unidad: 'HR' },
  ];
  const r = BP.recalcularMatriz(comps, { 1: 885.1, 2: 701.67, 3: 150.1, 4: 1500.1 });
  assert.equal(r.total, 375.5);
  assert.equal(r.porTipo.mano_obra, 297.49);
  assert.equal(r.porTipo.equipo, 60);
  const c = BP.composicionCD(r.porTipo);
  assert.equal(c.total, 375.5);
  assert.equal(Math.round((c.material + c.mano_obra + c.equipo_herramienta + c.otros) * 10) / 10, 100);
});
test('recalcularMatriz: cuadrilla con su matriz, herramienta (%)mo y faltantes', () => {
  const aux = { 10: [{ insumo_id: 11, cantidad: 1, tipo: 'mano_obra' }, { insumo_id: 2, cantidad: 0.2, tipo: 'mano_obra' }] };
  const r = BP.recalcularMatriz([
    { insumo_id: 10, cantidad: 0.5, tipo: 'mano_obra', compuesto: true },
    { insumo_id: 20, cantidad: 0.03, tipo: 'herramienta', unidad: '(%)mo' },
    { insumo_id: 30, cantidad: 2, tipo: 'material' },
  ], { 11: 700.2, 2: 701.67 }, aux);
  assert.equal(r.porTipo.mano_obra, 420.27);
  assert.equal(r.porTipo.herramienta, 12.61);
  assert.equal(r.sinPrecio, 1);
  assert.equal(r.total, 432.88);
});

// ---- RPC contra la API real ----------------------------------------------------------------------------------------
const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const A = process.env.QA_TOKEN_A || process.env.OBRA_QA_TOKEN || '';
const B = process.env.QA_TOKEN_B || '';
const skipApi = A && B ? false : 'OBRA_QA_TOKEN y QA_TOKEN_B no definidos';
async function rest(path, token, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(token ? { 'x-obra-token': token } : {}), ...(opts.headers || {}) } });
  let body = null; try { body = await r.json(); } catch { /* vacío */ }
  return { status: r.status, body };
}
const rpc = (n, t, a) => rest(`rpc/${n}`, t, { method: 'POST', body: JSON.stringify(a) });

test('importar_opus_insumos: idempotente, cuadrillas a insumo_componentes, fusión mueve componentes; otra empresa no ve nada', { skip: skipApi }, async () => {
  const ts = Date.now(); const k = (s) => `QA-BP-${s}-${ts}`;
  const doc = { formato: 'opus-insumos/v1', proyecto: { nombre: 'QA banco' }, fechas: { presentacion: '2026-09-14T13:30:00' },
    recursos: [
      { clave: k('MO'), descripcion: 'Peón QA', unidad: 'JOR', tipo: 'mano_obra', precio: 701.67, mano_obra: { salario_base: 380, sbc: 398.73, fsr: 1.8465 } },
      { clave: k('MAT'), descripcion: 'Arena QA', unidad: 'M3', tipo: 'material', precio: 520 },
      { clave: k('MAT2'), descripcion: 'Arena QA duplicada', unidad: 'M3', tipo: 'material', precio: 530 },
      { clave: k('CUA'), descripcion: 'Cuadrilla QA', unidad: 'jor', tipo: 'mano_obra', precio: 840.53, tiene_matriz: true },
      { clave: k('FL'), descripcion: 'Flete QA', unidad: 'VJE', tipo: 'flete', precio: 1000.1 },
      { clave: k('HM'), descripcion: 'Herramienta QA', unidad: '(%)mo', tipo: 'herramienta', precio: 0 },
    ],
    conceptos: [{ clave: k('C1'), clave_matriz: k('C1'), descripcion: 'Concepto QA', unidad: 'M2', cantidad: 10, costo_directo: 100, pu: 121.76 }],
    componentes: [
      { concepto_clave: k('C1'), matriz: 'concepto', insumo_clave: k('MO'), insumo_tipo: 'mano_obra', cantidad: 0.1 },
      { concepto_clave: k('C1'), matriz: 'concepto', insumo_clave: k('MAT'), insumo_tipo: 'material', cantidad: 0.05 },
      { concepto_clave: k('C1'), matriz: 'concepto', insumo_clave: k('MAT2'), insumo_tipo: 'material', cantidad: 0.02 },
      { concepto_clave: k('C1'), matriz: 'concepto', insumo_clave: k('HM'), insumo_tipo: 'herramienta', cantidad: 0.03 },
      { concepto_clave: k('CUA'), matriz: 'auxiliar', insumo_clave: k('MO'), insumo_tipo: 'mano_obra', cantidad: 1 },
    ] };
  const lic = await rest('licitaciones', A, { method: 'POST', body: JSON.stringify({ codigo: k('LIC'), nombre: 'QA banco', plaza: 'cuauhtemoc' }) });
  assert.equal(lic.status, 201, JSON.stringify(lic.body));
  const licId = lic.body[0].id;
  try {
    const r1 = await rpc('importar_opus_insumos', A, { p_licitacion_id: licId, p_plaza: 'cuauhtemoc', p_fecha: '2026-09-14', p_doc: doc });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.deepEqual([r1.body.recursos_importados, r1.body.insumos_nuevos, r1.body.precios, r1.body.conceptos, r1.body.componentes, r1.body.componentes_auxiliares],
      [6, 6, 4, 1, 4, 1], JSON.stringify(r1.body));
    assert.deepEqual(r1.body.sin_precio.map((x) => x.motivo).sort(), ['compuesto', 'herramienta_pct_mo']);
    const r2 = await rpc('importar_opus_insumos', A, { p_licitacion_id: licId, p_plaza: 'cuauhtemoc', p_fecha: '2026-09-14', p_doc: doc });
    assert.deepEqual([r2.body.insumos_nuevos, r2.body.conceptos_nuevos, r2.body.precios], [0, 0, 4], 'reimportar no duplica');
    const pre = await rest(`insumo_precios?licitacion_id=eq.${licId}&select=id,datos`, A);
    assert.equal(pre.body.length, 4);
    assert.ok(pre.body.some((p) => p.datos.fsr === 1.8465 && p.datos.salario_base === 380), 'MO guarda SB y FSR en datos');
    const mc = await rest(`matriz_componentes?licitacion_id=eq.${licId}&select=id,insumo_id,cantidad`, A);
    assert.equal(mc.body.length, 4);
    const imp = await rest(`banco_importaciones?licitacion_id=eq.${licId}&select=mapa,resumen`, A);
    const mapa = imp.body[0].mapa;
    const cua = await rest(`insumos?id=eq.${mapa[k('CUA').toLowerCase()]}&select=compuesto`, A);
    assert.equal(cua.body[0].compuesto, true);
    // Fusión: MAT2 en MAT suma cantidades dentro de la matriz del concepto
    const f = await rpc('fusionar_insumos', A, { p_origen: mapa[k('MAT2').toLowerCase()], p_destino: mapa[k('MAT').toLowerCase()], p_motivo: 'QA' });
    assert.equal(f.status, 200, JSON.stringify(f.body));
    assert.deepEqual([f.body.precios_movidos, f.body.precios_descartados, f.body.componentes_movidos], [0, 1, 1]);
    const mc2 = await rest(`matriz_componentes?licitacion_id=eq.${licId}&insumo_id=eq.${mapa[k('MAT').toLowerCase()]}&select=cantidad`, A);
    assert.equal(Number(mc2.body[0].cantidad), 0.07);
    // Aislamiento: la otra empresa no ve nada ni puede importar a esta licitación
    const otra = await rest(`banco_importaciones?licitacion_id=eq.${licId}&select=id`, B);
    assert.deepEqual(otra.body, []);
    const r3 = await rpc('importar_opus_insumos', B, { p_licitacion_id: licId, p_plaza: 'cuauhtemoc', p_fecha: '2026-09-14', p_doc: doc });
    assert.notEqual(r3.status, 200);
  } finally {
    await rest(`insumo_fusiones?origen_clave=eq.${k('MAT2')}`, A, { method: 'DELETE' });
    const imp = await rest(`banco_importaciones?licitacion_id=eq.${licId}&select=mapa`, A);
    const ids = Object.values((imp.body && imp.body[0] && imp.body[0].mapa) || {});
    const cps = await rest(`concepto_precios?licitacion_id=eq.${licId}&select=concepto_id`, A);
    await rest(`licitaciones?id=eq.${licId}`, A, { method: 'DELETE' });
    if (ids.length) await rest(`insumos?id=in.(${ids.join(',')})`, A, { method: 'DELETE' });
    const cids = (cps.body || []).map((c) => c.concepto_id);
    if (cids.length) await rest(`conceptos_historicos?id=in.(${cids.join(',')})`, A, { method: 'DELETE' });
  }
});
