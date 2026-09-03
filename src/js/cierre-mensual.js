/**
 * Cierre mensual para el contador (fase 2: US-118). Módulo de menú 'ci' (Contabilidad › Cierres).
 * Lista los últimos 12 meses con totales y pendientes, genera el paquete ZIP (XLSX + PDF + XML) y cierra o reabre el mes.
 * Depende de: D, S, F, fmt, $, currentUser, sb, Toast, Dialog, humanizeError, hoyISO, Finanzas, JSZip, XLSX, jsPDF, Telemetry.
 */
const Cierres = (() => {
  const num = (v) => parseFloat(v) || 0;
  const r2 = (v) => Math.round(v * 100) / 100;
  let cargado = false;
  const esAdmin = () => (currentUser?.nivel || 0) >= 100;
  const mesLabel = (p) => new Date(+p.slice(0, 4), +p.slice(5, 7) - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

  async function cargar(force) {
    if (cargado && !force) return;
    try { const { data } = await sb.from('cierres_mensuales').select('*').eq('empresa_id', currentUser.empresa_id); D.cierres = data || []; cargado = true; } catch (e) { D.cierres = D.cierres || []; }
  }
  function cierreDe(periodo) { return (D.cierres || []).find(c => c.periodo === periodo); }
  /** true si la fecha cae en un mes cerrado (para bloquear ediciones a usuarios que no son administradores). */
  function bloqueado(fecha) {
    const p = String(fecha || '').slice(0, 7); if (!p) return false;
    const c = cierreDe(p); return !!(c && c.estado === 'cerrado');
  }
  async function verificarEdicion(fecha) {
    if (!bloqueado(fecha)) return true;
    if (!esAdmin()) { Toast.error(`${mesLabel(String(fecha).slice(0, 7))} está cerrado; pide a un administrador que lo reabra.`); return false; }
    return await Dialog.confirm({ title: 'Mes cerrado', body: `${mesLabel(String(fecha).slice(0, 7))} ya se cerró y se envió al contador. Si continúas, el cambio quedará fuera del paquete enviado.`, confirmText: 'Editar de todos modos', tone: 'danger' });
  }

  function pendientes(periodo) {
    const rg = Finanzas.rango(periodo);
    const g = (D.g || []).filter(x => Finanzas.enRango(x.fecha_solicitud, rg.desde, rg.hasta) && x.estatus_pago !== 'Rechazado');
    const items = [];
    const sinCat = g.filter(x => !x.categoria); if (sinCat.length) items.push({ n: sinCat.length, t: 'gastos sin categoría', a: "Compras.setTab('todos')" });
    const sinFac = g.filter(x => x.tipo_comprobante === 'Fiscal' && x.comprobacion !== 'facturado' && x.destino !== 'socio'); if (sinFac.length) items.push({ n: sinFac.length, t: 'gastos con factura pendiente', a: "Compras.setTab('comprobante')" });
    const porAprobar = g.filter(x => !x.aprobado_at && x.estatus_pago !== 'Rechazado'); if (porAprobar.length) items.push({ n: porAprobar.length, t: 'compras por aprobar', a: "Compras.setTab('aprobar')" });
    const ind = g.filter(x => (x.destino || (x.obra_id ? 'obra' : 'indirecto')) === 'indirecto' && !x.obra_id && !(D.gad || []).some(d => d.gasto_id === x.id)); if (ind.length) items.push({ n: ind.length, t: 'indirectos sin repartir entre obras', a: 'Socios.prorratearAhora()' });
    const sinConc = [...(D.prc || []).filter(p => Finanzas.enRango(p.fecha_pago, rg.desde, rg.hasta) && !p.conciliado_at), ...(D.ppv || []).filter(p => Finanzas.enRango(p.fecha_pago, rg.desde, rg.hasta) && !p.conciliado_at)]; if (sinConc.length) items.push({ n: sinConc.length, t: 'cobros y pagos sin conciliar con el banco', a: "pcTab='conciliar';M='pc';R()" });
    return items;
  }
  function totales(periodo) {
    const rg = Finanzas.rango(periodo);
    const f = Finanzas.calcularFlujo({ desde: rg.desde, hasta: rg.hasta });
    const er = Finanzas.estadoResultados({ desde: rg.desde, hasta: rg.hasta, base: D.fcfg?.base_resultados || 'caja' });
    const gastos = (D.g || []).filter(x => Finanzas.enRango(x.fecha_solicitud, rg.desde, rg.hasta) && x.estatus_pago !== 'Rechazado');
    return { cobrado: f.cobrado, pagado: f.pagado, gastos: r2(gastos.reduce((s, g) => s + num(g.monto_neto), 0)), nGastos: gastos.length, iva: r2(gastos.filter(g => g.comprobacion === 'facturado').reduce((s, g) => s + num(g.iva), 0)), nomina: f.nomina, retiros: f.retiros, utilidadNeta: er.utilidadNeta };
  }

  async function render(c) {
    c.innerHTML = '<p class="text-sm text-ink-muted p-4">Cargando…</p>';
    await cargar(); if (typeof Socios !== 'undefined') await Socios.cargar();
    const meses = []; const h = hoyISO(); for (let i = 0; i < 12; i++) { const d = new Date(+h.slice(0, 4), +h.slice(5, 7) - 1 - i, 1); meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    c.innerHTML = `<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4"><div><h1 class="text-xl font-bold"><i class="ri-archive-drawer-line" aria-hidden="true"></i> Cierres mensuales</h1><p class="text-sm text-ink-muted mt-1">Cierra el mes con un clic y manda al contador un paquete con todo: gastos con UUID, cobros, pagos, nómina, retiros y los XML.</p></div></div>
<div class="space-y-2">${meses.map(p => { const ci = cierreDe(p); const t = totales(p); const pend = pendientes(p); const cerrado = ci && ci.estado === 'cerrado'; return `<details class="g rounded-xl" ${p === h.slice(0, 7) ? 'open' : ''}><summary class="p-3 flex flex-wrap items-center gap-3 cursor-pointer list-none"><span class="font-semibold capitalize flex-1 min-w-[160px]">${mesLabel(p)}</span><span class="px-2 py-0.5 rounded-full text-xs ${cerrado ? 'bg-emerald-100 text-emerald-800' : ci ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}">${cerrado ? 'Cerrado' : ci ? 'Reabierto' : 'Abierto'}</span><span class="text-xs text-ink-subtle">cobrado ${F(t.cobrado)} · gastos ${F(t.gastos)} (${t.nGastos}) · utilidad ${F(t.utilidadNeta)}</span>${pend.length ? `<span class="text-xs text-warn">${pend.reduce((s, x) => s + x.n, 0)} pendiente(s)</span>` : '<span class="text-xs text-ok">sin pendientes</span>'}</summary>
<div class="border-t border-line p-3 grid md:grid-cols-2 gap-4"><div><h3 class="text-sm font-semibold mb-1">Antes de cerrar</h3>${pend.length ? `<ul class="text-sm space-y-1">${pend.map(x => `<li><button type="button" class="link" onclick="${x.a}">${x.n} ${x.t}</button></li>`).join('')}</ul>` : '<p class="text-sm text-ok">Todo en orden.</p>'}
<h3 class="text-sm font-semibold mt-3 mb-1">Totales</h3><dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-sm"><dt class="text-ink-subtle">Cobrado</dt><dd class="text-right">${F(t.cobrado)}</dd><dt class="text-ink-subtle">Pagado (caja)</dt><dd class="text-right">${F(t.pagado)}</dd><dt class="text-ink-subtle">Gastos registrados</dt><dd class="text-right">${F(t.gastos)}</dd><dt class="text-ink-subtle">IVA acreditable (facturado)</dt><dd class="text-right">${F(t.iva)}</dd><dt class="text-ink-subtle">Nómina</dt><dd class="text-right">${F(t.nomina)}</dd>${esAdmin() ? `<dt class="text-ink-subtle">Retiros de socios</dt><dd class="text-right">${F(t.retiros)}</dd>` : ''}<dt class="text-ink-subtle font-medium">Utilidad neta</dt><dd class="text-right font-bold ${t.utilidadNeta < 0 ? 'text-danger' : ''}">${F(t.utilidadNeta)}</dd></dl></div>
<div><h3 class="text-sm font-semibold mb-1">Paquete para el contador</h3><p class="text-xs text-ink-subtle mb-2">ZIP con gastos.xlsx, cobros.xlsx, pagos.xlsx, nomina.xlsx${esAdmin() ? ', retiros_socios.xlsx' : ''}, resumen.pdf y la carpeta xml/ del mes.${esAdmin() ? ' Las pólizas (CONTPAQi / Aspel COI) usan las cuentas de Configuración › Contabilidad.' : ''}</p>
<div class="flex flex-wrap gap-2"><button type="button" class="btn btn-s text-sm" onclick="Cierres.paquete('${p}')"><i class="ri-download-2-line" aria-hidden="true"></i> Generar paquete</button>${esAdmin() && typeof Contabilidad !== 'undefined' ? `<button type="button" class="btn btn-s text-sm" onclick="Contabilidad.polizas('${p}')" title="XLSX para Aspel COI y TXT para CONTPAQi"><i class="ri-book-open-line" aria-hidden="true"></i> Descargar pólizas</button>` : ''}${esAdmin() ? (cerrado ? `<button type="button" class="btn btn-s text-sm" onclick="Cierres.reabrir('${p}')"><i class="ri-lock-unlock-line" aria-hidden="true"></i> Reabrir mes</button>` : `<button type="button" class="btn btn-p text-sm" onclick="Cierres.cerrar('${p}')"><i class="ri-lock-line" aria-hidden="true"></i> Cerrar ${mesLabel(p).split(' ')[0]}</button>`) : ''}${ci?.paquete_path ? `<button type="button" class="btn btn-s text-sm" onclick="Cierres.enlace('${p}')"><i class="ri-link" aria-hidden="true"></i> Copiar enlace del paquete (7 días)</button>` : ''}</div>
${ci ? `<p class="text-xs text-ink-subtle mt-2">${cerrado ? 'Cerrado' : 'Reabierto'} el ${String((cerrado ? ci.cerrado_at : ci.reabierto_at) || '').slice(0, 10)}${ci.motivo_reapertura ? ' · ' + S(ci.motivo_reapertura) : ''}</p>` : ''}</div></div></details>`; }).join('')}</div>`;
  }

  function hoja(wb, nombre, filas, cols) {
    const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{ '(sin registros)': '' }]);
    if (cols) ws['!cols'] = cols.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, nombre);
  }
  async function paquete(periodo) {
    Toast.info('Armando el paquete…');
    try {
      const rg = Finanzas.rango(periodo);
      const zip = new JSZip();
      const obraTxt = (id) => { const o = (D.o || []).find(x => x.id === id); return o ? (o.codigo_obra || o.nombre_obra) : ''; };
      const prov = (id) => (D.pv || []).find(p => p.id === id) || {};
      const gastos = (D.g || []).filter(x => Finanzas.enRango(x.fecha_solicitud, rg.desde, rg.hasta) && x.estatus_pago !== 'Rechazado').sort((a, b) => String(a.fecha_solicitud).localeCompare(String(b.fecha_solicitud)));
      const wbG = XLSX.utils.book_new();
      hoja(wbG, 'Gastos', gastos.map(g => ({ Fecha: String(g.fecha_solicitud).slice(0, 10), Proveedor: prov(g.proveedor_id).nombre_proveedor || '', RFC: prov(g.proveedor_id).rfc || '', Concepto: g.descripcion || '', Categoría: g.categoria || '', Destino: (g.destino || (g.obra_id ? 'obra' : 'indirecto')), Obra: obraTxt(g.obra_id), Subtotal: num(g.subtotal), IVA: num(g.iva), Total: num(g.monto_neto), Pagado: num(g.monto_pagado), 'Pagó': g.pagado_por_socio_id ? ((D.soc || []).find(s => s.id === g.pagado_por_socio_id)?.nombre || 'Socio') : 'Empresa', Comprobación: g.comprobacion || '', UUID: g.folio_fiscal || '', Factura: g.factura_numero || '' })), [12, 28, 14, 40, 18, 10, 12, 12, 10, 12, 12, 12, 16, 38, 12]);
      zip.file('gastos.xlsx', XLSX.write(wbG, { type: 'array', bookType: 'xlsx' }));
      const cobros = (D.prc || []).filter(p => Finanzas.enRango(p.fecha_pago, rg.desde, rg.hasta));
      const wbC = XLSX.utils.book_new(); hoja(wbC, 'Cobros', cobros.map(p => ({ Folio: p.numero_pago || '', Fecha: String(p.fecha_pago).slice(0, 10), Obra: obraTxt(p.obra_id), Concepto: p.concepto || '', Método: p.metodo_pago || '', Referencia: p.referencia || '', Monto: num(p.monto), 'UUID factura': p.factura_numero || '', Conciliado: p.conciliado_at ? 'sí' : 'no' })), [10, 12, 14, 40, 14, 16, 12, 38, 10]);
      zip.file('cobros.xlsx', XLSX.write(wbC, { type: 'array', bookType: 'xlsx' }));
      const pagos = (D.ppv || []).filter(p => Finanzas.enRango(p.fecha_pago, rg.desde, rg.hasta));
      const wbP = XLSX.utils.book_new(); hoja(wbP, 'Pagos', pagos.map(p => ({ Folio: p.numero_pago || '', Fecha: String(p.fecha_pago).slice(0, 10), Proveedor: prov(p.proveedor_id).nombre_proveedor || '', Concepto: p.concepto || '', Obra: obraTxt(p.obra_id), Método: p.metodo_pago || '', Referencia: p.referencia || '', Monto: num(p.monto), Conciliado: p.conciliado_at ? 'sí' : 'no' })), [10, 12, 28, 40, 14, 14, 16, 12, 10]);
      zip.file('pagos.xlsx', XLSX.write(wbP, { type: 'array', bookType: 'xlsx' }));
      const nom = (D.nom || []).filter(n => Finanzas.enRango(n.fecha_pago || n.periodo_fin, rg.desde, rg.hasta));
      const wbN = XLSX.utils.book_new(); hoja(wbN, 'Nómina', nom.map(n => ({ Empleado: (D.e || []).find(e => e.id === n.empleado_id)?.nombre_completo || n.empleado_id, 'Periodo inicio': n.periodo_inicio || '', 'Periodo fin': n.periodo_fin || '', 'Sueldo base': num(n.sueldo_base), Descuentos: num(n.descuentos), 'Total a pagar': num(n.total_pagar), Estatus: n.estatus || '', 'Fecha de pago': n.fecha_pago || '', Obra: (D.nomd || []).filter(d => d.nomina_id === n.id).map(d => obraTxt(d.obra_id) + ' ' + num(d.porcentaje) + '%').join(', ') })), [28, 12, 12, 12, 12, 12, 10, 12, 30]);
      zip.file('nomina.xlsx', XLSX.write(wbN, { type: 'array', bookType: 'xlsx' }));
      if (esAdmin()) { const movs = (D.msoc || []).filter(m => Finanzas.enRango(m.fecha, rg.desde, rg.hasta)); const wbS = XLSX.utils.book_new(); hoja(wbS, 'Socios', movs.map(m => ({ Fecha: String(m.fecha).slice(0, 10), Socio: (D.soc || []).find(s => s.id === m.socio_id)?.nombre || '', Tipo: m.tipo, Concepto: m.concepto || '', Monto: num(m.monto), Referencia: m.referencia || '' })), [12, 22, 16, 40, 12, 16]); zip.file('retiros_socios.xlsx', XLSX.write(wbS, { type: 'array', bookType: 'xlsx' })); }
      // resumen.pdf
      const er = Finanzas.estadoResultados({ desde: rg.desde, hasta: rg.hasta, base: D.fcfg?.base_resultados || 'caja' });
      const f = Finanzas.calcularFlujo({ desde: rg.desde, hasta: rg.hasta });
      const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'letter' });
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(currentUser?.empresa_nombre || 'Empresa', 20, 18); doc.setFontSize(12); doc.text(`Resumen del mes: ${mesLabel(periodo)}`, 20, 26);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`Generado el ${hoyISO()} · base ${er.base}`, 20, 31);
      doc.autoTable({ startY: 36, head: [['Estado de resultados', 'Monto']], body: [['Ingresos', F(er.ingresos)], ['Costo directo de obras', '−' + F(er.directos)], ['Utilidad bruta', F(er.utilidadBruta)], ['Gastos indirectos', '−' + F(er.indirectosTotal)], ['Nómina no asignada a obra', '−' + F(er.nominaNoAsignada)], ['Utilidad neta', F(er.utilidadNeta)], ['Gastos personales de socios', F(er.personales)], ['Retiros de socios', F(er.retiros)]], styles: { fontSize: 9 }, headStyles: { fillColor: [30, 41, 59] }, columnStyles: { 1: { halign: 'right' } } });
      doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, head: [['Flujo de efectivo', 'Monto']], body: [['Cobrado', F(f.cobrado)], ['Pagado a proveedores y gastos', '−' + F(f.pagosProv + f.gastosPagados)], ['Nómina pagada', '−' + F(f.nomina)], ['Retiros', '−' + F(f.retiros)], ['Flujo neto', F(f.neto)], ['Por cobrar al cierre', F(f.porCobrar)], ['Por pagar al cierre', F(f.porPagar)]], styles: { fontSize: 9 }, headStyles: { fillColor: [30, 41, 59] }, columnStyles: { 1: { halign: 'right' } } });
      doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, head: [['Obra', 'Ingreso', 'Costo directo', 'Indirectos', 'Utilidad']], body: er.filas.map(x => [x.obra.codigo_obra || x.obra.nombre_obra, F(x.ingreso), F(x.directo), F(x.indirectos), F(x.utilidad)]), styles: { fontSize: 8 }, headStyles: { fillColor: [30, 41, 59] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } } });
      zip.file('resumen.pdf', doc.output('arraybuffer'));
      // xml del mes desde Storage
      try {
        const { data: lista } = await sb.storage.from('comprobantes').list(`empresa/${currentUser.empresa_id}/xml`, { limit: 1000 });
        const uuids = new Set([...(D.fr || []).filter(x => Finanzas.enRango(x.fecha_emision, rg.desde, rg.hasta)).map(x => (x.uuid_cfdi || '').toUpperCase()), ...(D.cfdi || []).filter(x => Finanzas.enRango(x.fecha_emision, rg.desde, rg.hasta)).map(x => (x.uuid || '').toUpperCase())]);
        let n = 0;
        for (const it of (lista || [])) { const u = it.name.replace(/\.xml$/i, '').toUpperCase(); if (!uuids.has(u)) continue; const { data: blob } = await sb.storage.from('comprobantes').download(`empresa/${currentUser.empresa_id}/xml/${it.name}`); if (blob) { zip.file('xml/' + it.name, await blob.arrayBuffer()); n++; } }
        if (!n) zip.file('xml/LEEME.txt', 'No hay XML importados para este mes. Impórtalos desde Compras › Importar XML.');
      } catch (e) { zip.file('xml/LEEME.txt', 'No se pudieron descargar los XML: ' + (e.message || e)); }
      const blob = await zip.generateAsync({ type: 'blob' });
      const nombre = `Cierre_${periodo}_${(currentUser?.empresa_nombre || 'empresa').replace(/[^\w]+/g, '_')}.zip`;
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      // copia en Storage para el enlace de 7 días
      try { const path = `empresa/${currentUser.empresa_id}/cierres/${nombre}`; const { error } = await sb.storage.from('comprobantes').upload(path, blob, { contentType: 'application/zip', upsert: true }); if (!error) { const ci = cierreDe(periodo); if (ci) { await sb.from('cierres_mensuales').update({ paquete_path: path }).eq('id', ci.id); ci.paquete_path = path; } window._ultimoPaquete = { periodo, path }; } } catch (e) { }
      Toast.success('Paquete descargado.');
    } catch (e) { Toast.error(humanizeError(e, 'No se pudo armar el paquete')); }
  }
  async function cerrar(periodo) {
    if (!esAdmin()) return;
    const pend = pendientes(periodo);
    const ok = await Dialog.confirm({ title: `Cerrar ${mesLabel(periodo)}`, body: (pend.length ? `Hay ${pend.reduce((s, x) => s + x.n, 0)} pendiente(s): ${pend.map(x => x.n + ' ' + x.t).join(', ')}.\n` : '') + 'Los registros del mes quedan de sólo lectura para el equipo (tú podrás reabrirlo).', confirmText: 'Cerrar mes' });
    if (!ok) return;
    const t = totales(periodo);
    const row = { empresa_id: currentUser.empresa_id, periodo, estado: 'cerrado', cerrado_por: currentUser.id, cerrado_at: new Date().toISOString(), totales: t, paquete_path: window._ultimoPaquete?.periodo === periodo ? window._ultimoPaquete.path : (cierreDe(periodo)?.paquete_path || null) };
    const { data, error } = await sb.from('cierres_mensuales').upsert(row, { onConflict: 'empresa_id,periodo' }).select().single();
    if (error) { Toast.error(humanizeError(error, 'No se pudo cerrar el mes')); return; }
    D.cierres = (D.cierres || []).filter(c => c.periodo !== periodo).concat([data]);
    try { Telemetry.track('mes_cerrado', { periodo, pendientes: pend.length }); } catch (e) { }
    Toast.success(`${mesLabel(periodo)} cerrado.`); render($('c'));
  }
  async function reabrir(periodo) {
    const ci = cierreDe(periodo); if (!ci || !esAdmin()) return;
    let dlg = $('dlgReabrir'); if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'dlgReabrir'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
    dlg.innerHTML = `<form method="dialog" onsubmit="Cierres._reabrir(event,'${periodo}')"><h2 class="font-bold mb-2">Reabrir ${mesLabel(periodo)}</h2><label class="text-xs mb-1 block" for="reMotivo">Motivo *</label><textarea id="reMotivo" class="inp" rows="2" required placeholder="Ej. llegó una factura de proveedor con fecha del mes"></textarea><div class="flex gap-2 mt-3"><button type="button" class="btn btn-s flex-1" onclick="this.closest('dialog').close()">Cancelar</button><button type="submit" class="btn btn-p flex-1">Reabrir</button></div></form>`;
    dlg.showModal();
  }
  async function _reabrir(e, periodo) {
    e.preventDefault(); const motivo = $('reMotivo').value.trim(); if (!motivo) return;
    const ci = cierreDe(periodo);
    const { data, error } = await sb.from('cierres_mensuales').update({ estado: 'reabierto', reabierto_por: currentUser.id, reabierto_at: new Date().toISOString(), motivo_reapertura: motivo }).eq('id', ci.id).select().single();
    if (error) { Toast.error(humanizeError(error)); return; }
    Object.assign(ci, data); $('dlgReabrir').close(); Toast.success('Mes reabierto.'); render($('c'));
  }
  async function enlace(periodo) {
    const ci = cierreDe(periodo); if (!ci?.paquete_path) return;
    const { data, error } = await sb.storage.from('comprobantes').createSignedUrl(ci.paquete_path, 7 * 86400);
    if (error || !data?.signedUrl) { Toast.error('No se pudo generar el enlace.'); return; }
    try { await navigator.clipboard.writeText(data.signedUrl); Toast.success('Enlace copiado (vence en 7 días).'); } catch (e) { Toast.info(data.signedUrl, 10000); }
  }

  return { render, cargar, bloqueado, verificarEdicion, pendientes, totales, paquete, cerrar, reabrir, _reabrir, enlace };
})();
