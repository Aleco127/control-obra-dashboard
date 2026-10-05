// Calculadora de factor de salario real (US-831): BancoPrecios.calcularFSR con los parámetros 2026 de la migración
// 098 (fila de fábrica). Debe reproducir el tabulador de Cd. Cuauhtémoc 2026 de la skill /opus-budget-direct con
// tolerancia de 0.0005 (MO-PEON $360 → 1.84650; MO-CABO $620 → 1.83089) y su SBC al centavo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BP = require('../../src/js/banco-precios.js');

// Los mismos valores que inserta migrations/098_parametros_laborales_2026.sql (se leen del archivo para no divergir)
const sql = readFileSync(new URL('../../migrations/098_parametros_laborales_2026.sql', import.meta.url), 'utf8');
const jsons = [...sql.matchAll(/'(\[[\s\S]*?\]|\{[\s\S]*?\})'::jsonb/g)].map((m) => JSON.parse(m[1]));
const P2026 = { anio: 2026, uma: 117.31, salario_minimo: 315.04, dias_vacaciones: 12, riesgo_trabajo_pct: 7.58875, isn_pct: 3.0,
  cesantia_tabla: jsons[0], datos: jsons[1], es_fabrica: true };

const TABULADOR = [
  ['MO-PEON', 360, 377.74, 1.84650, 664.74], ['MO-PIN', 460, 482.67, 1.84646, 849.37], ['MO-ALB', 480, 503.66, 1.84395, 885.09],
  ['MO-PLO', 500, 524.64, 1.84163, 920.82], ['MO-TAB', 520, 545.63, 1.83950, 956.54], ['MO-HER', 560, 587.60, 1.83568, 1027.98],
  ['MO-ELE', 560, 587.60, 1.83568, 1027.98], ['MO-OPE', 580, 608.58, 1.83397, 1063.71], ['MO-INS', 600, 629.57, 1.83238, 1099.43],
  ['MO-CABO', 620, 650.55, 1.83089, 1135.15],
];

test('la migración 098 trae la tabla de cesantía 3.150 a 7.513 y Tp/Tl 383.25/285.25', () => {
  assert.deepEqual(P2026.cesantia_tabla.map((x) => x.pct), [3.15, 3.676, 4.851, 5.556, 6.026, 6.361, 6.613, 7.513]);
  assert.deepEqual([P2026.datos.tp, P2026.datos.tl], [383.25, 285.25]);
});

test('reproduce el tabulador de Cd. Cuauhtémoc 2026 (tolerancia 0.0005)', () => {
  for (const [clave, sb, sbc, fsr, costo] of TABULADOR) {
    const r = BP.calcularFSR(sb, P2026);
    assert.ok(Math.abs(r.fsr - fsr) <= 0.0005, `${clave}: FSR ${r.fsr} contra ${fsr}`);
    assert.ok(Math.abs(r.sbc - sbc) <= 0.011, `${clave}: SBC ${r.sbc} contra ${sbc}`);
    assert.ok(Math.abs(r.costo_jornada - costo) <= 0.02, `${clave}: costo ${r.costo_jornada} contra ${costo}`);
  }
  // Peor diferencia de los 10: 0.00001 (MO-CABO 1.83088 contra 1.83089)
});

test('desglose: cuota fija sobre UMA, excedente de 3 UMA, cesantía escalonada e ISN', () => {
  const r = BP.calcularFSR(360, P2026);
  assert.equal(r.fsb, 1.049281);
  assert.equal(r.cuotas.cuota_fija, Math.round(0.204 * 117.31 * 1e4) / 1e4);
  assert.equal(r.cuotas.excedente, Math.round(0.011 * (377.74 - 3 * 117.31) * 1e4) / 1e4);
  assert.equal(r.cesantia_pct, 6.361, 'SBC 3.22 UMA → 3.01 a 3.50 UMA');
  assert.equal(BP.calcularFSR(620, P2026).cesantia_pct, 7.513, 'SBC 5.55 UMA → 4.01 en adelante');
  assert.equal(BP.calcularFSR(250, P2026).cesantia_pct, 3.15, 'hasta 1 salario mínimo de SBC');
  assert.equal(BP.calcularFSR(300, P2026).cuotas.excedente, 0, 'SBC < 3 UMA no paga excedente');
  assert.ok(Math.abs(r.fsr / r.fsr_sin_isn - 1.03) < 1e-4, 'el ISN multiplica por 1.03');
});

test('cordura: el FSR baja cuando sube el salario; sin parámetros no calcula', () => {
  let prev = Infinity;
  for (const sb of [400, 500, 650, 800, 1200]) { const f = BP.calcularFSR(sb, P2026).fsr; assert.ok(f < prev, `${sb}: ${f}`); prev = f; }
  assert.equal(BP.calcularFSR(0, P2026), null);
  assert.equal(BP.calcularFSR(360, null), null);
});

test('parametrosDelAnio: los de la empresa mandan sobre los de fábrica; sin año, null', () => {
  const filas = [{ anio: 2026, es_fabrica: true, uma: 1 }, { anio: 2026, es_fabrica: false, uma: 2 }, { anio: 2025, es_fabrica: true, uma: 3 }];
  assert.equal(BP.parametrosDelAnio(filas, 2026).uma, 2);
  assert.equal(BP.parametrosDelAnio(filas, 2025).uma, 3);
  assert.equal(BP.parametrosDelAnio(filas, 2027), null);
});
