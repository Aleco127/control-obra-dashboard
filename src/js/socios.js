/**
 * Socios (fase 2: US-125 a US-128): catálogo de socios, cuenta corriente, reparto de utilidades y dashboard de socios.
 * Módulo de menú 'so' (sólo nivel >= 100). Datos: D.soc, D.msoc (los trae load_all_data_seguro sólo para nivel >= 100),
 * D.rep / D.repd (se cargan aquí). Configuración financiera: D.fcfg (finanzas_config).
 * Depende de: D, S, F, fmt, $, currentUser, sb, Toast, Dialog, humanizeError, hoyISO, Finanzas, openMdl, closeMdl, Telemetry, XLSX, jsPDF, numeroALetras.
 */
const Socios = (() => {
  const num = (v) => parseFloat(v) || 0;
  const r2 = (v) => Math.round(v * 100) / 100;
  let tab = 'resumen';   // resumen | socios | cuenta | repartos
  let cargado = false;
  let periodo = 'anio';
  const esAdmin = () => (currentUser?.nivel || 0) >= 100;
  const socios = () => (D.soc || []).slice().sort((a, b) => String(a.nombre).localeCompare(b.nombre));
  const fechaCorta = (f) => f ? new Date(String(f).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }) : '-';
  const TIPOS = { aportacion: ['Aportación', 'text-ok'], retiro: ['Retiro', 'text-danger'], gasto_personal: ['Gasto personal', 'text-danger'], utilidad_asignada: ['Utilidad asignada', 'text-ok'], utilidad_pagada: ['Utilidad pagada', 'text-danger'], ajuste: ['Ajuste', ''] };
  const SIGNO = { aportacion: 1, retiro: -1, gasto_personal: -1, utilidad_asignada: 1, utilidad_pagada: -1, ajuste: 1 };

  async function cargar(force) {
    if (cargado && !force) return;
    try {
      const [rep, repd, cfg] = await Promise.all([sb.from('repartos').select('*').eq('empresa_id', currentUser.empresa_id).order('created_at', { ascending: false }), sb.from('reparto_detalle').select('*'), sb.from('finanzas_config').select('*').eq('empresa_id', currentUser.empresa_id).maybeSingle()]);
      D.rep = rep.data || []; D.repd = repd.data || []; D.fcfg = cfg.data || { prorrateo: { tipo: 'iguales' }, reservas: { impuestos: 30, capital: 10 }, base_resultados: 'caja' };
      cargado = true;
    } catch (e) { console.warn('Socios.cargar', e); }
  }
  function saldoSocio(id, hasta) {
    return r2((D.msoc || []).filter(m => m.socio_id == id && (!hasta || String(m.fecha).slice(0, 10) <= hasta)).reduce((s, m) => s + (SIGNO[m.tipo] || 1) * num(m.monto), 0));
  }
  function totalesSocio(id, desde, hasta) {
    const t = { aportacion: 0, retiro: 0, gasto_personal: 0, utilidad_asignada: 0, utilidad_pagada: 0, ajuste: 0 };
    (D.msoc || []).filter(m => m.socio_id == id && Finanzas.enRango(m.fecha, desde, hasta)).forEach(m => { t[m.tipo] = r2((t[m.tipo] || 0) + num(m.monto)); });
    return t;
  }

  // ---------- render ----------
  async function render(c) {
    if (!esAdmin()) { c.innerHTML = vacio('socios', { icon: 'ri-lock-line', title: 'Sólo para socios', body: 'Los movimientos de socios sólo los ven los administradores.' }); return; }
    c.innerHTML = '<p class="text-sm text-ink-muted p-4">Cargando…</p>';
    await cargar();
    const tabs = [['resumen', 'Resumen'], ['socios', 'Socios'], ['cuenta', 'Cuenta corriente'], ['repartos', 'Repartos']];
    c.innerHTML = `<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4"><div><h1 class="text-xl font-bold"><i class="ri-user-star-line" aria-hidden="true"></i> Socios</h1><p class="text-sm text-ink-muted mt-1">Participaciones, cuenta corriente de cada socio y reparto de utilidades.</p></div>
<div class="flex flex-wrap gap-2"><button type="button" class="btn btn-s text-sm" onclick="Socios.nuevoMovimiento()"><i class="ri-exchange-dollar-line" aria-hidden="true"></i> Registrar movimiento</button><button type="button" class="btn btn-p text-sm" onclick="Socios.nuevoReparto()"><i class="ri-pie-chart-2-line" aria-hidden="true"></i> Nuevo reparto</button></div></div>
<div class="tabs mb-3" role="tablist" aria-label="Secciones de socios">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="tab ${tab === k ? 'active' : ''}" onclick="Socios.setTab('${k}')">${l}</button>`).join('')}</div>
<div id="soContent"></div>`;
    if (tab === 'socios') renderSocios(); else if (tab === 'cuenta') renderCuenta(); else if (tab === 'repartos') renderRepartos(); else renderResumen();
  }
  function setTab(t) { tab = t; if (M !== 'so') { M = 'so'; R(); } else render($('c')); }

  function renderResumen() {
    const c = $('soContent'); if (!c) return;
    const rg = Finanzas.rango(periodo);
    const er = Finanzas.estadoResultados({ desde: rg.desde, hasta: rg.hasta, base: D.fcfg?.base_resultados || 'caja' });
    const f = Finanzas.calcularFlujo({ desde: rg.desde, hasta: rg.hasta });
    const socs = socios().filter(s => s.activo !== false);
    const pctTot = socs.reduce((s, x) => s + num(x.porcentaje), 0);
    const kpi = (v, l, cls = '') => `<div class="kpi"><p class="kpi-v ${cls}">${v}</p><p class="kpi-l">${l}</p></div>`;
    const sel = (k, l) => `<button type="button" class="tab ${periodo === k ? 'active' : ''}" role="tab" aria-selected="${periodo === k}" onclick="Socios.periodo('${k}')">${l}</button>`;
    const obras = (D.o || []).filter(o => ['Activa', 'En Proceso'].includes(o.estatus)).map(o => Finanzas.resultadoObra(o.id)).filter(Boolean).sort((a, b) => (a.margenDevengado ?? a.margenProyectado ?? 0) - (b.margenDevengado ?? b.margenProyectado ?? 0));
    const sem = { ok: 'bg-emerald-100 text-emerald-800', warn: 'bg-amber-100 text-amber-800', danger: 'bg-red-100 text-red-800', na: 'bg-slate-100 text-slate-600' };
    c.innerHTML = `<div class="tabs mb-3" role="tablist" aria-label="Periodo">${sel('mes', 'Este mes')}${sel('trim', 'Trimestre')}${sel('anio', 'Año')}${sel('todo', 'Todo')}</div>
