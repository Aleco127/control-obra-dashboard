// node --test scripts/qa/finanzas.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../../src/js/finanzas.js');

// Fixture: una obra tipo ICHIFE 035 al 29-ago-2026 (contrato sin IVA 825,256; cobrado 267,189.24; gastos 680,913; indirectos 3,206)
const data = {
  o: [
    { id: 1, codigo_obra: 'ICH-035', nombre_obra: 'ICHIFE 035', estatus: 'Activa', subtotal: 825256, presupuesto_total: 957296.96, porcentaje_iva: 16, avance_porcentaje: 80, fecha_inicio: '2025-11-19', fecha_fin_estimada: '2026-02-19' },
    { id: 2, codigo_obra: 'LL-LS-01', nombre_obra: 'Luminae', estatus: 'Activa', subtotal: 284403.19, presupuesto_total: 329907.70, porcentaje_iva: 16, avance_porcentaje: 10, fecha_inicio: '2026-08-28', fecha_fin_estimada: '2026-10-30' }
  ],
  prc: [
    { id: 1, obra_id: 1, fecha_pago: '2025-11-20', monto: 200000 },
    { id: 2, obra_id: 1, fecha_pago: '2026-01-15', monto: 67189.24 },
    { id: 3, obra_id: 2, fecha_pago: '2026-08-28', monto: 85320.95 }
  ],
  cxc: [
    { id: 1, obra_id: 1, monto_total: 858400, monto_pendiente: 591210.76, fecha_vencimiento: '2026-03-23' },
    { id: 2, obra_id: 2, monto_total: 284403.19, monto_pendiente: 199082.24, fecha_vencimiento: '2026-10-30' }
  ],
  g: [
    { id: 10, obra_id: 1, destino: 'obra', fecha_solicitud: '2025-12-05', categoria: 'Materiales', monto_neto: 600000, monto_pagado: 600000, estatus_pago: 'Pagado' },
    { id: 11, obra_id: 1, destino: 'obra', fecha_solicitud: '2026-01-10', categoria: 'Mano de obra', monto_neto: 80913, monto_pagado: 80913, estatus_pago: 'Pagado' },
    { id: 12, obra_id: 1, destino: 'obra', fecha_solicitud: '2026-08-20', categoria: 'Materiales', monto_neto: 1500, monto_pagado: 500, estatus_pago: 'Parcial', proveedor_id: 7, aprobado_at: 'x' },
    { id: 13, obra_id: null, destino: 'indirecto', fecha_solicitud: '2026-08-01', categoria: 'Telefonía e internet', monto_neto: 399, monto_pagado: 399, estatus_pago: 'Pagado' },
    { id: 14, obra_id: 1, destino: 'obra', fecha_solicitud: '2026-08-10', categoria: 'Combustible', monto_neto: 800, monto_pagado: 800, estatus_pago: 'Pagado', pagado_por_socio_id: 1 },
    { id: 15, obra_id: null, destino: 'socio', socio_id: 2, fecha_solicitud: '2026-08-12', categoria: 'Gasto personal de socio', monto_neto: 5033, monto_pagado: 5033, estatus_pago: 'Pagado' },
    { id: 16, obra_id: 1, destino: 'obra', fecha_solicitud: '2026-08-11', categoria: 'Materiales', monto_neto: 1000, monto_pagado: 0, estatus_pago: 'Rechazado' },
    // honorarios de un socio con cargo a la utilidad de Luminae (no es costo de la obra)
    { id: 17, obra_id: 2, destino: 'socio', socio_tipo: 'utilidad', socio_id: 2, fecha_solicitud: '2026-09-01', categoria: 'Honorarios de socio', monto_neto: 5000, monto_pagado: 5000, estatus_pago: 'Pagado' }
  ],
  ppv: [{ id: 1, gasto_id: 12, obra_id: 1, proveedor_id: 7, fecha_pago: '2026-08-25', monto: 500 }],
  gad: [{ gasto_id: 13, obra_id: 1, porcentaje: 100, monto_asignado: 399 }],
  nom: [{ id: 1, estatus: 'Pagado', fecha_pago: '2026-08-15', total_pagar: 7000 }],
  nomd: [],
  soc: [{ id: 1, nombre: 'Ricardo', porcentaje: 50, activo: true }, { id: 2, nombre: 'Daniel', porcentaje: 50, activo: true }],
  msoc: [
    { id: 1, socio_id: 1, tipo: 'aportacion', gasto_id: 14, fecha: '2026-08-10', monto: 800 },
    { id: 2, socio_id: 2, tipo: 'gasto_personal', gasto_id: 15, fecha: '2026-08-12', monto: 5033 },
    { id: 3, socio_id: 1, tipo: 'retiro', fecha: '2026-08-20', monto: 10000 },
    { id: 4, socio_id: 2, tipo: 'anticipo_utilidad', gasto_id: 17, obra_id: 2, fecha: '2026-09-01', monto: 5000 }
  ],
  catg: [{ nombre: 'Materiales', naturaleza: 'directo' }, { nombre: 'Telefonía e internet', naturaleza: 'indirecto' }, { nombre: 'Gasto personal de socio', naturaleza: 'personal' }, { nombre: 'Mano de obra', naturaleza: 'directo' }, { nombre: 'Combustible', naturaleza: 'directo' }],
  pv: [{ id: 7, nombre_proveedor: 'Home Depot', dias_credito: 0 }],
  cot: []
};

