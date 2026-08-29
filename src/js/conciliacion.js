/**
 * Conciliación bancaria ligera (fase 2: US-114). Pestaña Pagos › Conciliar.
 * Sube el CSV/XLSX del banco, empareja abonos con cobros y cargos con pagos/gastos pagados, confirma y marca conciliado_at.
 * Depende de: D, S, F, fmt, $, currentUser, sb, Toast, humanizeError, hoyISO, Finanzas, XLSX, vacio, Compras, newPagoRecibido.
 */
const Conciliacion = (() => {
  const num = (v) => parseFloat(String(v ?? '').replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0;
  const r2 = (v) => Math.round(v * 100) / 100;
  let movs = [];     // {i, fecha, descripcion, cargo, abono, match:{tipo,id,score}|null, decision:'ok'|'omitir'|'crear'}
  let archivo = '';

  function fechaNorm(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    m = s.match(/^(\d{1,2})\s+([a-z]{3})/i); if (m) { const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']; const mi = meses.indexOf(m[2].toLowerCase().slice(0, 3)); if (mi >= 0) return `${hoyISO().slice(0, 4)}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    return '';
  }
  /** Detección tolerante de columnas: fecha, descripción/concepto, cargo/retiro, abono/depósito o un solo importe con signo. */
  function parsear(rows) {
    if (!rows.length) return [];
    let head = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) { const t = rows[i].map(x => String(x || '').toLowerCase()).join('|'); if (/fecha/.test(t) && /(concepto|descrip|detalle|movimiento)/.test(t)) { head = i; break; } }
    if (head < 0) head = 0;
    const H = rows[head].map(x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
    const idx = (re) => H.findIndex(h => re.test(h));
    const iF = idx(/fecha/), iD = idx(/concepto|descrip|detalle|movimiento|referencia/), iC = idx(/cargo|retiro|debe|salida|egreso/), iA = idx(/abono|deposito|haber|entrada|ingreso/), iM = idx(/^(importe|monto|cantidad)$/);
    const out = [];
    rows.slice(head + 1).forEach((r, k) => {
      const fecha = fechaNorm(r[iF >= 0 ? iF : 0]); if (!fecha) return;
      const desc = String(r[iD >= 0 ? iD : 1] || '').trim();
      let cargo = iC >= 0 ? Math.abs(num(r[iC])) : 0, abono = iA >= 0 ? Math.abs(num(r[iA])) : 0;
      if (iC < 0 && iA < 0 && iM >= 0) { const v = num(r[iM]); if (v < 0) cargo = -v; else abono = v; }
      if (!cargo && !abono) return;
      out.push({ i: k, fecha, descripcion: desc, cargo: r2(cargo), abono: r2(abono), match: null, decision: 'ok' });
    });
    return out;
  }
  function difDias(a, b) { return Math.abs((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000); }
  function emparejar() {
    const usados = new Set();
    movs.forEach(m => {
      const monto = m.abono || m.cargo; const tol = Math.max(1, monto * 0.01);
      let cands = [];
      if (m.abono) cands = (D.prc || []).filter(p => !p.conciliado_at && !usados.has('c' + p.id)).map(p => ({ tipo: 'cobro', id: p.id, ref: p, monto: num(p.monto), fecha: String(p.fecha_pago || '').slice(0, 10) }));
      else {
        const conPago = new Set((D.ppv || []).map(p => p.gasto_id).filter(Boolean));
        cands = [...(D.ppv || []).filter(p => !p.conciliado_at && !usados.has('p' + p.id)).map(p => ({ tipo: 'pago', id: p.id, ref: p, monto: num(p.monto), fecha: String(p.fecha_pago || '').slice(0, 10) })), ...(D.g || []).filter(g => !g.conciliado_at && !conPago.has(g.id) && num(g.monto_pagado) > 0 && !g.pagado_por_socio_id && g.estatus_pago !== 'Rechazado' && !usados.has('g' + g.id)).map(g => ({ tipo: 'gasto', id: g.id, ref: g, monto: Math.min(num(g.monto_pagado), num(g.monto_neto)), fecha: String(g.fecha_solicitud || '').slice(0, 10) }))];
      }
      const scored = cands.map(c => { const dm = Math.abs(c.monto - monto); const dd = c.fecha ? difDias(c.fecha, m.fecha) : 99; let score = 0; if (dm <= 0.005) score += 60; else if (dm <= tol) score += 40; else return null; if (dd <= 3) score += 30; else if (dd <= 10) score += 15; else if (dd <= 30) score += 5; return { ...c, score, dd, exacto: dm <= 0.005 && dd <= 3 }; }).filter(Boolean).sort((a, b) => b.score - a.score || a.dd - b.dd);
      if (scored[0]) { m.match = scored[0]; m.cands = scored.slice(0, 4); usados.add(scored[0].tipo[0] + scored[0].id); }
      else { m.match = null; m.cands = []; m.decision = 'crear'; }
    });
  }

  function render() {
    const c = $('pcContent'); if (!c) return;
    if (!movs.length) {
      c.innerHTML = `<div class="g rounded-xl p-6 text-center"><i class="ri-bank-line text-3xl text-ink-subtle" aria-hidden="true"></i><h3 class="font-bold mt-2">Concilia con el estado de cuenta del banco</h3><p class="text-sm text-ink-muted mt-1 mb-3">Exporta el CSV o XLSX de tu banca en línea y súbelo. Cada abono se empareja con un cobro y cada cargo con un pago o gasto pagado por monto y fecha (±3 días exactos, ±1 % probable). El archivo no se guarda, sólo el resultado.</p><label class="btn btn-p cursor-pointer"><i class="ri-upload-2-line" aria-hidden="true"></i> Subir estado de cuenta<input type="file" class="hidden" accept=".csv,.xlsx,.xls,text/csv" onchange="Conciliacion.cargar(this.files[0])"></label>
${(D.conc || []).length ? `<div class="text-left mt-5"><h4 class="text-sm font-semibold mb-1">Conciliaciones anteriores</h4><ul class="text-sm divide-y divide-slate-100">${(D.conc || []).slice(0, 6).map(x => `<li class="py-1.5 flex justify-between"><span>${String(x.created_at || '').slice(0, 10)} · ${S(x.archivo || '')}</span><span class="text-xs text-ink-subtle">${x.conciliadas}/${x.filas} conciliadas · ${x.sin_banco || 0} sin registro</span></li>`).join('')}</ul></div>` : ''}</div>`;
      return;
    }
    const ok = movs.filter(m => m.match && m.decision === 'ok').length, sinReg = movs.filter(m => !m.match).length;
    c.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-2 mb-3"><p class="text-sm"><b>${S(archivo)}</b> · ${movs.length} movimientos · <span class="text-ok">${ok} emparejados</span> · <span class="${sinReg ? 'text-warn' : ''}">${sinReg} sin registro en la app</span></p><div class="flex gap-2"><button type="button" class="btn btn-s text-sm" onclick="Conciliacion.reiniciar()">Otro archivo</button><button type="button" class="btn btn-p text-sm" onclick="Conciliacion.confirmar()">Confirmar ${ok} conciliado${ok === 1 ? '' : 's'}</button></div></div>
<div class="g rounded-xl overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-slate-50 text-xs text-ink-muted"><tr><th class="p-2 text-left">Banco</th><th class="p-2 text-right">Abono</th><th class="p-2 text-right">Cargo</th><th class="p-2 text-left">En la app</th><th class="p-2 text-left">Acción</th></tr></thead><tbody>
${movs.map((m, i) => `<tr class="border-t border-line ${m.match ? '' : 'bg-amber-50/40'}"><td class="p-2"><div class="text-xs text-ink-subtle">${m.fecha}</div><div class="truncate max-w-[260px]" title="${S(m.descripcion)}">${S(m.descripcion)}</div></td><td class="p-2 text-right text-ok">${m.abono ? F(m.abono) : ''}</td><td class="p-2 text-right">${m.cargo ? F(m.cargo) : ''}</td><td class="p-2">${m.cands && m.cands.length ? `<select class="inp text-xs py-1" onchange="Conciliacion.elegir(${i},this.value)" aria-label="Registro relacionado">${m.cands.map(cd => `<option value="${cd.tipo}:${cd.id}" ${m.match && m.match.id === cd.id && m.match.tipo === cd.tipo ? 'selected' : ''}>${cd.exacto ? '' : '~ '}${cd.tipo === 'cobro' ? 'Cobro ' + (cd.ref.numero_pago || '') : cd.tipo === 'pago' ? 'Pago ' + (cd.ref.numero_pago || '') : 'Gasto ' + S((cd.ref.descripcion || '').slice(0, 30))} · ${cd.fecha} · ${F(cd.monto)}</option>`).join('')}<option value="" ${!m.match ? 'selected' : ''}>Sin registro</option></select>` : '<span class="text-xs text-warn">No hay cobro ni pago con ese monto</span>'}</td><td class="p-2">${m.match ? `<select class="inp text-xs py-1" onchange="Conciliacion.decidir(${i},this.value)" aria-label="Acción"><option value="ok" ${m.decision === 'ok' ? 'selected' : ''}>Conciliar</option><option value="omitir" ${m.decision === 'omitir' ? 'selected' : ''}>Omitir</option></select>` : (m.abono ? `<button type="button" class="btn btn-s text-xs" onclick="Conciliacion.crearCobro(${i})">Registrar como cobro</button>` : `<button type="button" class="btn btn-s text-xs" onclick="Conciliacion.crearGasto(${i})">Registrar como gasto</button>`)}</td></tr>`).join('')}
</tbody></table></div></div>`;
  }
  async function cargar(file) {
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', raw: false, cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      movs = parsear(rows); archivo = file.name;
      if (!movs.length) { Toast.warning('No se reconocieron movimientos: el archivo necesita columnas de fecha, concepto y cargo/abono (o importe).'); return; }
      emparejar(); render();
    } catch (e) { Toast.error('No se pudo leer el archivo: ' + (e.message || e)); }
  }
  function elegir(i, v) { const m = movs[i]; if (!v) { m.match = null; m.decision = 'crear'; render(); return; } const [tipo, id] = v.split(':'); m.match = (m.cands || []).find(c => c.tipo === tipo && c.id == id) || null; m.decision = 'ok'; render(); }
  function decidir(i, v) { movs[i].decision = v; }
  function reiniciar() { movs = []; archivo = ''; render(); }
  function crearCobro(i) { const m = movs[i]; if (typeof newPagoRecibido === 'function') { newPagoRecibido(); setTimeout(() => { if ($('prMonto')) { $('prMonto').value = m.abono.toFixed(2); $('prMonto').dataset.auto = '0'; } if ($('prFecha')) $('prFecha').value = m.fecha; if ($('prReferencia')) $('prReferencia').value = m.descripcion.slice(0, 60); }, 200); } }
  function crearGasto(i) { const m = movs[i]; if (typeof Compras !== 'undefined') { Compras.nuevo({ origen: 'conciliacion' }); setTimeout(() => { if ($('gastoMonto')) $('gastoMonto').value = m.cargo.toFixed(2); if ($('gastoFecha')) $('gastoFecha').value = m.fecha; if ($('gastoDescripcion')) { $('gastoDescripcion').value = m.descripcion.slice(0, 80); Compras.sugerir(); } }, 200); } }
  async function confirmar() {
    const sel = movs.filter(m => m.match && m.decision === 'ok');
    if (!sel.length) { Toast.warning('No hay movimientos por conciliar.'); return; }
    const now = new Date().toISOString();
    const ids = { cobro: [], pago: [], gasto: [] }; sel.forEach(m => ids[m.match.tipo].push(m.match.id));
    try {
      if (ids.cobro.length) { await sb.from('pagos_recibidos').update({ conciliado_at: now }).in('id', ids.cobro); (D.prc || []).forEach(p => { if (ids.cobro.includes(p.id)) p.conciliado_at = now; }); }
      if (ids.pago.length) { await sb.from('pagos_proveedores').update({ conciliado_at: now }).in('id', ids.pago); (D.ppv || []).forEach(p => { if (ids.pago.includes(p.id)) p.conciliado_at = now; }); }
      if (ids.gasto.length) { await sb.from('gastos').update({ conciliado_at: now }).in('id', ids.gasto); (D.g || []).forEach(g => { if (ids.gasto.includes(g.id)) g.conciliado_at = now; }); }
      const fechas = movs.map(m => m.fecha).sort();
      const sinBanco = 0;
      const row = { empresa_id: currentUser.empresa_id, archivo, periodo: fechas[0] ? fechas[0].slice(0, 7) : null, filas: movs.length, conciliadas: sel.length, pendientes: movs.filter(m => !m.match).length, sin_banco: sinBanco, resultado: { conciliados: sel.map(m => ({ fecha: m.fecha, monto: m.abono || m.cargo, tipo: m.match.tipo, id: m.match.id })), sin_registro: movs.filter(m => !m.match).map(m => ({ fecha: m.fecha, descripcion: m.descripcion.slice(0, 80), abono: m.abono, cargo: m.cargo })) }, created_by: currentUser.id };
      const { data } = await sb.from('conciliaciones').insert(row).select().single(); if (data) (D.conc = D.conc || []).unshift(data);
      Toast.success(`${sel.length} movimiento(s) conciliados. ${movs.filter(m => !m.match).length} quedaron sin registro en la app.`, 6000);
      try { Telemetry.track('conciliacion', { n: sel.length, sin: movs.filter(m => !m.match).length }); } catch (e) { }
      movs = []; archivo = ''; render();
    } catch (e) { Toast.error(humanizeError(e, 'No se pudo conciliar')); }
  }
  async function cargarHistorial() { try { const { data } = await sb.from('conciliaciones').select('*').eq('empresa_id', currentUser.empresa_id).order('created_at', { ascending: false }).limit(20); D.conc = data || []; } catch (e) { } }

  return { render, cargar, elegir, decidir, reiniciar, crearCobro, crearGasto, confirmar, parsear, cargarHistorial };
})();
if (typeof module !== 'undefined') module.exports = Conciliacion;