<div class="kpi-strip">${kpi(F(er.utilidadNeta), 'Utilidad neta · ' + rg.label + ' (' + (er.base === 'caja' ? 'caja' : 'devengado') + ')', er.utilidadNeta < 0 ? 'text-danger' : 'text-ok')}${kpi(F(f.porCobrar), 'Por cobrar' + (f.vencidoCobrar ? ' · <span class="text-danger">' + F(f.vencidoCobrar) + ' vencido</span>' : ''))}${kpi(F(f.neto), 'Caja del periodo (cobrado − pagado)', f.neto < 0 ? 'text-danger' : '')}${kpi(F(er.retiros + er.personales), 'Retiros y gastos personales')}</div>
<div class="grid md:grid-cols-2 gap-4 mb-4">
<section class="g rounded-xl p-4"><h2 class="font-bold text-sm mb-2">Retiros de cada socio contra su participación</h2>${socs.length ? (pctTot <= 0 ? '<p class="text-sm text-warn mb-2">Captura los porcentajes en la pestaña Socios para comparar.</p>' : '') + socs.map(s => { const t = totalesSocio(s.id, rg.desde, rg.hasta); const retiro = r2(t.retiro + t.gasto_personal + t.utilidad_pagada); const totalRet = socs.reduce((x, y) => { const tt = totalesSocio(y.id, rg.desde, rg.hasta); return x + tt.retiro + tt.gasto_personal + tt.utilidad_pagada; }, 0); const pctReal = totalRet > 0 ? retiro / totalRet * 100 : 0; const pct = pctTot > 0 ? num(s.porcentaje) : 100 / socs.length; const dif = r2(retiro - totalRet * pct / 100); return `<div class="mb-3"><div class="flex justify-between text-sm"><span class="font-medium">${S(s.nombre)}</span><span>${F(retiro)} <span class="text-ink-subtle">(${r2(pctReal)} % de lo retirado · le corresponde ${r2(pct)} %)</span></span></div><div class="h-2 bg-slate-100 rounded-full overflow-hidden mt-1 relative"><div class="h-full bg-slate-400" style="width:${Math.min(100, pctReal)}%"></div><div class="absolute top-0 h-full w-0.5 bg-primary" style="left:${Math.min(100, pct)}%" title="Participación"></div></div><p class="text-xs mt-1 ${dif > 0 ? 'text-warn' : 'text-ink-subtle'}">${dif > 0 ? 'Ha retirado ' + F(dif) + ' más de lo que le toca del total retirado' : dif < 0 ? 'Le faltan ' + F(-dif) + ' para igualar su participación' : 'En equilibrio'} · saldo en cuenta ${F(saldoSocio(s.id))}</p></div>`; }).join('') : '<p class="text-sm text-ink-subtle">Registra a los socios primero.</p>'}</section>
<section class="g rounded-xl p-4"><h2 class="font-bold text-sm mb-2">Obras por margen</h2>${obras.length ? `<ul class="divide-y divide-slate-100 text-sm">${obras.map(r => `<li class="flex items-center gap-2 py-1.5"><span class="px-2 py-0.5 rounded-full text-xs ${sem[r.semaforo]}">${r.margenDevengado != null ? r.margenDevengado + ' %' : (r.margenProyectado != null ? r.margenProyectado + ' %' : 's/d')}</span><button type="button" class="link flex-1 min-w-0 truncate text-left" onclick="abrirFichaObra(${r.obra.id})">${S(r.obra.codigo_obra || r.obra.nombre_obra)}</button><span class="text-xs text-ink-subtle">${F(r.utilidadProyectada)} proy.</span></li>`).join('')}</ul>` : '<p class="text-sm text-ink-subtle">Sin obras activas.</p>'}</section>
</div>
<section class="g rounded-xl p-4"><h2 class="font-bold text-sm mb-2">Pendientes del mes</h2><ul class="text-sm space-y-1">${(() => { const items = []; const sinDest = (D.g || []).filter(g => !g.categoria).length; if (sinDest) items.push(`<li><button type="button" class="link" onclick="Compras.setTab('todos')">${sinDest} gasto(s) sin categoría</button></li>`); const sinFac = (D.g || []).filter(g => g.tipo_comprobante === 'Fiscal' && g.comprobacion !== 'facturado' && g.destino !== 'socio').length; if (sinFac) items.push(`<li><button type="button" class="link" onclick="Compras.setTab('comprobante')">${sinFac} gasto(s) con factura pendiente</button></li>`); const propuestos = (D.rep || []).filter(r => r.estado === 'propuesto').length; if (propuestos) items.push(`<li><button type="button" class="link" onclick="Socios.setTab('repartos')">${propuestos} reparto(s) por aprobar</button></li>`); if (er.indirectosSinAsignar > 0.5) items.push(`<li>${F(er.indirectosSinAsignar)} de indirectos sin repartir entre obras <button type="button" class="link" onclick="Socios.prorratearAhora()">Repartir ahora</button></li>`); if (pctTot <= 0 && socs.length) items.push('<li><button type="button" class="link" onclick="Socios.setTab(\'socios\')">Captura los porcentajes de participación</button></li>'); return items.length ? items.join('') : '<li class="text-ink-subtle">Nada pendiente.</li>'; })()}</ul></section>`;
  }
  function setPeriodo(k) { periodo = k; renderResumen(); }

  function renderSocios() {
    const c = $('soContent'); if (!c) return;
    const socs = socios(); const pctTot = r2(socs.filter(s => s.activo !== false).reduce((s, x) => s + num(x.porcentaje), 0));
    const users = (D.u || []).filter(u => u.activo);
    c.innerHTML = `<div class="flex items-center justify-between mb-3"><p class="text-sm ${pctTot > 100.005 ? 'text-danger' : pctTot < 99.995 && socs.length ? 'text-warn' : 'text-ok'}">Participación total: <b>${pctTot} %</b>${pctTot < 99.995 && socs.length ? ` · faltan ${r2(100 - pctTot)} %` : ''}</p><button type="button" class="btn btn-p text-sm" onclick="Socios.editarSocio()"><i class="ri-user-add-line" aria-hidden="true"></i> Agregar socio</button></div>
<div class="g rounded-xl overflow-hidden"><table class="w-full text-sm"><thead class="bg-slate-50 text-xs text-ink-muted"><tr><th class="p-2 text-left">Socio</th><th class="p-2 text-left hidden sm:table-cell">Usuario</th><th class="p-2 text-left hidden md:table-cell">RFC</th><th class="p-2 text-right">Participación</th><th class="p-2 text-right">Saldo en cuenta</th><th class="p-2 text-center">Activo</th><th class="p-2"></th></tr></thead><tbody>
${socs.length ? socs.map(s => `<tr class="border-t border-line"><td class="p-2 font-medium">${S(s.nombre)}</td><td class="p-2 hidden sm:table-cell text-xs">${S(users.find(u => u.id === s.usuario_id)?.nombre || '-')}</td><td class="p-2 hidden md:table-cell text-xs font-mono">${S(s.rfc || '-')}</td><td class="p-2 text-right">${s.porcentaje != null ? num(s.porcentaje) + ' %' : '<span class="text-warn">sin capturar</span>'}</td><td class="p-2 text-right ${saldoSocio(s.id) > 0 ? 'text-ok' : saldoSocio(s.id) < 0 ? 'text-danger' : ''}" title="Positivo: la empresa le debe al socio">${F(saldoSocio(s.id))}</td><td class="p-2 text-center">${s.activo !== false ? '<i class="ri-checkbox-circle-line text-ok" aria-label="Activo"></i>' : '<span class="text-xs text-ink-subtle">inactivo</span>'}</td><td class="p-2 text-right"><button type="button" class="btn-icon" onclick="Socios.editarSocio(${s.id})" aria-label="Editar socio"><i class="ri-edit-line" aria-hidden="true"></i></button></td></tr>`).join('') : `<tr><td colspan="7" class="p-4">${vacio('socios', { icon: 'ri-user-star-line', body: 'Da de alta a los socios con su porcentaje para poder repartir utilidades.', action: { label: 'Agregar socio', onClick: 'Socios.editarSocio()' } })}</td></tr>`}
</tbody></table></div>
<p class="text-xs text-ink-subtle mt-2">El saldo en cuenta es positivo cuando la empresa le debe al socio (aportaciones y utilidades asignadas menos retiros, gastos personales y utilidades pagadas).</p>`;
  }
  function editarSocio(id) {
    const s = id ? (D.soc || []).find(x => x.id === id) : null;
    const users = (D.u || []).filter(u => u.activo);
    let dlg = $('dlgSocio'); if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'dlgSocio'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
    dlg.innerHTML = `<form method="dialog" onsubmit="Socios.guardarSocio(event,${id || 'null'})"><h2 class="font-bold mb-3">${s ? 'Editar socio' : 'Agregar socio'}</h2>
