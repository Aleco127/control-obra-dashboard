/**
 * Contabilidad (US-241): catálogo de cuentas por empresa y pólizas del mes para CONTPAQi / Aspel COI.
 * - Contabilidad.configHtml()      → tarjeta "Cuentas contables" para Configuración (nivel >= 100)
 * - Contabilidad.polizas(periodo)  → arma las pólizas del mes y descarga polizas_<periodo>.xlsx y polizas_<periodo>.txt (CONTPAQi)
 * - Contabilidad.generar(periodo)  → sólo el cálculo (para pruebas): {polizas, faltantes}
 * Depende de: D, sb, currentUser, Toast, XLSX, Finanzas, S, fmt, hoyISO.
 * Formato del TXT documentado en docs/contabilidad/contpaqi.md.
 */
const Contabilidad = (() => {
  const num = (v) => parseFloat(v) || 0;
  const r2 = (v) => Math.round(v * 100) / 100;
  const ROLES = [
    ['bancos', 'Bancos'], ['caja', 'Caja y efectivo'], ['clientes', 'Clientes'], ['proveedores', 'Proveedores'],
    ['iva_acreditable', 'IVA acreditable'], ['iva_trasladado', 'IVA trasladado'], ['ingresos', 'Ingresos por obra'],
    ['costo_directo', 'Costo directo (sin categoría)'], ['indirectos', 'Gastos indirectos'], ['nomina', 'Sueldos y salarios'],
    ['socios_aportaciones', 'Aportaciones de socios'], ['socios_retiros', 'Retiros de socios'],
  ];
  let cargado = false;

  async function cargar(force) {
    if (cargado && !force) return D.cta || [];
    try { const { data } = await sb.from('cuentas_contables').select('*').eq('empresa_id', currentUser.empresa_id).order('rol'); D.cta = data || []; cargado = true; } catch (e) { D.cta = D.cta || []; }
    return D.cta;
  }
  const cuentaDe = (rol, lista) => ((lista || (typeof D !== 'undefined' ? D.cta : null)) || []).find(c => c.rol === rol) || null;
  function cuenta(rol, faltantes, lista) {
    const c = cuentaDe(rol, lista) || (rol.startsWith('costo:') ? cuentaDe('costo_directo', lista) : null);
    if (!c) { faltantes.add(rol); return { cuenta: '', nombre: rol }; }
    return c;
  }

  /** Calcula las pólizas del periodo (AAAA-MM). Devuelve {polizas:[{tipo, numero, fecha, concepto, movs:[{cuenta,nombre,cargo,abono,ref,uuid}]}], faltantes:Set} */
  function generar(periodo, d) {
    d = d || (typeof D !== 'undefined' ? D : {});
    const rg = Finanzas.rango(periodo);
    const en = (f) => Finanzas.enRango(f, rg.desde, rg.hasta);
    const faltantes = new Set();
    const obraTxt = (id) => { const o = (d.o || []).find(x => x.id == id); return o ? (o.codigo_obra || o.nombre_obra) : ''; };
    const prov = (id) => (d.pv || []).find(p => p.id === id) || {};
    const socio = (id) => (d.soc || []).find(s => s.id === id) || {};
    const polizas = []; const n = { 1: 0, 2: 0, 3: 0 };
    const nueva = (tipo, fecha, concepto) => { const p = { tipo, numero: ++n[tipo], fecha: String(fecha).slice(0, 10), concepto: String(concepto || '').slice(0, 100), movs: [] }; polizas.push(p); return p; };
    const mov = (p, rol, cargo, abono, ref, uuid, concepto) => { const c = cuenta(rol, faltantes, d.cta); p.movs.push({ rol, cuenta: c.cuenta, nombre: c.nombre, cargo: r2(cargo), abono: r2(abono), ref: String(ref || '').slice(0, 10), uuid: uuid || '', concepto: String(concepto || p.concepto).slice(0, 100) }); };

    // Ingresos: cobros del mes (cargo bancos / abono clientes)
    (d.prc || []).filter(x => en(x.fecha_pago)).sort((a, b) => String(a.fecha_pago).localeCompare(String(b.fecha_pago))).forEach(x => {
      const p = nueva(1, x.fecha_pago, `Cobro ${x.numero_pago || ''} ${obraTxt(x.obra_id)} ${x.concepto || ''}`.trim());
      const efectivo = /efectivo/i.test(x.metodo_pago || '');
      mov(p, efectivo ? 'caja' : 'bancos', num(x.monto), 0, x.referencia || x.numero_pago, x.factura_numero);
      mov(p, 'clientes', 0, num(x.monto), x.referencia || x.numero_pago, x.factura_numero);
    });
    // Diario: facturas emitidas (cargo clientes / abono ingresos + IVA trasladado)
    (d.cfdi || []).filter(x => en(x.fecha_emision) && !/cancel/i.test(x.estatus || '')).forEach(x => {
      const total = num(x.total), iva = num(x.iva ?? x.iva_trasladado), sub = num(x.subtotal) || r2(total - iva);
      const p = nueva(3, x.fecha_emision, `Factura ${(x.serie || '') + (x.folio || '')} ${obraTxt(x.obra_id)} ${x.receptor_nombre || x.cliente || ''}`.trim());
      mov(p, 'clientes', total, 0, (x.serie || '') + (x.folio || ''), x.uuid);
      mov(p, 'ingresos', 0, sub, (x.serie || '') + (x.folio || ''), x.uuid);
      if (iva > 0) mov(p, 'iva_trasladado', 0, iva, (x.serie || '') + (x.folio || ''), x.uuid);
    });
    // Diario: gastos devengados (cargo costo/indirecto + IVA acreditable / abono proveedores o socio)
    (d.g || []).filter(g => en(g.fecha_solicitud) && g.estatus_pago !== 'Rechazado' && (g.destino || (g.obra_id ? 'obra' : 'indirecto')) !== 'socio').sort((a, b) => String(a.fecha_solicitud).localeCompare(String(b.fecha_solicitud))).forEach(g => {
      const destino = g.destino || (g.obra_id ? 'obra' : 'indirecto');
      const total = num(g.monto_neto), iva = g.comprobacion === 'facturado' ? num(g.iva) : 0, base = r2(total - iva);
      const pv = prov(g.proveedor_id);
      const p = nueva(3, g.fecha_solicitud, `Gasto ${obraTxt(g.obra_id) || 'indirecto'} ${pv.nombre_proveedor || ''} ${g.descripcion || ''}`.trim());
      mov(p, destino === 'obra' ? (g.categoria ? 'costo:' + g.categoria : 'costo_directo') : 'indirectos', base, 0, g.factura_numero, g.folio_fiscal);
      if (iva > 0) mov(p, 'iva_acreditable', iva, 0, g.factura_numero, g.folio_fiscal);
      mov(p, g.pagado_por_socio_id ? 'socios_aportaciones' : 'proveedores', 0, total, g.factura_numero, g.folio_fiscal, g.pagado_por_socio_id ? `Pagado por ${socio(g.pagado_por_socio_id).nombre || 'socio'}` : undefined);
    });
    // Egresos: pagos a proveedores (cargo proveedores / abono bancos)
    (d.ppv || []).filter(x => en(x.fecha_pago)).sort((a, b) => String(a.fecha_pago).localeCompare(String(b.fecha_pago))).forEach(x => {
      const pv = prov(x.proveedor_id); const g = (d.g || []).find(y => y.id === x.gasto_id) || {};
      const p = nueva(2, x.fecha_pago, `Pago ${x.numero_pago || ''} ${pv.nombre_proveedor || ''} ${x.concepto || g.descripcion || ''}`.trim());
      mov(p, 'proveedores', num(x.monto), 0, x.referencia || x.numero_pago, g.folio_fiscal);
      mov(p, /efectivo/i.test(x.metodo_pago || '') ? 'caja' : 'bancos', 0, num(x.monto), x.referencia || x.numero_pago, g.folio_fiscal);
    });
    // Egresos: nómina pagada (cargo sueldos / abono bancos)
    (d.nom || []).filter(x => en(x.fecha_pago) && num(x.total_pagar) > 0).forEach(x => {
      const e = (d.e || []).find(y => y.id === x.empleado_id) || {};
      const p = nueva(2, x.fecha_pago, `Nómina ${e.nombre_completo || ''} ${x.periodo_inicio || ''} a ${x.periodo_fin || ''}`.trim());
      mov(p, 'nomina', num(x.total_pagar), 0, '');
      mov(p, 'bancos', 0, num(x.total_pagar), '');
    });
    // Socios: aportaciones (ingreso) y retiros / gastos personales / utilidad pagada (egreso)
    (d.msoc || []).filter(x => en(x.fecha)).forEach(x => {
      const s = socio(x.socio_id); const m = num(x.monto);
      if (x.tipo === 'aportacion') { const p = nueva(1, x.fecha, `Aportación ${s.nombre || ''} ${x.concepto || ''}`.trim()); mov(p, 'bancos', m, 0, x.referencia); mov(p, 'socios_aportaciones', 0, m, x.referencia); }
      else { const p = nueva(2, x.fecha, `${x.tipo === 'utilidad_pagada' ? 'Utilidad pagada' : x.tipo === 'gasto_personal' ? 'Gasto personal' : 'Retiro'} ${s.nombre || ''} ${x.concepto || ''}`.trim()); mov(p, 'socios_retiros', m, 0, x.referencia); mov(p, 'bancos', 0, m, x.referencia); }
    });
    // numeración cronológica por tipo
    polizas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.tipo - b.tipo || a.numero - b.numero);
    const cnt = { 1: 0, 2: 0, 3: 0 }; polizas.forEach(p => { p.numero = ++cnt[p.tipo]; });
    return { polizas, faltantes };
  }

  /** Formato ASCII de importación de pólizas de CONTPAQi Contabilidad (ver docs/contabilidad/contpaqi.md) */
  function contpaqi(polizas) {
    const pad = (v, n) => String(v ?? '').slice(0, n).padEnd(n, ' ');
    const imp = (v) => r2(v).toFixed(2).padStart(20, ' ');
    const lines = [];
    polizas.forEach(p => {
      lines.push(`P  ${p.fecha.replace(/-/g, '')}  ${p.tipo}  ${String(p.numero).padStart(6, '0')}  0  ${pad(p.concepto, 100)}  0  0  0`);
      p.movs.forEach(m => {
        lines.push(`M  ${pad(m.cuenta, 20)}  ${pad(m.ref, 10)}  ${m.abono > 0 && m.cargo === 0 ? 1 : 0}  ${imp(m.cargo > 0 ? m.cargo : m.abono)}  ${pad('', 5)}  ${pad(m.concepto, 100)}`);
        if (m.uuid) lines.push(`CFDI  ${m.uuid}`);
      });
    });
    return lines.join('\r\n') + '\r\n';
  }

  async function polizas(periodo) {
    await cargar();
    if (!(D.cta || []).length) { Toast.warning('Primero captura el catálogo de cuentas en Configuración › Contabilidad.'); return; }
    const { polizas: ps, faltantes } = generar(periodo);
    if (!ps.length) { Toast.info('No hay movimientos en ese mes.'); return; }
    const tipoTxt = { 1: 'Ingresos', 2: 'Egresos', 3: 'Diario' };
    const filas = []; ps.forEach(p => p.movs.forEach(m => filas.push({ Fecha: p.fecha, Tipo: tipoTxt[p.tipo], 'Número': p.numero, 'Concepto póliza': p.concepto, Cuenta: m.cuenta, 'Nombre cuenta': m.nombre, Cargo: m.cargo || '', Abono: m.abono || '', Referencia: m.ref, UUID: m.uuid, 'Concepto movimiento': m.concepto })));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(filas); ws['!cols'] = [12, 10, 8, 50, 14, 30, 14, 14, 12, 38, 50].map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, 'Pólizas');
    const res = XLSX.utils.json_to_sheet(ps.map(p => ({ Fecha: p.fecha, Tipo: tipoTxt[p.tipo], 'Número': p.numero, Concepto: p.concepto, Cargos: r2(p.movs.reduce((s, m) => s + m.cargo, 0)), Abonos: r2(p.movs.reduce((s, m) => s + m.abono, 0)) }))); XLSX.utils.book_append_sheet(wb, res, 'Resumen');
    XLSX.writeFile(wb, `polizas_${periodo}.xlsx`);
    const txt = new Blob([contpaqi(ps)], { type: 'text/plain;charset=windows-1252' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(txt); a.download = `polizas_${periodo}_contpaqi.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    if (faltantes.size) Toast.warning(`Faltan cuentas para: ${[...faltantes].join(', ')}. Captúralas en Configuración › Contabilidad y vuelve a descargar.`, 8000);
    else Toast.success(`${ps.length} pólizas descargadas (XLSX y TXT CONTPAQi).`);
    try { Telemetry.track('polizas_descargadas', { periodo, n: ps.length }); } catch (e) { }
  }

  // ===== Configuración › Contabilidad =====
  function configHtml() {
    setTimeout(renderConfig, 0);
    return `<div class="g rounded-xl p-4" id="ctaCard"><div class="flex items-center justify-between mb-2"><h3 class="font-bold text-sm"><i class="ri-book-open-line n" aria-hidden="true"></i> Cuentas contables</h3></div><p class="text-xs text-slate-600 mb-3">Con estas cuentas se arman las pólizas del mes que descargas en Cierres (XLSX para Aspel COI y TXT para CONTPAQi). Pide a tu contador los números de su catálogo.</p><div id="ctaBody" class="text-sm text-ink-subtle">Cargando…</div></div>`;
  }
  async function renderConfig() {
    const el = document.getElementById('ctaBody'); if (!el) return;
    await cargar(true);
    if (!(D.cta || []).length) { el.innerHTML = `<button type="button" class="btn btn-p text-sm" onclick="Contabilidad.crearDefault()"><i class="ri-magic-line" aria-hidden="true"></i> Crear catálogo sugerido</button><p class="text-xs text-ink-subtle mt-2">Crea las cuentas base y una de costo por cada categoría de gasto; después ajusta los números.</p>`; return; }
    const cats = (D.catg || []).filter(c => c.activa !== false).map(c => c.nombre);
    const roles = [...ROLES, ...cats.map(c => ['costo:' + c, 'Costo de obra: ' + c])];
    el.innerHTML = `<div class="grid md:grid-cols-2 gap-2">${roles.map(([rol, label]) => { const c = cuentaDe(rol) || {}; return `<label class="text-xs">${S(label)}<div class="flex gap-1 mt-1"><input class="inp" data-rol="${S(rol)}" data-campo="cuenta" value="${S(c.cuenta || '')}" placeholder="Número" style="max-width:130px"><input class="inp flex-1" data-rol="${S(rol)}" data-campo="nombre" value="${S(c.nombre || label)}" placeholder="Nombre en el sistema del contador"></div></label>`; }).join('')}</div><button type="button" class="btn btn-p text-sm mt-3" onclick="Contabilidad.guardar()"><i class="ri-save-line" aria-hidden="true"></i> Guardar cuentas</button>`;
  }
  async function crearDefault() {
    const { data, error } = await sb.rpc('cuentas_contables_default');
    if (error || !data?.success) { Toast.error(humanizeError(error, 'crear el catálogo')); return; }
    Toast.success(`${data.cuentas} cuentas creadas; ajusta los números si tu contador usa otros.`); renderConfig();
  }
  async function guardar() {
    const inputs = [...document.querySelectorAll('#ctaBody input[data-rol]')];
    const porRol = {}; inputs.forEach(i => { porRol[i.dataset.rol] = porRol[i.dataset.rol] || {}; porRol[i.dataset.rol][i.dataset.campo] = i.value.trim(); });
    const filas = Object.entries(porRol).filter(([, v]) => v.cuenta).map(([rol, v]) => ({ empresa_id: currentUser.empresa_id, rol, cuenta: v.cuenta, nombre: v.nombre || rol, updated_at: new Date().toISOString() }));
    const { error } = await sb.from('cuentas_contables').upsert(filas, { onConflict: 'empresa_id,rol' });
    if (error) { Toast.error(humanizeError(error, 'guardar las cuentas')); return; }
    const vacias = Object.entries(porRol).filter(([, v]) => !v.cuenta).map(([rol]) => rol);
    if (vacias.length) await sb.from('cuentas_contables').delete().eq('empresa_id', currentUser.empresa_id).in('rol', vacias);
    Toast.success('Cuentas guardadas.'); renderConfig();
  }

  return { cargar, generar, contpaqi, polizas, configHtml, renderConfig, crearDefault, guardar, ROLES };
})();
if (typeof module !== 'undefined') module.exports = Contabilidad;
