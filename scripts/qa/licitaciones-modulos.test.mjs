// Funciones puras de los módulos de licitaciones (US-806): src/js/licitaciones.js, expediente.js y banco-precios.js
// cargan en Node con module.exports. Sin red: node --test scripts/qa/licitaciones-modulos.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const Licitaciones = require('../../src/js/licitaciones.js');
const Expediente = require('../../src/js/expediente.js');
const BancoPrecios = require('../../src/js/banco-precios.js');

test('los tres módulos exponen render y cargar (IIFE) y sus catálogos coinciden con los CHECK de las migraciones', () => {
  for (const m of [Licitaciones, Expediente, BancoPrecios]) {
    assert.equal(typeof m.render, 'function');
    assert.equal(typeof m.cargar, 'function');
  }
  const sql = ['080_licitaciones.sql', '081_expediente_empresa.sql', '083_banco_precios.sql']
    .map((f) => readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8')).join('\n');
  const check = (col) => { const m = sql.match(new RegExp(`${col}\\s+text[^\\n]*?CHECK \\(${col} IN \\(([^)]*)\\)`)); return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort() : null; };
  assert.deepEqual(check('modalidad'), Object.keys(Licitaciones.MODALIDADES).sort());
  assert.deepEqual(check('plaza'), Object.keys(Licitaciones.PLAZAS).sort());
  assert.deepEqual(Object.keys(BancoPrecios.PLAZAS).sort(), Object.keys(Licitaciones.PLAZAS).sort());
  assert.deepEqual(check('sobre'), Object.keys(Licitaciones.SOBRES).sort());
  assert.deepEqual(check('origen'), Object.keys(Licitaciones.ORIGENES).sort());
  // `flete` llega en 096_banco_precios_catalogo.sql (épica D); banco-precios.test.mjs lo compara contra esa migración
  assert.deepEqual(check('tipo'), Object.keys(BancoPrecios.TIPOS).filter((t) => t !== 'flete').sort());
  assert.deepEqual(check('fuente'), Object.keys(BancoPrecios.FUENTES).sort());
  const estatus = sql.match(/CHECK \(estatus IN \(([^)]*)\)/)[1];
  assert.deepEqual([...estatus.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(), Object.keys(Licitaciones.ESTATUS).sort());
  const estado = sql.match(/CHECK \(estado IN \(([^)]*)\)/)[1];
  assert.deepEqual([...estado.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(), Object.keys(Licitaciones.ESTADOS_REQUISITO).sort());
  const cat = sql.match(/categoria\s+text NOT NULL CHECK \(categoria IN \(([\s\S]*?)\)\),/)[1];
  assert.deepEqual([...cat.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(), Expediente.CATEGORIAS.map((c) => c.k).sort());
  assert.equal(Expediente.CATEGORIAS.length, 16, '14 de LicitaGen + padrón + declaración anual');
});

test('Licitaciones: días hasta una fecha en la fecha civil de México y próxima fecha clave', () => {
  assert.equal(Licitaciones.hoyMx(new Date('2026-10-05T03:00:00Z')), '2026-10-04', 'a las 9 p. m. del 4 en México sigue siendo 4');
  assert.equal(Licitaciones.diasHasta('2026-10-10', '2026-10-04'), 6);
  assert.equal(Licitaciones.diasHasta('2026-10-01', '2026-10-04'), -3);
  assert.equal(Licitaciones.diasHasta('2026-10-05T02:00:00Z', '2026-10-04'), 0, 'un timestamp de la noche del 4 en México cuenta como hoy');
  assert.equal(Licitaciones.diasHasta(null, '2026-10-04'), null);
  const lic = { visita: '2026-09-30T16:00:00Z', junta_aclaraciones: '2026-10-04T17:00:00Z', presentacion: '2026-10-12T16:00:00Z', fallo: '2026-10-20T16:00:00Z' };
  assert.deepEqual(Licitaciones.proximaFechaClave(lic, '2026-10-04'), { campo: 'junta_aclaraciones', etiqueta: 'Junta de aclaraciones', fecha: lic.junta_aclaraciones, dias: 0 });
  assert.equal(Licitaciones.proximaFechaClave(lic, '2026-10-13').campo, 'fallo');
  assert.equal(Licitaciones.proximaFechaClave(lic, '2026-11-01'), null);
  assert.equal(Licitaciones.proximaFechaClave({}, '2026-10-04'), null);
});

test('Licitaciones: KPIs de la lista', () => {
  const l = [
    { estatus: 'en_preparacion' }, { estatus: 'en_preparacion' }, { estatus: 'presentada', presentacion: '2026-09-01' },
    { estatus: 'ganada', fallo: '2026-08-01' }, { estatus: 'perdida', fallo: '2026-07-01' }, { estatus: 'desierta', fallo: '2026-06-01' },
    { estatus: 'ganada', fallo: '2025-12-01' }, { estatus: 'cancelada' },
  ];
  assert.deepEqual(Licitaciones.resumen(l, 2026), { en_preparacion: 2, presentadas: 1, ganadas_anio: 1, resueltas_anio: 3, pct_exito: 33 });
  assert.deepEqual(Licitaciones.resumen([], 2026), { en_preparacion: 0, presentadas: 0, ganadas_anio: 0, resueltas_anio: 0, pct_exito: null });
  assert.equal(Licitaciones.etiqueta(Licitaciones.ESTATUS, 'no_participamos'), 'No participamos');
});

test('Expediente: estado del documento con la regla de la vista (30 días) y faltantes', () => {
  const hoy = '2026-10-04';
  assert.deepEqual(Expediente.estadoDocumento({ fecha_vencimiento: '2026-10-03' }, hoy), { estado: 'vencido', dias: -1 });
  assert.deepEqual(Expediente.estadoDocumento({ fecha_vencimiento: '2026-10-04' }, hoy), { estado: 'por_vencer', dias: 0 });
  assert.deepEqual(Expediente.estadoDocumento({ fecha_vencimiento: '2026-11-03' }, hoy), { estado: 'por_vencer', dias: 30 });
  assert.deepEqual(Expediente.estadoDocumento({ fecha_vencimiento: '2026-11-04' }, hoy), { estado: 'vigente', dias: 31 });
  assert.deepEqual(Expediente.estadoDocumento({ fecha_vencimiento: null }, hoy), { estado: 'sin_vencimiento', dias: null });
  assert.equal(Expediente.estadoDocumento({ fecha_vencimiento: '2027-01-01', reemplazado_por_id: 9 }, hoy).estado, 'reemplazado');
  assert.equal(Expediente.vencimientoSugerido('opinion_sat', '2026-10-04'), '2026-11-03');
  assert.equal(Expediente.vencimientoSugerido('acta_constitutiva', '2026-10-04'), null);
  const docs = [
    { categoria: 'opinion_sat', estado: 'vencido' }, { categoria: 'opinion_sat', estado: 'reemplazado' },
    { categoria: 'acta_constitutiva', estado: 'sin_vencimiento' }, { categoria: 'opinion_imss', estado: 'por_vencer' },
  ];
  const f = Expediente.faltantes(docs);
  assert.ok(f.includes('opinion_sat'), 'una opinión vencida cuenta como faltante');
  assert.ok(!f.includes('acta_constitutiva') && !f.includes('opinion_imss'));
  assert.ok(!f.includes('otro'), '«otro» nunca falta');
  assert.equal(f.length, 13);
  assert.deepEqual(Expediente.resumen(docs), { vigente: 0, por_vencer: 1, vencido: 1, sin_vencimiento: 1, total: 3 });
});

test('BancoPrecios: normalización igual a texto_norm, antigüedad y precio vigente por plaza (D5)', () => {
  assert.equal(BancoPrecios.normalizarTexto('  Cemento GRIS, Portland—CPC 30R (50 kg)  '), 'cemento gris portland cpc 30r 50 kg');
  assert.equal(BancoPrecios.normalizarTexto('Peón · Ayudante / Señalero'), 'peon ayudante senalero');
  assert.equal(BancoPrecios.antiguedadDias('2026-04-07', '2026-10-04'), 180);
  assert.equal(BancoPrecios.esViejo('2026-04-07', '2026-10-04'), false, '180 días todavía no es viejo');
  assert.equal(BancoPrecios.esViejo('2026-04-06', '2026-10-04'), true);
  const precios = [
    { id: 1, precio: 240, fecha: '2026-03-01', plaza: 'cuauhtemoc' },
    { id: 2, precio: 250, fecha: '2026-08-01', plaza: 'cuauhtemoc' },
    { id: 3, precio: 262, fecha: '2026-09-01', plaza: 'chihuahua' },
  ];
  assert.deepEqual(BancoPrecios.precioVigente(precios, 'cuauhtemoc'), { precio: 250, fecha: '2026-08-01', plaza: 'cuauhtemoc', de_otra_plaza: false });
  assert.deepEqual(BancoPrecios.precioVigente(precios, 'juarez'), { precio: 262, fecha: '2026-09-01', plaza: 'chihuahua', de_otra_plaza: true });
  assert.deepEqual(BancoPrecios.precioVigente(precios), { precio: 262, fecha: '2026-09-01', plaza: 'chihuahua', de_otra_plaza: false });
  assert.equal(BancoPrecios.precioVigente([], 'cuauhtemoc'), null);
  const empate = [{ id: 5, precio: 1, fecha: '2026-09-01', plaza: 'otra' }, { id: 7, precio: 2, fecha: '2026-09-01', plaza: 'otra' }];
  assert.equal(BancoPrecios.precioVigente(empate, 'otra').precio, 2, 'misma fecha: gana el registro más nuevo');
});

test('build: los tres módulos son diferidos y no se enlazan en index.html; load_all_data_seguro no se toca', () => {
  const build = readFileSync(new URL('../../scripts/build.mjs', import.meta.url), 'utf8');
  for (const f of ['licitaciones.js', 'expediente.js', 'banco-precios.js']) assert.ok(build.includes(`file: '${f}'`), `${f} en LAZY_ARCHIVOS`);
  const html = readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
  for (const f of ['licitaciones', 'expediente', 'banco-precios']) assert.ok(!html.includes(`<script src="js/${f}.js`), `${f}.js no va en el arranque`);
  assert.ok(html.includes("else if(M==='lc'||M==='ex'||M==='bp')abrirModuloArchivo(M,c);"), 'R() despacha los tres módulos');
  assert.ok(html.includes("function R(){N();updateBreadcrumb();updateMobileBottomNav();const c=$('c');"), 'la primera línea de R() sigue intacta');
});