<div class="grid grid-cols-2 gap-3 force-2col">
<div class="col-span-2"><label class="text-xs mb-1 block" for="soNombre">Nombre *</label><input type="text" id="soNombre" class="inp" required value="${S(s?.nombre || '')}"></div>
<div><label class="text-xs mb-1 block" for="soPct">Participación %</label><input type="number" id="soPct" class="inp" min="0" max="100" step="0.01" value="${s?.porcentaje ?? ''}"></div>
<div><label class="text-xs mb-1 block" for="soRfc">RFC</label><input type="text" id="soRfc" class="inp font-mono" maxlength="13" style="text-transform:uppercase" value="${S(s?.rfc || '')}"></div>
<div class="col-span-2"><label class="text-xs mb-1 block" for="soUsuario">Usuario vinculado</label><select id="soUsuario" class="inp"><option value="">Sin usuario</option>${users.map(u => `<option value="${u.id}" ${u.id === s?.usuario_id ? 'selected' : ''}>${S(u.nombre)}</option>`).join('')}</select></div>
<div><label class="text-xs mb-1 block" for="soDesde">Socio desde</label><input type="date" id="soDesde" class="inp" value="${s?.fecha_ingreso || hoyISO()}"></div>
<div class="flex items-end"><label class="zk-switch"><input type="checkbox" id="soActivo" ${s ? (s.activo !== false ? 'checked' : '') : 'checked'}><span class="zk-slider" aria-hidden="true"></span><span class="zk-label">Activo</span></label></div>
</div>
<div class="flex gap-2 mt-4"><button type="button" class="btn btn-s flex-1" onclick="this.closest('dialog').close()">Cancelar</button><button type="submit" class="btn btn-p flex-1">Guardar socio</button></div></form>`;
    dlg.showModal(); setTimeout(() => $('soNombre').focus(), 50);
  }
  async function guardarSocio(e, id) {
    e.preventDefault();
    const pct = $('soPct').value === '' ? null : num($('soPct').value);
    const otros = (D.soc || []).filter(s => s.id !== id && s.activo !== false).reduce((s, x) => s + num(x.porcentaje), 0);
    if ($('soActivo').checked && pct != null && otros + pct > 100.005) { Toast.error(`Con ${pct} % la suma sería ${r2(otros + pct)} %: sobran ${r2(otros + pct - 100)} %.`); return; }
    const row = { empresa_id: currentUser.empresa_id, nombre: $('soNombre').value.trim(), porcentaje: pct, rfc: ($('soRfc').value || '').toUpperCase() || null, usuario_id: $('soUsuario').value || null, fecha_ingreso: $('soDesde').value || null, activo: $('soActivo').checked, updated_at: new Date().toISOString() };
    const q = id ? sb.from('socios').update(row).eq('id', id) : sb.from('socios').insert(row);
    const { data, error } = await q.select().single();
    if (error) { Toast.error(humanizeError(error, 'No se pudo guardar el socio')); return; }
    if (id) { const s = D.soc.find(x => x.id === id); Object.assign(s, data); } else (D.soc = D.soc || []).push(data);
    $('dlgSocio').close(); Toast.success('Socio guardado.'); renderSocios();
  }

  function renderCuenta() {
    const c = $('soContent'); if (!c) return;
    const socs = socios();
    c.innerHTML = `<div class="grid md:grid-cols-2 gap-4">${socs.map(s => { const movs = (D.msoc || []).filter(m => m.socio_id === s.id).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || b.id - a.id); const t = totalesSocio(s.id); const saldo = saldoSocio(s.id); return `<section class="g rounded-xl p-4" aria-labelledby="soc${s.id}"><div class="flex items-start justify-between gap-2"><div><h2 id="soc${s.id}" class="font-bold">${S(s.nombre)}</h2><p class="text-xs text-ink-subtle">${s.porcentaje != null ? num(s.porcentaje) + ' % de participación' : 'sin porcentaje'}</p></div><div class="text-right"><p class="text-xl font-bold ${saldo > 0 ? 'text-ok' : saldo < 0 ? 'text-danger' : ''}" title="aportaciones + utilidades asignadas − retiros − gastos personales − utilidades pagadas">${F(saldo)}</p><p class="text-xs text-ink-subtle">${saldo > 0 ? 'la empresa le debe' : saldo < 0 ? 'debe a la empresa' : 'en ceros'}</p></div></div>
<dl class="grid grid-cols-3 gap-2 text-xs mt-3"><div><dt class="text-ink-subtle">Aportó</dt><dd class="font-medium">${F(t.aportacion)}</dd></div><div><dt class="text-ink-subtle">Retiró</dt><dd class="font-medium">${F(t.retiro + t.utilidad_pagada)}</dd></div><div><dt class="text-ink-subtle">Gastos personales</dt><dd class="font-medium">${F(t.gasto_personal)}</dd></div></dl>
<div class="flex flex-wrap gap-2 mt-3"><button type="button" class="btn btn-s text-xs" onclick="Socios.nuevoMovimiento(${s.id})"><i class="ri-add-line" aria-hidden="true"></i> Movimiento</button><button type="button" class="btn btn-s text-xs" onclick="Socios.estadoCuentaPDF(${s.id})"><i class="ri-file-pdf-line" aria-hidden="true"></i> Estado de cuenta</button></div>
<ul class="divide-y divide-slate-100 text-sm mt-3">${movs.slice(0, 12).map(m => `<li class="flex items-center gap-2 py-1.5"><span class="text-xs text-ink-subtle w-16 shrink-0">${fechaCorta(m.fecha)}</span><span class="chip chip-ind">${TIPOS[m.tipo]?.[0] || m.tipo}</span><span class="flex-1 min-w-0 truncate" title="${S(m.concepto || '')}">${S(m.concepto || '')}</span><span class="font-medium ${TIPOS[m.tipo]?.[1] || ''}">${SIGNO[m.tipo] < 0 ? '−' : '+'}${F(m.monto)}</span>${!m.gasto_id && !m.reparto_id ? `<button type="button" class="btn-icon" onclick="Socios.eliminarMovimiento(${m.id})" aria-label="Eliminar movimiento"><i class="ri-delete-bin-line" aria-hidden="true"></i></button>` : ''}</li>`).join('') || '<li class="text-ink-subtle py-2">Sin movimientos.</li>'}</ul>${movs.length > 12 ? `<p class="text-xs text-ink-subtle mt-1">${movs.length - 12} movimientos más en el estado de cuenta.</p>` : ''}</section>`; }).join('') || vacio('socios', { icon: 'ri-user-star-line', body: 'Registra a los socios primero.' })}</div>`;
  }
  function nuevoMovimiento(socioId) {
    let dlg = $('dlgMov'); if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'dlgMov'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
    dlg.innerHTML = `<form method="dialog" onsubmit="Socios.guardarMovimiento(event)"><h2 class="font-bold mb-3">Registrar movimiento de socio</h2>