test('rango(): mes, trimestre, año', () => {
  assert.deepEqual(F.rango('mes', '2026-08-29').desde, '2026-08-01');
  assert.equal(F.rango('mes', '2026-08-29').hasta, '2026-08-31');
  assert.equal(F.rango('trim', '2026-08-29').desde, '2026-07-01');
  assert.equal(F.rango('trim', '2026-08-29').hasta, '2026-09-30');
  assert.equal(F.rango('anio', '2026-08-29').hasta, '2026-12-31');
  assert.equal(F.rango('2026-02').hasta, '2026-02-28');
});

test('cuentasPorPagar: sólo saldo > 0, no rechazados, no socios, no pagados por socio', () => {
  const cxp = F.cuentasPorPagar({ data });
  assert.equal(cxp.length, 1);
  assert.equal(cxp[0].gasto.id, 12);
  assert.equal(cxp[0].saldo, 1000);
  const ag = F.agingPagar(cxp);
  assert.equal(ag.total, 1000);
});

test('calcularFlujo agosto 2026: cobrado, pagado (gasto sin pago explícito no se duplica con el pago), nómina, retiros, aportaciones', () => {
  const f = F.calcularFlujo({ desde: '2026-08-01', hasta: '2026-08-31', data });
  assert.equal(f.cobrado, 85320.95);
  // pagosProv 500 (gasto 12 tiene pago explícito → no se suma su monto_pagado 0) + gasto 13 (399) + gasto 15 personal pagado por la empresa (5033); gasto 14 lo pagó un socio (no sale de caja)
  assert.equal(f.pagosProv, 500);
  assert.equal(f.gastosPagados, 399 + 5033);
  assert.equal(f.nomina, 7000);
  assert.equal(f.retiros, 10000);
  assert.equal(f.porSocios, 800);
  assert.equal(f.pagado, 500 + 399 + 5033 + 7000 + 10000);
  assert.equal(f.neto, F.r2(85320.95 - f.pagado));
  assert.equal(f.porCobrar, F.r2(591210.76 + 199082.24));
  assert.equal(f.porPagar, 1000);
});

test('calcularFlujo por obra excluye nómina, retiros e indirectos', () => {
  const f = F.calcularFlujo({ desde: '2025-01-01', hasta: '2026-12-31', obraIds: [1], data });
  assert.equal(f.cobrado, 267189.24);
  assert.equal(f.nomina, 0);
  assert.equal(f.retiros, 0);
  assert.equal(f.pagado, F.r2(500 + 600000 + 80913));
});

test('resultadoObra ICHIFE 035: costos, indirectos, margen y semáforo', () => {
  const r = F.resultadoObra(1, { data, hasta: '2026-08-29' });
  assert.equal(r.contrato, 825256);
  assert.equal(r.cobrado, 267189.24);
  assert.equal(r.porCobrar, 591210.76);
  assert.equal(r.vencido, 591210.76);
  // directo: 600000 + 80913 + 1500 + 800 (el rechazado no cuenta)
  assert.equal(r.directo, 683213);
  assert.equal(r.indirectos, 399);
  assert.equal(r.costoTotal, 683612);
  assert.equal(r.avance, 80);
  assert.equal(r.ingresoDevengado, F.r2(825256 * 0.8));
  assert.equal(r.utilidadProyectada, F.r2(825256 - 683612));
  assert.equal(r.margenDevengado, F.r2((660204.8 - 683612) / 660204.8 * 100));
  assert.equal(r.semaforo, 'danger');
  assert.ok(/Costo al/.test(r.causa));
  // caja de la obra: cobrado − pagado por la empresa (600000+80913+500 del pago; el gasto 14 lo pagó un socio)
  assert.equal(r.pagadoEmpresa, F.r2(600000 + 80913 + 500));
});

test('resultadoObra Luminae: margen sano en verde', () => {
  const r = F.resultadoObra(2, { data, hasta: '2026-08-29' });
  assert.equal(r.costoTotal, 0);
  assert.equal(r.semaforo, 'ok');
});

test('estadoResultados agosto (caja)', () => {
  const e = F.estadoResultados({ desde: '2026-08-01', hasta: '2026-08-31', data });
  assert.equal(e.ingresos, 85320.95);
  // directos de agosto: gasto 12 (1500) + gasto 14 (800); el rechazado no
  assert.equal(e.directos, 2300);
  assert.equal(e.indirectosTotal, 399);
  assert.equal(e.nominaNoAsignada, 7000);
  assert.equal(e.utilidadNeta, F.r2(85320.95 - 2300 - 399 - 7000));
  assert.equal(e.personales, 5033);
  assert.equal(e.retiros, 10000);
});

