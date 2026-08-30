// Reglas del SAT para armar un CFDI 4.0 de ingreso. Módulo puro (sin red ni Deno): lo importa la Edge Function
// cfdi-emitir y lo ejercitan las pruebas de scripts/qa/cfdi-emitir.test.mjs. US-232.
//
// Decisiones que vale la pena recordar:
//  - El navegador nunca arma el comprobante: manda datos de negocio y aquí se convierten a la estructura del PAC.
//  - El IVA de una obra puede ser 16 %, 0 % o exento. Exento NO es tasa cero: va sin impuesto y con ObjetoImp 01,
//    que es el caso de los servicios de construcción de casa habitación (art. 9 LIVA).
//  - Los importes se redondean a dos decimales concepto por concepto, como lo valida el SAT.

export const RE_RFC = /^([A-ZÑ&]{3,4})\d{6}[A-Z\d]{3}$/;
export const RFC_GENERICO = 'XAXX010101000';
export const RFC_EXTRANJERO = 'XEXX010101000';

// Regímenes por tipo de persona (catálogo c_RegimenFiscal). 12 caracteres = moral, 13 = física.
const REGIMENES_MORAL = ['601', '603', '610', '620', '622', '623', '624', '626', '628', '629', '630'];
const REGIMENES_FISICA = ['605', '606', '608', '610', '611', '612', '614', '615', '616', '621', '622', '625', '626', '629', '630'];

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const limpio = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

export function rfcValido(rfc) {
  const r = limpio(rfc).toUpperCase();
  return (r.length === 12 || r.length === 13) && RE_RFC.test(r);
}
export function esMoral(rfc) { return limpio(rfc).length === 12; }

/** Revisa el receptor contra el catálogo del SAT antes de gastar un timbre. Devuelve [] si todo está bien. */
export function validarReceptor(rec) {
  const errores = [];
  const rfc = limpio(rec && rec.rfc).toUpperCase();
  if (!rfcValido(rfc)) errores.push('El RFC del cliente no tiene el formato del SAT (12 caracteres para empresa, 13 para persona física).');
  if (!limpio(rec && rec.nombre)) errores.push('Falta el nombre o razón social del cliente, tal como aparece en su constancia de situación fiscal.');
  const cp = limpio(rec && rec.cp);
  if (!/^\d{5}$/.test(cp)) errores.push('El código postal del cliente debe tener 5 dígitos.');
  const reg = limpio(rec && rec.regimen);
  if (!/^\d{3}$/.test(reg)) {
    errores.push('Falta el régimen fiscal del cliente.');
  } else if (rfc === RFC_GENERICO) {
    if (reg !== '616') errores.push('El público en general (XAXX010101000) sólo admite el régimen 616.');
  } else if (rfcValido(rfc)) {
    const lista = esMoral(rfc) ? REGIMENES_MORAL : REGIMENES_FISICA;
    if (lista.indexOf(reg) < 0) {
      errores.push(esMoral(rfc)
        ? 'El régimen ' + reg + ' es de persona física y el RFC del cliente es de empresa.'
        : 'El régimen ' + reg + ' es de empresa y el RFC del cliente es de persona física.');
    }
  }
  if (rfc === RFC_GENERICO && limpio(rec && rec.uso) !== 'S01') errores.push('Al público en general se le factura con uso de CFDI S01.');
  return errores;
}