<div class="grid grid-cols-2 gap-3 force-2col">
<div><label class="text-xs mb-1 block" for="mvSocio">Socio *</label><select id="mvSocio" class="inp" required>${socios().map(s => `<option value="${s.id}" ${s.id == socioId ? 'selected' : ''}>${S(s.nombre)}</option>`).join('')}</select></div>
<div><label class="text-xs mb-1 block" for="mvTipo">Tipo *</label><select id="mvTipo" class="inp"><option value="aportacion">Aportación (el socio pone dinero)</option><option value="retiro">Retiro (el socio saca dinero)</option><option value="ajuste">Ajuste</option></select></div>
<div><label class="text-xs mb-1 block" for="mvFecha">Fecha *</label><input type="date" id="mvFecha" class="inp" value="${hoyISO()}" required></div>
<div><label class="text-xs mb-1 block" for="mvMonto">Monto *</label><input type="number" id="mvMonto" class="inp" step="0.01" min="0" required inputmode="decimal"></div>
<div><label class="text-xs mb-1 block" for="mvMetodo">Método</label><select id="mvMetodo" class="inp"><option>Transferencia</option><option>Efectivo</option><option>Cheque</option></select></div>
<div><label class="text-xs mb-1 block" for="mvRef">Referencia</label><input type="text" id="mvRef" class="inp"></div>
<div class="col-span-2"><label class="text-xs mb-1 block" for="mvConcepto">Concepto</label><input type="text" id="mvConcepto" class="inp" placeholder="Ej. Retiro a cuenta de utilidades de agosto"></div>
</div>
<p class="text-xs text-ink-subtle mt-2">Los gastos personales pagados por la empresa y lo que el socio paga de su bolsa se registran desde Compras (destino Socio o "quién puso el dinero"); aquí sólo van entradas y salidas de dinero directas.</p>
<div class="flex gap-2 mt-4"><button type="button" class="btn btn-s flex-1" onclick="this.closest('dialog').close()">Cancelar</button><button type="submit" class="btn btn-p flex-1">Guardar movimiento</button></div></form>`;
    dlg.showModal(); setTimeout(() => $('mvMonto').focus(), 50);
  }
  async function guardarMovimiento(e) {
    e.preventDefault();
    const row = { empresa_id: currentUser.empresa_id, socio_id: parseInt($('mvSocio').value), tipo: $('mvTipo').value, fecha: $('mvFecha').value, monto: r2(num($('mvMonto').value)), metodo_pago: $('mvMetodo').value, referencia: $('mvRef').value || null, concepto: $('mvConcepto').value || null, created_by: currentUser.id };
    if (!(row.monto > 0)) { Toast.warning('Captura el monto.'); return; }
    const { data, error } = await sb.from('movimientos_socio').insert(row).select().single();
    if (error) { Toast.error(humanizeError(error, 'No se pudo guardar el movimiento')); return; }
    (D.msoc = D.msoc || []).unshift(data); $('dlgMov').close(); Toast.success('Movimiento registrado.'); render($('c'));
  }
  async function eliminarMovimiento(id) {
    const m = (D.msoc || []).find(x => x.id === id); if (!m) return;
    if (!await Dialog.confirm({ title: 'Eliminar movimiento', body: `${TIPOS[m.tipo]?.[0] || m.tipo} de ${F(m.monto)} del ${fechaCorta(m.fecha)}.`, confirmText: 'Eliminar', tone: 'danger' })) return;
    const { error } = await sb.from('movimientos_socio').delete().eq('id', id);
    if (error) { Toast.error(humanizeError(error)); return; }
    D.msoc = D.msoc.filter(x => x.id !== id); render($('c'));
  }
  async function estadoCuentaPDF(id) {
    const s = (D.soc || []).find(x => x.id === id); if (!s) return;
    const movs = (D.msoc || []).filter(m => m.socio_id === id).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.id - b.id);
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(currentUser?.empresa_nombre || 'Empresa', 20, 18);
    doc.setFontSize(12); doc.text(`Estado de cuenta del socio: ${s.nombre}`, 20, 26);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`Generado el ${hoyISO()} · Participación ${s.porcentaje != null ? num(s.porcentaje) + ' %' : 'sin capturar'}`, 20, 31);
    let saldo = 0;
    const body = movs.map(m => { saldo = r2(saldo + (SIGNO[m.tipo] || 1) * num(m.monto)); return [String(m.fecha).slice(0, 10), TIPOS[m.tipo]?.[0] || m.tipo, m.concepto || '', SIGNO[m.tipo] > 0 ? F(m.monto) : '', SIGNO[m.tipo] < 0 ? F(m.monto) : '', F(saldo)]; });
    doc.autoTable({ startY: 36, head: [['Fecha', 'Tipo', 'Concepto', 'A favor', 'En contra', 'Saldo']], body, styles: { fontSize: 8 }, headStyles: { fillColor: [30, 41, 59] }, columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } } });
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.text(`Saldo: ${F(saldo)} (${saldo > 0 ? 'la empresa le debe al socio' : saldo < 0 ? 'el socio debe a la empresa' : 'en ceros'})`, 20, doc.lastAutoTable.finalY + 8);
    doc.save(`EstadoCuenta_${s.nombre.replace(/[^\w]+/g, '_')}_${hoyISO()}.pdf`);
  }

  // ---------- Repartos ----------
  function renderRepartos() {
    const c = $('soContent'); if (!c) return;
    const reps = (D.rep || []);
    const est = { propuesto: 'bg-amber-100 text-amber-800', aprobado: 'bg-sky-100 text-sky-800', pagado: 'bg-emerald-100 text-emerald-800', anulado: 'bg-slate-100 text-slate-600' };
    c.innerHTML = reps.length ? `<div class="space-y-3">${reps.map(r => { const det = (D.repd || []).filter(d => d.reparto_id === r.id); const o = r.obra_id ? (D.o || []).find(x => x.id === r.obra_id) : null; const apro = Array.isArray(r.aprobaciones) ? r.aprobaciones : []; const yo = apro.some(a => a.user_id === currentUser.id); return `<section class="g rounded-xl p-4"><div class="flex flex-wrap items-center justify-between gap-2"><div><h2 class="font-bold">${o ? 'Obra ' + S(o.codigo_obra || o.nombre_obra) : `${fechaCorta(r.periodo_desde)} a ${fechaCorta(r.periodo_hasta)}`} <span class="px-2 py-0.5 rounded-full text-xs ${est[r.estado]}">${r.estado}</span></h2><p class="text-xs text-ink-subtle">Utilidad ${F(r.utilidad)} · reservas ${F((r.reservas?.impuestos || 0) + (r.reservas?.capital || 0))} · distribuible <b>${F(r.distribuible)}</b> · ${apro.length} aprobación(es)</p></div>
<div class="flex flex-wrap gap-2">${r.estado === 'propuesto' && !yo ? `<button type="button" class="btn btn-p text-xs" onclick="Socios.aprobar(${r.id})"><i class="ri-check-line" aria-hidden="true"></i> Aprobar</button>` : ''}${r.estado === 'aprobado' ? `<button type="button" class="btn btn-p text-xs" onclick="Socios.marcarPagado(${r.id})"><i class="ri-bank-card-line" aria-hidden="true"></i> Marcar pagado</button>` : ''}<button type="button" class="btn btn-s text-xs" onclick="Socios.actaPDF(${r.id})"><i class="ri-file-pdf-line" aria-hidden="true"></i> Acta</button>${r.estado !== 'anulado' && r.estado !== 'pagado' ? `<button type="button" class="btn btn-s text-xs text-danger" onclick="Socios.anular(${r.id})">Anular</button>` : ''}</div></div>
<table class="w-full text-sm mt-3"><thead class="text-xs text-ink-muted"><tr><th class="text-left p-1">Socio</th><th class="text-right p-1">%</th><th class="text-right p-1">Asignado</th><th class="text-right p-1">A cuenta</th><th class="text-right p-1">Aportó</th><th class="text-right p-1">Ajuste</th><th class="text-right p-1">A pagar</th><th class="text-left p-1 hidden sm:table-cell">Pagado</th></tr></thead><tbody>${det.map(d => { const s = (D.soc || []).find(x => x.id === d.socio_id); return `<tr class="border-t border-line"><td class="p-1">${S(s?.nombre || d.socio_id)}</td><td class="p-1 text-right">${num(d.porcentaje)} %</td><td class="p-1 text-right">${F(d.asignado)}</td><td class="p-1 text-right">−${F(d.a_cuenta)}</td><td class="p-1 text-right">+${F(d.aportado)}</td><td class="p-1 text-right">${num(d.ajuste) ? F(d.ajuste) : '-'}</td><td class="p-1 text-right font-bold ${num(d.a_pagar) < 0 ? 'text-danger' : ''}">${F(d.a_pagar)}</td><td class="p-1 text-xs hidden sm:table-cell">${d.pagado_at ? fechaCorta(d.pagado_at) + (d.referencia ? ' · ' + S(d.referencia) : '') : '-'}</td></tr>`; }).join('')}</tbody></table>${r.notas ? `<p class="text-xs text-ink-subtle mt-2">${S(r.notas)}</p>` : ''}</section>`; }).join('')}</div>` : vacio('repartos', { icon: 'ri-pie-chart-2-line', body: 'Cierra un periodo o una obra y reparte la utilidad entre los socios descontando lo que cada uno ya retiró.', action: { label: 'Nuevo reparto', onClick: 'Socios.nuevoReparto()' } });
  }

  let wz = null;
  function nuevoReparto() {
    const socs = socios().filter(s => s.activo !== false);
    if (!socs.length) { Toast.warning('Registra a los socios primero.'); return; }
    if (!socs.some(s => num(s.porcentaje) > 0)) { Toast.warning('Captura los porcentajes de participación en la pestaña Socios.'); setTab('socios'); return; }
    const cfg = D.fcfg || {}; const rg = Finanzas.rango('mes');
    wz = { base: 'periodo', desde: rg.desde, hasta: rg.hasta, obraId: null, tipoBase: cfg.base_resultados || 'caja', reservas: { impuestos: num(cfg.reservas?.impuestos ?? 30), capital: num(cfg.reservas?.capital ?? 10) }, ajustes: {}, motivos: {}, paso: 1 };
    let dlg = $('dlgReparto'); if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'dlgReparto'; dlg.className = 'dlg dlg-wide'; document.body.appendChild(dlg); }
    pintarWizard(); dlg.showModal();
  }
  function calcularWz() {
    const b = wz.base === 'obra' ? Finanzas.baseReparto({ obraId: wz.obraId, reservas: wz.reservas, hasta: wz.hasta }) : Finanzas.baseReparto({ desde: wz.desde, hasta: wz.hasta, reservas: wz.reservas, base: wz.tipoBase });
    b.filas.forEach(f => { f.ajuste = num(wz.ajustes[f.socio.id]); f.aPagarFinal = r2(f.aPagar + f.ajuste); });
    return b;
  }
  function pintarWizard() {
    const dlg = $('dlgReparto'); const obras = (D.o || []).filter(o => o.estatus !== 'Archivada');
    const b = wz.paso >= 2 ? calcularWz() : null;
    const pasos = ['Base', 'Reservas', 'Por socio', 'Resumen'];
    let cuerpo = '';
    if (wz.paso === 1) cuerpo = `<div class="seg mb-3" role="radiogroup"><button type="button" class="seg-btn ${wz.base === 'periodo' ? 'active' : ''}" onclick="Socios.wz('base','periodo')">Un periodo</button><button type="button" class="seg-btn ${wz.base === 'obra' ? 'active' : ''}" onclick="Socios.wz('base','obra')">Una obra terminada</button></div>
