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
