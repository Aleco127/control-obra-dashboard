// Prueba US-242: los presets OPUS y Neodata importan el 100 % de los conceptos con importe correcto.
// Ejecutar: node --test scripts/qa/import-opus.test.mjs   (los CSV salen de scripts/qa/make-plantillas.py)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const ImportPresets = require('../../src/js/import-presets.js');
const here = dirname(fileURLToPath(import.meta.url));

function csv(nombre) {
  const txt = readFileSync(join(here, 'fixtures', nombre), 'utf8');
  const rows = txt.split(/\r?\n/).filter(l => l.trim()).map(l => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')).filter((c, i, a) => i < a.length - 1 || c !== ''));
  const h = rows.findIndex(r => r.some(c => /clave|c[oó]digo/i.test(c)));
  return { headers: rows[h], rows: rows.slice(h + 1) };
}
const TOTAL_ESPERADO = 800 * 18.5 + 96 * 285 + 42 * 310 + 64 * 145 + 28.5 * 4850 + 118 * 425 + 420 * 385 + 260 * 295 + 210 * 1650 + 840 * 165 + 190 * 690 + 840 * 78;

for (const [archivo, preset] of [['opus-ejemplo.csv', 'opus'], ['neodata-ejemplo.csv', 'neodata']]) {
  test(`${archivo}: preset ${preset}, 12 conceptos en 4 partidas, importe exacto`, () => {
    const { headers, rows } = csv(archivo);
    const det = ImportPresets.detectar(headers);
    assert.equal(det.preset, preset);
    for (const campo of ['clave', 'descripcion', 'unidad', 'cantidad', 'precio_unitario', 'importe']) assert.ok(Object.values(det.mapping).includes(campo), 'falta ' + campo);
    const r = ImportPresets.construir(rows, det.mapping, { obra_id: 1 });
    assert.equal(r.conceptos.length, 12);
    assert.deepEqual(r.partidas.map(p => p.nombre), ['PRELIMINARES', 'CIMENTACIÓN', 'ESTRUCTURA', 'ACABADOS']);
    assert.deepEqual(r.partidas.map(p => p.n), [3, 3, 3, 3]);
    const total = r.conceptos.reduce((s, c) => s + c.cantidad * c.precio_unitario, 0);
    assert.ok(Math.abs(total - TOTAL_ESPERADO) < 0.01, `total ${total} vs ${TOTAL_ESPERADO}`);
    assert.equal(r.conceptos[0].partida, 'PRELIMINARES');
    assert.equal(r.conceptos[11].partida, 'ACABADOS');
    assert.equal(r.conceptos[4].clave, 'B.02');
    assert.equal(r.conceptos[4].precio_unitario, 4850);
    assert.equal(r.errores.length, 0, JSON.stringify(r.errores));
  });
}

test('filas con error se reportan por número y no se pierden las buenas', () => {
  const headers = ['Código', 'Concepto', 'Unidad', 'Cantidad', 'P. Unitario', 'Importe'];
  const rows = [['A', 'PRELIMINARES', '', '', '', ''], ['A.01', 'Limpieza', 'm2', '10', '5', '50'], ['A.02', '', 'm2', '1', '1', '1'], ['A.03', 'Sin unidad', '', '2', '3', '6'], ['A.04', 'Importe malo', 'pza', '2', '3', '99'], ['', 'TOTAL', '', '', '', '156']];
  const r = ImportPresets.construir(rows, ImportPresets.detectar(headers).mapping);
  assert.equal(r.conceptos.length, 3);
  assert.equal(r.errores.length, 3);
  assert.ok(r.errores.some(e => e.fila === 4 && /Sin descripción/.test(e.motivo)));
  assert.ok(r.errores.some(e => e.fila === 5 && /sin unidad/.test(e.motivo)));
  assert.ok(r.errores.some(e => e.fila === 6 && /no coincide/.test(e.motivo)));
});

test('números con formato $1,234.50 y 1.234,50', () => {
  assert.equal(ImportPresets.numero('$1,234.50'), 1234.5);
  assert.equal(ImportPresets.numero('1.234,50'), 1234.5);
  assert.equal(ImportPresets.numero('12,5'), 12.5);
  assert.equal(ImportPresets.numero(''), 0);
});

// --- Formato real de OPUS 24 (skill /opus-budget-direct) ---------------------
test('OPUS 24: claves NN-XXX, 6 partidas, 17 conceptos y el subtotal de cada partida cuadra', () => {
  const { headers, rows } = csv('opus-24-ejemplo.csv');
  const det = ImportPresets.detectar(headers, rows);
  assert.equal(det.preset, 'opus');
  const r = ImportPresets.construir(rows, det.mapping, { obra_id: 1 });
  assert.equal(r.conceptos.length, 17);
  assert.equal(r.partidas.length, 6);
  assert.deepEqual(r.partidas.map(p => p.n), [4, 6, 2, 2, 1, 2]);
  assert.equal(r.partidas[1].nombre, 'ALBAÑILERIA Y RECUBRIMIENTOS');
  assert.equal(r.conceptos[0].partida, 'PRELIMINARES Y DEMOLICIONES');
  assert.equal(r.conceptos[16].partida, 'LIMPIEZA Y ACARREOS');
  assert.equal(r.conceptos[0].unidad, 'LOTE');
  assert.equal(r.sinPrecios, false);
  assert.equal(r.errores.length, 0, JSON.stringify(r.errores));
});

test('OPUS 24: un catálogo de concurso sin precios se importa sin marcar cada renglón', () => {
  const { headers, rows } = csv('opus-24-concurso.csv');
  const r = ImportPresets.construir(rows, ImportPresets.detectar(headers, rows).mapping, {});
  assert.equal(r.conceptos.length, 17);
  assert.equal(r.partidas.length, 6);
  assert.equal(r.sinPrecios, true);
  assert.equal(r.errores.length, 0, JSON.stringify(r.errores));
  assert.equal(r.conceptos[2].cantidad, 35);
  assert.equal(r.conceptos[2].precio_unitario, 0);
});

test('OPUS 24: sin renglones de grupo, la partida se deduce de la clave', () => {
  const { headers, rows } = csv('opus-24-ejemplo.csv');
  const sinGrupos = rows.filter(r => !/^\d{2}-[A-Z]{3}$/.test((r[0] || '').trim()));
  const res = ImportPresets.construir(sinGrupos, ImportPresets.detectar(headers, sinGrupos).mapping, {});
  assert.equal(res.conceptos.length, 17);
  assert.deepEqual(res.partidas.map(p => p.clave), ['01-PRE', '02-ALB', '03-PLA', '04-PIN', '05-HOJ', '06-LIM']);
  assert.ok(res.partidas.every(p => p.derivada));
  assert.equal(res.conceptos[0].partida, '01-PRE');
});

test('OPUS 24: conceptos desordenados siguen cayendo en su partida', () => {
  const headers = ['Clave', 'Concepto', 'Unidad', 'Cantidad', 'P.U.', 'Importe'];
  const rows = [
    ['01-PRE', 'PRELIMINARES', '', '', '', ''],
    ['02-ALB', 'ALBAÑILERIA', '', '', '', ''],
    ['02-ALB-010', 'Aplanado', 'M2', '10', '100', '1000'],
    ['01-PRE-005', 'Trazo', 'M2', '5', '20', '100'],
  ];
  const r = ImportPresets.construir(rows, ImportPresets.detectar(headers, rows).mapping, {});
  assert.equal(r.conceptos[0].partida, 'ALBAÑILERIA');
  assert.equal(r.conceptos[1].partida, 'PRELIMINARES');
});

test('sin encabezados legibles se usa el orden de columnas de OPUS', () => {
  const rows = [
    ['01-PRE', 'PRELIMINARES', '', '', '', ''],
    ['01-PRE-005', 'Trazo de ejes', 'M2', '244.71', '21.99', '5381.17'],
    ['01-PRE-010', 'Carton corrugado', 'M2', '244.71', '60.82', '14883.26'],
    ['02-DEM', 'DEMOLICIONES', '', '', '', ''],
    ['02-DEM-200', 'Hueco en losa', 'PZA', '4', '1409.18', '5636.72'],
  ];
  const det = ImportPresets.detectar(['', '', '', '', '', ''], rows);
  assert.equal(det.preset, 'opus');
  assert.equal(det.porPosicion, true);
  const r = ImportPresets.construir(rows, det.mapping, {});
  assert.equal(r.conceptos.length, 3);
  assert.equal(r.conceptos[0].partida, 'PRELIMINARES');
});

test('claves repetidas y unidades de OPUS', () => {
  assert.equal(ImportPresets.unidad('m2'), 'M2');
  assert.equal(ImportPresets.unidad('Pza.'), 'PZA');
  assert.equal(ImportPresets.repararTexto('ALBA�ILERIAS'), 'ALBAÑILERIAS');
  assert.equal(ImportPresets.repararTexto('DEMOLICI�N'), 'DEMOLICIÓN');
  const headers = ['Clave', 'Concepto', 'Unidad', 'Cantidad', 'P.U.', 'Importe'];
  const rows = [['01-PRE-005', 'Trazo', 'M2', '10', '20', '200'], ['01-PRE-005', 'Trazo otra vez', 'M2', '10', '20', '200']];
  const r = ImportPresets.construir(rows, ImportPresets.detectar(headers, rows).mapping, {});
  assert.equal(r.duplicadas, 1);
  assert.equal(r.conceptos.length, 2);
});
