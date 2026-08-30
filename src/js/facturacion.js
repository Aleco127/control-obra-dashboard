/**
 * Facturación electrónica (US-231, US-232): datos fiscales, alta del sello digital y emisión de CFDI 4.0
 * desde una estimación, desde un cobro o desde cero.
 *
 * El navegador sólo captura y muestra: la cuenta del proveedor de timbrado y el armado del comprobante viven
 * en las Edge Functions pac-config y cfdi-emitir. Aquí nunca se toca un .key ni una contraseña del PAC.
 * Depende de globales de index.html: D, S, F, fmt, $, currentUser, sb, SB, Toast, Dialog, openMdl, closeMdl, L, M, R.
 */
const Facturacion = (() => {
  let estadoCache = null;

  async function fn(nombre, action, payload) {
    const r = await fetch(SB + '/functions/v1/' + nombre, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-obra-token': currentUser.token },
      body: JSON.stringify(Object.assign({ action }, payload || {}))
    });
    let j = null; try { j = await r.json(); } catch (e) { }
    return Object.assign({ status: r.status }, j || {});
  }

  /** Estado de la facturación: si la plataforma ya tiene cuenta con el PAC y si la empresa terminó su alta. */
  async function estado(forzar) {
    if (estadoCache && !forzar) return estadoCache;
    const r = await fn('cfdi-emitir', 'estado');
    estadoCache = r && r.ok ? r : { ok: false, cuenta_pac: false, configurado: false, config: null, error: r && r.error };
    return estadoCache;
  }
  const configuracion = () => (D.pac || [])[0] || null;
  const listo = () => { const c = configuracion(); return !!(c && c.activo && c.csd_registrado_at); };

  // ---------- Catálogos del SAT que el usuario ve como listas ----------
  const REGIMENES = [
    ['601', 'General de Ley Personas Morales'], ['603', 'Personas Morales con Fines no Lucrativos'],
    ['605', 'Sueldos y Salarios'], ['606', 'Arrendamiento'], ['608', 'Demás ingresos'],
    ['610', 'Residentes en el Extranjero'], ['611', 'Dividendos'], ['612', 'Actividad Empresarial y Profesional'],
    ['614', 'Intereses'], ['615', 'Premios'], ['616', 'Sin obligaciones fiscales'],
    ['620', 'Sociedades Cooperativas de Producción'], ['621', 'Incorporación Fiscal'],
    ['622', 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras'], ['623', 'Opcional para Grupos de Sociedades'],
    ['624', 'Coordinados'], ['625', 'Ingresos por Plataformas Tecnológicas'], ['626', 'Simplificado de Confianza (RESICO)'],
    ['628', 'Hidrocarburos'], ['629', 'Regímenes Fiscales Preferentes'], ['630', 'Enajenación de acciones en bolsa']
  ];
  const USOS = [
    ['G01', 'Adquisición de mercancías'], ['G03', 'Gastos en general'], ['I01', 'Construcciones'],
    ['I02', 'Mobiliario y equipo de oficina'], ['I08', 'Otra maquinaria y equipo'],
    ['D10', 'Pagos por servicios educativos'], ['S01', 'Sin efectos fiscales'], ['CP01', 'Pagos']
  ];
  const FORMAS = [
    ['01', 'Efectivo'], ['02', 'Cheque nominativo'], ['03', 'Transferencia electrónica'],
    ['04', 'Tarjeta de crédito'], ['28', 'Tarjeta de débito'], ['99', 'Por definir']
  ];
  const CLAVES_SAT = [
    ['72141500', 'Servicios de construcción de edificaciones'], ['72131500', 'Construcción de vivienda unifamiliar'],
    ['72121400', 'Servicios de construcción de obra civil'], ['72101500', 'Servicios de mantenimiento y reparación'],
    ['81101500', 'Servicios de ingeniería civil'], ['81101700', 'Servicios de arquitectura'],
    ['80101500', 'Servicios de consultoría de negocios']
  ];
  // Cómo se cobró en la app → forma de pago del SAT
  const FORMA_POR_METODO = { 'Transferencia': '03', 'Transferencia bancaria': '03', 'Cheque': '02', 'Efectivo': '01', 'Tarjeta': '04', 'Tarjeta de crédito': '04', 'Tarjeta de débito': '28', 'Depósito': '03' };
  const opciones = (lista, sel) => lista.map((o) => `<option value="${o[0]}" ${String(sel) === o[0] ? 'selected' : ''}>${o[0]} · ${S(o[1])}</option>`).join('');

  // ================= Configuración › Facturación (US-231) =================
  async function abrirConfig() {
    const e = await estado(true);
    const c = e.config || configuracion() || {};
    const vence = c.csd_vigencia_fin ? new Date(c.csd_vigencia_fin + 'T12:00:00') : null;
    const dias = vence ? Math.round((vence - new Date()) / 86400000) : null;
    $('mdlPacConfig').innerHTML = `
<div class="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto m-4">
  <div class="mdl-h sticky top-0 bg-white z-10 border-b"><span class="text-cyan-600 font-bold"><i class="ri-bill-line mr-2"></i>Facturación</span><button onclick="closeMdl('mdlPacConfig')" class="mdl-x" aria-label="Cerrar">&times;</button></div>
  <div class="p-6 space-y-5">
    ${!e.cuenta_pac ? `<div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800"><i class="ri-information-line mr-1"></i>La facturación todavía no está habilitada en tu cuenta. Captura tus datos y escríbenos para activarla.</div>` : ''}
    <form id="frmFiscal" onsubmit="Facturacion.guardarConfig(event)" class="space-y-4">
      <h3 class="font-bold text-slate-700 border-b pb-2">Datos de tu empresa ante el SAT</h3>
      <p class="text-xs text-slate-500 -mt-2">Cópialos tal cual de tu constancia de situación fiscal: si algo no coincide, el SAT rechaza la factura.</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="text-xs text-slate-500">RFC<input id="fcRfc" class="inp mt-1 uppercase" maxlength="13" required value="${S(c.rfc_emisor || '')}"></label>
        <label class="text-xs text-slate-500">Razón social<input id="fcRazon" class="inp mt-1 uppercase" required value="${S(c.razon_social || '')}" placeholder="Sin S.A. de C.V."></label>
        <label class="text-xs text-slate-500">Régimen fiscal<select id="fcRegimen" class="inp mt-1" required><option value="">Elige…</option>${opciones(REGIMENES, c.regimen_fiscal)}</select></label>
        <label class="text-xs text-slate-500">Código postal de expedición<input id="fcCp" class="inp mt-1" inputmode="numeric" maxlength="5" required value="${S(c.lugar_expedicion || c.codigo_postal || '')}"></label>
        <label class="text-xs text-slate-500">Serie<input id="fcSerie" class="inp mt-1 uppercase" maxlength="10" value="${S(c.serie_default || 'A')}"></label>
        <label class="text-xs text-slate-500">Folio de la próxima factura<input id="fcFolio" class="inp mt-1" inputmode="numeric" value="${(Number(c.folio_actual) || 0) + 1}"></label>
        <label class="text-xs text-slate-500">Concepto por omisión<input id="fcConcepto" class="inp mt-1" value="${S(c.concepto_default || 'Servicios de construcción')}"></label>
        <label class="text-xs text-slate-500">Clave del SAT del servicio<select id="fcClave" class="inp mt-1">${opciones(CLAVES_SAT, c.clave_prodserv_default || '72141500')}</select></label>
        <label class="text-xs text-slate-500">Uso de CFDI por omisión<select id="fcUso" class="inp mt-1">${opciones(USOS, c.uso_cfdi_default || 'G03')}</select></label>
        <label class="text-xs text-slate-500">Modo<select id="fcModo" class="inp mt-1">
          <option value="sandbox" ${c.pac_modo !== 'produccion' ? 'selected' : ''}>Pruebas (no tiene validez fiscal)</option>
          <option value="produccion" ${c.pac_modo === 'produccion' ? 'selected' : ''}>Producción (facturas reales)</option>
        </select></label>
      </div>
      <div class="text-right"><button type="submit" class="btn btn-p"><i class="ri-save-line mr-1"></i>Guardar datos fiscales</button></div>
    </form>

    <form id="frmCsd" onsubmit="Facturacion.subirCsd(event)" class="space-y-3 border-t pt-5">
      <h3 class="font-bold text-slate-700">Sello digital (CSD)</h3>
      ${c.csd_registrado_at ? `
        <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
          <i class="ri-shield-check-line mr-1"></i>Sello cargado${c.csd_no_certificado ? ' · serie ' + S(c.csd_no_certificado) : ''}.
          ${c.csd_vigencia_fin ? `Vigente hasta el ${new Date(c.csd_vigencia_fin + 'T12:00:00').toLocaleDateString('es-MX')}${dias != null && dias <= 30 ? ` <strong>(${dias < 0 ? 'ya venció' : 'faltan ' + dias + ' días'})</strong>` : ''}.` : ''}
          <button type="button" onclick="Facturacion.borrarCsd()" class="underline ml-1">Reemplazar</button>
        </div>` : `
        <p class="text-xs text-slate-500">Sube los archivos que te dio el SAT. La contraseña de tu llave viaja cifrada hasta el proveedor de timbrado y no se guarda en ningún lado.</p>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label class="text-xs text-slate-500">Certificado (.cer)<input type="file" id="fcCer" class="inp mt-1" accept=".cer" required></label>
          <label class="text-xs text-slate-500">Llave privada (.key)<input type="file" id="fcKey" class="inp mt-1" accept=".key" required></label>
          <label class="text-xs text-slate-500">Contraseña de la llave<input type="password" id="fcPass" class="inp mt-1" autocomplete="off" required></label>
        </div>
        <div class="text-right"><button type="submit" class="btn btn-p"><i class="ri-upload-2-line mr-1"></i>Subir sello</button></div>`}
    </form>

    <div class="flex gap-2 border-t pt-4">
      <button type="button" onclick="Facturacion.probar()" class="btn btn-s flex-1"><i class="ri-wifi-line mr-1"></i>Probar conexión</button>
      <button type="button" onclick="closeMdl('mdlPacConfig')" class="btn btn-s flex-1">Cerrar</button>
    </div>
  </div>
</div>`;
    openMdl('mdlPacConfig');
  }

  async function guardarConfig(ev) {
    ev.preventDefault();
    const r = await fn('pac-config', 'guardar', {
      rfc_emisor: $('fcRfc').value, razon_social: $('fcRazon').value, regimen_fiscal: $('fcRegimen').value,
      codigo_postal: $('fcCp').value, lugar_expedicion: $('fcCp').value, serie_default: $('fcSerie').value,
      folio_inicial: parseInt($('fcFolio').value, 10) || null, concepto_default: $('fcConcepto').value,
      clave_prodserv_default: $('fcClave').value, clave_unidad_default: 'E48', uso_cfdi_default: $('fcUso').value,
      pac_modo: $('fcModo').value, activo: true
    });
    if (!r.ok) { Toast.error(r.error || 'No se pudo guardar'); return; }
    Toast.success('Datos fiscales guardados');
    await refrescar(); await abrirConfig();
  }

  const aBase64 = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(file); });

  async function subirCsd(ev) {
    ev.preventDefault();
    const cer = $('fcCer').files[0], key = $('fcKey').files[0], pass = $('fcPass').value;
    if (!cer || !key || !pass) { Toast.warning('Faltan el .cer, el .key o la contraseña'); return; }
    Toast.info('Registrando el sello…');
    const r = await fn('pac-config', 'subir_csd', { cer: await aBase64(cer), key: await aBase64(key), password: pass });
    $('fcPass').value = '';
    if (!r.ok) { Toast.error(r.error || 'No se pudo registrar el sello'); return; }
    Toast.success('Sello digital registrado');
    await refrescar(); await abrirConfig();
  }

  async function borrarCsd() {
    if (!await Dialog.confirm('¿Quitar el sello digital? No podrás facturar hasta subir otro.')) return;
    const r = await fn('pac-config', 'borrar_csd');
    if (!r.ok) { Toast.error(r.error || 'No se pudo quitar'); return; }
    await refrescar(); await abrirConfig();
  }

  async function probar() {
    const r = await fn('pac-config', 'probar');
    if (!r.ok) { Toast.error(r.error || 'No se pudo conectar'); return; }
    r.registrado ? Toast.success('Todo listo: el proveedor reconoce tu sello digital.') : Toast.warning('Conectamos con el proveedor, pero tu sello todavía no está cargado.');
  }

  async function refrescar() {
    estadoCache = null;
    const { data } = await sb.from('config_pac').select('*').eq('empresa_id', currentUser.empresa_id);
    D.pac = data || [];
    if (typeof M !== 'undefined' && M === 'ce' && typeof R === 'function') R();
  }

  // ================= Emitir factura (US-232) =================
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  /** Arma el borrador de la factura a partir de la estimación o el cobro que la origina. */
  function prellenar(ctx) {
    const cfg = configuracion() || {};
    const base = {
      origen: ctx.origen || 'libre', obra_id: null, cliente_id: null,
      estimacion_id: null, pago_recibido_id: null, cuenta_cobrar_id: null,
      metodo: 'PUE', forma: '03', modoIva: '16', referencia: '',
      conceptos: [{ descripcion: cfg.concepto_default || 'Servicios de construcción', clave: cfg.clave_prodserv_default || '72141500', unidad: cfg.clave_unidad_default || 'E48', cantidad: 1, precio: 0 }]
    };
    if (ctx.origen === 'estimacion') {
      const est = (D.est || []).find((x) => x.id === ctx.estimacion_id);
      if (!est) return base;
      const obra = (D.o || []).find((o) => o.id === est.obra_id) || {};
      const iva = est.porcentaje_iva != null ? Number(est.porcentaje_iva) : (obra.porcentaje_iva != null ? Number(obra.porcentaje_iva) : 16);
      const cxc = (D.cxc || []).find((x) => x.estimacion_id === est.id);
      return Object.assign(base, {
        obra_id: est.obra_id, cliente_id: obra.cliente_id || null, estimacion_id: est.id,
        cuenta_cobrar_id: cxc ? cxc.id : null,
        metodo: 'PPD', forma: '99', modoIva: iva === 0 ? 'exento' : String(iva),
        referencia: 'Estimación ' + (est.numero_estimacion || ''),
        conceptos: [{
          descripcion: `Estimación ${est.numero_estimacion || ''} · ${obra.nombre_obra || 'obra'}${est.periodo_inicio ? ' (' + est.periodo_inicio + ' a ' + (est.periodo_fin || '') + ')' : ''}`.trim(),
          clave: cfg.clave_prodserv_default || '72141500', unidad: cfg.clave_unidad_default || 'E48',
          cantidad: 1, precio: r2(est.subtotal || est.monto_periodo || 0)
        }]
      });
    }
    if (ctx.origen === 'cobro') {
      const pago = (D.prc || []).find((x) => x.id === ctx.pago_recibido_id);
      if (!pago) return base;
      const obra = (D.o || []).find((o) => o.id === pago.obra_id) || {};
      const iva = obra.porcentaje_iva != null ? Number(obra.porcentaje_iva) : 16;
      const bruto = Number(pago.monto) || 0;
      // El cobro se captura con IVA incluido; la factura se arma desde la base.
      const neto = iva === 0 ? bruto : r2(bruto / (1 + iva / 100));
      return Object.assign(base, {
        obra_id: pago.obra_id, cliente_id: obra.cliente_id || null, pago_recibido_id: pago.id,
        cuenta_cobrar_id: pago.cuenta_cobrar_id || null,
        metodo: 'PUE', forma: FORMA_POR_METODO[pago.metodo_pago] || '03', modoIva: iva === 0 ? 'exento' : String(iva),
        referencia: pago.numero_pago ? 'Cobro ' + pago.numero_pago : 'Cobro',
        conceptos: [{
          descripcion: `${pago.concepto || 'Pago'} · ${obra.nombre_obra || 'obra'}`,
          clave: cfg.clave_prodserv_default || '72141500', unidad: cfg.clave_unidad_default || 'E48',
          cantidad: 1, precio: neto
        }]
      });
    }
    return base;
  }

  let borrador = null;

  async function abrirFactura(ctx) {
    const e = await estado(true);
    if (!e.cuenta_pac) { Toast.warning('La facturación todavía no está habilitada en tu cuenta. Escríbenos y la activamos.'); return; }
    if (!e.configurado) { Toast.warning('Primero completa tus datos fiscales y sube tu sello digital.'); abrirConfig(); return; }
    borrador = prellenar(ctx || {});
    const cli = (D.cli || []).find((c) => c.id === borrador.cliente_id) || {};
    const cfg = e.config || configuracion() || {};
    $('mdlCfdi').innerHTML = `
<div class="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto m-4">
  <div class="mdl-h sticky top-0 bg-white z-10 border-b"><span class="text-cyan-600 font-bold"><i class="ri-bill-line mr-2"></i>Facturar${borrador.referencia ? ' · ' + S(borrador.referencia) : ''}</span><button onclick="closeMdl('mdlCfdi')" class="mdl-x" aria-label="Cerrar">&times;</button></div>
  <form onsubmit="Facturacion.emitir(event)" class="p-6 space-y-4">
    <div class="bg-slate-50 rounded-lg p-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
      <span class="text-slate-600">Emisor: <strong>${S(cfg.razon_social || '')}</strong></span>
      <span class="text-slate-600">RFC: <strong>${S(cfg.rfc_emisor || '')}</strong></span>
      <span class="text-slate-600">Folio: <strong>${S(cfg.serie_default || 'A')}-${(Number(cfg.folio_actual) || 0) + 1}</strong></span>
      ${cfg.pac_modo !== 'produccion' ? '<span class="text-amber-600 font-medium">Modo pruebas: la factura no tiene validez fiscal</span>' : ''}
    </div>

    <h3 class="font-bold text-slate-700 border-b pb-2">¿A quién le facturas?</h3>
    <p class="text-xs text-slate-500 -mt-2">Los datos deben coincidir con la constancia de situación fiscal del cliente, letra por letra.</p>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <label class="text-xs text-slate-500 md:col-span-3">Cliente<select id="faCliente" class="inp mt-1" onchange="Facturacion.cargarCliente()">
        <option value="">Capturar a mano…</option>
        ${(D.cli || []).map((c) => `<option value="${c.id}" ${borrador.cliente_id === c.id ? 'selected' : ''}>${S(c.nombre)}${c.rfc ? ' · ' + S(c.rfc) : ''}</option>`).join('')}
      </select></label>
      <label class="text-xs text-slate-500">RFC<input id="faRfc" class="inp mt-1 uppercase" maxlength="13" required value="${S(cli.rfc || '')}"></label>
      <label class="text-xs text-slate-500 md:col-span-2">Nombre o razón social<input id="faNombre" class="inp mt-1 uppercase" required value="${S(cli.razon_social || cli.nombre || '')}"></label>
      <label class="text-xs text-slate-500">Régimen fiscal<select id="faRegimen" class="inp mt-1" required><option value="">Elige…</option>${opciones(REGIMENES, cli.regimen_fiscal || '')}</select></label>
      <label class="text-xs text-slate-500">Código postal<input id="faCp" class="inp mt-1" inputmode="numeric" maxlength="5" required value="${S(cli.codigo_postal || '')}"></label>
      <label class="text-xs text-slate-500">Uso de CFDI<select id="faUso" class="inp mt-1">${opciones(USOS, cli.uso_cfdi || cfg.uso_cfdi_default || 'G03')}</select></label>
    </div>

    <h3 class="font-bold text-slate-700 border-b pb-2 mt-4">Cómo se paga</h3>
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
      <label class="text-xs text-slate-500">Método<select id="faMetodo" class="inp mt-1" onchange="Facturacion.cambiarMetodo()">
        <option value="PUE" ${borrador.metodo === 'PUE' ? 'selected' : ''}>PUE · ya te pagaron</option>
        <option value="PPD" ${borrador.metodo === 'PPD' ? 'selected' : ''}>PPD · te pagarán después</option>
      </select></label>
      <label class="text-xs text-slate-500">Forma de pago<select id="faForma" class="inp mt-1">${opciones(FORMAS, borrador.forma)}</select></label>
      <label class="text-xs text-slate-500">IVA<select id="faIva" class="inp mt-1" onchange="Facturacion.calcular()">
        <option value="16" ${borrador.modoIva === '16' ? 'selected' : ''}>16 %</option>
        <option value="0" ${borrador.modoIva === '0' ? 'selected' : ''}>Tasa 0 %</option>
        <option value="exento" ${borrador.modoIva === 'exento' ? 'selected' : ''}>Exento (casa habitación)</option>
      </select>
      <p id="faAvisoIva" class="text-xs text-amber-600 mt-1 ${borrador.modoIva === 'exento' ? '' : 'hidden'}">Esta factura sale sin IVA porque la obra está marcada como exenta. Sólo aplica a construcción de casa habitación.</p></label>
      <label class="text-xs text-slate-500">Obra<select id="faObra" class="inp mt-1">
        <option value="">Sin obra</option>
        ${(D.o || []).map((o) => `<option value="${o.id}" ${borrador.obra_id === o.id ? 'selected' : ''}>${S(o.nombre_obra)}</option>`).join('')}
      </select></label>
    </div>
    <details class="text-xs text-slate-500">
      <summary class="cursor-pointer">Retenciones (sólo si tu cliente te retiene impuestos)</summary>
      <div class="grid grid-cols-2 gap-3 mt-2 max-w-md">
        <label>ISR retenido (%)<input id="faIsr" class="inp mt-1" inputmode="decimal" value="0" onchange="Facturacion.calcular()"></label>
        <label>IVA retenido (%)<input id="faIvaRet" class="inp mt-1" inputmode="decimal" value="0" onchange="Facturacion.calcular()"></label>
      </div>
    </details>

    <h3 class="font-bold text-slate-700 border-b pb-2 mt-4">Qué se factura</h3>
    <div id="faConceptos" class="space-y-2">${borrador.conceptos.map((c, i) => filaConcepto(i, c)).join('')}</div>
    <button type="button" onclick="Facturacion.agregarConcepto()" class="text-blue-600 text-sm hover:underline"><i class="ri-add-line"></i> Agregar concepto</button>

    <div class="bg-slate-50 rounded-lg p-4 mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-right">
      <div><span class="text-xs text-slate-500 block">Subtotal</span><span id="faSubtotal" class="font-bold">$0.00</span></div>
      <div><span class="text-xs text-slate-500 block">IVA</span><span id="faIvaMonto" class="font-bold">$0.00</span></div>
      <div><span class="text-xs text-slate-500 block">Retenciones</span><span id="faRet" class="font-bold text-red-600">$0.00</span></div>
      <div><span class="text-xs text-slate-500 block">Total</span><span id="faTotal" class="text-xl font-bold text-green-600">$0.00</span></div>
    </div>

    <label class="text-xs text-slate-500 block">Nota interna (no aparece en la factura)<input id="faNotas" class="inp mt-1" value="${S(borrador.referencia || '')}"></label>

    <div class="flex gap-2 mt-4 pt-4 border-t">
      <button type="button" onclick="closeMdl('mdlCfdi')" class="btn btn-s flex-1">Cancelar</button>
      <button type="submit" id="faEmitir" class="btn btn-p flex-1"><i class="ri-stamp-line mr-1"></i>Timbrar factura</button>
    </div>
  </form>
</div>`;
    openMdl('mdlCfdi');
    calcular();
  }

  function filaConcepto(i, c) {
    return `<div class="grid grid-cols-12 gap-2 items-end border rounded p-2 bg-white" data-fila>
      <label class="col-span-12 md:col-span-5 text-xs text-slate-500">Descripción<input class="inp mt-1 fa-desc" required value="${S(c.descripcion || '')}"></label>
      <label class="col-span-6 md:col-span-2 text-xs text-slate-500">Clave SAT<input class="inp mt-1 fa-clave" maxlength="8" value="${S(c.clave || '72141500')}"></label>
      <label class="col-span-3 md:col-span-1 text-xs text-slate-500">Unidad<input class="inp mt-1 fa-unidad" maxlength="3" value="${S(c.unidad || 'E48')}"></label>
      <label class="col-span-3 md:col-span-1 text-xs text-slate-500">Cant.<input class="inp mt-1 fa-cant" inputmode="decimal" value="${Number(c.cantidad) || 1}" onchange="Facturacion.calcular()"></label>
      <label class="col-span-6 md:col-span-2 text-xs text-slate-500">Precio unitario<input class="inp mt-1 fa-precio" inputmode="decimal" value="${Number(c.precio) || 0}" onchange="Facturacion.calcular()"></label>
      <div class="col-span-6 md:col-span-1 flex justify-end"><button type="button" onclick="Facturacion.quitarConcepto(this)" class="p-2 text-red-500 hover:bg-red-50 rounded" aria-label="Quitar concepto"><i class="ri-delete-bin-line" aria-hidden="true"></i></button></div>
    </div>`;
  }
  function agregarConcepto() { $('faConceptos').insertAdjacentHTML('beforeend', filaConcepto(0, {})); }
  function quitarConcepto(btn) {
    const filas = $('faConceptos').querySelectorAll('[data-fila]');
    if (filas.length <= 1) { Toast.warning('La factura necesita al menos un concepto'); return; }
    btn.closest('[data-fila]').remove(); calcular();
  }
  function cambiarMetodo() {
    // Una factura PPD siempre lleva forma de pago 99: todavía no se sabe cómo van a pagar.
    if ($('faMetodo').value === 'PPD') { $('faForma').value = '99'; $('faForma').disabled = true; }
    else { $('faForma').disabled = false; if ($('faForma').value === '99') $('faForma').value = '03'; }
  }
  function cargarCliente() {
    const c = (D.cli || []).find((x) => String(x.id) === $('faCliente').value);
    if (!c) return;
    $('faRfc').value = c.rfc || ''; $('faNombre').value = c.razon_social || c.nombre || '';
    if (c.regimen_fiscal) $('faRegimen').value = c.regimen_fiscal;
    if (c.codigo_postal) $('faCp').value = c.codigo_postal;
    if (c.uso_cfdi) $('faUso').value = c.uso_cfdi;
  }
  function leerConceptos() {
    return Array.from($('faConceptos').querySelectorAll('[data-fila]')).map((f) => ({
      descripcion: f.querySelector('.fa-desc').value.trim(),
      claveProdServ: f.querySelector('.fa-clave').value.trim(),
      claveUnidad: f.querySelector('.fa-unidad').value.trim(),
      cantidad: parseFloat(f.querySelector('.fa-cant').value) || 0,
      valorUnitario: parseFloat(f.querySelector('.fa-precio').value) || 0
    }));
  }
  function calcular() {
    const modo = $('faIva') ? $('faIva').value : '16';
    const isr = parseFloat(($('faIsr') || {}).value) || 0, ivaRet = parseFloat(($('faIvaRet') || {}).value) || 0;
    let sub = 0, iva = 0;
    leerConceptos().forEach((c) => { const imp = r2(c.cantidad * c.valorUnitario); sub += imp; if (modo !== 'exento') iva += r2(imp * (Number(modo) || 0) / 100); });
    sub = r2(sub); iva = r2(iva);
    const ret = r2(sub * isr / 100) + r2(sub * ivaRet / 100);
    const aviso = $('faAvisoIva');
    if (aviso) aviso.classList.toggle('hidden', modo !== 'exento');
    if ($('faSubtotal')) $('faSubtotal').textContent = fmt(sub);
    if ($('faIvaMonto')) $('faIvaMonto').textContent = fmt(iva);
    if ($('faRet')) $('faRet').textContent = '-' + fmt(ret);
    if ($('faTotal')) $('faTotal').textContent = fmt(r2(sub + iva - ret));
  }

  async function emitir(ev) {
    ev.preventDefault();
    const btn = $('faEmitir');
    if (!await Dialog.confirm('¿Timbrar la factura ante el SAT? Una vez timbrada sólo se puede cancelar, no editar.')) return;
    btn.disabled = true; btn.innerHTML = '<i class="ri-loader-4-line animate-spin mr-1"></i>Timbrando…';
    const r = await fn('cfdi-emitir', 'emitir', {
      origen: borrador.origen, obra_id: $('faObra').value || borrador.obra_id || null,
      cliente_id: $('faCliente').value || null,
      estimacion_id: borrador.estimacion_id, pago_recibido_id: borrador.pago_recibido_id, cuenta_cobrar_id: borrador.cuenta_cobrar_id,
      receptor: { rfc: $('faRfc').value, nombre: $('faNombre').value, regimen: $('faRegimen').value, cp: $('faCp').value, uso: $('faUso').value },
      conceptos: leerConceptos(),
      forma_pago: $('faForma').value, metodo_pago: $('faMetodo').value, modo_iva: $('faIva').value,
      isr_retenido: parseFloat($('faIsr').value) || 0, iva_retenido: parseFloat($('faIvaRet').value) || 0,
      notas: $('faNotas').value.trim() || null
    });
    btn.disabled = false; btn.innerHTML = '<i class="ri-stamp-line mr-1"></i>Timbrar factura';
    if (!r.ok) { Toast.error(r.error || 'No se pudo timbrar', 8000); return; }
    Toast.success('Factura timbrada · UUID ' + (r.uuid || ''), 6000);
    closeMdl('mdlCfdi');
    await refrescar();
    if (typeof L === 'function') await L();
  }

  // ================= Ver y descargar =================
  function verFactura(id) {
    const cf = (D.cfdi || []).find((x) => x.id === id); if (!cf) return;
    const cfg = configuracion() || {};
    $('mdlCfdi').innerHTML = `
<div class="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto m-4">
  <div class="mdl-h sticky top-0 bg-white z-10 border-b"><span class="text-cyan-600 font-bold"><i class="ri-bill-line mr-2"></i>Factura ${S(cf.serie || '')}-${cf.folio || ''}</span><button onclick="closeMdl('mdlCfdi')" class="mdl-x" aria-label="Cerrar">&times;</button></div>
  <div class="p-6 space-y-4">
    <div class="flex justify-between items-start">
      <div><p class="text-2xl font-bold">${S(cf.serie || '')}-${cf.folio || ''}</p><p class="text-sm text-slate-500">${cf.fecha_emision ? new Date(cf.fecha_emision).toLocaleString('es-MX') : '-'}</p></div>
      <span class="px-3 py-1 rounded-full text-sm font-medium ${cf.estatus === 'timbrado' ? 'bg-green-100 text-green-700' : cf.estatus === 'cancelado' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">${S((cf.estatus || '').toUpperCase())}</span>
    </div>
    ${cf.uuid ? `<div class="bg-green-50 border border-green-200 rounded-lg p-4"><p class="text-xs text-green-600 font-medium">Folio fiscal (UUID)</p><p class="font-mono text-green-800 break-all">${S(cf.uuid)}</p>${cf.fecha_timbrado ? `<p class="text-xs text-green-600 mt-1">Timbrada el ${new Date(cf.fecha_timbrado).toLocaleString('es-MX')}</p>` : ''}</div>` : ''}
    ${cf.estatus === 'error' ? `<div class="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">No se pudo timbrar. ${S((cf.pac_response && cf.pac_response.error) || '')}</div>` : ''}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="bg-slate-50 rounded-lg p-4"><h4 class="font-bold text-slate-700 mb-1">Emisor</h4><p>${S(cfg.razon_social || '')}</p><p class="text-sm text-slate-600">RFC ${S(cfg.rfc_emisor || '')}</p></div>
      <div class="bg-slate-50 rounded-lg p-4"><h4 class="font-bold text-slate-700 mb-1">Receptor</h4><p>${S(cf.receptor_nombre || '')}</p><p class="text-sm text-slate-600">RFC ${S(cf.receptor_rfc || '')} · Uso ${S(cf.uso_cfdi || '')}</p></div>
    </div>
    <table class="table-modern w-full">
      <thead><tr><th>Descripción</th><th>Cant.</th><th>P. unitario</th><th class="text-right">Importe</th></tr></thead>
      <tbody>${(cf.conceptos || []).map((c) => `<tr><td><span class="text-xs text-slate-400">${S(c.ProductCode || c.clave_prod_serv || '')}</span><br>${S(c.Description || c.descripcion || '')}</td><td>${Number(c.Quantity ?? c.cantidad) || 0}</td><td>${fmt(Number(c.UnitPrice ?? c.valor_unitario) || 0)}</td><td class="text-right">${fmt(Number(c.Subtotal ?? c.importe) || 0)}</td></tr>`).join('')}</tbody>
    </table>
    <div class="bg-slate-50 rounded-lg p-4">
      <div class="flex justify-between py-1"><span>Subtotal</span><span>${fmt(cf.subtotal)}</span></div>
      <div class="flex justify-between py-1"><span>IVA${cf.iva_tasa ? ' (' + cf.iva_tasa + ' %)' : ' (exento)'}</span><span>${fmt(cf.iva_monto)}</span></div>
      ${cf.isr_retenido ? `<div class="flex justify-between py-1 text-red-600"><span>ISR retenido</span><span>-${fmt(cf.isr_retenido)}</span></div>` : ''}
      ${cf.iva_retenido ? `<div class="flex justify-between py-1 text-red-600"><span>IVA retenido</span><span>-${fmt(cf.iva_retenido)}</span></div>` : ''}
      <div class="flex justify-between py-2 border-t font-bold text-lg"><span>Total</span><span class="text-green-600">${fmt(cf.total)}</span></div>
    </div>
    ${cf.estatus === 'timbrado' ? `<div class="flex gap-2">
      <button onclick="Facturacion.descargar(${cf.id},'xml')" class="btn btn-s flex-1"><i class="ri-file-code-line mr-1"></i>Descargar XML</button>
      <button onclick="Facturacion.descargar(${cf.id},'pdf')" class="btn btn-p flex-1"><i class="ri-file-pdf-line mr-1"></i>Descargar PDF</button>
    </div>` : ''}
  </div>
</div>`;
    openMdl('mdlCfdi');
  }

  async function descargar(id, tipo) {
    const cf = (D.cfdi || []).find((x) => x.id === id); if (!cf) return;
    const path = tipo === 'pdf' ? cf.pdf_path : cf.archivo_path;
    if (path) {
      const { data, error } = await sb.storage.from('comprobantes').createSignedUrl(path, 300);
      if (!error && data && data.signedUrl) { window.open(data.signedUrl, '_blank'); return; }
    }
    if (tipo === 'xml' && cf.xml_content) {
      const url = URL.createObjectURL(new Blob([cf.xml_content], { type: 'application/xml' }));
      const a = document.createElement('a'); a.href = url; a.download = `CFDI_${cf.serie || ''}${cf.folio || ''}.xml`; a.click(); URL.revokeObjectURL(url);
      return;
    }
    Toast.warning(tipo === 'pdf' ? 'Esta factura no tiene PDF guardado' : 'Esta factura no tiene XML guardado');
  }

  return { estado, listo, configuracion, refrescar, abrirConfig, guardarConfig, subirCsd, borrarCsd, probar, abrirFactura, agregarConcepto, quitarConcepto, cambiarMetodo, cargarCliente, calcular, emitir, verFactura, descargar, prellenar, REGIMENES, USOS, FORMAS };
})();
if (typeof module !== 'undefined') module.exports = Facturacion;
