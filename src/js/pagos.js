/**
 * Pagos a proveedores, cuentas por pagar, flujo y ficha de proveedor (fase 2: US-110 a US-113).
 * Se monta dentro del módulo Pagos (Pc) del index.html: renderiza en #pcContent y expone
 *   PagosProv.abrir({gastoId|proveedorId|pagoId})   modal de pago (uno, varios o en lote)
 *   PagosProv.renderPorPagar() / renderPagos() / renderFlujo()
 *   PagosProv.abrirProveedor(id)                     ficha lateral con estado de cuenta
 * Depende de globales: D, S, F, fmt, $, currentUser, selectedObra, openMdl, closeMdl, Toast, Dialog, humanizeError,
 * hoyISO, getFilteredObras, filterByEmpresa, vacio, sb, Telemetry, Finanzas, Compras, Chart, XLSX, editProveedor.
 */
const PagosProv = (() => {
  const num = (v) => parseFloat(v) || 0;
  const r2 = (v) => Math.round(v * 100) / 100;
  let filtroPagar = 'todas';   // todas | semana | vencidas
  let periodoFlujo = 'mes';    // mes | trim | anio | todo
  let chart = null;
  let modo = null;             // {tipo:'nuevo'|'editar', pagoId}

  const prov = (id) => (D.pv || []).find(p => p.id == id);
  const provNombre = (id) => prov(id)?.nombre_proveedor || 'Sin proveedor';
  const obraDe = (id) => (D.o || []).find(o => o.id == id);
  const obraIds = () => selectedObra ? [parseInt(selectedObra)] : null;
  const fechaCorta = (f) => f ? new Date(String(f).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : '-';

  // ---------- Por pagar ----------
  function renderPorPagar() {
    const c = $('pcContent'); if (!c) return;
    let rows = Finanzas.cuentasPorPagar({ obraIds: obraIds() });
    const aging = Finanzas.agingPagar(rows);
    if (filtroPagar === 'semana') rows = rows.filter(r => r.bucket !== 'por_vencer');
    if (filtroPagar === 'vencidas') rows = rows.filter(r => r.bucket === 'vencida');
    const grupos = new Map();
    rows.forEach(r => { const k = r.gasto.proveedor_id || 0; if (!grupos.has(k)) grupos.set(k, { id: k, rows: [], saldo: 0, proxima: r.vence, vencidas: 0 }); const g = grupos.get(k); g.rows.push(r); g.saldo = r2(g.saldo + r.saldo); if (r.vence < g.proxima) g.proxima = r.vence; if (r.bucket === 'vencida') g.vencidas++; });
    const lista = [...grupos.values()].sort((a, b) => a.proxima.localeCompare(b.proxima));
    const chip = (k, l, n) => `<button type="button" class="tab ${filtroPagar === k ? 'active' : ''}" role="tab" aria-selected="${filtroPagar === k}" onclick="PagosProv.filtrarPagar('${k}')">${l} <span class="tab-n">${n}</span></button>`;
    c.innerHTML = `
<div class="kpi-strip"><div class="kpi"><p class="kpi-v">${F(aging.total)}</p><p class="kpi-l">Por pagar a proveedores</p></div><div class="kpi"><p class="kpi-v ${aging.vencida.monto ? 'text-danger' : ''}">${F(aging.vencida.monto)}</p><p class="kpi-l">Vencido · ${aging.vencida.n}</p></div><div class="kpi"><p class="kpi-v ${aging.semana.monto ? 'text-warn' : ''}">${F(aging.semana.monto)}</p><p class="kpi-l">Vence en 7 días · ${aging.semana.n}</p></div><div class="kpi"><p class="kpi-v">${F(aging.por_vencer.monto)}</p><p class="kpi-l">Por vencer · ${aging.por_vencer.n}</p></div></div>
<div class="tabs mb-3" role="tablist" aria-label="Filtro de cuentas por pagar">${chip('todas', 'Todas', grupos.size)}${chip('semana', 'Vence esta semana', rows.filter(r => r.bucket !== 'por_vencer').length)}${chip('vencidas', 'Vencidas', aging.vencida.n)}</div>
${!lista.length ? vacio('cuentas por pagar', { icon: 'ri-bank-card-line', title: 'No debes nada a proveedores', body: 'Los gastos pendientes de pago aparecen aquí agrupados por proveedor, con su fecha de vencimiento.' }) : `<div class="space-y-2">${lista.map(g => {
      const p = prov(g.id);
      return `<details class="g rounded-xl" ${lista.length <= 3 ? 'open' : ''}><summary class="p-3 flex flex-wrap items-center gap-3 cursor-pointer list-none">
<div class="flex-1 min-w-0"><p class="font-semibold truncate">${g.id ? `<button type="button" class="link" onclick="event.preventDefault();PagosProv.abrirProveedor(${g.id})">${S(provNombre(g.id))}</button>` : 'Sin proveedor'}</p><p class="text-xs text-ink-subtle">${g.rows.length} gasto${g.rows.length > 1 ? 's' : ''} · próximo vence ${fechaCorta(g.proxima)}${g.vencidas ? ` · <span class="text-danger font-medium">${g.vencidas} vencido${g.vencidas > 1 ? 's' : ''}</span>` : ''}${p?.clabe ? '' : (g.id ? ' · <span class="text-warn">sin CLABE</span>' : '')}</p></div>
<p class="font-bold whitespace-nowrap">${F(g.saldo)}</p>
<button type="button" class="btn btn-p text-xs" onclick="event.preventDefault();PagosProv.abrir({proveedorId:${g.id || 'null'},gastoIds:[${g.rows.map(r => r.gasto.id).join(',')}]})"><i class="ri-bank-card-line" aria-hidden="true"></i> Registrar pago</button></summary>
<div class="border-t border-line divide-y divide-slate-100">${g.rows.map(r => `<div class="px-3 py-2 flex flex-wrap items-center gap-2 text-sm"><span class="text-xs w-16 shrink-0 ${r.bucket === 'vencida' ? 'text-danger font-medium' : r.bucket === 'semana' ? 'text-warn' : 'text-ink-subtle'}">${fechaCorta(r.vence)}</span><span class="flex-1 min-w-0 truncate">${S(r.gasto.descripcion || r.gasto.categoria)}${r.gasto.obra_id ? ` <span class="text-xs text-ink-subtle">· ${S(obraDe(r.gasto.obra_id)?.codigo_obra || '')}</span>` : ' <span class="text-xs text-ink-subtle">· indirecto</span>'}${!r.aprobado ? ' <span class="chip chip-ind">por aprobar</span>' : ''}</span><span class="text-xs text-ink-subtle">${num(r.gasto.monto_pagado) ? 'pagado ' + F(r.gasto.monto_pagado) + ' de ' + F(r.gasto.monto_neto) : ''}</span><span class="font-medium whitespace-nowrap">${F(r.saldo)}</span><button type="button" class="btn-icon" onclick="PagosProv.abrir({gastoId:${r.gasto.id}})" aria-label="Pagar este gasto" title="Pagar"><i class="ri-bank-card-line" aria-hidden="true"></i></button></div>`).join('')}</div></details>`;
    }).join('')}</div>`}`;
  }
  function filtrarPagar(k) { filtroPagar = k; renderPorPagar(); }

  // ---------- Pagos realizados ----------
  function renderPagos(pp) {
    const c = $('pcContent'); if (!c) return;
    const data = (pp || (typeof getFilteredPagosProveedores === 'function' ? getFilteredPagosProveedores() : (D.ppv || []))).slice().sort((a, b) => String(b.fecha_pago).localeCompare(String(a.fecha_pago)) || b.id - a.id);
    if (!data.length) { c.innerHTML = vacio('pagos a proveedores', { icon: 'ri-arrow-up-circle-line', body: 'Cuando pagues una compra, regístralo desde la pestaña Por pagar o desde el gasto; aquí queda el historial con su comprobante.', action: { label: 'Registrar pago', onClick: 'PagosProv.abrir({})' } }); return; }
    c.innerHTML = `<div class="g rounded-xl overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-slate-50 text-xs text-ink-muted"><tr><th class="p-2 text-left">Folio</th><th class="p-2 text-left">Fecha</th><th class="p-2 text-left">Proveedor</th><th class="p-2 text-left hidden md:table-cell">Qué se pagó</th><th class="p-2 text-left hidden lg:table-cell">Obra</th><th class="p-2 text-left hidden sm:table-cell">Método</th><th class="p-2 text-right">Monto</th><th class="p-2"></th></tr></thead><tbody>
${data.map(p => { const g = (D.g || []).find(x => x.id === p.gasto_id); const o = obraDe(p.obra_id); return `<tr class="border-t border-line hover:bg-slate-50"><td class="p-2 font-mono text-xs">${S(p.numero_pago || '')}${p.conciliado_at ? ' <i class="ri-checkbox-circle-line text-ok" title="Conciliado con el banco" aria-label="Conciliado"></i>' : ''}</td><td class="p-2 whitespace-nowrap">${String(p.fecha_pago || '').slice(0, 10)}</td><td class="p-2">${p.proveedor_id ? `<button type="button" class="link" onclick="PagosProv.abrirProveedor(${p.proveedor_id})">${S(provNombre(p.proveedor_id))}</button>` : '<span class="text-ink-subtle">-</span>'}</td><td class="p-2 hidden md:table-cell text-xs">${S(p.concepto || g?.descripcion || '')}</td><td class="p-2 hidden lg:table-cell text-xs">${o ? S(o.codigo_obra || o.nombre_obra) : '<span class="text-ink-subtle">indirecto</span>'}</td><td class="p-2 hidden sm:table-cell text-xs">${S(p.metodo_pago || '')}${p.referencia ? ` <span class="text-ink-subtle">· ${S(p.referencia)}</span>` : ''}</td><td class="p-2 text-right font-semibold whitespace-nowrap">${F(p.monto)}</td><td class="p-2 text-right whitespace-nowrap"><button type="button" class="btn-icon" onclick="PagosProv.comprobantePDF(${p.id})" aria-label="Comprobante de pago en PDF" title="Comprobante PDF"><i class="ri-file-pdf-line" aria-hidden="true"></i></button><button type="button" class="btn-icon" onclick="PagosProv.editar(${p.id})" aria-label="Editar pago" title="Editar"><i class="ri-edit-line" aria-hidden="true"></i></button><button type="button" class="btn-icon text-danger" onclick="PagosProv.eliminar(${p.id})" aria-label="Eliminar pago" title="Eliminar"><i class="ri-delete-bin-line" aria-hidden="true"></i></button></td></tr>`; }).join('')}
</tbody></table></div></div>`;
  }

  // ---------- Flujo ----------
  function renderFlujo() {
    const c = $('pcContent'); if (!c) return;
    if (typeof pcPeriodo !== 'undefined') periodoFlujo = pcPeriodo;
    const rg = Finanzas.rango(periodoFlujo);
    const f = Finanzas.calcularFlujo({ desde: rg.desde, hasta: rg.hasta, obraIds: obraIds() });
    const esAdmin = (currentUser?.nivel || 0) >= 100;
    const fila = (l, v, cls = '') => `<div class="flex justify-between py-1.5 border-b border-slate-100 text-sm"><span class="text-ink-muted">${l}</span><span class="font-medium ${cls}">${v}</span></div>`;
    c.innerHTML = `
<p class="text-sm text-ink-muted mb-3">Periodo: <b>${rg.label}</b> (cámbialo arriba a la derecha). Una sola fórmula para Pagos, el dashboard y los reportes: entra lo cobrado y las aportaciones en efectivo; sale lo pagado a proveedores, los gastos pagados al momento, la nómina y los retiros.</p>
<div class="grid md:grid-cols-2 gap-4">
<div class="g rounded-xl p-4"><h3 class="font-semibold text-sm mb-2">Qué salió</h3>${fila('Pagos a proveedores', F(f.pagosProv))}${fila('Gastos pagados al momento', F(f.gastosPagados))}${obraIds() ? '' : fila('Nómina pagada', F(f.nomina))}${esAdmin && !obraIds() ? fila('Retiros y utilidades a socios', F(f.retiros)) : ''}${fila('Pagado por los socios de su bolsa (no salió de caja)', F(f.porSocios), 'text-ink-subtle')}${esAdmin && !obraIds() && f.aportaciones ? fila('Aportaciones en efectivo de socios', F(f.aportaciones), 'text-ok') : ''}
<h3 class="font-semibold text-sm mt-4 mb-2">Qué viene</h3>${fila('Por cobrar en 30 días', F(f.proximos30.cobrar), 'text-ok')}${fila('Por pagar en 30 días', F(f.proximos30.pagar))}${fila('Por cobrar total', F(f.porCobrar) + (f.vencidoCobrar ? ` <span class="text-danger text-xs">(${F(f.vencidoCobrar)} vencido)</span>` : ''))}${fila('Por pagar total', F(f.porPagar) + (f.vencidoPagar ? ` <span class="text-danger text-xs">(${F(f.vencidoPagar)} vencido)</span>` : ''))}</div>
<div class="g rounded-xl p-4"><h3 class="font-semibold text-sm mb-2">Cobrado vs pagado por semana</h3><div style="position:relative;height:240px;width:100%"><canvas id="flujoChart" aria-label="Gráfica de cobrado y pagado por semana" role="img"></canvas></div></div>
</div>`;
    setTimeout(() => {
      const serie = Finanzas.serieSemanal({ desde: rg.desde || Finanzas.sumaDias(hoyISO(), -84), hasta: rg.hasta || hoyISO(), obraIds: obraIds() });
      const cv = $('flujoChart'); if (!cv || typeof Chart === 'undefined') return;
      if (chart) { try { chart.destroy(); } catch (e) { } }
      const css = getComputedStyle(document.documentElement);
      chart = new Chart(cv.getContext('2d'), { type: 'bar', data: { labels: serie.map(w => w.label), datasets: [{ label: 'Cobrado', data: serie.map(w => w.cobrado), backgroundColor: css.getPropertyValue('--ok').trim() || '#047857' }, { label: 'Pagado', data: serie.map(w => w.pagado), backgroundColor: css.getPropertyValue('--ink-subtle').trim() || '#64748b' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: (v) => '$' + (v / 1000).toFixed(0) + 'k' } } } } });
    }, 0);
  }
  function periodo(k) { periodoFlujo = k; renderFlujo(); }

  // ---------- Modal de pago ----------
  function ensureModal() {
    if ($('mdlPagoProv')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="mdlPagoProv" class="modal"><div class="g rounded-2xl p-5 w-full max-w-xl mx-4 max-h-[92vh] overflow-y-auto"><div id="mdlPagoProvBody"></div></div></div>`);
  }
  function pendientesDe(proveedorId, gastoIds) {
    let rows = Finanzas.cuentasPorPagar({});
    if (gastoIds && gastoIds.length) rows = rows.filter(r => gastoIds.includes(r.gasto.id));
    else if (proveedorId) rows = rows.filter(r => r.gasto.proveedor_id == proveedorId);
    else rows = [];
    return rows;
  }
  function abrir(opts = {}) {
    ensureModal();
    modo = { tipo: 'nuevo' };
    let proveedorId = opts.proveedorId || null; let gastoIds = opts.gastoIds || null;
    if (opts.gastoId) { const g = (D.g || []).find(x => x.id == opts.gastoId); if (g) { proveedorId = g.proveedor_id || null; gastoIds = [g.id]; } }
    const provs = filterByEmpresa(D.pv || []).filter(p => p.estatus !== 'Inactivo');
    const p = prov(proveedorId);
    $('mdlPagoProvBody').innerHTML = `
<div class="flex justify-between items-center mb-3"><h2 class="text-lg font-bold" id="ppTitulo">Registrar pago${p ? ' a ' + S(p.nombre_proveedor) : ''}</h2><button type="button" class="btn-icon" onclick="closeMdl('mdlPagoProv')" aria-label="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></div>
<form id="frmPagoProv" onsubmit="PagosProv.guardar(event)" novalidate>
<input type="hidden" id="ppPagoId" value="">
<div class="grid grid-cols-2 gap-3 force-2col">
<div class="col-span-2"><label class="text-xs mb-1 block" for="ppProveedor">Proveedor</label><select id="ppProveedor" class="inp" onchange="PagosProv.cambiarProveedor(this.value)"><option value="">Sin proveedor (pago suelto)</option>${provs.map(x => `<option value="${x.id}" ${x.id == proveedorId ? 'selected' : ''}>${S(x.nombre_proveedor)}</option>`).join('')}</select>${p?.clabe ? `<p class="text-xs text-ink-subtle mt-1">CLABE ${S(p.clabe)}${p.banco ? ' · ' + S(p.banco) : ''} <button type="button" class="link" onclick="PagosProv.copiarDatosPago(${p.id})">Copiar datos</button></p>` : ''}</div>
<div><label class="text-xs mb-1 block" for="ppFecha">Fecha del pago *</label><input type="date" id="ppFecha" class="inp" value="${hoyISO()}" required></div>
<div><label class="text-xs mb-1 block" for="ppMetodo">Método</label><select id="ppMetodo" class="inp"><option>Transferencia</option><option>Efectivo</option><option>Tarjeta</option><option>Cheque</option></select></div>
<div><label class="text-xs mb-1 block" for="ppReferencia">Referencia</label><input type="text" id="ppReferencia" class="inp" placeholder="Folio o número de operación"></div>
<div><label class="text-xs mb-1 block" for="ppBanco">Banco</label><input type="text" id="ppBanco" class="inp"></div>
</div>
<div class="mt-3"><p class="text-xs font-medium mb-1">Gastos que cubre este pago</p><div id="ppLista" class="border border-line rounded-lg divide-y divide-slate-100"></div><p class="text-xs text-ink-subtle mt-1">Puedes pagar una parte cambiando el monto aplicado. Si pagas de más, te preguntaremos qué hacer con el excedente.</p></div>
<div class="flex items-center justify-between mt-3"><span class="text-sm text-ink-muted">Total del pago</span><span class="text-xl font-bold" id="ppTotal">$0.00</span></div>
<div class="mt-2"><label class="text-xs mb-1 block" for="ppNotas">Notas</label><input type="text" id="ppNotas" class="inp"></div>
<div class="flex gap-3 mt-4"><button type="button" class="btn btn-s flex-1" onclick="closeMdl('mdlPagoProv')">Cancelar</button><button type="submit" class="btn btn-p flex-1" id="ppGuardar">Registrar pago</button></div>
</form>`;
    renderLista(proveedorId, gastoIds);
    openMdl('mdlPagoProv');
    setTimeout(() => $('ppFecha')?.focus(), 60);
  }
  function renderLista(proveedorId, gastoIds) {
    const box = $('ppLista'); if (!box) return;
    const rows = pendientesDe(proveedorId, gastoIds);
    if (!rows.length) {
      box.innerHTML = `<div class="p-3 text-sm"><p class="text-ink-muted">${proveedorId ? 'Este proveedor no tiene gastos pendientes de pago.' : 'Elige un proveedor para ver sus gastos pendientes, o registra un pago suelto:'}</p><label class="text-xs mt-2 mb-1 block" for="ppMontoSuelto">Monto</label><input type="number" id="ppMontoSuelto" class="inp" step="0.01" min="0" placeholder="0.00" oninput="PagosProv.recalcular()"><label class="text-xs mt-2 mb-1 block" for="ppConceptoSuelto">Concepto</label><input type="text" id="ppConceptoSuelto" class="inp" placeholder="Ej. Anticipo a proveedor"><label class="text-xs mt-2 mb-1 block" for="ppObraSuelto">Obra</label><select id="ppObraSuelto" class="inp"><option value="">Indirecto</option>${getFilteredObras().filter(o => !['Archivada', 'Completada'].includes(o.estatus)).map(o => `<option value="${o.id}">${S(o.codigo_obra ? o.codigo_obra + ' · ' : '')}${S(o.nombre_obra)}</option>`).join('')}</select></div>`;
      recalcular(); return;
    }
    box.innerHTML = rows.map((r, i) => `<label class="flex items-center gap-2 p-2 text-sm cursor-pointer"><input type="checkbox" class="ppChk w-4 h-4 rounded" data-id="${r.gasto.id}" checked onchange="PagosProv.recalcular()" aria-label="Incluir ${S(r.gasto.descripcion || r.gasto.id)}"><span class="flex-1 min-w-0"><span class="block truncate">${S(r.gasto.descripcion || r.gasto.categoria)}</span><span class="block text-xs text-ink-subtle">${fechaCorta(r.gasto.fecha_solicitud)} · ${r.gasto.obra_id ? S(obraDe(r.gasto.obra_id)?.codigo_obra || 'obra') : 'indirecto'} · vence ${fechaCorta(r.vence)} · saldo ${F(r.saldo)}${!r.aprobado ? ' · <span class="text-warn">por aprobar</span>' : ''}</span></span><input type="number" class="inp w-28 text-right ppMonto" data-id="${r.gasto.id}" data-saldo="${r.saldo}" step="0.01" min="0" value="${r.saldo.toFixed(2)}" oninput="PagosProv.recalcular()" aria-label="Monto aplicado a ${S(r.gasto.descripcion || r.gasto.id)}"></label>`).join('');
    recalcular();
  }
  function cambiarProveedor(v) { renderLista(parseInt(v) || null, null); const p = prov(v); const t = $('ppTitulo'); if (t) t.textContent = 'Registrar pago' + (p ? ' a ' + p.nombre_proveedor : ''); }
  function recalcular() {
    let total = 0;
    document.querySelectorAll('#ppLista .ppChk').forEach(chk => { const inp = document.querySelector(`#ppLista .ppMonto[data-id="${chk.dataset.id}"]`); if (inp) inp.disabled = !chk.checked; if (chk.checked && inp) total += num(inp.value); });
    const suelto = $('ppMontoSuelto'); if (suelto) total += num(suelto.value);
    const el = $('ppTotal'); if (el) el.textContent = F(total);
    const btn = $('ppGuardar'); if (btn) btn.textContent = modo?.tipo === 'editar' ? 'Guardar cambios' : `Registrar pago${total ? ' de ' + F(total) : ''}`;
    return total;
  }
  async function nuevoNumero() { try { const { data } = await sb.rpc('get_next_pago_proveedor_numero'); return data || ('PP-' + Date.now()); } catch (e) { return 'PP-' + Date.now(); } }

  async function guardar(e) {
    e.preventDefault();
    const btn = $('ppGuardar'); btn.disabled = true;
    try {
      const base = { empresa_id: currentUser.empresa_id, fecha_pago: $('ppFecha').value, metodo_pago: $('ppMetodo').value, referencia: $('ppReferencia').value || null, banco: $('ppBanco').value || null, notas: $('ppNotas').value || null, created_by: currentUser.id };
      if (!base.fecha_pago) { Toast.warning('Falta la fecha del pago.'); return; }
      if (typeof Cierres !== 'undefined' && !(await Cierres.verificarEdicion(base.fecha_pago))) return;
      const proveedorId = parseInt($('ppProveedor').value) || null;
      if (modo?.tipo === 'editar') {
        const monto = num(document.querySelector('#ppLista .ppMonto')?.value ?? $('ppMontoSuelto')?.value);
        if (!(monto > 0)) { Toast.warning('Captura el monto.'); return; }
        const { data: row, error } = await sb.from('pagos_proveedores').update({ ...base, monto, proveedor_id: proveedorId, updated_at: new Date().toISOString() }).eq('id', modo.pagoId).select().single();
        if (error) throw error;
        const i = (D.ppv || []).findIndex(p => p.id === row.id); if (i >= 0) D.ppv[i] = row;
        await refrescarGasto(row.gasto_id);
        Toast.success(`Pago ${row.numero_pago} actualizado.`);
      } else {
        const partes = [];
        document.querySelectorAll('#ppLista .ppChk:checked').forEach(chk => { const inp = document.querySelector(`#ppLista .ppMonto[data-id="${chk.dataset.id}"]`); const m = num(inp?.value); if (m > 0) partes.push({ gastoId: parseInt(chk.dataset.id), monto: r2(m), saldo: num(inp.dataset.saldo) }); });
        const suelto = $('ppMontoSuelto');
        if (suelto && num(suelto.value) > 0) {
          // Pago suelto: se crea un gasto "Anticipo a proveedor" y su pago
          const obraId = parseInt($('ppObraSuelto')?.value) || null;
          const { data: res, error: e1 } = await sb.rpc('crear_gasto', { p_user_id: currentUser.id, p_obra_id: obraId, p_fecha_solicitud: base.fecha_pago, p_estatus_pago: 'Pendiente', p_tipo_comprobante: 'No Fiscal', p_categoria: 'Otros', p_monto_neto: r2(num(suelto.value)), p_proveedor_id: proveedorId, p_descripcion: $('ppConceptoSuelto')?.value || 'Anticipo a proveedor', p_destino: obraId ? 'obra' : 'indirecto', p_comprobacion: 'sin_comprobante', p_aprobado: true });
          if (e1) throw e1; if (!res?.success) throw new Error(res?.error || 'No se pudo crear el gasto');
          const { data: g } = await sb.from('gastos').select('*').eq('id', res.gasto_id).single(); if (g) (D.g = D.g || []).unshift(g);
          partes.push({ gastoId: res.gasto_id, monto: r2(num(suelto.value)), saldo: r2(num(suelto.value)) });
        }
        if (!partes.length) { Toast.warning('Marca al menos un gasto o captura un monto.'); return; }
        // Sobrepago: excedente al siguiente pendiente del proveedor o como anticipo
        for (const p of partes.slice()) {
          if (p.monto > p.saldo + 0.005) {
            const exced = r2(p.monto - p.saldo);
            const siguiente = Finanzas.cuentasPorPagar({}).find(r => r.gasto.proveedor_id == proveedorId && !partes.some(x => x.gastoId === r.gasto.id));
            const ok = await Dialog.confirm({ title: 'Pagaste más que el saldo', body: `El gasto tiene saldo de ${F(p.saldo)} y aplicaste ${F(p.monto)}. Excedente: ${F(exced)}.\n${siguiente ? `Se puede aplicar a "${siguiente.gasto.descripcion || 'siguiente gasto'}" (saldo ${F(siguiente.saldo)}).` : 'Se puede registrar como anticipo a este proveedor.'}`, confirmText: siguiente ? 'Aplicar al siguiente' : 'Registrar como anticipo', cancelText: 'Ajustar monto' });
            if (!ok) return;
            p.monto = p.saldo;
            if (siguiente) partes.push({ gastoId: siguiente.gasto.id, monto: Math.min(exced, siguiente.saldo), saldo: siguiente.saldo });
            else {
              const g0 = (D.g || []).find(x => x.id === p.gastoId);
              const { data: res, error: e1 } = await sb.rpc('crear_gasto', { p_user_id: currentUser.id, p_obra_id: g0?.obra_id || null, p_fecha_solicitud: base.fecha_pago, p_estatus_pago: 'Pendiente', p_tipo_comprobante: 'No Fiscal', p_categoria: g0?.categoria || 'Otros', p_monto_neto: exced, p_proveedor_id: proveedorId, p_descripcion: 'Anticipo a proveedor', p_destino: g0?.obra_id ? 'obra' : 'indirecto', p_aprobado: true });
              if (e1) throw e1; if (!res?.success) throw new Error(res?.error);
              const { data: g } = await sb.from('gastos').select('*').eq('id', res.gasto_id).single(); if (g) (D.g = D.g || []).unshift(g);
              partes.push({ gastoId: res.gasto_id, monto: exced, saldo: exced });
            }
          }
        }
        const numero = await nuevoNumero();
        const nuevos = [];
        for (const p of partes) {
          const g = (D.g || []).find(x => x.id === p.gastoId);
          const { data: row, error } = await sb.from('pagos_proveedores').insert({ ...base, numero_pago: numero, gasto_id: p.gastoId, obra_id: g?.obra_id || null, orden_compra_id: g?.orden_compra_id || null, proveedor_id: proveedorId || g?.proveedor_id || null, monto: p.monto, concepto: g?.descripcion || g?.categoria || null }).select().single();
          if (error) throw error;
          nuevos.push(row);
        }
        D.ppv = (D.ppv || []).concat(nuevos);
        for (const p of partes) await refrescarGasto(p.gastoId);
        const total = r2(partes.reduce((s, p) => s + p.monto, 0));
        const restante = Finanzas.cuentasPorPagar({}).filter(r => proveedorId && r.gasto.proveedor_id == proveedorId).reduce((s, r) => s + r.saldo, 0);
        Toast.success(`Pago ${numero} registrado por ${F(total)}${proveedorId ? `. Saldo con ${provNombre(proveedorId)}: ${F(restante)}` : ''}.`, 6000);
        try { Telemetry.track('pago_proveedor_registrado', { n: partes.length, lote: partes.length > 1 }); } catch (e2) { }
      }
      try { Cache.saveAppData(D, currentUser?.empresa_id || 'global'); } catch (e3) { }
      closeMdl('mdlPagoProv');
      refrescar();
    } catch (err) { Toast.error(humanizeError(err, 'No se pudo registrar el pago')); }
    finally { btn.disabled = false; }
  }
  async function refrescarGasto(id) { if (!id) return; const { data } = await sb.from('gastos').select('*').eq('id', id).single(); if (data) { const g = (D.g || []).find(x => x.id === id); if (g) Object.assign(g, data); else (D.g = D.g || []).unshift(data); } }
  function refrescar() { if (typeof refrescarVistaActual === 'function') refrescarVistaActual(); else if (typeof R === 'function') R(); }

  function editar(id) {
    const p = (D.ppv || []).find(x => x.id === id); if (!p) return;
    ensureModal(); modo = { tipo: 'editar', pagoId: id };
    const g = (D.g || []).find(x => x.id === p.gasto_id);
    const provs = filterByEmpresa(D.pv || []);
    $('mdlPagoProvBody').innerHTML = `<div class="flex justify-between items-center mb-3"><h2 class="text-lg font-bold" id="ppTitulo">Editar pago ${S(p.numero_pago || '')}</h2><button type="button" class="btn-icon" onclick="closeMdl('mdlPagoProv')" aria-label="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></div>
<form id="frmPagoProv" onsubmit="PagosProv.guardar(event)" novalidate><input type="hidden" id="ppPagoId" value="${p.id}">
<div class="grid grid-cols-2 gap-3 force-2col">
<div class="col-span-2"><label class="text-xs mb-1 block" for="ppProveedor">Proveedor</label><select id="ppProveedor" class="inp"><option value="">Sin proveedor</option>${provs.map(x => `<option value="${x.id}" ${x.id == p.proveedor_id ? 'selected' : ''}>${S(x.nombre_proveedor)}</option>`).join('')}</select></div>
<div><label class="text-xs mb-1 block" for="ppFecha">Fecha *</label><input type="date" id="ppFecha" class="inp" value="${String(p.fecha_pago || '').slice(0, 10)}" required></div>
<div><label class="text-xs mb-1 block" for="ppMetodo">Método</label><select id="ppMetodo" class="inp">${['Transferencia', 'Efectivo', 'Tarjeta', 'Cheque'].map(m => `<option ${m === p.metodo_pago ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
<div><label class="text-xs mb-1 block" for="ppReferencia">Referencia</label><input type="text" id="ppReferencia" class="inp" value="${S(p.referencia || '')}"></div>
<div><label class="text-xs mb-1 block" for="ppBanco">Banco</label><input type="text" id="ppBanco" class="inp" value="${S(p.banco || '')}"></div></div>
<div class="mt-3"><p class="text-xs font-medium mb-1">Gasto</p><div id="ppLista" class="border border-line rounded-lg"><div class="flex items-center gap-2 p-2 text-sm"><span class="flex-1 min-w-0 truncate">${S(g?.descripcion || p.concepto || 'Pago')}</span><input type="number" class="inp w-28 text-right ppMonto" data-id="${p.gasto_id || 0}" step="0.01" min="0" value="${num(p.monto).toFixed(2)}" oninput="PagosProv.recalcular()" aria-label="Monto"></div></div></div>
<div class="flex items-center justify-between mt-3"><span class="text-sm text-ink-muted">Total</span><span class="text-xl font-bold" id="ppTotal">${F(p.monto)}</span></div>
<div class="mt-2"><label class="text-xs mb-1 block" for="ppNotas">Notas</label><input type="text" id="ppNotas" class="inp" value="${S(p.notas || '')}"></div>
<div class="flex gap-3 mt-4"><button type="button" class="btn btn-s flex-1" onclick="closeMdl('mdlPagoProv')">Cancelar</button><button type="submit" class="btn btn-p flex-1" id="ppGuardar">Guardar cambios</button></div></form>`;
    openMdl('mdlPagoProv');
  }
  async function eliminar(id) {
    const p = (D.ppv || []).find(x => x.id === id); if (!p) return;
    if (!await Dialog.confirm({ title: 'Eliminar pago', body: `Se eliminará el pago ${p.numero_pago || ''} por ${F(p.monto)}; el gasto volverá a quedar pendiente por ese monto.`, confirmText: 'Eliminar pago', tone: 'danger' })) return;
    const { error } = await sb.from('pagos_proveedores').delete().eq('id', id);
    if (error) { Toast.error(humanizeError(error, 'No se eliminó el pago')); return; }
    D.ppv = (D.ppv || []).filter(x => x.id !== id);
    await refrescarGasto(p.gasto_id);
    Toast.success('Pago eliminado.'); refrescar();
  }

  function copiarDatosPago(id) {
    const p = prov(id); if (!p) return;
    const txt = [p.titular_cuenta || p.razon_social || p.nombre_proveedor, p.banco ? 'Banco: ' + p.banco : '', p.clabe ? 'CLABE: ' + p.clabe : '', p.cuenta_bancaria ? 'Cuenta: ' + p.cuenta_bancaria : '', p.rfc ? 'RFC: ' + p.rfc : ''].filter(Boolean).join('\n');
    navigator.clipboard?.writeText(txt).then(() => Toast.success('Datos de pago copiados.')).catch(() => Toast.info(txt));
  }

  async function comprobantePDF(id) {
    const p = (D.ppv || []).find(x => x.id === id); if (!p) return;
    const g = (D.g || []).find(x => x.id === p.gasto_id); const pv = prov(p.proveedor_id); const o = obraDe(p.obra_id);
    let emp = { nombre: currentUser?.empresa_nombre || '' };
    try { const { data } = await sb.from('empresas').select('nombre,razon_social,rfc,direccion,telefono,email').eq('id', currentUser?.empresa_id).single(); if (data) emp = { ...emp, ...data }; } catch (e) { }
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(emp.razon_social || emp.nombre || 'Empresa', 20, 20);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text([emp.rfc ? 'RFC ' + emp.rfc : '', emp.direccion || '', [emp.telefono, emp.email].filter(Boolean).join(' · ')].filter(Boolean), 20, 26);
    doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text('Comprobante de pago a proveedor', 20, 45);
    doc.setFontSize(11); doc.setFont('helvetica', 'normal');
    const filas = [['Folio', p.numero_pago || ''], ['Fecha', String(p.fecha_pago || '').slice(0, 10)], ['Proveedor', pv?.nombre_proveedor || '-'], ['RFC', pv?.rfc || '-'], ['Concepto', p.concepto || g?.descripcion || '-'], ['Obra', o ? (o.codigo_obra || '') + ' ' + o.nombre_obra : 'Indirecto'], ['Método', [p.metodo_pago, p.referencia, p.banco].filter(Boolean).join(' · ')], ['Importe', F(p.monto)], ['Importe con letra', typeof numeroALetras === 'function' ? numeroALetras(num(p.monto)) : '']];
    doc.autoTable({ startY: 52, head: [], body: filas, theme: 'plain', styles: { fontSize: 10, cellPadding: 2 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45 } } });
    const y = doc.lastAutoTable.finalY + 30;
    doc.line(30, y, 95, y); doc.line(115, y, 180, y); doc.setFontSize(9); doc.text('Pagó', 55, y + 5); doc.text('Recibió', 140, y + 5);
    doc.save(`Pago_${(p.numero_pago || p.id)}_${(pv?.nombre_proveedor || 'proveedor').replace(/[^\w]+/g, '_').slice(0, 20)}.pdf`);
  }

  // ---------- Ficha de proveedor (drawer) ----------
  function ensureDrawer() {
    if ($('provDrawer')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="provDrawerBack" class="drawer-backdrop" onclick="PagosProv.cerrarProveedor()"></div><aside id="provDrawer" class="drawer" role="dialog" aria-modal="true" aria-labelledby="provDrawerTitle" aria-hidden="true"><div class="drawer-h"><h2 id="provDrawerTitle" class="font-bold text-lg">Proveedor</h2><button class="btn-icon" onclick="PagosProv.cerrarProveedor()" aria-label="Cerrar ficha"><i class="ri-close-line text-xl" aria-hidden="true"></i></button></div><div id="provDrawerBody" class="drawer-b"></div></aside>`);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('provDrawer')?.classList.contains('ac')) cerrarProveedor(); });
  }
  function cerrarProveedor() { $('provDrawer')?.classList.remove('ac'); $('provDrawer')?.setAttribute('aria-hidden', 'true'); $('provDrawerBack')?.classList.remove('ac'); }
  function abrirProveedor(id) {
    const p = prov(id); if (!p) { Toast.warning('Proveedor no encontrado.'); return; }
    ensureDrawer();
    const gastos = (D.g || []).filter(g => g.proveedor_id == id && g.estatus_pago !== 'Rechazado').sort((a, b) => String(b.fecha_solicitud).localeCompare(String(a.fecha_solicitud)));
    const pagos = (D.ppv || []).filter(x => x.proveedor_id == id);
    const compras = r2(gastos.reduce((s, g) => s + num(g.monto_neto), 0));
    const pagado = r2(gastos.reduce((s, g) => s + Math.min(num(g.monto_pagado), num(g.monto_neto)), 0));
    const saldo = r2(compras - pagado);
    const sinFactura = gastos.filter(g => (g.comprobacion || 'sin_comprobante') !== 'facturado');
    const socio = (D.soc || []).find(s => s.rfc && p.rfc && s.rfc.toUpperCase() === p.rfc.toUpperCase());
    const movs = [...gastos.map(g => ({ f: g.fecha_solicitud, t: 'compra', d: g.descripcion || g.categoria, m: num(g.monto_neto), g })), ...pagos.map(x => ({ f: x.fecha_pago, t: 'pago', d: (x.numero_pago || '') + ' ' + (x.metodo_pago || ''), m: num(x.monto) }))].sort((a, b) => String(b.f).localeCompare(String(a.f))).slice(0, 12);
    $('provDrawerTitle').textContent = p.nombre_proveedor;
    $('provDrawerBody').innerHTML = `
<div class="kpi-strip" style="grid-template-columns:repeat(3,1fr)"><div class="kpi"><p class="kpi-v">${F(compras)}</p><p class="kpi-l">Compras</p></div><div class="kpi"><p class="kpi-v">${F(pagado)}</p><p class="kpi-l">Pagado</p></div><div class="kpi"><p class="kpi-v ${saldo > 0 ? 'text-warn' : ''}">${F(saldo)}</p><p class="kpi-l">Saldo por pagar</p></div></div>
<div class="flex flex-wrap gap-2 mb-3">${saldo > 0 ? `<button type="button" class="btn btn-p text-sm" onclick="PagosProv.abrir({proveedorId:${p.id}})"><i class="ri-bank-card-line" aria-hidden="true"></i> Registrar pago</button>` : ''}${sinFactura.length ? `<button type="button" class="btn btn-s text-sm" onclick="Compras.pedirFactura([${sinFactura.map(g => g.id).join(',')}])"><i class="ri-mail-send-line" aria-hidden="true"></i> Pedir factura (${sinFactura.length})</button>` : ''}<button type="button" class="btn btn-s text-sm" onclick="PagosProv.cerrarProveedor();editProveedor(${p.id})"><i class="ri-edit-line" aria-hidden="true"></i> Editar</button><button type="button" class="btn btn-s text-sm" onclick="PagosProv.exportarProveedor(${p.id})"><i class="ri-file-excel-2-line" aria-hidden="true"></i> Estado de cuenta</button></div>
<section class="g rounded-xl p-3 mb-3"><h3 class="text-sm font-semibold mb-2">Datos de pago</h3>
<dl class="text-sm grid grid-cols-[110px_1fr] gap-y-1"><dt class="text-ink-subtle">RFC</dt><dd>${S(p.rfc || '-')}</dd><dt class="text-ink-subtle">Banco</dt><dd>${S(p.banco || '-')}</dd><dt class="text-ink-subtle">CLABE</dt><dd class="font-mono">${S(p.clabe || '-')}</dd><dt class="text-ink-subtle">Titular</dt><dd>${S(p.titular_cuenta || p.razon_social || '-')}</dd><dt class="text-ink-subtle">Crédito</dt><dd>${num(p.dias_credito)} días</dd><dt class="text-ink-subtle">Contacto</dt><dd>${S([p.contacto, p.telefono, p.email].filter(Boolean).join(' · ') || '-')}</dd></dl>
<div class="flex flex-wrap gap-2 mt-2">${p.clabe ? `<button type="button" class="btn btn-s text-xs" onclick="PagosProv.copiarDatosPago(${p.id})"><i class="ri-file-copy-line" aria-hidden="true"></i> Copiar datos de pago</button>` : '<span class="text-xs text-warn">Sin CLABE: agrégala en Editar para pagar por transferencia.</span>'}${p.telefono ? `<a class="btn btn-s text-xs" href="https://wa.me/${String(p.telefono).replace(/\D/g, '').replace(/^(\d{10})$/, '52$1')}" target="_blank" rel="noopener"><i class="ri-whatsapp-line" aria-hidden="true"></i> WhatsApp</a>` : ''}</div></section>
${socio ? `<section class="g rounded-xl p-3 mb-3 border border-warn/40"><p class="text-sm"><i class="ri-user-star-line" aria-hidden="true"></i> Este proveedor es el socio <b>${S(socio.nombre)}</b>. Lo que pagó de su bolsa debe registrarse como "pagado por el socio", no como compra a proveedor.</p>${gastos.length ? `<button type="button" class="btn btn-s text-xs mt-2" onclick="PagosProv.reclasificarSocio(${p.id},${socio.id})">Reclasificar ${gastos.length} gasto(s) como pagados por el socio</button>` : ''}</section>` : ''}
<section class="g rounded-xl p-3"><h3 class="text-sm font-semibold mb-2">Últimos movimientos</h3>${movs.length ? `<ul class="divide-y divide-slate-100 text-sm">${movs.map(m => `<li class="flex items-center gap-2 py-1.5"><span class="text-xs text-ink-subtle w-14 shrink-0">${fechaCorta(m.f)}</span><span class="chip ${m.t === 'pago' ? 'chip-obra' : 'chip-ind'}">${m.t === 'pago' ? 'Pago' : 'Compra'}</span><span class="flex-1 min-w-0 truncate">${S(m.d || '')}</span><span class="font-medium ${m.t === 'pago' ? 'text-ok' : ''}">${m.t === 'pago' ? '-' : ''}${F(m.m)}</span></li>`).join('')}</ul>` : '<p class="text-sm text-ink-subtle">Sin movimientos todavía.</p>'}</section>`;
    $('provDrawer').classList.add('ac'); $('provDrawer').setAttribute('aria-hidden', 'false'); $('provDrawerBack').classList.add('ac');
    setTimeout(() => $('provDrawer')?.querySelector('button')?.focus(), 50);
    try { Telemetry.track('proveedor_ficha', { saldo: saldo > 0 }); } catch (e) { }
  }
  async function reclasificarSocio(provId, socioId) {
    const ids = (D.g || []).filter(g => g.proveedor_id == provId).map(g => g.id);
    if (!ids.length) return;
    if (!await Dialog.confirm({ title: 'Reclasificar como pagado por el socio', body: `${ids.length} gasto(s) dejarán de tener proveedor y quedarán como pagados de la bolsa del socio (aportación a su cuenta corriente).`, confirmText: 'Reclasificar' })) return;
    const { error } = await sb.from('gastos').update({ pagado_por_socio_id: socioId, proveedor_id: null, updated_at: new Date().toISOString() }).in('id', ids);
    if (error) { Toast.error(humanizeError(error, 'No se pudo reclasificar')); return; }
    ids.forEach(id => { const g = D.g.find(x => x.id === id); if (g) { g.pagado_por_socio_id = socioId; g.proveedor_id = null; } });
    await sb.from('proveedores').update({ estatus: 'Inactivo' }).eq('id', provId); const p = prov(provId); if (p) p.estatus = 'Inactivo';
    Toast.success('Gastos reclasificados; se generaron las aportaciones del socio.'); cerrarProveedor(); refrescar();
  }
  function exportarProveedor(id) {
    const p = prov(id); if (!p) return;
    const gastos = (D.g || []).filter(g => g.proveedor_id == id).sort((a, b) => String(a.fecha_solicitud).localeCompare(String(b.fecha_solicitud)));
    const pagos = (D.ppv || []).filter(x => x.proveedor_id == id);
    const filas = [...gastos.map(g => ({ Fecha: String(g.fecha_solicitud || '').slice(0, 10), Tipo: 'Compra', Concepto: g.descripcion || g.categoria || '', Obra: obraDe(g.obra_id)?.codigo_obra || (g.obra_id ? '' : 'Indirecto'), Cargo: num(g.monto_neto), Abono: 0, Factura: g.folio_fiscal || g.factura_numero || '' })), ...pagos.map(x => ({ Fecha: String(x.fecha_pago || '').slice(0, 10), Tipo: 'Pago', Concepto: [x.numero_pago, x.metodo_pago, x.referencia].filter(Boolean).join(' · '), Obra: obraDe(x.obra_id)?.codigo_obra || '', Cargo: 0, Abono: num(x.monto), Factura: '' }))].sort((a, b) => a.Fecha.localeCompare(b.Fecha));
    let saldo = 0; filas.forEach(f => { saldo = r2(saldo + f.Cargo - f.Abono); f.Saldo = saldo; });
    if (!filas.length) { Toast.warning('Sin movimientos para exportar.'); return; }
    const ws = XLSX.utils.json_to_sheet(filas); ws['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 40 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 38 }, { wch: 12 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Estado de cuenta');
    XLSX.writeFile(wb, `EstadoCuenta_${p.nombre_proveedor.replace(/[^\w]+/g, '_').slice(0, 30)}_${hoyISO()}.xlsx`);
  }

  return { renderPorPagar, filtrarPagar, renderPagos, renderFlujo, periodo, abrir, cambiarProveedor, recalcular, guardar, editar, eliminar, copiarDatosPago, comprobantePDF, abrirProveedor, cerrarProveedor, reclasificarSocio, exportarProveedor };
})();