/** Impuestos de un concepto. modoIva: '16' | '0' | 'exento'. Retenciones en porcentaje (0 = sin retención). */
export function impuestosConcepto(base, opciones) {
  const o = opciones || {};
  const modo = String(o.modoIva == null ? '16' : o.modoIva);
  const taxes = [];
  let iva = 0, ivaRet = 0, isrRet = 0;
  if (modo !== 'exento') {
    const tasa = modo === '0' ? 0 : (Number(modo) || 0) / 100;
    iva = r2(base * tasa);
    taxes.push({ Name: 'IVA', Rate: Number(tasa.toFixed(6)), Total: iva, Base: r2(base), IsRetention: false, IsFederalTax: true });
  }
  const tIvaRet = (Number(o.ivaRetenido) || 0) / 100;
  if (tIvaRet > 0) {
    ivaRet = r2(base * tIvaRet);
    taxes.push({ Name: 'IVA', Rate: Number(tIvaRet.toFixed(6)), Total: ivaRet, Base: r2(base), IsRetention: true, IsFederalTax: true });
  }
  const tIsr = (Number(o.isrRetenido) || 0) / 100;
  if (tIsr > 0) {
    isrRet = r2(base * tIsr);
    taxes.push({ Name: 'ISR', Rate: Number(tIsr.toFixed(6)), Total: isrRet, Base: r2(base), IsRetention: true, IsFederalTax: true });
  }
  // ObjetoImp: 01 = no objeto de impuesto (exento), 02 = sí objeto
  return { taxes: taxes, objeto: modo === 'exento' ? '01' : '02', iva: iva, ivaRet: ivaRet, isrRet: isrRet };
}

/**
 * Arma el JSON del CFDI de ingreso para el PAC multiemisor y de paso devuelve los totales ya cuadrados.
 * datos: { emisor:{rfc,nombre,regimen,cp}, receptor:{rfc,nombre,regimen,cp,uso},
 *          conceptos:[{descripcion,claveProdServ,claveUnidad,unidad,cantidad,valorUnitario,noIdentificacion}],
 *          serie, folio, formaPago, metodoPago, modoIva, ivaRetenido, isrRetenido, fecha, condiciones }
 */
export function construirCfdi(datos) {
  const d = datos || {};
  const errores = validarReceptor(d.receptor || {});
  const emisor = d.emisor || {};
  if (!rfcValido(emisor.rfc)) errores.push('El RFC de tu empresa no tiene el formato del SAT.');
  if (!/^\d{5}$/.test(limpio(emisor.cp))) errores.push('Falta el código postal de expedición de tu empresa.');
  if (!/^\d{3}$/.test(limpio(emisor.regimen))) errores.push('Falta el régimen fiscal de tu empresa.');
  const conceptos = (d.conceptos || []).filter((c) => c && limpio(c.descripcion) && (Number(c.cantidad) || 0) > 0);
  if (!conceptos.length) errores.push('Agrega al menos un concepto con descripción y cantidad.');
  const metodo = limpio(d.metodoPago) || 'PUE';
  if (metodo !== 'PUE' && metodo !== 'PPD') errores.push('El método de pago debe ser PUE o PPD.');
  const forma = limpio(d.formaPago) || (metodo === 'PPD' ? '99' : '03');
  if (metodo === 'PPD' && forma !== '99') errores.push('Una factura PPD se emite con forma de pago 99 (por definir).');
  if (errores.length) return { errores: errores };

  let subtotal = 0, iva = 0, ivaRet = 0, isrRet = 0;
  const items = conceptos.map((c) => {
    const cantidad = Number(c.cantidad) || 0;
    const pu = Number(c.valorUnitario) || 0;
    const importe = r2(cantidad * pu);
    const imp = impuestosConcepto(importe, d);
    subtotal += importe; iva += imp.iva; ivaRet += imp.ivaRet; isrRet += imp.isrRet;
    const item = {
      ProductCode: limpio(c.claveProdServ) || '72141500',
      Description: limpio(c.descripcion).slice(0, 1000),
      Unit: limpio(c.unidad) || 'Unidad de servicio',
      UnitCode: (limpio(c.claveUnidad) || 'E48').toUpperCase(),
      UnitPrice: pu,
      Quantity: cantidad,
      Subtotal: importe,
      TaxObject: imp.objeto,
      Total: r2(importe + imp.iva - imp.ivaRet - imp.isrRet)
    };
    if (limpio(c.noIdentificacion)) item.IdentificationNumber = limpio(c.noIdentificacion).slice(0, 100);
    if (imp.taxes.length) item.Taxes = imp.taxes;
    return item;
  });
  subtotal = r2(subtotal); iva = r2(iva); ivaRet = r2(ivaRet); isrRet = r2(isrRet);
  const total = r2(subtotal + iva - ivaRet - isrRet);

  const cfdi = {
    CfdiType: 'I',
    Currency: 'MXN',
    Exportation: '01',
    ExpeditionPlace: limpio(emisor.cp),
    PaymentForm: forma,
    PaymentMethod: metodo,
    Issuer: { FiscalRegime: limpio(emisor.regimen), Name: limpio(emisor.nombre).toUpperCase(), Rfc: limpio(emisor.rfc).toUpperCase() },
    Receiver: {
      Rfc: limpio(d.receptor.rfc).toUpperCase(),
      Name: limpio(d.receptor.nombre).toUpperCase(),
      CfdiUse: limpio(d.receptor.uso) || 'G03',
      FiscalRegime: limpio(d.receptor.regimen),
      TaxZipCode: limpio(d.receptor.cp)
    },
    Items: items
  };
  if (limpio(d.serie)) cfdi.Serie = limpio(d.serie).toUpperCase();
  if (d.folio) cfdi.Folio = String(d.folio);
  if (limpio(d.fecha)) cfdi.Date = limpio(d.fecha);
  if (limpio(d.condiciones)) cfdi.PaymentConditions = limpio(d.condiciones).slice(0, 1000);

  return { cfdi: cfdi, totales: { subtotal: subtotal, iva: iva, ivaRetenido: ivaRet, isrRetenido: isrRet, total: total }, errores: [] };
}

