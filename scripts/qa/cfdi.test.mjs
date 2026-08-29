// node --test scripts/qa/cfdi.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CFDI = require('../../src/js/cfdi.js');
const x40 = readFileSync(new URL('./fixtures/cfdi40_recibida.xml', import.meta.url), 'utf8');
const x33 = readFileSync(new URL('./fixtures/cfdi33_emitida.xml', import.meta.url), 'utf8');

test('CFDI 4.0 recibida: UUID, emisor, receptor, totales e IVA', () => {
  const c = CFDI.parse(x40);
  assert.equal(c.version, '4.0');
  assert.equal(c.uuid, 'AB12CD34-1111-2222-3333-444455556666');
  assert.equal(c.fecha, '2026-08-14');
  assert.equal(c.serie, 'A'); assert.equal(c.folio, '1234');
  assert.equal(c.emisorRfc, 'HDM001017AS1'); assert.equal(c.emisorNombre, 'HOME DEPOT MEXICO');
  assert.equal(c.receptorRfc, 'SAR190101ABC'); assert.equal(c.receptorUso, 'G03');
  assert.equal(c.subtotal, 538.79); assert.equal(c.total, 625); assert.equal(c.iva, 86.21); assert.equal(c.ivaTasa, 16);
  assert.equal(c.formaPago, '04'); assert.equal(c.metodoPago, 'PUE');
  assert.equal(c.conceptos.length, 1); assert.equal(c.conceptos[0].descripcion, 'Garrafon de agua 20 L');
  assert.equal(c.descripcion, 'Garrafon de agua 20 L');
  assert.equal(c.fechaTimbrado, '2026-08-14T10:22:40');
});

test('CFDI 3.3 emitida: retenciones en cero, IVA de totales, folio numérico', () => {
  const c = CFDI.parse(x33);
  assert.equal(c.version, '3.3');
  assert.equal(c.uuid, 'FF00FF00-AAAA-BBBB-CCCC-DDDDEEEEFFFF');
  assert.equal(c.emisorRfc, 'SAR190101ABC');
  assert.equal(c.receptorRfc, 'LOLA800101XYZ');
  assert.equal(c.subtotal, 85320.95); assert.equal(c.total, 98972.3); assert.equal(c.iva, 13651.35);
  assert.equal(c.isrRet, 0); assert.equal(c.ivaRet, 0);
  assert.equal(c.folio, '87');
});

test('archivo que no es CFDI lanza error', () => {
  assert.throws(() => CFDI.parse('<html><body>hola</body></html>'), /no es un CFDI/);
});

test('atributos con entidades y comentarios no rompen el tokenizador', () => {
  const xml = x40.replace('Nombre="HOME DEPOT MEXICO"', 'Nombre="HOME &amp; DEPOT &quot;MX&quot;"').replace('<cfdi:Emisor', '<!-- comentario --><cfdi:Emisor');
  const c = CFDI.parse(xml);
  assert.equal(c.emisorNombre, 'HOME & DEPOT "MX"');
});