${wz.base === 'periodo' ? `<div class="grid grid-cols-2 gap-3 force-2col"><div><label class="text-xs mb-1 block" for="wzDesde">Desde</label><input type="date" id="wzDesde" class="inp" value="${wz.desde}" onchange="Socios.wz('desde',this.value)"></div><div><label class="text-xs mb-1 block" for="wzHasta">Hasta</label><input type="date" id="wzHasta" class="inp" value="${wz.hasta}" onchange="Socios.wz('hasta',this.value)"></div><div class="col-span-2"><label class="text-xs mb-1 block" for="wzTipoBase">Ingreso del periodo</label><select id="wzTipoBase" class="inp" onchange="Socios.wz('tipoBase',this.value)"><option value="caja" ${wz.tipoBase === 'caja' ? 'selected' : ''}>Caja: lo cobrado en el periodo</option><option value="devengado" ${wz.tipoBase === 'devengado' ? 'selected' : ''}>Devengado: contrato × avance</option></select></div></div>` : `<label class="text-xs mb-1 block" for="wzObra">Obra</label><select id="wzObra" class="inp" onchange="Socios.wz('obraId',this.value)"><option value="">Elige la obra</option>${obras.map(o => `<option value="${o.id}" ${wz.obraId == o.id ? 'selected' : ''}>${S(o.codigo_obra || '')} ${S(o.nombre_obra)} · ${S(o.estatus)}</option>`).join('')}</select><p class="text-xs text-ink-subtle mt-1">Se toma la utilidad en caja de la obra (cobrado − costo total, con indirectos prorrateados).</p>`}`;
    else if (wz.paso === 2) cuerpo = `<p class="text-sm mb-3">Utilidad ${wz.base === 'obra' ? 'de la obra' : 'neta del periodo'}: <b class="${b.utilidad < 0 ? 'text-danger' : ''}">${F(b.utilidad)}</b></p><div class="grid grid-cols-2 gap-3 force-2col"><div><label class="text-xs mb-1 block" for="wzImp">Reserva para impuestos %</label><input type="number" id="wzImp" class="inp" min="0" max="100" step="0.5" value="${wz.reservas.impuestos}" onchange="Socios.wz('impuestos',this.value)"><p class="text-xs text-ink-subtle mt-1">${F(b.reservas.impuestos)}</p></div><div><label class="text-xs mb-1 block" for="wzCap">Reserva de capital de trabajo %</label><input type="number" id="wzCap" class="inp" min="0" max="100" step="0.5" value="${wz.reservas.capital}" onchange="Socios.wz('capital',this.value)"><p class="text-xs text-ink-subtle mt-1">${F(b.reservas.capital)}</p></div></div><p class="text-lg font-bold mt-3">Distribuible: ${F(b.distribuible)}</p>${b.utilidad <= 0 ? '<p class="text-sm text-danger mt-1">No hay utilidad que repartir en esta base.</p>' : ''}`;
    else if (wz.paso === 3) cuerpo = `<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="text-xs text-ink-muted"><tr><th class="text-left p-1">Socio</th><th class="text-right p-1">%</th><th class="text-right p-1">Asignado</th><th class="text-right p-1">Retiros a cuenta</th><th class="text-right p-1">Aportó</th><th class="text-right p-1">Ajuste</th><th class="text-right p-1">A pagar</th></tr></thead><tbody>${b.filas.map(f => `<tr class="border-t border-line"><td class="p-1">${S(f.socio.nombre)}</td><td class="p-1 text-right">${f.porcentaje} %</td><td class="p-1 text-right">${F(f.asignado)}</td><td class="p-1 text-right">−${F(f.aCuenta)}</td><td class="p-1 text-right">+${F(f.aportado)}</td><td class="p-1 text-right"><input type="number" class="inp w-24 text-right text-xs py-0.5" step="0.01" value="${f.ajuste || ''}" placeholder="0" onchange="Socios.wz('ajuste:${f.socio.id}',this.value)" aria-label="Ajuste para ${S(f.socio.nombre)}"><input type="text" class="inp w-full text-xs py-0.5 mt-1" placeholder="Motivo del ajuste" value="${S(wz.motivos[f.socio.id] || '')}" onchange="Socios.wz('motivo:${f.socio.id}',this.value)" aria-label="Motivo del ajuste para ${S(f.socio.nombre)}"></td><td class="p-1 text-right font-bold ${f.aPagarFinal < 0 ? 'text-danger' : ''}">${F(f.aPagarFinal)}</td></tr>`).join('')}</tbody></table></div><p class="text-xs text-ink-subtle mt-2">A pagar = asignado − retiros y gastos personales del periodo + lo que el socio pagó de su bolsa ± ajuste. Un valor negativo significa que el socio ya retiró de más.</p>`;
    else cuerpo = `<p class="text-sm">Se creará el reparto en estado <b>propuesto</b>. Cada socio con usuario lo aprueba desde aquí; al aprobar todos, pasa a <b>aprobado</b> y se registran las utilidades asignadas en la cuenta de cada socio. Al marcarlo pagado se registran los pagos.</p><ul class="text-sm mt-3 space-y-1">${b.filas.map(f => `<li class="flex justify-between"><span>${S(f.socio.nombre)}</span><b>${F(f.aPagarFinal)}</b></li>`).join('')}</ul><label class="text-xs mt-3 mb-1 block" for="wzNotas">Notas</label><input type="text" id="wzNotas" class="inp" value="${S(wz.notas || '')}" onchange="Socios.wz('notas',this.value)">`;
    dlg.innerHTML = `<div class="flex justify-between items-center mb-3"><h2 class="font-bold">Reparto de utilidades · paso ${wz.paso} de 4: ${pasos[wz.paso - 1]}</h2><button type="button" class="btn-icon" onclick="this.closest('dialog').close()" aria-label="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></div>${cuerpo}