/** Traduce a español llano lo que contesta el PAC o el SAT. */
export function humanizarPac(mensaje) {
  const m = String(mensaje == null ? '' : mensaje);
  // El 401 se busca aislado: los códigos del SAT como CFDI40147 llevan "401" dentro.
  if (/(^|\s)401(\D|$)|unauthorized|credencial/i.test(m)) return 'La cuenta del proveedor de timbrado no está configurada o la contraseña cambió. Avísanos para revisarla.';
  if (/CFDI40147|c[oó]digo\s*postal|LugarExpedicion/i.test(m)) return 'El código postal no coincide con el que el SAT tiene registrado. Revisa el CP de tu empresa o el del cliente en su constancia de situación fiscal.';
  if (/CFDI40158|CFDI40157|r[eé]gimen/i.test(m)) return 'El régimen fiscal no corresponde al RFC. Cópialo tal cual de la constancia de situación fiscal del cliente.';
  if (/CFDI40102|CFDI40101|RFC/i.test(m)) return 'El SAT no reconoce ese RFC. Revísalo en la constancia de situación fiscal del cliente.';
  if (/CFDI40161|nombre.*receptor|raz[oó]n social/i.test(m)) return 'El nombre del cliente debe escribirse igual que en su constancia de situación fiscal, sin el régimen de capital (sin "S.A. de C.V.").';
  if (/CFDI40150|UsoCFDI|uso de cfdi/i.test(m)) return 'Ese uso de CFDI no es válido para el régimen del cliente. Pregúntale cuál usar; lo más común es G03.';
  if (/certificado|CSD|sello/i.test(m)) return 'El sello digital (CSD) no está cargado o ya venció. Súbelo de nuevo en Configuración › Facturación.';
  if (/folio.*duplicad|ya\s*existe/i.test(m)) return 'Ya existe una factura con esa serie y folio. Vuelve a intentar: se tomará el siguiente folio.';
  if (/saldo|timbres|cr[eé]ditos/i.test(m)) return 'Se agotaron los timbres de la cuenta del proveedor. Avísanos para recargarlos.';
  return m.replace(/^Facturama \d+: /, '').slice(0, 300) || 'El proveedor de timbrado no aceptó la factura.';
}
