// PRD portal v2, US-752: PortalCalc puro (src/js/portal/calculos.js). Sin navegador: node --test scripts/qa/portal-calculos.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../../src/js/portal/calculos.js');

const HOY = '2026-11-06';
const act = (o) => Object.assign({ id: 1, nombre: 'x', inicio: '2026-11-01', fin: '2026-11-10', avance: 0, peso: 10, hito: false, partida: 'Albañilería' }, o);

test('planeado: obra sin programa → 0 y frase de sin programa', () => {
  assert.equal(C.planeadoALaFecha([], HOY), 0);
  assert.equal(C.planeadoALaFecha([act({ peso: 0 })], HOY), 0);
  assert.match(C.fraseAvance({ real: 0, hayPrograma: false }), /no comparte el programa/);
});
test('planeado: actividad futura = 0, terminada = peso completo, en curso lineal', () => {
  assert.equal(C.fraccionPlaneada(act({ inicio: '2026-11-20', fin: '2026-11-25' }), HOY), 0);
  assert.equal(C.fraccionPlaneada(act({ inicio: '2026-10-01', fin: '2026-10-10' }), HOY), 1);
  // 1 al 10 de noviembre: el día 6 van 6 de 10 días
  assert.equal(C.fraccionPlaneada(act(), HOY), 0.6);
  assert.equal(C.planeadoALaFecha([act({ peso: 50 }), act({ id: 2, peso: 50, inicio: '2026-12-01', fin: '2026-12-10' })], HOY), 30);
});
test('planeado: los hitos no pesan', () => {
  const acts = [act({ peso: 100, avance: 50 }), act({ id: 9, hito: true, peso: 0, avance: 100, inicio: '2026-10-01', fin: '2026-10-01' })];
  assert.equal(C.planeadoALaFecha(acts, HOY), 60);
  assert.equal(C.realPonderado(acts), 50);
});
test('real ponderado: avances > 100 se topan', () => {
  assert.equal(C.realPonderado([act({ avance: 150, peso: 1 }), act({ id: 2, avance: 50, peso: 1 })]), 75);
});
test('desviación: al día → 0', () => {
  const acts = [act({ inicio: '2026-11-01', fin: '2026-11-10' })];
  assert.equal(C.desviacionDias(acts, 60, HOY), 0);
});
test('desviación: atraso en días (el programado iguala al real hace N días)', () => {
  const acts = [act({ inicio: '2026-11-01', fin: '2026-11-10' })];
  // programado hoy 60 %; real 30 % = lo programado al 3-nov → 3 días de atraso
  assert.equal(C.desviacionDias(acts, 30, HOY), 3);
});
test('desviación: adelanto negativo y obra al 100 % → 0', () => {
  const acts = [act({ inicio: '2026-11-01', fin: '2026-11-10' })];
  assert.equal(C.desviacionDias(acts, 90, HOY), -3);
  assert.equal(C.desviacionDias(acts, 100, HOY), 0);
});
test('desviación: todo el programa vencido con real < 100 cuenta desde el fin', () => {
  const acts = [act({ inicio: '2026-10-01', fin: '2026-10-10' })];
  // programado 100 % desde el 10-oct; real 100 % se alcanzó... el real 50 % equivale al 5-oct → 32 días
  assert.equal(C.desviacionDias(acts, 50, HOY), 32);
});
test('estado de actividad (D5)', () => {
  assert.equal(C.estadoActividad(act({ avance: 100 }), HOY), 'terminada');
  assert.equal(C.estadoActividad(act({ fin: '2026-10-15', avance: 0 }), HOY), 'atrasada');
  assert.equal(C.estadoActividad(act({ avance: 20 }), HOY), 'en_curso');
  assert.equal(C.estadoActividad(act({ inicio: '2026-11-03', fin: '2026-11-20', avance: 0 }), HOY), 'en_curso');
  assert.equal(C.estadoActividad(act({ inicio: '2026-11-20', fin: '2026-11-25' }), HOY), 'proxima');
  assert.equal(C.estadoActividad(act({ hito: true, avance: 0, fin: '2026-10-01' }), HOY), 'pendiente');
  assert.equal(C.estadoActividad(act({ hito: true, avance: 100 }), HOY), 'cumplido');
});
test('semana en curso: lunes a domingo', () => {
  assert.deepEqual(C.semanaDe('2026-11-06'), { inicio: '2026-11-02', fin: '2026-11-08' });   // 6-nov-2026 es viernes
  assert.equal(C.enSemana(act({ inicio: '2026-11-08', fin: '2026-11-12' }), HOY), true);
  assert.equal(C.enSemana(act({ inicio: '2026-11-09', fin: '2026-11-12' }), HOY), false);
  assert.equal(C.enSemana(act({ inicio: '2026-10-01', fin: '2026-11-02' }), HOY), true);
});
test('grupos por partida: orden por inicio, sin partida al final, % del grupo', () => {
  const acts = [
    act({ id: 1, partida: 'Acabados', inicio: '2026-11-05', fin: '2026-11-20', peso: 30, avance: 0 }),
    act({ id: 2, partida: 'Albañilería', inicio: '2026-10-01', fin: '2026-10-20', peso: 60, avance: 100 }),
    act({ id: 3, partida: '', inicio: '2026-09-01', fin: '2026-09-02', peso: 10, avance: 50 }),
    act({ id: 4, partida: 'Albañilería', inicio: '2026-10-10', fin: '2026-10-30', peso: 0, avance: 0 }),
  ];
  const g = C.agruparPorPartida(acts, HOY);
  assert.deepEqual(g.map((x) => x.partida), ['Albañilería', 'Acabados', 'Sin partida']);
  assert.equal(g[0].real, 100);          // la de peso 0 no cuenta en el ponderado
  assert.equal(g[0].pesoPct, 60);
  assert.equal(g[0].terminadas, 1);
  assert.equal(g[0].atrasadas, 1);
  assert.equal(g[1].enCurso, 1);
});
test('cambios: extras, deductivas (también capturadas en negativo), entrega vigente y contrato', () => {
  const cambios = [
    { tipo: 'Adicional', monto: 4800, dias: 1, nueva_fecha_fin: '2026-10-30' },
    { tipo: 'Deductiva', monto: -12543.7, dias: 0, nueva_fecha_fin: '2026-10-30' },
    { tipo: 'Adicional', monto: 2402.4, dias: 0, nueva_fecha_fin: '2026-11-07' },
    { tipo: 'Extension de Tiempo', monto: 0, dias: 5, nueva_fecha_fin: null },
  ];
  const r = C.resumenCambios(cambios);
  assert.deepEqual(r, { n: 4, extras: 7202.4, deductivas: 12543.7, neto: -5341.3, dias: 6, entrega: '2026-11-07' });
  assert.equal(C.contratoVigente(100000, cambios), 94658.7);
  assert.equal(C.contratoVigente(100000, []), 100000);
});
test('entrega vigente: vencida sólo si ya pasó y la obra no terminó; reprogramada si difiere de la original', () => {
  const o = { fecha_fin: '2026-10-30', fecha_entrega_vigente: '2026-11-07', estatus: 'Activa' };
  assert.deepEqual(C.entregaVigente(o, [], '2026-11-06', 88), { fecha: '2026-11-07', vencida: false, reprogramada: false });
  assert.deepEqual(C.entregaVigente(o, [{ tipo: 'Adicional', monto: 1, nueva_fecha_fin: '2026-11-07' }], '2026-11-10', 88), { fecha: '2026-11-07', vencida: true, reprogramada: true });
  assert.equal(C.entregaVigente(o, [], '2026-11-10', 100).vencida, false);
  assert.equal(C.entregaVigente({ fecha_fin: null }, [], HOY, 10).fecha, null);
});
test('concepto corto', () => {
  assert.equal(C.conceptoCorto('Contrato LL-LS-01 — Remodelación local Luminae Studio (4 exhibiciones)'), 'Contrato LL-LS-01');
  assert.equal(C.conceptoCorto('1º pago · Anticipo 30 % contrato LL-LS-01 (Luminae Studio)'), '1º pago · Anticipo 30 % contrato LL-LS-01');
  assert.equal(C.conceptoCorto('Abono 25 % · Entrega del paquete arquitectónico (vie 18 sep)'), 'Abono 25 % · Entrega del paquete arquitectónico');
  assert.equal(C.conceptoCorto('x'.repeat(80)).length, 64);
  assert.equal(C.conceptoCorto(''), '');
});
test('frase de avance', () => {
  assert.equal(C.fraseAvance({ real: 100, hayPrograma: true }), 'La obra está terminada.');
  assert.equal(C.fraseAvance({ real: 40, hayPrograma: true, dias: 6 }), 'Vas 6 días atrasado respecto al programa.');
  assert.equal(C.fraseAvance({ real: 40, hayPrograma: true, dias: -1 }), 'Vas 1 día adelantado respecto al programa.');
  assert.equal(C.fraseAvance({ real: 40, hayPrograma: true, dias: 0 }), 'Vas al día con el programa.');
});
