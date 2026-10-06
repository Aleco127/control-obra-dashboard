// Pruebas de las funciones puras de src/js/licitacion-sobres.js (pestaña «Sobres», migración 115). Sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../../src/js/licitacion-sobres.js');

const reqs = [
  { id: 1, sobre: 'legal', orden: 2, revisado_at: '2026-10-06T10:00:00Z', archivos_base: [{ path: 'a/formas.docx' }, { path: 'a/dd01.docx' }] },
  { id: 2, sobre: 'legal', orden: 1, revisado_at: null, archivos_base: [] },
  { id: 3, sobre: 'tecnico', orden: 1, revisado_at: null, archivos_base: [{ path: 'a/formas.docx' }] },
  { id: 4, sobre: 'economico', orden: 1, revisado_at: '2026-10-06T11:00:00Z' },
];

test('tipoArchivo reconoce Word, Excel y PDF por extensión', () => {
  assert.equal(S.tipoArchivo('DD-01 - SUPERNOVA.docx'), 'word');
  assert.equal(S.tipoArchivo('Formas O.P OK.XLSX'), 'excel');
  assert.equal(S.tipoArchivo('6.2.pdf'), 'pdf');
  assert.equal(S.tipoArchivo('plano.dwg'), 'otro');
  assert.equal(S.tipoArchivo(''), 'otro');
});

test('resumenRevision cuenta revisados por sobre y en total', () => {
  const r = S.resumenRevision(reqs);
  assert.deepEqual(r.legal, { total: 2, revisados: 1 });
  assert.deepEqual(r.tecnico, { total: 1, revisados: 0 });
  assert.deepEqual(r.economico, { total: 1, revisados: 1 });
  assert.deepEqual(r.total, { total: 4, revisados: 2 });
  assert.deepEqual(S.resumenRevision([]).total, { total: 0, revisados: 0 });
});

test('usosDe encuentra los otros requisitos que comparten un archivo base', () => {
  assert.deepEqual(S.usosDe(reqs, 'a/formas.docx', 1), [3]);
  assert.deepEqual(S.usosDe(reqs, 'a/formas.docx', null), [1, 3]);
  assert.deepEqual(S.usosDe(reqs, 'a/dd01.docx', 1), []);
});

test('cambiarArchivo reemplaza en la misma posición o quita', () => {
  const lista = [{ path: 'x' }, { path: 'y' }, { path: 'z' }];
  assert.deepEqual(S.cambiarArchivo(lista, 'y', { path: 'y2' }).map((a) => a.path), ['x', 'y2', 'z']);
  assert.deepEqual(S.cambiarArchivo(lista, 'y', null).map((a) => a.path), ['x', 'z']);
  assert.deepEqual(S.cambiarArchivo(null, 'y', null), []);
});

test('filasSobre ordena por orden y filtra los ya palomeados', () => {
  assert.deepEqual(S.filasSobre(reqs, 'legal').map((q) => q.id), [2, 1]);
  assert.deepEqual(S.filasSobre(reqs, 'legal', true).map((q) => q.id), [2]);
  assert.deepEqual(S.filasSobre(reqs, 'economico', true), []);
});
