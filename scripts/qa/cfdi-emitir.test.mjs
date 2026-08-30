// Pruebas US-231 y US-232: armado del CFDI 4.0 de ingreso y lectura del certificado de sello digital.
// Ejecutar: node --test scripts/qa/cfdi-emitir.test.mjs
// El .cer de fixtures se generó con openssl imitando un CSD del SAT (serie de 20 dígitos en ASCII y el RFC en el subject).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construirCfdi, validarReceptor, impuestosConcepto, humanizarPac, rfcValido } from '../../supabase/functions/cfdi-emitir/cfdi-payload.js';
import { leerCertificado, revisarCsd } from '../../supabase/functions/pac-config/certificado.js';

const EMISOR = { rfc: 'SAR250213IS1', nombre: 'Supernova Arquitectos', regimen: '601', cp: '31000' };
const RECEPTOR = { rfc: 'RSS2202108U5', nombre: 'Radial Software Solutions', regimen: '601', cp: '78116', uso: 'G03' };
const base = (extra) => Object.assign({ emisor: EMISOR, receptor: RECEPTOR, serie: 'A', folio: 7, conceptos: [{ descripcion: 'Estimación 3 de obra', claveProdServ: '72141500', claveUnidad: 'E48', cantidad: 1, valorUnitario: 120000 }] }, extra || {});

test('CFDI de ingreso PUE con IVA 16 %: totales cuadrados y estructura del PAC', () => {
  const r = construirCfdi(base({ formaPago: '03', metodoPago: 'PUE' }));
  assert.deepEqual(r.errores, []);
  assert.equal(r.cfdi.CfdiType, 'I');
  assert.equal(r.cfdi.Exportation, '01');
  assert.equal(r.cfdi.Serie, 'A');
  assert.equal(r.cfdi.Folio, '7');
  assert.equal(r.cfdi.ExpeditionPlace, '31000');
  assert.equal(r.cfdi.Issuer.Rfc, 'SAR250213IS1');
  assert.equal(r.cfdi.Receiver.Rfc, 'RSS2202108U5');
  assert.equal(r.cfdi.Receiver.TaxZipCode, '78116');
  const it = r.cfdi.Items[0];
  assert.equal(it.TaxObject, '02');
  assert.equal(it.Subtotal, 120000);
  assert.equal(it.Taxes.length, 1);
  assert.equal(it.Taxes[0].Total, 19200);
  assert.equal(it.Taxes[0].Rate, 0.16);
  assert.equal(it.Total, 139200);
  assert.deepEqual(r.totales, { subtotal: 120000, iva: 19200, ivaRetenido: 0, isrRetenido: 0, total: 139200 });
});

test('Obra exenta de IVA: sin impuesto trasladado y ObjetoImp 01, no tasa cero', () => {
  const r = construirCfdi(base({ modoIva: 'exento' }));
  assert.deepEqual(r.errores, []);
  assert.equal(r.cfdi.Items[0].TaxObject, '01');
  assert.equal(r.cfdi.Items[0].Taxes, undefined);
  assert.equal(r.totales.iva, 0);
  assert.equal(r.totales.total, 120000);
});

test('Tasa 0 % sí lleva el impuesto desglosado en cero', () => {
  const r = construirCfdi(base({ modoIva: '0' }));
  assert.equal(r.cfdi.Items[0].TaxObject, '02');
  assert.equal(r.cfdi.Items[0].Taxes[0].Rate, 0);
  assert.equal(r.cfdi.Items[0].Taxes[0].Total, 0);
  assert.equal(r.totales.total, 120000);
});

test('Retenciones de persona física: ISR 10 % e IVA 2/3 restan del total', () => {
  const r = construirCfdi(base({ isrRetenido: 10, ivaRetenido: 10.666667 }));
  assert.equal(r.totales.subtotal, 120000);
  assert.equal(r.totales.iva, 19200);
  assert.equal(r.totales.isrRetenido, 12000);
  assert.equal(r.totales.ivaRetenido, 12800);
  assert.equal(r.totales.total, 114400);
  const ret = r.cfdi.Items[0].Taxes.filter((t) => t.IsRetention);
  assert.equal(ret.length, 2);
});

test('Cada concepto se redondea a dos decimales antes de sumar', () => {
  const r = construirCfdi(base({ conceptos: [
    { descripcion: 'Muro de block', claveUnidad: 'MTK', cantidad: 3, valorUnitario: 33.333 },
    { descripcion: 'Firme de concreto', claveUnidad: 'MTK', cantidad: 7, valorUnitario: 12.345 }
  ] }));
  assert.equal(r.cfdi.Items[0].Subtotal, 100);      // 99.999 → 100.00
  assert.equal(r.cfdi.Items[1].Subtotal, 86.42);    // 86.415 → 86.42
  assert.equal(r.totales.subtotal, 186.42);
  assert.equal(r.totales.iva, 29.83);
  assert.equal(r.totales.total, 216.25);
});

test('PPD exige forma de pago 99 y PUE toma transferencia por omisión', () => {
  assert.match(construirCfdi(base({ metodoPago: 'PPD', formaPago: '03' })).errores[0], /99/);
  assert.equal(construirCfdi(base({ metodoPago: 'PPD' })).cfdi.PaymentForm, '99');
  assert.equal(construirCfdi(base({})).cfdi.PaymentForm, '03');
});

