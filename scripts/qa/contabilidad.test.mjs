// Prueba US-241: pólizas cuadradas (cargos = abonos) y formato CONTPAQi.
// Ejecutar: node --test scripts/qa/contabilidad.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.Finanzas = require('../../src/js/finanzas.js');
const Contabilidad = require('../../src/js/contabilidad.js');

const cuentas = ['bancos', 'caja', 'clientes', 'proveedores', 'iva_acreditable', 'iva_trasladado', 'ingresos', 'costo_directo', 'indirectos', 'nomina', 'socios_aportaciones', 'socios_retiros', 'costo:Materiales'].map((rol, i) => ({ rol, cuenta: `${100 + i}.01`, nombre: rol }));
const D = {
  cta: cuentas,
  o: [{ id: 1, codigo_obra: 'OB-1', nombre_obra: 'Casa' }],
  pv: [{ id: 5, nombre_proveedor: 'Cemex' }],
  soc: [{ id: 9, nombre: 'Ricardo' }],
  e: [{ id: 3, nombre_completo: 'Juan Pérez' }],
  prc: [{ id: 1, numero_pago: 'PR-1', fecha_pago: '2026-08-05', monto: 11600, obra_id: 1, metodo_pago: 'Transferencia', concepto: 'Anticipo', factura_numero: 'UUID-1' }],
  cfdi: [{ id: 1, fecha_emision: '2026-08-04', serie: 'A', folio: '12', subtotal: 10000, iva: 1600, total: 11600, uuid: 'UUID-1', obra_id: 1 }],
  g: [
    { id: 1, fecha_solicitud: '2026-08-10', descripcion: 'Cemento', categoria: 'Materiales', obra_id: 1, destino: 'obra', proveedor_id: 5, subtotal: 5000, iva: 800, monto_neto: 5800, comprobacion: 'facturado', folio_fiscal: 'UUID-P1', estatus_pago: 'Pagado' },
    { id: 2, fecha_solicitud: '2026-08-12', descripcion: 'Papelería', destino: 'indirecto', monto_neto: 300, comprobacion: 'ticket', estatus_pago: 'Pagado', pagado_por_socio_id: 9 },
    { id: 3, fecha_solicitud: '2026-08-12', descripcion: 'Comida socio', destino: 'socio', monto_neto: 900, estatus_pago: 'Pagado' },
    { id: 4, fecha_solicitud: '2026-07-30', descripcion: 'Mes anterior', destino: 'obra', obra_id: 1, monto_neto: 100, estatus_pago: 'Pagado' },
  ],
  ppv: [{ id: 1, numero_pago: 'PP-1', fecha_pago: '2026-08-15', monto: 5800, proveedor_id: 5, gasto_id: 1, metodo_pago: 'Transferencia', referencia: '778' }],
  nom: [{ id: 1, empleado_id: 3, fecha_pago: '2026-08-14', total_pagar: 4200, periodo_inicio: '2026-08-01', periodo_fin: '2026-08-14' }],
  msoc: [{ id: 1, socio_id: 9, fecha: '2026-08-02', tipo: 'aportacion', monto: 20000 }, { id: 2, socio_id: 9, fecha: '2026-08-20', tipo: 'retiro', monto: 5000 }],
  fcfg: {},
};

test('genera pólizas del mes cuadradas y sólo del periodo', () => {
  const { polizas, faltantes } = Contabilidad.generar('2026-08', D);
  assert.equal(faltantes.size, 0, [...faltantes].join(','));
  assert.equal(polizas.length, 8); // cobro, factura, gasto 1, gasto 2, pago, nómina, aportación, retiro
  for (const p of polizas) {
    const c = p.movs.reduce((s, m) => s + m.cargo, 0), a = p.movs.reduce((s, m) => s + m.abono, 0);
    assert.ok(Math.abs(c - a) < 0.01, `${p.concepto}: cargos ${c} vs abonos ${a}`);
    assert.ok(p.fecha >= '2026-08-01' && p.fecha <= '2026-08-31');
  }
  const gasto = polizas.find(p => /Cemento/.test(p.concepto));
  assert.ok(gasto.movs.some(m => m.rol === 'costo:Materiales' && m.cargo === 5000));
  assert.ok(gasto.movs.some(m => m.rol === 'iva_acreditable' && m.cargo === 800));
  assert.ok(gasto.movs.some(m => m.rol === 'proveedores' && m.abono === 5800 && m.uuid === 'UUID-P1'));
  const socio = polizas.find(p => /Papeler/.test(p.concepto));
  assert.ok(socio.movs.some(m => m.rol === 'socios_aportaciones' && m.abono === 300));
  assert.ok(!polizas.some(p => /Comida socio|Mes anterior/.test(p.concepto)));
  const numsIngresos = polizas.filter(p => p.tipo === 1).map(p => p.numero);
  assert.deepEqual(numsIngresos, [1, 2]);
});

test('formato CONTPAQi: líneas P, M y CFDI con anchos fijos', () => {
  const { polizas } = Contabilidad.generar('2026-08', D);
  const txt = Contabilidad.contpaqi(polizas);
  const lineas = txt.split('\r\n').filter(Boolean);
  assert.ok(lineas[0].startsWith('P  20260802  1  000001  0  '));
  const m = lineas.find(l => l.startsWith('M  '));
  assert.equal(m.slice(3, 23).length, 20);
  assert.match(m, /^M  .{20}  .{10}  [01]  {0,19}\d+\.\d{2}  {5}  /);
  assert.ok(lineas.some(l => l === 'CFDI  UUID-1'));
});

test('cuentas faltantes se reportan sin romper', () => {
  const { polizas, faltantes } = Contabilidad.generar('2026-08', { ...D, cta: D.cta.filter(c => c.rol !== 'nomina') });
  assert.ok(faltantes.has('nomina'));
  assert.ok(polizas.some(p => p.movs.some(m => m.rol === 'nomina' && m.cuenta === '')));
});