<div class="flex justify-between gap-2 mt-4"><button type="button" class="btn btn-s" ${wz.paso === 1 ? 'disabled' : ''} onclick="Socios.wzPaso(-1)">Atrás</button>${wz.paso < 4 ? `<button type="button" class="btn btn-p" onclick="Socios.wzPaso(1)">Siguiente</button>` : `<button type="button" class="btn btn-p" onclick="Socios.guardarReparto()">Crear reparto</button>`}</div>`;
  }
  function wzSet(k, v) {
    if (k.startsWith('ajuste:')) wz.ajustes[k.slice(7)] = num(v);
    else if (k.startsWith('motivo:')) wz.motivos[k.slice(7)] = v;
    else if (k === 'impuestos' || k === 'capital') wz.reservas[k] = num(v);
    else if (k === 'obraId') wz.obraId = parseInt(v) || null;
    else wz[k] = v;
    if (k === 'base' || k === 'impuestos' || k === 'capital') pintarWizard();
  }
  function wzPaso(d) {
    if (d > 0 && wz.paso === 1 && wz.base === 'obra' && !wz.obraId) { Toast.warning('Elige la obra.'); return; }
    if (d > 0 && wz.paso === 2 && calcularWz().utilidad <= 0) { Toast.warning('No hay utilidad que repartir.'); return; }
    wz.paso = Math.max(1, Math.min(4, wz.paso + d)); pintarWizard();
  }
  async function guardarReparto() {
    const b = calcularWz();
    const yaHay = (D.rep || []).find(r => r.estado !== 'anulado' && ((wz.base === 'obra' && r.obra_id === wz.obraId) || (wz.base !== 'obra' && r.periodo_desde === wz.desde && r.periodo_hasta === wz.hasta)));
    if (yaHay) { Toast.error('Ese periodo u obra ya tiene un reparto; anúlalo antes de crear otro.'); return; }
    const { data: rep, error } = await sb.from('repartos').insert({ empresa_id: currentUser.empresa_id, periodo_desde: wz.base === 'obra' ? null : wz.desde, periodo_hasta: wz.base === 'obra' ? null : wz.hasta, obra_id: wz.base === 'obra' ? wz.obraId : null, base: wz.base === 'obra' ? 'caja' : wz.tipoBase, utilidad: b.utilidad, reservas: { impuestos: b.reservas.impuestos, capital: b.reservas.capital, pctImpuestos: wz.reservas.impuestos, pctCapital: wz.reservas.capital }, distribuible: b.distribuible, estado: 'propuesto', notas: wz.notas || null, created_by: currentUser.id }).select().single();
    if (error) { Toast.error(humanizeError(error, 'No se pudo crear el reparto')); return; }
    const det = b.filas.map(f => ({ reparto_id: rep.id, socio_id: f.socio.id, porcentaje: f.porcentaje, asignado: f.asignado, a_cuenta: f.aCuenta, aportado: f.aportado, ajuste: f.ajuste || 0, ajuste_motivo: wz.motivos[f.socio.id] || null, a_pagar: f.aPagarFinal }));
    const { data: rows, error: e2 } = await sb.from('reparto_detalle').insert(det).select();
    if (e2) { Toast.error(humanizeError(e2)); return; }
    (D.rep = D.rep || []).unshift(rep); D.repd = (D.repd || []).concat(rows);
    $('dlgReparto').close(); Toast.success('Reparto creado; falta la aprobación de los socios.');
    try { Telemetry.track('reparto_generado', { base: wz.base }); } catch (e) { }
    tab = 'repartos'; render($('c'));
  }
  async function aprobar(id) {
    const r = (D.rep || []).find(x => x.id === id); if (!r) return;
    const apro = Array.isArray(r.aprobaciones) ? r.aprobaciones.slice() : [];
    if (apro.some(a => a.user_id === currentUser.id)) { Toast.info('Ya aprobaste este reparto.'); return; }
    apro.push({ user_id: currentUser.id, nombre: currentUser.nombre, fecha: new Date().toISOString() });
    const socsConUsuario = (D.soc || []).filter(s => s.activo !== false && s.usuario_id);
    const faltan = socsConUsuario.filter(s => !apro.some(a => a.user_id === s.usuario_id));
    const estado = faltan.length ? 'propuesto' : 'aprobado';
    const { data, error } = await sb.from('repartos').update({ aprobaciones: apro, estado, updated_at: new Date().toISOString() }).eq('id', id).select().single();
    if (error) { Toast.error(humanizeError(error)); return; }
    Object.assign(r, data);
    if (estado === 'aprobado') {
      const det = (D.repd || []).filter(d => d.reparto_id === id);
      const movs = det.map(d => ({ empresa_id: currentUser.empresa_id, socio_id: d.socio_id, tipo: 'utilidad_asignada', fecha: hoyISO(), monto: num(d.asignado), reparto_id: id, concepto: 'Utilidad asignada · reparto #' + id, created_by: currentUser.id }));
      const { data: ms } = await sb.from('movimientos_socio').insert(movs).select(); if (ms) D.msoc = (D.msoc || []).concat(ms);
      Toast.success('Reparto aprobado por todos los socios; las utilidades quedaron asignadas.');
    } else Toast.success(`Aprobado. Falta${faltan.length > 1 ? 'n' : ''}: ${faltan.map(s => s.nombre).join(', ')}.`);
    renderRepartos();
  }
  async function marcarPagado(id) {
    const r = (D.rep || []).find(x => x.id === id); if (!r) return;
    const det = (D.repd || []).filter(d => d.reparto_id === id);
    let dlg = $('dlgPagoRep'); if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'dlgPagoRep'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
    dlg.innerHTML = `<form method="dialog" onsubmit="Socios._pagar(event,${id})"><h2 class="font-bold mb-3">Registrar pago del reparto</h2><label class="text-xs mb-1 block" for="rpFecha">Fecha</label><input type="date" id="rpFecha" class="inp mb-3" value="${hoyISO()}">${det.map(d => { const s = (D.soc || []).find(x => x.id === d.socio_id); return `<div class="flex items-center gap-2 mb-2"><span class="flex-1 text-sm">${S(s?.nombre || '')} · ${F(d.a_pagar)}</span><input type="text" class="inp w-40 text-xs" placeholder="Referencia" id="rpRef${d.id}"></div>`; }).join('')}<div class="flex gap-2 mt-3"><button type="button" class="btn btn-s flex-1" onclick="this.closest('dialog').close()">Cancelar</button><button type="submit" class="btn btn-p flex-1">Marcar pagado</button></div></form>`;
    dlg.showModal();
  }
  async function _pagar(e, id) {
    e.preventDefault();
    const fecha = $('rpFecha').value || hoyISO();
    const det = (D.repd || []).filter(d => d.reparto_id === id);
    for (const d of det) {
      const ref = $('rpRef' + d.id)?.value || null;
      await sb.from('reparto_detalle').update({ pagado_at: fecha, referencia: ref }).eq('id', d.id); d.pagado_at = fecha; d.referencia = ref;
      if (num(d.a_pagar) > 0) { const { data: m } = await sb.from('movimientos_socio').insert({ empresa_id: currentUser.empresa_id, socio_id: d.socio_id, tipo: 'utilidad_pagada', fecha, monto: num(d.a_pagar), reparto_id: id, referencia: ref, concepto: 'Pago de utilidades · reparto #' + id, created_by: currentUser.id }).select().single(); if (m) (D.msoc = D.msoc || []).unshift(m); }
    }
    const { data } = await sb.from('repartos').update({ estado: 'pagado', updated_at: new Date().toISOString() }).eq('id', id).select().single();
    const r = D.rep.find(x => x.id === id); if (data) Object.assign(r, data);
    $('dlgPagoRep').close(); Toast.success('Reparto pagado y registrado en las cuentas de los socios.'); renderRepartos();
  }
  async function anular(id) {
    const r = (D.rep || []).find(x => x.id === id); if (!r) return;
    let dlg = $('dlgAnular'); if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'dlgAnular'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
    dlg.innerHTML = `<form method="dialog" onsubmit="Socios._anular(event,${id})"><h2 class="font-bold mb-2">Anular reparto</h2><label class="text-xs mb-1 block" for="anMotivo">Motivo *</label><textarea id="anMotivo" class="inp" rows="2" required></textarea><div class="flex gap-2 mt-3"><button type="button" class="btn btn-s flex-1" onclick="this.closest('dialog').close()">Cancelar</button><button type="submit" class="btn btn-p flex-1">Anular</button></div></form>`;
    dlg.showModal();
  }
  async function _anular(e, id) {
    e.preventDefault();
    const motivo = $('anMotivo').value.trim(); if (!motivo) return;
    const { data, error } = await sb.from('repartos').update({ estado: 'anulado', anulado_motivo: motivo, updated_at: new Date().toISOString() }).eq('id', id).select().single();
    if (error) { Toast.error(humanizeError(error)); return; }
    await sb.from('movimientos_socio').delete().eq('reparto_id', id); D.msoc = (D.msoc || []).filter(m => m.reparto_id !== id);
    Object.assign(D.rep.find(x => x.id === id), data); $('dlgAnular').close(); Toast.success('Reparto anulado.'); renderRepartos();
  }
  async function actaPDF(id) {
    const r = (D.rep || []).find(x => x.id === id); if (!r) return;
    const det = (D.repd || []).filter(d => d.reparto_id === id); const o = r.obra_id ? (D.o || []).find(x => x.id === r.obra_id) : null;
    let emp = { nombre: currentUser?.empresa_nombre || '' };
    try { const { data } = await sb.from('empresas').select('nombre,razon_social,rfc,direccion').eq('id', currentUser?.empresa_id).single(); if (data) emp = { ...emp, ...data }; } catch (e) { }
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(emp.razon_social || emp.nombre || 'Empresa', 20, 18);
    doc.setFontSize(12); doc.text('Acta de reparto de utilidades', 20, 26);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text([emp.rfc ? 'RFC ' + emp.rfc : '', `Reparto #${r.id} · estado: ${r.estado} · generado el ${hoyISO()}`, o ? `Base: obra ${o.codigo_obra || ''} ${o.nombre_obra}` : `Base: periodo del ${r.periodo_desde} al ${r.periodo_hasta} (${r.base})`].filter(Boolean), 20, 32);
    doc.autoTable({ startY: 46, theme: 'plain', styles: { fontSize: 10 }, body: [['Utilidad', F(r.utilidad)], [`Reserva para impuestos (${r.reservas?.pctImpuestos ?? ''} %)`, '−' + F(r.reservas?.impuestos || 0)], [`Reserva de capital de trabajo (${r.reservas?.pctCapital ?? ''} %)`, '−' + F(r.reservas?.capital || 0)], ['Distribuible', F(r.distribuible)]], columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } } });
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, head: [['Socio', '%', 'Asignado', 'A cuenta', 'Aportó', 'Ajuste', 'A pagar']], body: det.map(d => { const s = (D.soc || []).find(x => x.id === d.socio_id); return [s?.nombre || '', num(d.porcentaje) + ' %', F(d.asignado), '−' + F(d.a_cuenta), '+' + F(d.aportado), num(d.ajuste) ? F(d.ajuste) + (d.ajuste_motivo ? ' (' + d.ajuste_motivo + ')' : '') : '-', F(d.a_pagar)]; }), styles: { fontSize: 9 }, headStyles: { fillColor: [30, 41, 59] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 6: { halign: 'right', fontStyle: 'bold' } } });
    let y = doc.lastAutoTable.finalY + 10;
    if (r.notas) { doc.setFontSize(9); doc.text('Notas: ' + r.notas, 20, y, { maxWidth: 170 }); y += 10; }
    const apro = Array.isArray(r.aprobaciones) ? r.aprobaciones : [];
    doc.setFontSize(9); doc.text('Aprobaciones: ' + (apro.length ? apro.map(a => `${a.nombre} (${String(a.fecha).slice(0, 10)})`).join(', ') : 'pendientes'), 20, y, { maxWidth: 170 }); y += 22;
    const socs = det.map(d => (D.soc || []).find(x => x.id === d.socio_id)?.nombre || '');
    socs.forEach((n, i) => { const x = 20 + (i % 2) * 95; if (i && i % 2 === 0) y += 22; doc.line(x, y, x + 75, y); doc.text(n, x + 37 - n.length, y + 5); });
    const nombre = `Acta_reparto_${r.id}_${hoyISO()}.pdf`;
    try { const blob = doc.output('blob'); const path = `empresa/${currentUser.empresa_id}/repartos/${nombre}`; const { error } = await sb.storage.from('comprobantes').upload(path, blob, { contentType: 'application/pdf', upsert: true }); if (!error && r.acta_path !== path) { await sb.from('repartos').update({ acta_path: path }).eq('id', id); r.acta_path = path; } } catch (e) { }
    doc.save(nombre);
  }

  // ---------- Configuración financiera (Configuración › Finanzas) ----------
  function configHtml() {
    const cfg = D.fcfg || { prorrateo: { tipo: 'iguales', fijos: {} }, reservas: { impuestos: 30, capital: 10 }, base_resultados: 'caja' };
    const obras = (D.o || []).filter(o => ['Activa', 'En Proceso'].includes(o.estatus));
    const tipo = cfg.prorrateo?.tipo || 'iguales';
    return `<div class="space-y-3">
<div><label class="text-xs mb-1 block" for="fcProrrateo">Cómo se reparten los gastos indirectos entre las obras</label><select id="fcProrrateo" class="inp" onchange="$('fcFijos').classList.toggle('hidden',this.value!=='fijo')"><option value="iguales" ${tipo === 'iguales' ? 'selected' : ''}>Partes iguales entre obras activas del mes</option><option value="contrato" ${tipo === 'contrato' ? 'selected' : ''}>Proporcional al monto del contrato</option><option value="directo" ${tipo === 'directo' ? 'selected' : ''}>Proporcional al gasto directo del mes</option><option value="fijo" ${tipo === 'fijo' ? 'selected' : ''}>Porcentajes fijos por obra</option></select></div>
<div id="fcFijos" class="${tipo === 'fijo' ? '' : 'hidden'} space-y-1">${obras.map(o => `<div class="flex items-center gap-2 text-sm"><span class="flex-1 truncate">${S(o.codigo_obra || o.nombre_obra)}</span><input type="number" class="inp w-20 text-right fcFijo" data-id="${o.id}" min="0" max="100" step="1" value="${num(cfg.prorrateo?.fijos?.[o.id]) || ''}" aria-label="Porcentaje fijo para ${S(o.nombre_obra)}"><span class="text-xs">%</span></div>`).join('')}</div>
<div class="grid grid-cols-2 gap-3 force-2col"><div><label class="text-xs mb-1 block" for="fcImp">Reserva para impuestos %</label><input type="number" id="fcImp" class="inp" min="0" max="100" step="0.5" value="${num(cfg.reservas?.impuestos ?? 30)}"></div><div><label class="text-xs mb-1 block" for="fcCap">Reserva de capital de trabajo %</label><input type="number" id="fcCap" class="inp" min="0" max="100" step="0.5" value="${num(cfg.reservas?.capital ?? 10)}"></div></div>
<div><label class="text-xs mb-1 block" for="fcBase">Ingreso para el estado de resultados</label><select id="fcBase" class="inp"><option value="caja" ${cfg.base_resultados === 'caja' ? 'selected' : ''}>Caja (lo cobrado)</option><option value="devengado" ${cfg.base_resultados === 'devengado' ? 'selected' : ''}>Devengado (contrato × avance)</option></select></div>
<div class="flex flex-wrap gap-2"><button type="button" class="btn btn-p text-sm" onclick="Socios.guardarConfig()">Guardar</button><button type="button" class="btn btn-s text-sm" onclick="Socios.prorratearAhora()"><i class="ri-refresh-line" aria-hidden="true"></i> Reprocesar indirectos del año</button></div></div>`;
  }
  async function guardarConfig() {
    const fijos = {}; document.querySelectorAll('.fcFijo').forEach(i => { const v = num(i.value); if (v > 0) fijos[i.dataset.id] = v; });
    const row = { empresa_id: currentUser.empresa_id, prorrateo: { tipo: $('fcProrrateo').value, fijos }, reservas: { impuestos: num($('fcImp').value), capital: num($('fcCap').value) }, base_resultados: $('fcBase').value, updated_by: currentUser.id, updated_at: new Date().toISOString() };
    const { data, error } = await sb.from('finanzas_config').upsert(row, { onConflict: 'empresa_id' }).select().single();
    if (error) { Toast.error(humanizeError(error, 'No se pudo guardar la configuración')); return; }
    D.fcfg = data; Toast.success('Configuración financiera guardada.');
  }
  /** Reparte los gastos indirectos sin distribución manual según la regla vigente (US-121). */
  async function prorratear(gastos, opts = {}) {
    await cargar();
    const regla = D.fcfg?.prorrateo || { tipo: 'iguales' };
    const lista = (gastos || (D.g || []).filter(g => (g.destino || (g.obra_id ? 'obra' : 'indirecto')) === 'indirecto' && g.estatus_pago !== 'Rechazado' && Finanzas.enRango(g.fecha_solicitud, opts.desde, opts.hasta)));
    const filas = Finanzas.prorratear({ regla, gastos: lista });
    if (!filas.length) return 0;
    const ids = [...new Set(filas.map(f => f.gasto_id))];
    await sb.from('gastos_admin_distribucion').delete().in('gasto_id', ids);
    const { data, error } = await sb.from('gastos_admin_distribucion').insert(filas.map(f => ({ ...f, monto_asignado: f.monto_asignado }))).select();
    if (error) throw error;
    D.gad = (D.gad || []).filter(x => !ids.includes(x.gasto_id)).concat(data || []);
    return ids.length;
  }
  async function prorratearAhora() {
    try {
      const rg = Finanzas.rango('anio');
      const manual = new Set((D.gad || []).filter(x => x.fijado).map(x => x.gasto_id));
      const n = await prorratear((D.g || []).filter(g => (g.destino || (g.obra_id ? 'obra' : 'indirecto')) === 'indirecto' && g.estatus_pago !== 'Rechazado' && Finanzas.enRango(g.fecha_solicitud, rg.desde, rg.hasta) && !manual.has(g.id)));
      Toast.success(`${n} gasto(s) indirecto(s) repartidos entre las obras.`);
      if (M === 'so') render($('c'));
    } catch (e) { Toast.error(humanizeError(e, 'No se pudo prorratear')); }
  }

  return { render, setTab, periodo: setPeriodo, editarSocio, guardarSocio, nuevoMovimiento, guardarMovimiento, eliminarMovimiento, estadoCuentaPDF, nuevoReparto, wz: wzSet, wzPaso, guardarReparto, aprobar, marcarPagado, _pagar, anular, _anular, actaPDF, configHtml, guardarConfig, prorratear, prorratearAhora, cargar, saldoSocio, totalesSocio };
})();
