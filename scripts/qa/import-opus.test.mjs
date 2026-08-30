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