test('prorratear: iguales y por contrato suman 100 % y el monto exacto', () => {
  const eq = F.prorratear({ desde: '2026-08-01', hasta: '2026-08-31', regla: { tipo: 'iguales' }, data });
  assert.equal(eq.length, 2);
  assert.equal(eq.reduce((s, x) => s + x.porcentaje, 0), 100);
  assert.equal(F.r2(eq.reduce((s, x) => s + x.monto_asignado, 0)), 399);
  const ct = F.prorratear({ desde: '2026-08-01', hasta: '2026-08-31', regla: { tipo: 'contrato' }, data });
  assert.equal(ct.find(x => x.obra_id === 1).porcentaje, F.r2(825256 / (825256 + 284403.19) * 100));
  const fj = F.prorratear({ desde: '2026-08-01', hasta: '2026-08-31', regla: { tipo: 'fijo', fijos: { 1: 70, 2: 30 } }, data });
  assert.equal(fj.find(x => x.obra_id === 2).porcentaje, 30);
});

test('baseReparto: reservas y a pagar por socio con retiros y aportaciones a cuenta', () => {
  const b = F.baseReparto({ desde: '2026-08-01', hasta: '2026-08-31', reservas: { impuestos: 30, capital: 10 }, data });
  assert.equal(b.utilidad, F.r2(85320.95 - 2300 - 399 - 7000));
  assert.equal(b.distribuible, F.r2(b.utilidad - b.reservas.impuestos - b.reservas.capital));
  const ric = b.filas.find(f => f.socio.id === 1), dan = b.filas.find(f => f.socio.id === 2);
  assert.equal(ric.asignado, F.r2(b.distribuible * 0.5));
  assert.equal(ric.aCuenta, 10000);
  assert.equal(ric.aportado, 800);
  assert.equal(ric.aPagar, F.r2(ric.asignado - 10000 + 800));
  assert.equal(dan.aCuenta, 5033);
});

test('baseReparto: lo cobrado en efectivo va exento de la reserva para impuestos; capital de trabajo siempre', () => {
  const d2 = JSON.parse(JSON.stringify(data));
  // agosto: cobro 3 (85,320.95) en efectivo → 100 % exento
  d2.prc[2].metodo_pago = 'Efectivo';
  const b = F.baseReparto({ desde: '2026-08-01', hasta: '2026-08-31', reservas: { impuestos: 30, capital: 10 }, data: d2 });
  assert.equal(b.reservas.cobrado, 85320.95);
  assert.equal(b.reservas.efectivo, 85320.95);
  assert.equal(b.reservas.pctGravable, 0);
  assert.equal(b.reservas.impuestos, 0);
  assert.equal(b.reservas.capital, F.r2(b.utilidad * 0.10));
  assert.equal(b.distribuible, F.r2(b.utilidad - b.reservas.capital));
  // mitad efectivo → 50 % gravable
  d2.prc.push({ id: 9, obra_id: 2, fecha_pago: '2026-08-29', monto: 85320.95, metodo_pago: 'Transferencia' });
  const b2 = F.baseReparto({ desde: '2026-08-01', hasta: '2026-08-31', reservas: { impuestos: 30, capital: 10 }, data: d2 });
  assert.equal(b2.reservas.pctGravable, 50);
  assert.equal(b2.reservas.impuestos, F.r2(b2.utilidad * 0.30 * 0.5));
  // regla desactivada → todo gravable
  const b3 = F.baseReparto({ desde: '2026-08-01', hasta: '2026-08-31', reservas: { impuestos: 30, capital: 10, efectivo_exento: false }, data: d2 });
  assert.equal(b3.reservas.pctGravable, 100);
});

test('honorarios de socio con cargo a la utilidad de una obra: no son costo, restan de la utilidad disponible y se descuentan sólo en el reparto de esa obra', () => {
  const r = F.resultadoObra(2, { data });
  assert.equal(r.nGastos, 0);                       // el gasto 17 no entra al costo de la obra
  assert.equal(r.costoTotal, 0);
  assert.equal(r.anticiposSocios, 5000);
  assert.deepEqual(r.anticiposPorSocio, { Daniel: 5000 });
  assert.equal(r.utilidadDisponible, F.r2(r.utilidadCaja - 5000));
  assert.equal(r.caja, F.r2(85320.95 - 5000));
  const b = F.baseReparto({ obraId: 2, reservas: { impuestos: 30, capital: 10 }, data });
  const ric = b.filas.find(f => f.socio.id === 1), dan = b.filas.find(f => f.socio.id === 2);
  assert.equal(dan.aCuenta, 5000);                  // se le descuenta a Daniel en el reparto de Luminae
  assert.equal(ric.aCuenta, 0);                     // el retiro de Ricardo sin obra no se cobra a esta obra
  assert.equal(dan.aPagar, F.r2(dan.asignado - 5000));
  const e = F.estadoResultados({ desde: '2026-09-01', hasta: '2026-09-30', data });
  assert.equal(e.anticipos, 5000);
  assert.equal(e.personales, 0);
});