test('El receptor se revisa contra el catálogo del SAT antes de gastar un timbre', () => {
  assert.equal(validarReceptor(RECEPTOR).length, 0);
  assert.match(validarReceptor({ ...RECEPTOR, rfc: 'ABC12' })[0], /formato del SAT/);
  assert.match(validarReceptor({ ...RECEPTOR, cp: '781' })[0], /5 d[ií]gitos/);
  // 605 es de persona física y el RFC es de empresa (12 caracteres)
  assert.match(validarReceptor({ ...RECEPTOR, regimen: '605' })[0], /persona f[ií]sica/);
  // 601 es de empresa y el RFC es de persona física (13 caracteres)
  assert.match(validarReceptor({ rfc: 'COGR900101AB2', nombre: 'Ricardo Corral', cp: '31000', regimen: '601', uso: 'G03' })[0], /empresa/);
  assert.equal(validarReceptor({ rfc: 'XAXX010101000', nombre: 'PUBLICO EN GENERAL', cp: '31000', regimen: '616', uso: 'S01' }).length, 0);
  assert.match(validarReceptor({ rfc: 'XAXX010101000', nombre: 'PUBLICO EN GENERAL', cp: '31000', regimen: '616', uso: 'G03' })[0], /S01/);
});

test('rfcValido acepta 12 y 13 caracteres y rechaza lo demás', () => {
  assert.ok(rfcValido('SAR250213IS1'));
  assert.ok(rfcValido('COGR900101AB2'));
  assert.ok(!rfcValido('SAR2502'));
  assert.ok(!rfcValido('SAR250213IS12'));
});

test('impuestosConcepto no inventa impuestos cuando no hay retención', () => {
  const i = impuestosConcepto(1000, { modoIva: '16' });
  assert.equal(i.taxes.length, 1);
  assert.equal(i.iva, 160);
  assert.equal(i.ivaRet, 0);
});

test('Los errores del SAT se cuentan en español llano', () => {
  assert.match(humanizarPac('CFDI40147 El campo LugarExpedicion no coincide'), /c[oó]digo postal/i);
  assert.match(humanizarPac('Facturama 401: Unauthorized'), /cuenta del proveedor/i);
  assert.match(humanizarPac('El certificado no está cargado'), /sello digital/i);
});

test('El .cer del SAT entrega serie, vigencia y RFC', () => {
  const cer = readFileSync(new URL('./fixtures/csd_prueba.cer', import.meta.url));
  const info = leerCertificado(new Uint8Array(cer));
  assert.equal(info.serie, '30001000000500003456');
  assert.equal(info.serie.length, 20);
  assert.match(info.vigenciaIni, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(info.vigenciaFin, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(info.vigenciaFin > info.vigenciaIni);
  assert.equal(info.rfc, 'SAR250213IS1');
  assert.deepEqual(revisarCsd(info, 'SAR250213IS1'), []);
  assert.match(revisarCsd(info, 'COGR900101AB2')[0], /es del RFC/);
  assert.match(revisarCsd(null, 'SAR250213IS1')[0], /no se pudo leer/);
});

// --- Prellenado de la factura desde el documento que la origina (src/js/facturacion.js) ---
// El módulo es del navegador: se le ponen los globales mínimos y se ejercita la función pura.
globalThis.D = {
  pac: [{ activo: true, csd_registrado_at: '2026-08-30T00:00:00Z', serie_default: 'A', concepto_default: 'Servicios de construcción', clave_prodserv_default: '72141500', clave_unidad_default: 'E48', uso_cfdi_default: 'G03' }],
  o: [{ id: 5, nombre_obra: 'Casa Ortiz Mena', cliente_id: 9, porcentaje_iva: 16 }, { id: 6, nombre_obra: 'Casa habitación', cliente_id: 9, porcentaje_iva: 0 }],
  est: [{ id: 40, obra_id: 5, numero_estimacion: 3, periodo_inicio: '2026-08-01', periodo_fin: '2026-08-31', subtotal: 120000, porcentaje_iva: 16 }],
  prc: [{ id: 77, obra_id: 5, monto: 116000, metodo_pago: 'Transferencia', concepto: 'Anticipo', numero_pago: 'PR-001', cuenta_cobrar_id: 3 }],
  cxc: [{ id: 12, estimacion_id: 40 }],
  cli: []
};
const { createRequire: cr } = await import('node:module');
const Facturacion = cr(import.meta.url)('../../src/js/facturacion.js');

test('Facturar una estimación: PPD, forma 99 y la base sin IVA', () => {
  const b = Facturacion.prellenar({ origen: 'estimacion', estimacion_id: 40 });
  assert.equal(b.metodo, 'PPD');
  assert.equal(b.forma, '99');
  assert.equal(b.modoIva, '16');
  assert.equal(b.obra_id, 5);
  assert.equal(b.cuenta_cobrar_id, 12);
  assert.equal(b.conceptos[0].precio, 120000);
  assert.match(b.conceptos[0].descripcion, /Estimación 3 · Casa Ortiz Mena/);
});

test('Facturar un cobro: PUE, forma según cómo pagaron y el monto se baja a base', () => {
  const b = Facturacion.prellenar({ origen: 'cobro', pago_recibido_id: 77 });
  assert.equal(b.metodo, 'PUE');
  assert.equal(b.forma, '03');            // Transferencia
  assert.equal(b.conceptos[0].precio, 100000); // 116,000 con IVA → 100,000 de base
  assert.equal(b.pago_recibido_id, 77);
});

test('Obra sin IVA: la factura se prellena como exenta', () => {
  globalThis.D.prc.push({ id: 78, obra_id: 6, monto: 500000, metodo_pago: 'Cheque', concepto: 'Pago' });
  const b = Facturacion.prellenar({ origen: 'cobro', pago_recibido_id: 78 });
  assert.equal(b.modoIva, 'exento');
  assert.equal(b.forma, '02');
  assert.equal(b.conceptos[0].precio, 500000); // exenta: no se le quita IVA
});
