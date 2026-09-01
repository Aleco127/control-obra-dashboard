/**
 * Compras y gastos (fase 2: US-104 a US-108, US-115).
 * Un solo módulo para el dinero que sale: compra = gasto con destino (obra / indirecto / socio),
 * estado de aprobación, estado de pago derivado de monto_pagado y estado de comprobación fiscal.
 * Sustituye a Gs()/renderGastosTable()/newGasto()/editGasto()/saveGasto() del index.html (quedan como delegadores)
 * y absorbe al módulo Órdenes: la OC sólo se genera cuando el usuario la pide.
 *
 * Depende de globales del index.html: D, S, F, fmt, $, currentUser, selectedObra, openMdl, closeMdl, Toast, Dialog,
 * humanizeError, hoyISO, getFilteredGastos, getObrasPermitidas, filterByEmpresa, vacio, comprimirImagen, sb, Outbox,
 * Telemetry, partidasDeObra, abrirFichaObra, selectedGastos, updateBulkBarGastos, GastosRules, XLSX.
 */
const Compras = (() => {
  let tab = 'todos';            // todos | aprobar | pagar | indirectos | comprobante | socios
  let q = '', fProv = '', fCat = '', fDesde = '', fHasta = '', fPagador = '';
  let catTocada = false;        // el usuario eligió categoría a mano: no la sobreescribe la sugerencia
  let fotoPendiente = null;     // {dataUrl, size} del ticket capturado en el formulario
  let provQuery = '';
  const thumbs = new Map();     // path -> signed url (1 h)

  const nivel = () => currentUser?.nivel || 0;
  const perms = () => currentUser?.permisos || {};
  const esAdmin = () => nivel() >= 100;
  const puedeAprobar = () => nivel() >= 80 || perms().gastos?.aprobar === true;
  const puedeCrear = () => nivel() >= 100 || perms().gastos?.crear === true;
  const puedeEditar = () => nivel() >= 60 || perms().gastos?.editar === true;
  const limiteRol = (n) => n >= 80 ? Infinity : n >= 50 ? 200000 : 50000;
  const num = (v) => parseFloat(v) || 0;

  function cats() {
    return (D.catg || []).filter(c => c.activa !== false).sort((a, b) => (a.orden || 100) - (b.orden || 100) || String(a.nombre).localeCompare(b.nombre));
  }
  function catInfo(nombre) { const n = GastosRules.norm(nombre); return cats().find(c => GastosRules.norm(c.nombre) === n); }
  function socios() { return (D.soc || []).filter(s => s.activo !== false); }
  function socioNombre(id) { return socios().find(s => s.id == id)?.nombre || (D.soc || []).find(s => s.id == id)?.nombre || 'Socio'; }
  function provNombre(id) { return (D.pv || []).find(p => p.id == id)?.nombre_proveedor || ''; }
  function obraDe(g) { return (D.o || []).find(o => o.id === g.obra_id); }
  function destinoDe(g) { return g.destino || (g.obra_id ? 'obra' : 'indirecto'); }
  function saldo(g) { return Math.max(0, num(g.monto_neto) - num(g.monto_pagado)); }

  function estado(g) {
    if (g.estatus_pago === 'Rechazado') return 'rechazado';
    if (!g.aprobado_at) return 'solicitado';
    if (g.estatus_pago === 'Pagado') return 'pagado';
    if (g.estatus_pago === 'Parcial') return 'parcial';
    return 'aprobado';
  }
  const ESTADO = {
    solicitado: ['Por aprobar', 'bg-amber-100 text-amber-800'],
    aprobado: ['Por pagar', 'bg-sky-100 text-sky-800'],
    parcial: ['Pago parcial', 'bg-amber-100 text-amber-800'],
    pagado: ['Pagado', 'bg-emerald-100 text-emerald-800'],
    rechazado: ['Rechazado', 'bg-red-100 text-red-800']
  };
  const COMPROBACION = {
    sin_comprobante: ['Sin comprobante', 'bg-slate-100 text-slate-600'],
    ticket: ['Ticket', 'bg-amber-100 text-amber-800'],
    factura_pendiente: ['Factura pendiente', 'bg-sky-100 text-sky-800'],
    facturado: ['Facturado', 'bg-emerald-100 text-emerald-800']
  };

  // ---------- filtros ----------
  function base() {
    let list = getFilteredGastos();
    if (!esAdmin()) list = list.filter(g => destinoDe(g) !== 'socio' || g.pagado_por_socio_id);
    return list;
  }
  function lista() {
    let list = base();
    if (tab === 'aprobar') list = list.filter(g => estado(g) === 'solicitado');
    else if (tab === 'pagar') list = list.filter(g => ['aprobado', 'parcial'].includes(estado(g)) && destinoDe(g) !== 'socio');
    else if (tab === 'indirectos') list = list.filter(g => destinoDe(g) === 'indirecto');
    else if (tab === 'comprobante') list = list.filter(g => ['sin_comprobante', 'ticket', 'factura_pendiente'].includes(g.comprobacion || 'sin_comprobante') && destinoDe(g) !== 'socio');
    else if (tab === 'socios') list = list.filter(g => destinoDe(g) === 'socio' || g.pagado_por_socio_id);
    if (fPagador) list = list.filter(g => g.pagado_por_socio_id == fPagador);
    if (fProv) list = list.filter(g => g.proveedor_id == fProv);
    if (fCat) list = list.filter(g => GastosRules.norm(g.categoria) === GastosRules.norm(fCat));
    if (fDesde) list = list.filter(g => (g.fecha_solicitud || '') >= fDesde);
    if (fHasta) list = list.filter(g => (g.fecha_solicitud || '') <= fHasta);
    if (q) {
      const s = GastosRules.norm(q);
      list = list.filter(g => GastosRules.norm([g.descripcion, g.comentarios, g.categoria, g.orden_compra, g.solicitante, g.factura_numero, g.folio_fiscal, provNombre(g.proveedor_id), obraDe(g)?.nombre_obra].join(' ')).includes(s));
    }
    return list;
  }

  // ---------- render ----------
  function chipDestino(g) {
    const d = destinoDe(g);
    if (d === 'obra') { const o = obraDe(g); return `<button type="button" class="chip chip-obra" onclick="abrirFichaObra(${g.obra_id})" title="Abrir ficha de la obra">${S(o?.codigo_obra || o?.nombre_obra || 'Obra')}</button>`; }
    if (d === 'socio') return `<span class="chip chip-socio" title="Gasto personal del socio">${S(socioNombre(g.socio_id))}</span>`;
    const dist = (D.gad || []).filter(x => x.gasto_id === g.id).length;
    return `<span class="chip chip-ind" title="${dist ? 'Se reparte entre ' + dist + ' obra(s)' : 'Indirecto: se prorratea entre las obras'}">Indirecto${dist ? ' · ' + dist : ''}</span>`;
  }
  function chipEstado(g) { const [t, cls] = ESTADO[estado(g)]; return `<span class="px-2 py-0.5 rounded-full text-xs font-medium ${cls}">${t}</span>`; }
  // El estado de pago se cambia desde la lista: el gasto nace pendiente y alguien lo mueve a pagado
  // cuando de verdad salió el dinero (o cuando se le repuso a quien lo puso de su bolsa).
  function selectEstado(g) {
    const est = estado(g);
    const [, cls] = ESTADO[est];
    if (!puedeEditar() || est === 'rechazado') return chipEstado(g);
    const opts = [];
    if (puedeAprobar()) opts.push(['solicitado', ESTADO.solicitado[0]]);
    opts.push(['aprobado', ESTADO.aprobado[0]]);
    if (est === 'parcial') opts.push(['parcial', ESTADO.parcial[0]]);
    opts.push(['pagado', ESTADO.pagado[0]]);
    return `<select class="chip-select font-medium ${cls}" aria-label="Estado de pago de ${S(g.descripcion || g.id)}" onchange="Compras.cambiarEstado(${g.id},this.value)">${opts.map(([k, l]) => `<option value="${k}" ${k === est ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  }
  function selectComprobacion(g) {
    const v = g.comprobacion || 'sin_comprobante';
    const [, cls] = COMPROBACION[v] || COMPROBACION.sin_comprobante;
    if (!puedeEditar()) return `<span class="px-2 py-0.5 rounded-full text-xs ${cls}">${COMPROBACION[v][0]}</span>`;
    return `<select class="chip-select ${cls}" aria-label="Comprobación del gasto ${S(g.descripcion || g.id)}" onchange="Compras.cambiarComprobacion(${g.id},this.value)">${Object.entries(COMPROBACION).map(([k, [t]]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  }
  function thumbHtml(g) {
    if (!g.comprobante_url) return '';
    const url = thumbs.get(g.comprobante_url);
    return `<button type="button" class="thumb" onclick="Compras.verComprobante(${g.id})" aria-label="Ver comprobante" data-path="${S(g.comprobante_url)}">${url ? `<img src="${url}" alt="">` : '<i class="ri-attachment-2" aria-hidden="true"></i>'}</button>`;
  }
  function pagadoPor(g) {
    if (g.pagado_por_socio_id) return `<span class="text-xs text-ink-subtle">Pagó ${S(socioNombre(g.pagado_por_socio_id))}</span>`;
    return '';
  }

  function filas(list) {
    if (!list.length) {
      const msgs = {
        todos: ['ri-wallet-3-line', 'Registra la primera compra: qué se compró, cuánto y para qué obra. La foto del ticket basta para empezar.'],
        aprobar: ['ri-check-double-line', 'No hay compras esperando aprobación.'],
        pagar: ['ri-bank-card-line', 'No debes nada a proveedores.'],
        indirectos: ['ri-building-4-line', 'Sin gastos indirectos en este periodo. Renta, luz, telefonía y contador se registran con destino Indirecto y se reparten entre las obras.'],
        comprobante: ['ri-file-text-line', 'Todos los gastos tienen su comprobante.'],
        socios: ['ri-user-star-line', 'Sin gastos de socios en este periodo.']
      };
      const [icon, body] = msgs[tab] || msgs.todos;
      return `<tr><td colspan="9" class="p-4">${vacio('compras', { icon, body, action: puedeCrear() ? { label: 'Registrar gasto', onClick: 'Compras.nuevo()' } : null })}</td></tr>`;
    }
    const canEdit = puedeEditar();
    return list.map(g => {
      const sel = (selectedGastos || []).includes(g.id);
      const est = estado(g);
      const cat = g.categoria ? `<span class="text-xs text-ink-subtle">${S(g.categoria)}</span>` : '<span class="text-xs text-warn">Sin categoría</span>';
      const oc = g.orden_compra ? `<span class="text-[11px] font-mono text-ink-subtle ml-1">${S(g.orden_compra)}</span>` : '';
      const acciones = [];
      if (canEdit) acciones.push(`<button type="button" class="btn-icon" onclick="Compras.editar(${g.id})" aria-label="Editar gasto" title="Editar"><i class="ri-edit-line" aria-hidden="true"></i></button>`);
      if (est === 'solicitado' && puedeAprobar()) acciones.push(`<button type="button" class="btn-icon text-ok" onclick="Compras.aprobar([${g.id}])" aria-label="Aprobar compra" title="Aprobar"><i class="ri-check-line" aria-hidden="true"></i></button>`);
      if (['aprobado', 'parcial'].includes(est) && canEdit && destinoDe(g) !== 'socio') acciones.push(`<button type="button" class="btn-icon text-primary" onclick="Compras.pagar(${g.id})" aria-label="Registrar pago" title="Registrar pago"><i class="ri-bank-card-line" aria-hidden="true"></i></button>`);
      if (canEdit) acciones.push(`<button type="button" class="btn-icon" onclick="Compras.menu(${g.id},this)" aria-label="Más acciones" title="Más"><i class="ri-more-2-fill" aria-hidden="true"></i></button>`);
      return `<tr class="border-t border-line hover:bg-slate-50 ${sel ? 'bg-sky-50' : ''}">
${canEdit ? `<td class="p-2 text-center"><input type="checkbox" class="gastoCheckbox w-4 h-4 rounded" data-id="${g.id}" ${sel ? 'checked' : ''} aria-label="Seleccionar gasto ${S(g.descripcion || g.id)}" onchange="toggleGastoSelection(${g.id},this.checked)"></td>` : ''}
<td class="p-2 text-sm whitespace-nowrap">${(g.fecha_solicitud || '').slice(0, 10) || '-'}</td>
<td class="p-2"><div class="flex items-center gap-2">${thumbHtml(g)}<div class="min-w-0"><div class="text-sm font-medium truncate max-w-[260px]" title="${S(g.descripcion || '')}">${S(g.descripcion) || '<span class="text-ink-subtle">Sin descripción</span>'}${oc}</div>${cat}</div></div></td>
<td class="p-2 hidden md:table-cell">${chipDestino(g)}</td>
<td class="p-2 hidden lg:table-cell"><div class="text-xs">${g.proveedor_id ? `<button type="button" class="link" onclick="Compras.proveedor(${g.proveedor_id})">${S(provNombre(g.proveedor_id))}</button>` : '<span class="text-ink-subtle">-</span>'}</div>${pagadoPor(g)}</td>
<td class="p-2 text-right font-semibold whitespace-nowrap">${F(g.monto_neto)}${est === 'parcial' ? `<div class="text-[11px] text-ink-subtle">saldo ${F(saldo(g))}</div>` : ''}</td>
<td class="p-2 hidden sm:table-cell">${selectComprobacion(g)}</td>
<td class="p-2 text-center">${selectEstado(g)}</td>
${canEdit ? `<td class="p-2 text-right whitespace-nowrap">${acciones.join('')}</td>` : ''}
</tr>`;
    }).join('');
  }

  // Vista móvil (< 640 px): una tarjeta por gasto con total y estado visibles sin abrir
  function tarjetas(list) {
    if (!list.length) return `<div class="g rounded-xl p-4">${vacio('compras', { icon: 'ri-wallet-3-line', body: 'Toca + para registrar un gasto con la foto del ticket.', action: puedeCrear() ? { label: 'Registrar gasto', onClick: 'Compras.nuevo()' } : null })}</div>`;
    const canEdit = puedeEditar();
    return list.slice(0, 200).map(g => {
      const est = estado(g);
      return `<article class="g rounded-xl p-3" ${canEdit ? `onclick="if(!event.target.closest('button,select,a'))Compras.editar(${g.id})"` : ''}>
<div class="flex items-start gap-2">${thumbHtml(g)}<div class="flex-1 min-w-0"><p class="font-medium truncate">${S(g.descripcion) || '<span class="text-ink-subtle">Sin descripción</span>'}</p><p class="text-xs text-ink-subtle">${(g.fecha_solicitud || '').slice(0, 10)} · ${S(g.categoria || 'Sin categoría')}${g.proveedor_id ? ' · ' + S(provNombre(g.proveedor_id)) : ''}</p></div><p class="font-bold whitespace-nowrap">${F(g.monto_neto)}</p></div>
<div class="flex flex-wrap items-center gap-2 mt-2">${chipDestino(g)}${selectEstado(g)}${selectComprobacion(g)}
${est === 'solicitado' && puedeAprobar() ? `<button type="button" class="btn btn-s text-xs ml-auto" onclick="Compras.aprobar([${g.id}])"><i class="ri-check-line" aria-hidden="true"></i> Aprobar</button>` : ''}
${['aprobado', 'parcial'].includes(est) && canEdit && destinoDe(g) !== 'socio' ? `<button type="button" class="btn btn-s text-xs ml-auto" onclick="Compras.pagar(${g.id})"><i class="ri-bank-card-line" aria-hidden="true"></i> Pagar</button>` : ''}</div>
</article>`;
    }).join('');
  }

  function kpis(all) {
    const porAprobar = all.filter(g => estado(g) === 'solicitado');
    const porPagar = all.filter(g => ['aprobado', 'parcial'].includes(estado(g)) && destinoDe(g) !== 'socio');
    const sinComp = all.filter(g => ['sin_comprobante', 'ticket', 'factura_pendiente'].includes(g.comprobacion || 'sin_comprobante') && destinoDe(g) !== 'socio');
    const ind = all.filter(g => destinoDe(g) === 'indirecto');
    const total = all.filter(g => destinoDe(g) !== 'socio').reduce((s, g) => s + num(g.monto_neto), 0);
    const k = (v, l, cls = '') => `<div class="kpi"><p class="kpi-v ${cls}">${v}</p><p class="kpi-l">${l}</p></div>`;
    return `<div class="kpi-strip">
${k(F(total), 'Total de compras')}
${k(porAprobar.length, 'Por aprobar' + (porAprobar.length ? ' · ' + F(porAprobar.reduce((s, g) => s + num(g.monto_neto), 0)) : ''), porAprobar.length ? 'text-warn' : '')}
${k(F(porPagar.reduce((s, g) => s + saldo(g), 0)), 'Por pagar a proveedores')}
${k(sinComp.length, 'Sin factura', sinComp.length ? 'text-warn' : '')}
${k(F(ind.reduce((s, g) => s + num(g.monto_neto), 0)), 'Indirectos')}
</div>`;
  }

  // Caja chica: lo que alguien puso de su bolsa y todavia no se le repone.
  function porReponer(all) {
    const pend = all.filter(g => g.pagado_por_socio_id && !['pagado', 'rechazado'].includes(estado(g)));
    if (!pend.length) return '';
    const por = new Map();
    pend.forEach(g => { const k = g.pagado_por_socio_id; const v = por.get(k) || { n: 0, monto: 0 }; v.n++; v.monto += saldo(g); por.set(k, v); });
    const filas = [...por.entries()].sort((a, b) => b[1].monto - a[1].monto);
    const total = filas.reduce((t, [, v]) => t + v.monto, 0);
    const canEdit = puedeEditar();
    return `<div class="g rounded-xl p-3 mb-3 border border-amber-200 bg-amber-50">
<div class="flex flex-wrap items-baseline justify-between gap-2 mb-2">
<h2 class="font-bold text-sm"><i class="ri-hand-coin-line" aria-hidden="true"></i> Dinero por reponer</h2>
<p class="text-xs text-ink-muted">Gastos que alguien pagó de su bolsa y siguen sin saldarse · <strong>${F(total)}</strong></p></div>
<ul class="divide-y divide-amber-200/70 text-sm">
${filas.map(([id, v]) => `<li class="flex flex-wrap items-center gap-2 py-1.5">
<button type="button" class="link font-medium" onclick="Compras.verDe(${id})">${S(socioNombre(id))}</button>
<span class="text-xs text-ink-subtle">${v.n} ${v.n === 1 ? 'gasto' : 'gastos'}</span>
<span class="flex-1"></span><span class="font-semibold whitespace-nowrap">${F(v.monto)}</span>
${canEdit ? `<button type="button" class="btn btn-s text-xs" onclick="Compras.reponer(${id})"><i class="ri-check-double-line" aria-hidden="true"></i> Marcar repuesto</button>` : ''}</li>`).join('')}
</ul></div>`;
  }

  function render(c) {
    const all = base();
    const list = lista();
    const canEdit = puedeEditar();
    const obraTitle = selectedObra ? ` · ${S(getSelectedObraName())}` : '';
    const tabs = [
      ['todos', 'Todos', all.length],
      ['aprobar', 'Por aprobar', all.filter(g => estado(g) === 'solicitado').length],
      ['pagar', 'Por pagar', all.filter(g => ['aprobado', 'parcial'].includes(estado(g)) && destinoDe(g) !== 'socio').length],
      ['indirectos', 'Indirectos', all.filter(g => destinoDe(g) === 'indirecto').length],
      ['comprobante', 'Sin comprobante', all.filter(g => ['sin_comprobante', 'ticket', 'factura_pendiente'].includes(g.comprobacion || 'sin_comprobante') && destinoDe(g) !== 'socio').length]
    ];
    if (esAdmin()) tabs.push(['socios', 'Socios', all.filter(g => destinoDe(g) === 'socio' || g.pagado_por_socio_id).length]);
    c.innerHTML = `
<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
<div><h1 class="text-xl font-bold"><i class="ri-wallet-3-line" aria-hidden="true"></i> Compras y gastos${obraTitle}</h1>
<p class="text-sm text-ink-muted mt-1">Todo lo que sale: compras de obra, gastos indirectos y de socios, con su aprobación, pago y factura.</p></div>
<div class="flex flex-wrap gap-2">
${puedeCrear() ? `<button type="button" onclick="Compras.nuevo()" class="btn btn-p text-sm"><i class="ri-add-line" aria-hidden="true"></i> Registrar gasto</button>` : ''}
${canEdit ? `<button type="button" onclick="Compras.importarXML()" class="btn btn-s text-sm hidden sm:inline-flex"><i class="ri-file-code-line" aria-hidden="true"></i> Importar XML</button>` : ''}
${puedeAprobar() ? `<button type="button" onclick="Compras.revisarClasificacion()" class="btn btn-s text-sm hidden sm:inline-flex"><i class="ri-magic-line" aria-hidden="true"></i> Revisar clasificación</button>` : ''}
</div></div>
${kpis(all)}
${porReponer(all)}
<div class="tabs mb-3" role="tablist" aria-label="Vistas de compras">
${tabs.map(([k, l, n]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="tab ${tab === k ? 'active' : ''}" onclick="Compras.setTab('${k}')">${l} <span class="tab-n">${n}</span></button>`).join('')}
</div>
<div class="g rounded-xl p-3 mb-3">
<div class="flex items-center gap-2">
<input type="search" id="comprasQ" class="inp text-sm flex-1 sm:flex-none sm:w-56" placeholder="Buscar por concepto, proveedor, obra, folio" value="${S(q)}" oninput="Compras.buscar(this.value)" aria-label="Buscar gastos">
<button type="button" class="btn btn-s text-xs sm:hidden ${(fProv || fCat || fDesde || fHasta) ? 'text-primary' : ''}" onclick="$('comprasFiltros').classList.toggle('hidden')" aria-controls="comprasFiltros" aria-expanded="false"><i class="ri-filter-3-line" aria-hidden="true"></i> Filtros</button>
<div id="comprasFiltros" class="hidden sm:flex flex-wrap items-center gap-2 w-full sm:w-auto sm:flex-1">
<select class="inp text-sm py-1.5 w-44" aria-label="Filtrar por proveedor" onchange="Compras.filtro('prov',this.value)"><option value="">Todos los proveedores</option>${filterByEmpresa(D.pv || []).filter(p => p.estatus !== 'Inactivo').map(p => `<option value="${p.id}" ${fProv == p.id ? 'selected' : ''}>${S(p.nombre_proveedor)}</option>`).join('')}</select>
<select class="inp text-sm py-1.5 w-44" aria-label="Filtrar por categoría" onchange="Compras.filtro('cat',this.value)"><option value="">Todas las categorías</option>${cats().map(x => `<option value="${S(x.nombre)}" ${fCat === x.nombre ? 'selected' : ''}>${S(x.nombre)}</option>`).join('')}</select>
<input type="date" class="inp text-sm py-1.5 w-36" value="${fDesde}" aria-label="Desde" onchange="Compras.filtro('desde',this.value)"><span class="text-xs text-ink-subtle">a</span>
<input type="date" class="inp text-sm py-1.5 w-36" value="${fHasta}" aria-label="Hasta" onchange="Compras.filtro('hasta',this.value)">
${fPagador ? `<button type="button" class="chip chip-socio" onclick="Compras.filtro('pagador','')" title="Quitar el filtro">Pagó ${S(socioNombre(fPagador))} <i class="ri-close-line" aria-hidden="true"></i></button>` : ''}
<button type="button" class="btn-icon" onclick="Compras.limpiar()" aria-label="Limpiar filtros" title="Limpiar filtros"><i class="ri-refresh-line" aria-hidden="true"></i></button>
<span class="flex-1"></span>
<button type="button" class="btn btn-s text-xs" onclick="Compras.exportar()"><i class="ri-file-excel-2-line" aria-hidden="true"></i> Excel</button>
</div></div></div>
${canEdit ? `<div id="bulkBarGastos" class="${(selectedGastos || []).length ? '' : 'hidden'} g rounded-xl p-3 mb-3 border border-primary/40 bg-sky-50">
<div class="flex flex-wrap items-center justify-between gap-2">
<span class="text-sm font-medium"><span id="selectedGastosCount">${(selectedGastos || []).length}</span> seleccionados</span>
<div class="flex flex-wrap gap-2">
${puedeAprobar() ? `<button type="button" class="btn btn-s text-xs" onclick="Compras.aprobar(selectedGastos)"><i class="ri-check-double-line" aria-hidden="true"></i> Aprobar</button><button type="button" class="btn btn-s text-xs" onclick="Compras.rechazar(selectedGastos)"><i class="ri-close-circle-line" aria-hidden="true"></i> Rechazar</button>` : ''}
<button type="button" class="btn btn-s text-xs" onclick="Compras.pedirFactura(selectedGastos)"><i class="ri-mail-send-line" aria-hidden="true"></i> Pedir factura</button>
<button type="button" class="btn btn-s text-xs" onclick="Compras.cambiarDestinoLote(selectedGastos)"><i class="ri-arrow-left-right-line" aria-hidden="true"></i> Cambiar destino</button>
<button type="button" class="btn btn-s text-xs" onclick="bulkEditGastos('categoria')"><i class="ri-price-tag-3-line" aria-hidden="true"></i> Categoría</button>
<button type="button" class="btn btn-s text-xs" onclick="bulkEditGastos('proveedor')"><i class="ri-store-2-line" aria-hidden="true"></i> Proveedor</button>
<button type="button" class="btn btn-s text-xs" onclick="bulkEditGastos('fecha')"><i class="ri-calendar-line" aria-hidden="true"></i> Fecha</button>
<button type="button" class="btn btn-s text-xs text-danger" onclick="bulkDeleteGastos()"><i class="ri-delete-bin-line" aria-hidden="true"></i> Eliminar</button>
<button type="button" class="btn btn-s text-xs" onclick="clearGastosSelection()">Cancelar</button>
</div></div></div>` : ''}
<div id="gastosCards" class="sm:hidden space-y-2">${tarjetas(list)}</div>
<div class="g rounded-xl overflow-hidden hidden sm:block"><div class="overflow-x-auto"><table class="w-full text-sm" id="tblCompras">
<thead class="bg-slate-50"><tr class="text-xs text-ink-muted">
${canEdit ? '<th class="p-2 w-8"><input type="checkbox" id="selectAllGastos" aria-label="Seleccionar todos" onchange="toggleAllGastos(this.checked)" class="w-4 h-4 rounded"></th>' : ''}
<th class="p-2 text-left">Fecha</th><th class="p-2 text-left">Qué</th><th class="p-2 text-left hidden md:table-cell">Destino</th><th class="p-2 text-left hidden lg:table-cell">Proveedor</th><th class="p-2 text-right">Total</th><th class="p-2 text-left hidden sm:table-cell">Comprobante</th><th class="p-2 text-center">Pago</th>${canEdit ? '<th class="p-2"></th>' : ''}
</tr></thead>
<tbody id="gastosList">${filas(list)}</tbody></table></div></div>
${modalHtml()}
<div id="comprasMenu" class="ctx-menu" role="menu" hidden></div>`;
    setTimeout(() => { try { updateBulkBarGastos(); } catch (e) { } cargarMiniaturas(); }, 0);
    try { Telemetry.track('compras_tab', { tab }); } catch (e) { }
  }

  function repintar() { const tb = $('gastosList'); if (tb) { const l = lista(); tb.innerHTML = filas(l); const cd = $('gastosCards'); if (cd) cd.innerHTML = tarjetas(l); cargarMiniaturas(); } else if (M === 'g') R(); }
  function setTab(t) { tab = t; if (M !== 'g') { M = 'g'; R(); } else render($('c')); }
  function buscar(v) { q = v; repintar(); }
  function filtro(k, v) { if (k === 'prov') fProv = v; if (k === 'cat') fCat = v; if (k === 'desde') fDesde = v; if (k === 'hasta') fHasta = v; if (k === 'pagador') fPagador = v; render($('c')); }
  function limpiar() { q = ''; fProv = fCat = fDesde = fHasta = fPagador = ''; render($('c')); }
  function verDe(socioId) { fPagador = String(socioId); tab = 'todos'; render($('c')); }

  async function cargarMiniaturas() {
    const els = [...document.querySelectorAll('#gastosList .thumb[data-path], #gastosCards .thumb[data-path]')].filter(b => !thumbs.has(b.dataset.path));
    const paths = [...new Set(els.map(b => b.dataset.path))].slice(0, 60);
    if (!paths.length) return;
    try {
      const { data } = await sb.storage.from('comprobantes').createSignedUrls(paths, 3600);
      (data || []).forEach(d => { if (d.signedUrl) thumbs.set(d.path, d.signedUrl); });
      els.forEach(b => { const u = thumbs.get(b.dataset.path); if (u) b.innerHTML = `<img src="${u}" alt="">`; });
    } catch (e) { }
  }
  async function verComprobante(id) {
    const g = (D.g || []).find(x => x.id == id); if (!g?.comprobante_url) return;
    let url = thumbs.get(g.comprobante_url);
    if (!url) { const { data } = await sb.storage.from('comprobantes').createSignedUrl(g.comprobante_url, 3600); url = data?.signedUrl; }
    if (!url) { Toast.error('No se pudo abrir el comprobante'); return; }
    const isPdf = /\.pdf$/i.test(g.comprobante_url);
    let dlg = $('dlgComprobante');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'dlgComprobante'; dlg.className = 'dlg dlg-wide'; document.body.appendChild(dlg); }
    dlg.innerHTML = `<div class="flex justify-between items-center mb-2"><h2 class="font-bold">${S(g.descripcion || 'Comprobante')} · ${F(g.monto_neto)}</h2><button type="button" class="btn-icon" onclick="this.closest('dialog').close()" aria-label="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></div>${isPdf ? `<iframe src="${url}" title="Comprobante" style="width:100%;height:70vh;border:0"></iframe>` : `<img src="${url}" alt="Comprobante de ${S(g.descripcion || '')}" style="max-width:100%;max-height:75vh;display:block;margin:0 auto">`}`;
    dlg.showModal();
  }

  // ---------- formulario ----------
  function provComboHtml(selId, selName) {
    return `<div class="combo" id="gastoProvCombo">
<input type="text" id="gastoProvInput" class="inp" placeholder="Escribe para buscar o crear" autocomplete="off" value="${S(selName || '')}" oninput="Compras.provInput(this.value)" onfocus="Compras.provInput(this.value)" onkeydown="if(event.key==='Escape'){Compras.provCerrar();}" aria-autocomplete="list" aria-controls="gastoProvList" aria-expanded="false">
<input type="hidden" id="gastoProveedor" value="${selId || ''}">
<div id="gastoProvList" class="combo-list" role="listbox" hidden></div></div>`;
  }
  function provInput(v) {
    provQuery = v; const list = $('gastoProvList'); if (!list) return;
    const s = GastosRules.norm(v);
    const provs = filterByEmpresa(D.pv || []).filter(p => p.estatus !== 'Inactivo');
    const hits = (s ? provs.filter(p => GastosRules.norm(p.nombre_proveedor + ' ' + (p.rfc || '')).includes(s)) : provs).slice(0, 8);
    const exact = provs.some(p => GastosRules.norm(p.nombre_proveedor) === s);
    let html = hits.map(p => `<button type="button" role="option" class="combo-item" onclick="Compras.provPick(${p.id})"><span>${S(p.nombre_proveedor)}</span>${p.rfc ? `<span class="text-xs text-ink-subtle">${S(p.rfc)}</span>` : ''}</button>`).join('');
    if (s && !exact) html += `<button type="button" role="option" class="combo-item combo-new" onclick="Compras.provNuevo()"><i class="ri-add-line" aria-hidden="true"></i> Crear proveedor «${S(v)}»</button>`;
    if (!html) html = '<div class="p-2 text-xs text-ink-subtle">Sin proveedores. Escribe un nombre para crearlo.</div>';
    list.innerHTML = html; list.hidden = false; $('gastoProvInput').setAttribute('aria-expanded', 'true');
    if ($('gastoProveedor').value && GastosRules.norm(provNombre($('gastoProveedor').value)) !== s) $('gastoProveedor').value = '';
    sugerir();
  }
  function provPick(id) { $('gastoProveedor').value = id; $('gastoProvInput').value = provNombre(id); provCerrar(); sugerir(); }
  function provCerrar() { const l = $('gastoProvList'); if (l) l.hidden = true; $('gastoProvInput')?.setAttribute('aria-expanded', 'false'); }
  async function provNuevo() {
    const nombre = ($('gastoProvInput').value || '').trim(); if (!nombre) return;
    const { data, error } = await sb.from('proveedores').insert({ nombre_proveedor: nombre, empresa_id: currentUser.empresa_id, estatus: 'Activo', tipo: 'Materiales' }).select().single();
    if (error) { Toast.error(humanizeError(error, 'No se pudo crear el proveedor')); return; }
    D.pv.push(data); provPick(data.id); Toast.success(`Proveedor ${nombre} creado. Completa RFC y CLABE en su ficha cuando puedas.`);
  }

  function modalHtml() {
    const obras = getObrasPermitidas().filter(o => !['Archivada', 'Completada', 'Finalizada', 'Cancelada'].includes(o.estatus));
    const socs = socios();
    return `<div id="mdlGasto" class="modal"><div class="g rounded-2xl p-5 w-full max-w-xl mx-4 max-h-[92vh] overflow-y-auto">
<div class="flex justify-between items-center mb-3"><h2 class="text-lg font-bold" id="mdlGastoTitle">Registrar gasto</h2><button type="button" onclick="closeMdl('mdlGasto')" class="btn-icon" aria-label="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></div>
<form id="frmGasto" onsubmit="Compras.guardar(event)" novalidate>
<input type="hidden" id="gastoId"><input type="hidden" id="gastoDestino" value="obra"><input type="hidden" id="gastoTipo" value="obra">
<fieldset class="mb-3"><legend class="text-xs text-ink-muted mb-1">Destino del gasto</legend>
<div class="seg" role="radiogroup" aria-label="Destino">
<button type="button" class="seg-btn active" data-d="obra" onclick="Compras.setDestino('obra')" role="radio" aria-checked="true"><i class="ri-building-2-line" aria-hidden="true"></i> Obra</button>
<button type="button" class="seg-btn" data-d="indirecto" onclick="Compras.setDestino('indirecto')" role="radio" aria-checked="false"><i class="ri-building-4-line" aria-hidden="true"></i> Indirecto</button>
${esAdmin() && socs.length ? `<button type="button" class="seg-btn" data-d="socio" onclick="Compras.setDestino('socio')" role="radio" aria-checked="false"><i class="ri-user-star-line" aria-hidden="true"></i> Socio</button>` : ''}
</div></fieldset>
<div id="gastoSugerencia" class="sug hidden" aria-live="polite"></div>
<div class="grid grid-cols-2 gap-3 force-2col">
<div class="col-span-2" id="gastoObraContainer"><label class="text-xs mb-1 block" for="gastoObraId">Obra *</label><select id="gastoObraId" class="inp" onchange="Compras.onObra()"><option value="">Elige la obra</option>${obras.map(o => `<option value="${o.id}">${S(o.codigo_obra ? o.codigo_obra + ' · ' : '')}${S(o.nombre_obra)}</option>`).join('')}</select></div>
<div class="col-span-2 hidden" id="gastoSocioContainer"><label class="text-xs mb-1 block" for="gastoSocioId">Socio *</label><select id="gastoSocioId" class="inp">${socs.map(s => `<option value="${s.id}">${S(s.nombre)}</option>`).join('')}</select></div>
<div class="col-span-2"><label class="text-xs mb-1 block" for="gastoDescripcion">Qué se compró *</label><input type="text" id="gastoDescripcion" class="inp" required placeholder="Ej. 20 bultos de cemento, gasolina vuelta a Delicias" oninput="Compras.sugerir()"></div>
<div><label class="text-xs mb-1 block" for="gastoMonto">Total pagado *</label><input type="number" id="gastoMonto" class="inp" required inputmode="decimal" placeholder="0.00" step="0.01" min="0" oninput="Compras.calcIVA()"></div>
<div><label class="text-xs mb-1 block" for="gastoFecha">Fecha *</label><input type="date" id="gastoFecha" class="inp" required></div>
<div class="col-span-2 flex flex-wrap items-center gap-3">
<label class="zk-switch"><input type="checkbox" id="gastoConIVA" onchange="Compras.calcIVA()"><span class="zk-slider" aria-hidden="true"></span><span class="zk-label">Incluye IVA 16 %</span></label>
<span id="gastoIVAPreview" class="text-xs text-ink-subtle"></span>
</div>
<div class="col-span-2"><label class="text-xs mb-1 block" for="gastoProvInput">Proveedor</label>${provComboHtml('', '')}</div>
${esAdmin() && socs.length ? `<div class="col-span-2" id="gastoPagadoPorContainer"><label class="text-xs mb-1 block" for="gastoPagadoPor">Quién puso el dinero</label><select id="gastoPagadoPor" class="inp"><option value="">La empresa (caja, cuenta o tarjeta)</option>${socs.map(s => `<option value="${s.id}">${S(s.nombre)} (de su bolsa: queda como aportación)</option>`).join('')}</select></div>` : ''}
<div class="col-span-2"><p class="text-xs mb-1">Comprobante</p>
<div class="flex flex-wrap gap-2 items-center">
<label class="btn btn-s text-sm cursor-pointer"><i class="ri-camera-line" aria-hidden="true"></i> Foto del ticket<input type="file" accept="image/*,application/pdf" capture="environment" class="hidden" id="gastoFotoInput" onchange="Compras.foto(this.files[0])"></label>
<span id="gastoFotoInfo" class="text-xs text-ink-subtle"></span></div>
<div id="gastoFotoPreview" class="mt-2 hidden"><img alt="Vista previa del comprobante" style="max-height:120px;border-radius:8px"></div></div>
</div>
<details class="mt-3" id="gastoDetalles"><summary class="text-sm font-medium cursor-pointer">Más detalles (categoría, partida, pago, factura)</summary>
<div class="grid grid-cols-2 gap-3 force-2col mt-3">
<div><label class="text-xs mb-1 block" for="gastoCategoria">Categoría *</label><select id="gastoCategoria" class="inp" required onchange="Compras.catManual()"><option value="">Elegir</option>${cats().map(x => `<option value="${S(x.nombre)}" data-nat="${x.naturaleza}">${S(x.nombre)}</option>`).join('')}</select></div>
<div id="gastoPartidaContainer"><label class="text-xs mb-1 block" for="gastoPartida">Partida del catálogo</label><select id="gastoPartida" class="inp"><option value="">Sin partida</option></select></div>
<div><label class="text-xs mb-1 block" for="gastoEstatus">Pago</label><select id="gastoEstatus" class="inp" onchange="Compras.onEstatus()"><option value="Pendiente">Pendiente de pago</option><option value="Pagado">Ya se pagó</option></select></div>
<div id="gastoVenceContainer" class="hidden"><label class="text-xs mb-1 block" for="gastoVence">Vence el</label><input type="date" id="gastoVence" class="inp"></div>
<div><label class="text-xs mb-1 block" for="gastoSolicitante">Quién lo pidió</label><select id="gastoSolicitante" class="inp"><option value="">Elegir</option>${(D.u || []).filter(u => u.activo).map(u => `<option value="${S(u.nombre)}">${S(u.nombre)}</option>`).join('')}</select></div>
<div><label class="text-xs mb-1 block" for="gastoFactura">Número de factura</label><input type="text" id="gastoFactura" class="inp" placeholder="Serie y folio"></div>
<div class="col-span-2"><label class="text-xs mb-1 block" for="gastoFolioFiscal">Folio fiscal (UUID del CFDI)</label><input type="text" id="gastoFolioFiscal" class="inp font-mono text-xs" placeholder="Se llena solo al importar el XML" maxlength="36" style="text-transform:uppercase"></div>
<div class="col-span-2"><label class="text-xs mb-1 block" for="gastoComentarios">Comentarios</label><textarea id="gastoComentarios" class="inp" rows="2"></textarea></div>
<div class="col-span-2 hidden" id="gastoDistribucionContainer"><div class="border border-line rounded-lg p-3">
<div class="flex justify-between items-center mb-1"><p class="text-xs font-medium">Repartir entre obras</p><span class="text-xs text-ink-subtle" id="gastoPorcentajeTotal">Total: 0%</span></div>
<p class="text-xs text-ink-subtle mb-2">Déjalo vacío para aplicar la regla de prorrateo de la empresa.</p>
<div id="gastoDistribucionObras" class="space-y-1 max-h-40 overflow-y-auto">${(D.o || []).filter(o => o.estatus !== 'Finalizada' && o.estatus !== 'Archivada').map(o => `<div class="flex items-center gap-2"><input type="checkbox" id="gadCheck_${o.id}" class="w-4 h-4 rounded" onchange="toggleDistribucionObra(${o.id})"><label for="gadCheck_${o.id}" class="text-sm flex-1">${S(o.nombre_obra)}</label><input type="number" id="gadPct_${o.id}" class="inp w-20 text-center text-sm" placeholder="%" min="0" max="100" step="1" disabled onchange="updateDistribucionTotal()" aria-label="Porcentaje para ${S(o.nombre_obra)}"><span class="text-xs">%</span></div>`).join('')}</div>
<p class="text-xs text-warn mt-2 hidden" id="gastoPorcentajeError">La suma debe ser 100 % o dejarse vacía.</p></div></div>
</div></details>
<div class="flex gap-3 mt-4"><button type="button" onclick="closeMdl('mdlGasto')" class="btn btn-s flex-1">Cancelar</button><button type="submit" class="btn btn-p flex-1" id="gastoGuardarBtn">Guardar gasto</button></div>
</form></div></div>`;
  }

  function ensureModal() { if (!$('mdlGasto')) { const d = document.createElement('div'); d.innerHTML = modalHtml(); document.body.appendChild(d.firstElementChild); } }

  function setDestino(d) {
    $('gastoDestino').value = d; $('gastoTipo').value = d === 'obra' ? 'obra' : 'admin';
    document.querySelectorAll('#mdlGasto .seg-btn').forEach(b => { const on = b.dataset.d === d; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
    $('gastoObraContainer').classList.toggle('hidden', d !== 'obra');
    $('gastoSocioContainer').classList.toggle('hidden', d !== 'socio');
    $('gastoPartidaContainer').classList.toggle('hidden', d !== 'obra');
    $('gastoDistribucionContainer').classList.toggle('hidden', d !== 'indirecto');
    if (d === 'socio' && !catTocada) $('gastoCategoria').value = catInfo('Gasto personal de socio')?.nombre || '';
    $('gastoGuardarBtn').textContent = d === 'socio' ? 'Guardar gasto de socio' : 'Guardar gasto';
  }
  function onObra() {
    const obraId = parseInt($('gastoObraId').value) || null;
    const sel = $('gastoPartida'); if (!sel) return;
    let partidas = []; try { partidas = obraId ? partidasDeObra(obraId) : []; } catch (e) { }
    sel.innerHTML = '<option value="">Sin partida</option>' + partidas.map(p => `<option value="${S(p)}">${S(p)}</option>`).join('');
  }
  function onEstatus() { $('gastoVenceContainer').classList.toggle('hidden', $('gastoEstatus').value !== 'Pendiente'); }
  function calcIVA() {
    const t = num($('gastoMonto').value); const con = $('gastoConIVA').checked; const el = $('gastoIVAPreview');
    if (!el) return;
    if (!t) { el.textContent = ''; return; }
    if (con) { const sub = Math.round(t / 1.16 * 100) / 100; el.textContent = `Subtotal ${F(sub)} + IVA ${F(t - sub)}`; }
    else el.textContent = 'Sin desglose de IVA (ticket o exento)';
  }
  function catManual() { catTocada = true; }
  function sugerir() {
    const desc = $('gastoDescripcion')?.value || ''; const prov = provNombre($('gastoProveedor')?.value);
    const box = $('gastoSugerencia'); if (!box) return;
    if (!desc.trim() && !prov) { box.classList.add('hidden'); return; }
    const sug = GastosRules.sugerirClasificacion(desc, prov, { sinObra: $('gastoDestino').value === 'indirecto' });
    const ci = catInfo(sug.categoria);
    if (ci && !catTocada) $('gastoCategoria').value = ci.nombre;
    const dActual = $('gastoDestino').value;
    if (sug.motivo && sug.destino !== dActual && !(sug.destino === 'socio' && !esAdmin())) {
      const nombreD = { obra: 'Obra', indirecto: 'Indirecto', socio: 'Gasto personal de socio' }[sug.destino];
      box.innerHTML = `<i class="ri-lightbulb-line" aria-hidden="true"></i> Parece <b>${nombreD}</b> · ${S(sug.categoria)} <span class="text-ink-subtle">(por «${S(sug.motivo)}»)</span> <button type="button" class="link ml-1" onclick="Compras.aplicarSugerencia('${sug.destino}')">Aplicar</button>`;
      box.classList.remove('hidden');
    } else if (sug.motivo && ci) {
      box.innerHTML = `<i class="ri-lightbulb-line" aria-hidden="true"></i> Categoría sugerida: <b>${S(ci.nombre)}</b> <span class="text-ink-subtle">(por «${S(sug.motivo)}»)</span>`;
      box.classList.remove('hidden');
    } else box.classList.add('hidden');
  }
  function aplicarSugerencia(d) { setDestino(d); catTocada = false; sugerir(); $('gastoSugerencia').classList.add('hidden'); }

  async function foto(file) {
    if (!file) return;
    const info = $('gastoFotoInfo'); const prev = $('gastoFotoPreview');
    try {
      if (file.type === 'application/pdf') {
        if (file.size > 10 * 1024 * 1024) throw new Error('El PDF pesa más de 10 MB');
        const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
        fotoPendiente = { dataUrl, mime: 'application/pdf', ext: 'pdf', size: file.size };
        prev.classList.add('hidden'); info.textContent = `PDF listo (${Math.round(file.size / 1024)} KB)`;
      } else {
        const c = await comprimirImagen(file, 1600, 0.82);
        fotoPendiente = { dataUrl: c.dataUrl, mime: 'image/jpeg', ext: 'jpg', size: c.size };
        prev.querySelector('img').src = c.dataUrl; prev.classList.remove('hidden'); info.textContent = `Foto lista (${Math.round(c.size / 1024)} KB)`;
      }
    } catch (e) { Toast.error('No se pudo leer el archivo: ' + (e.message || e)); }
  }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); }
  async function subirComprobante(f) {
    const path = `empresa/${currentUser.empresa_id}/gastos/${uuid()}.${f.ext}`;
    const blob = await (await fetch(f.dataUrl)).blob();
    const { error } = await sb.storage.from('comprobantes').upload(path, blob, { contentType: f.mime, upsert: false });
    if (error) throw error;
    return path;
  }

  function resetForm() {
    catTocada = false; fotoPendiente = null; provQuery = '';
    ['gastoId', 'gastoDescripcion', 'gastoMonto', 'gastoFactura', 'gastoFolioFiscal', 'gastoComentarios', 'gastoProveedor', 'gastoProvInput', 'gastoVence'].forEach(id => { const e = $(id); if (e) e.value = ''; });
    $('gastoFecha').value = hoyISO(); $('gastoConIVA').checked = false; $('gastoIVAPreview').textContent = '';
    $('gastoEstatus').value = 'Pendiente'; onEstatus();
    $('gastoCategoria').value = ''; $('gastoSolicitante').value = currentUser?.nombre && [...$('gastoSolicitante').options].some(o => o.value === currentUser.nombre) ? currentUser.nombre : '';
    const pp = $('gastoPagadoPor'); if (pp) pp.value = '';
    $('gastoFotoInfo').textContent = ''; $('gastoFotoPreview').classList.add('hidden'); const fi = $('gastoFotoInput'); if (fi) fi.value = '';
    $('gastoSugerencia').classList.add('hidden'); $('gastoDetalles').open = false;
    try { resetDistribucionForm(); } catch (e) { }
    provCerrar();
  }

  function nuevo(opts = {}) {
    if (typeof opts === 'string') opts = { destino: opts === 'admin' ? 'indirecto' : 'obra' };
    if (M !== 'g' && !$('mdlGasto')) ensureModal();
    if (!$('mdlGasto')) ensureModal();
    resetForm();
    $('mdlGastoTitle').textContent = opts.rapido ? 'Gasto con ticket' : 'Registrar gasto';
    const obraId = opts.obraId || (selectedObra ? parseInt(selectedObra) : null) || parseInt(localStorage.getItem('brUltimaObra')) || '';
    $('gastoObraId').value = obraId || ''; onObra();
    setDestino(opts.destino || 'obra');
    if (opts.socioId) $('gastoSocioId').value = opts.socioId;
    openMdl('mdlGasto');
    setTimeout(() => { if (opts.rapido) $('gastoFotoInput')?.click(); else $('gastoDescripcion')?.focus(); }, 60);
    try { Telemetry.track('gasto_form_abierto', { origen: opts.rapido ? 'ticket_movil' : (opts.origen || 'modulo') }); } catch (e) { }
  }
  function rapido() { nuevo({ rapido: true, origen: 'ticket_movil' }); }

  function editar(id) {
    const g = (D.g || []).find(x => x.id == id); if (!g) return;
    if (!$('mdlGasto')) ensureModal();
    resetForm();
    $('mdlGastoTitle').textContent = 'Editar gasto';
    $('gastoId').value = g.id;
    $('gastoObraId').value = g.obra_id || ''; onObra();
    setDestino(destinoDe(g));
    if (g.socio_id && $('gastoSocioId')) $('gastoSocioId').value = g.socio_id;
    $('gastoDescripcion').value = g.descripcion || '';
    $('gastoMonto').value = g.monto_neto || '';
    $('gastoConIVA').checked = num(g.iva) > 0 || (g.iva == null && g.tipo_comprobante === 'Fiscal'); calcIVA();
    $('gastoFecha').value = (g.fecha_solicitud || '').slice(0, 10);
    $('gastoProveedor').value = g.proveedor_id || ''; $('gastoProvInput').value = provNombre(g.proveedor_id);
    const pp = $('gastoPagadoPor'); if (pp) pp.value = g.pagado_por_socio_id || '';
    $('gastoCategoria').value = catInfo(g.categoria)?.nombre || g.categoria || ''; catTocada = !!g.categoria;
    if (g.partida) { const sel = $('gastoPartida'); if (![...sel.options].some(o => o.value === g.partida)) sel.add(new Option(g.partida, g.partida)); sel.value = g.partida; }
    $('gastoEstatus').value = g.estatus_pago === 'Pagado' ? 'Pagado' : 'Pendiente'; onEstatus();
    $('gastoVence').value = g.fecha_vencimiento || '';
    $('gastoSolicitante').value = g.solicitante || '';
    $('gastoFactura').value = g.factura_numero || ''; $('gastoFolioFiscal').value = g.folio_fiscal || '';
    $('gastoComentarios').value = g.comentarios || '';
    if (g.comprobante_url) $('gastoFotoInfo').textContent = 'Ya tiene comprobante; sube otro para reemplazarlo.';
    if (destinoDe(g) === 'indirecto') { try { loadDistribucionExistente(g.id); } catch (e) { } }
    if (g.categoria || g.partida || g.factura_numero || g.folio_fiscal || g.comentarios) $('gastoDetalles').open = true;
    openMdl('mdlGasto');
  }

  function leerForm() {
    const destino = $('gastoDestino').value;
    const total = num($('gastoMonto').value);
    const conIVA = $('gastoConIVA').checked;
    const subtotal = conIVA ? Math.round(total / 1.16 * 100) / 100 : total;
    const folio = ($('gastoFolioFiscal').value || '').trim().toUpperCase();
    const obraId = destino === 'obra' ? (parseInt($('gastoObraId').value) || null) : null;
    const socioId = destino === 'socio' ? (parseInt($('gastoSocioId')?.value) || null) : null;
    const pagadoPor = parseInt($('gastoPagadoPor')?.value) || null;
    return {
      destino, obra_id: obraId, socio_id: socioId,
      descripcion: ($('gastoDescripcion').value || '').trim() || null,
      monto_neto: total, subtotal, iva: Math.round((total - subtotal) * 100) / 100,
      tipo_comprobante: conIVA || folio ? 'Fiscal' : 'No Fiscal',
      fecha_solicitud: $('gastoFecha').value,
      proveedor_id: parseInt($('gastoProveedor').value) || null,
      pagado_por_socio_id: pagadoPor,
      categoria: $('gastoCategoria').value || null,
      partida: destino === 'obra' ? ($('gastoPartida').value || null) : null,
      estatus_pago: $('gastoEstatus').value,
      fecha_vencimiento: $('gastoEstatus').value === 'Pendiente' ? ($('gastoVence').value || null) : null,
      solicitante: $('gastoSolicitante').value || null,
      factura_numero: $('gastoFactura').value || null,
      folio_fiscal: folio || null,
      comentarios: $('gastoComentarios').value || null
    };
  }

  async function guardar(e) {
    e.preventDefault();
    const id = $('gastoId').value;
    const d = leerForm();
    if (!d.descripcion) { Toast.warning('Escribe qué se compró.'); $('gastoDescripcion').focus(); return; }
    if (!(d.monto_neto > 0)) { Toast.warning('Captura el total pagado.'); $('gastoMonto').focus(); return; }
    if (!d.fecha_solicitud) { Toast.warning('Falta la fecha.'); $('gastoFecha').focus(); return; }
    if (d.destino === 'obra' && !d.obra_id) { Toast.warning('Elige la obra a la que se carga el gasto.'); $('gastoObraId').focus(); return; }
    if (d.destino === 'socio' && !d.socio_id) { Toast.warning('Elige el socio.'); return; }
    if (!d.categoria) { const sug = GastosRules.sugerirClasificacion(d.descripcion, provNombre(d.proveedor_id), { sinObra: d.destino === 'indirecto' }); d.categoria = catInfo(sug.categoria)?.nombre || sug.categoria; }
    if (d.folio_fiscal && !validarFolioFiscal(d.folio_fiscal)) { Toast.error('El folio fiscal debe ser un UUID de 36 caracteres.'); $('gastoDetalles').open = true; $('gastoFolioFiscal').focus(); return; }
    if (typeof Cierres !== 'undefined' && !(await Cierres.verificarEdicion(d.fecha_solicitud))) return;
    const btn = $('gastoGuardarBtn'); btn.disabled = true;
    try {
      // comprobante
      let comprobante_url = null;
      if (fotoPendiente) {
        if (navigator.onLine) comprobante_url = await subirComprobante(fotoPendiente);
      }
      let comprobacion = d.folio_fiscal ? 'facturado' : (fotoPendiente || (id && (D.g.find(x => x.id == id)?.comprobante_url))) ? 'ticket' : (d.proveedor_id && (D.pv.find(p => p.id == d.proveedor_id)?.rfc) ? 'factura_pendiente' : 'sin_comprobante');
      if (id) {
        const g = D.g.find(x => x.id == id);
        if (g?.comprobacion === 'facturado' && !d.folio_fiscal) comprobacion = 'facturado';
        const upd = { ...d, comprobacion, updated_at: new Date().toISOString() };
        if (comprobante_url) upd.comprobante_url = comprobante_url;
        if (d.estatus_pago === 'Pagado' && g && g.estatus_pago !== 'Pagado' && !g.aprobado_at && !puedeAprobar()) { upd.estatus_pago = 'Pendiente'; Toast.info('El gasto sigue pendiente de aprobación; se marcará pagado cuando se apruebe.'); }
        const { data: row, error } = await sb.from('gastos').update(upd).eq('id', id).select().single();
        if (error) throw error;
        Object.assign(g, row);
        if (d.destino === 'indirecto') await distribuirIndirecto(g);
        Toast.success(`Gasto actualizado: ${F(row.monto_neto)}`);
      } else {
        const params = {
          p_user_id: currentUser?.id, p_obra_id: d.obra_id, p_fecha_solicitud: d.fecha_solicitud, p_estatus_pago: d.estatus_pago,
          p_tipo_comprobante: d.tipo_comprobante, p_categoria: d.categoria, p_monto_neto: d.monto_neto, p_proveedor_id: d.proveedor_id,
          p_solicitante: d.solicitante, p_comentarios: d.comentarios, p_factura_numero: d.factura_numero, p_folio_fiscal: d.folio_fiscal,
          p_descripcion: d.descripcion, p_destino: d.destino, p_socio_id: d.socio_id, p_subtotal: d.subtotal, p_iva: d.iva,
          p_comprobacion: comprobacion, p_comprobante_url: comprobante_url, p_fecha_vencimiento: d.fecha_vencimiento, p_partida: d.partida
        };
        if (!navigator.onLine) {
          await Outbox.enqueue({ tipo: 'gasto', tabla: 'gastos', payload: { rpc: params, foto: fotoPendiente ? { ...fotoPendiente, ext: fotoPendiente.ext } : null, pagado_por_socio_id: d.pagado_por_socio_id } });
          Toast.info('Sin señal: el gasto quedó guardado en el teléfono y se enviará solo.');
          closeMdl('mdlGasto'); return;
        }
        const { data: result, error } = await sb.rpc('crear_gasto', params);
        if (error) throw error;
        if (!result?.success) throw new Error(result?.error || 'No se pudo crear el gasto');
        const { data: row } = await sb.from('gastos').select('*').eq('id', result.gasto_id).single();
        if (row) {
          if (d.pagado_por_socio_id) { const { data: r2 } = await sb.from('gastos').update({ pagado_por_socio_id: d.pagado_por_socio_id }).eq('id', row.id).select().single(); if (r2) Object.assign(row, r2); }
          if (!row.aprobado_at && row.estatus_pago === 'Pagado') { const { data: r3 } = await sb.from('gastos').update({ estatus_pago: 'Pendiente', monto_pagado: 0 }).eq('id', row.id).select().single(); if (r3) Object.assign(row, r3); }
          D.g.unshift(row);
          if (d.destino === 'indirecto') await distribuirIndirecto(row);
        }
        const destinoTxt = d.destino === 'obra' ? `en ${obraDe({ obra_id: d.obra_id })?.codigo_obra || 'la obra'}` : d.destino === 'indirecto' ? 'como indirecto' : `a la cuenta de ${socioNombre(d.socio_id)}`;
        if (result.aprobado === false) Toast.warning(`Gasto de ${F(d.monto_neto)} enviado a aprobación (excede tu límite de ${fmt(limiteRol(nivel()))}).`);
        else Toast.success(`Gasto de ${F(d.monto_neto)} registrado ${destinoTxt}.`);
        try { Telemetry.track('gasto_creado', { destino: d.destino, con_foto: !!fotoPendiente, origen: $('mdlGastoTitle').textContent.includes('ticket') ? 'ticket_movil' : 'modulo', aprobado: result.aprobado !== false }); } catch (e) { }
      }
      try { Cache.saveAppData(D, currentUser?.empresa_id || 'global'); } catch (e) { }
      closeMdl('mdlGasto');
      refrescar();
    } catch (err) {
      Toast.error(humanizeError(err, 'No se pudo guardar el gasto'));
    } finally { btn.disabled = false; }
  }

  // Indirecto: distribución manual si el usuario la capturó; si no, la regla de prorrateo de la empresa (US-121)
  async function distribuirIndirecto(g) {
    try {
      const manual = (typeof getDistribucionData === 'function') ? getDistribucionData() : [];
      if (manual.length) { await saveDistribucion(g.id, num(g.monto_neto)); const { data } = await sb.from('gastos_admin_distribucion').select('*').eq('gasto_id', g.id); D.gad = (D.gad || []).filter(x => x.gasto_id !== g.id).concat(data || []); }
      else if (typeof Socios !== 'undefined') await Socios.prorratear([g]);
    } catch (e) { console.warn('prorrateo', e); }
  }

  function refrescar() {
    if (M === 'g') render($('c'));
    else if (typeof refrescarVistaActual === 'function') refrescarVistaActual();
    try { updateMobileBottomNav(); } catch (e) { }
  }

  // ---------- acciones en línea ----------
  async function cambiarEstado(id, val) {
    const g = D.g.find(x => x.id == id); if (!g) return;
    const antes = estado(g);
    if (val === antes) return;
    if (val === 'parcial') { repintar(); return; }
    if (val !== 'solicitado' && !g.aprobado_at && !puedeAprobar()) { Toast.warning('Este gasto sigue pendiente de aprobación. Pídeselo a un gerente o administrador.'); repintar(); return; }
    // Si ya hay pagos capturados, el estado lo manda la cuenta de pagos, no esta burbuja.
    const pagos = (D.ppv || []).filter(p => p.gasto_id == id);
    if (pagos.length && val !== 'pagado') { Toast.warning(`Este gasto ya tiene ${pagos.length === 1 ? 'un pago capturado' : pagos.length + ' pagos capturados'}. Cancela el pago para regresarlo a pendiente.`); repintar(); return; }
    if (typeof Cierres !== 'undefined' && !(await Cierres.verificarEdicion(g.fecha_solicitud))) { repintar(); return; }
    const now = new Date().toISOString();
    let upd;
    if (val === 'solicitado') upd = { aprobado_at: null, aprobado_por: null, estatus_pago: 'Pendiente', monto_pagado: 0, updated_at: now };
    else if (val === 'aprobado') upd = { aprobado_at: g.aprobado_at || now, aprobado_por: g.aprobado_por || currentUser?.id || null, estatus_pago: 'Pendiente', monto_pagado: 0, updated_at: now };
    else upd = { aprobado_at: g.aprobado_at || now, aprobado_por: g.aprobado_por || currentUser?.id || null, estatus_pago: 'Pagado', monto_pagado: num(g.monto_neto), updated_at: now };
    const { error } = await sb.from('gastos').update(upd).eq('id', id);
    if (error) { Toast.error(humanizeError(error, 'No se pudo cambiar el estado')); repintar(); return; }
    Object.assign(g, upd);
    const quien = g.pagado_por_socio_id ? ' a ' + socioNombre(g.pagado_por_socio_id) : '';
    Toast.success(val === 'pagado' ? `${S(g.descripcion || 'El gasto')} quedó como pagado${quien}.` : `${S(g.descripcion || 'El gasto')} regresó a ${ESTADO[val][0].toLowerCase()}.`);
    try { Telemetry.track('gasto_estado_manual', { de: antes, a: val }); } catch (e) { }
    refrescar();
  }

  // Al cierre de obra se repone de una sola vez lo que alguien puso de su bolsa.
  async function reponer(socioId) {
    const ids = base().filter(g => g.pagado_por_socio_id == socioId && !['pagado', 'rechazado'].includes(estado(g))).map(g => g.id);
    if (!ids.length) { Toast.info('No hay nada por reponer.'); return; }
    const monto = base().filter(g => ids.includes(g.id)).reduce((t, g) => t + saldo(g), 0);
    if (!await Dialog.confirm(`¿Marcar como pagados los ${ids.length} gastos que puso ${socioNombre(socioId)}, por ${F(monto)} en total?`)) return;
    const now = new Date().toISOString();
    // Los que nunca se aprobaron necesitan además la firma de aprobación; a los demás no se les toca la suya.
    const sinAprobar = ids.filter(id => !D.g.find(x => x.id == id)?.aprobado_at);
    for (const [lote, extra] of [[sinAprobar, { aprobado_at: now, aprobado_por: currentUser?.id || null }], [ids.filter(id => !sinAprobar.includes(id)), {}]]) {
      if (!lote.length) continue;
      const { error } = await sb.from('gastos').update({ estatus_pago: 'Pagado', updated_at: now, ...extra }).in('id', lote);
      if (error) { Toast.error(humanizeError(error, 'No se pudo reponer')); refrescar(); return; }
    }
    ids.forEach(id => { const g = D.g.find(x => x.id == id); if (g) { g.estatus_pago = 'Pagado'; g.monto_pagado = num(g.monto_neto); g.aprobado_at = g.aprobado_at || now; } });
    Toast.success(`Se repusieron ${F(monto)} a ${socioNombre(socioId)}.`, 6000);
    try { Telemetry.track('caja_chica_repuesta', { n: ids.length }); } catch (e) { }
    refrescar();
  }

  async function cambiarComprobacion(id, val) {
    const g = D.g.find(x => x.id == id); if (!g) return;
    const { error } = await sb.from('gastos').update({ comprobacion: val, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { Toast.error(humanizeError(error, 'No se pudo cambiar la comprobación')); return; }
    g.comprobacion = val; repintar();
  }

  async function aprobar(ids) {
    ids = [...new Set((ids || []).map(Number).filter(Boolean))]; if (!ids.length) { Toast.warning('Selecciona al menos una compra.'); return; }
    if (!puedeAprobar()) { Toast.error('Sólo un gerente o administrador puede aprobar compras.'); return; }
    const { error } = await sb.from('gastos').update({ aprobado_por: currentUser.id, aprobado_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in('id', ids);
    if (error) { Toast.error(humanizeError(error, 'No se pudo aprobar')); return; }
    const now = new Date().toISOString();
    ids.forEach(id => { const g = D.g.find(x => x.id == id); if (g) { g.aprobado_at = now; g.aprobado_por = currentUser.id; } });
    try { clearGastosSelection(); } catch (e) { }
    Toast.success(ids.length === 1 ? 'Compra aprobada.' : `${ids.length} compras aprobadas.`);
    try { Telemetry.track('compra_aprobada', { n: ids.length }); } catch (e) { }
    refrescar();
  }
  function rechazar(ids) {
    ids = [...new Set((ids || []).map(Number).filter(Boolean))]; if (!ids.length) { Toast.warning('Selecciona al menos una compra.'); return; }
    let dlg = $('dlgRechazo');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'dlgRechazo'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
    dlg.innerHTML = `<form method="dialog" onsubmit="Compras._rechazar(event,[${ids.join(',')}])"><h2 class="font-bold mb-2">Rechazar ${ids.length === 1 ? 'la compra' : ids.length + ' compras'}</h2>
<label class="text-xs mb-1 block" for="rechazoMotivo">Motivo (se le muestra a quien la pidió) *</label><textarea id="rechazoMotivo" class="inp" rows="3" required></textarea>
<div class="flex gap-2 mt-3"><button type="button" class="btn btn-s flex-1" onclick="this.closest('dialog').close()">Cancelar</button><button type="submit" class="btn btn-p flex-1">Rechazar</button></div></form>`;
    dlg.showModal(); setTimeout(() => $('rechazoMotivo').focus(), 50);
  }
  async function _rechazar(e, ids) {
    e.preventDefault();
    const motivo = ($('rechazoMotivo').value || '').trim(); if (!motivo) return;
    for (const id of ids) {
      const g = D.g.find(x => x.id == id); if (!g) continue;
      const comentarios = (g.comentarios ? g.comentarios + ' | ' : '') + 'Rechazado por ' + (currentUser?.nombre || '') + ': ' + motivo;
      const { error } = await sb.from('gastos').update({ estatus_pago: 'Rechazado', comentarios, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) { Toast.error(humanizeError(error, 'No se pudo rechazar')); return; }
      g.estatus_pago = 'Rechazado'; g.comentarios = comentarios;
    }
    $('dlgRechazo').close(); try { clearGastosSelection(); } catch (e2) { }
    Toast.success('Compra rechazada; el solicitante lo verá en su dashboard.');
    try { Telemetry.track('compra_rechazada', { n: ids.length }); } catch (e3) { }
    refrescar();
  }

  function pagar(id) {
    if (typeof PagosProv !== 'undefined' && PagosProv.abrir) return PagosProv.abrir({ gastoId: id });
    return marcarPagado(id);
  }
  async function marcarPagado(id) {
    const g = D.g.find(x => x.id == id); if (!g) return;
    const s = saldo(g); if (!(s > 0)) return;
    try {
      const { data: numero } = await sb.rpc('get_next_pago_proveedor_numero');
      const pago = { empresa_id: currentUser.empresa_id, obra_id: g.obra_id, gasto_id: g.id, proveedor_id: g.proveedor_id, numero_pago: numero, fecha_pago: hoyISO(), monto: s, metodo_pago: 'Efectivo', concepto: g.descripcion || g.categoria, created_by: currentUser.id };
      const { data: row, error } = await sb.from('pagos_proveedores').insert(pago).select().single();
      if (error) throw error;
      D.ppv = D.ppv || []; D.ppv.unshift(row);
      g.monto_pagado = num(g.monto_pagado) + s; g.estatus_pago = 'Pagado';
      refrescar();
      Toast.success(`Pago ${numero} registrado por ${F(s)} a ${provNombre(g.proveedor_id) || 'proveedor sin nombre'}.`, 6000);
      try { Telemetry.track('pago_proveedor_registrado', { rapido: true }); } catch (e) { }
    } catch (err) { Toast.error(humanizeError(err, 'No se pudo registrar el pago')); }
  }

  function menu(id, btn) {
    const g = D.g.find(x => x.id == id); if (!g) return;
    const m = $('comprasMenu'); if (!m) return;
    const items = [];
    if (g.proveedor_id && !g.orden_compra_id) items.push(['ri-file-list-3-line', 'Generar orden de compra', `Compras.generarOC(${id})`]);
    if (g.orden_compra_id && typeof verOrdenPDF === 'function') items.push(['ri-printer-line', 'Ver orden de compra', `verOrdenPDF(${g.orden_compra_id})`]);
    if (['sin_comprobante', 'ticket', 'factura_pendiente'].includes(g.comprobacion || 'sin_comprobante') && g.proveedor_id) items.push(['ri-mail-send-line', 'Pedir factura al proveedor', `Compras.pedirFactura([${id}])`]);
    if (g.comprobante_url) items.push(['ri-attachment-2', 'Ver comprobante', `Compras.verComprobante(${id})`]);
    if (esAdmin() && g.pagado_por_socio_id) items.push(['ri-user-star-line', 'Ver cuenta del socio', `M='so';R();`]);
    items.push(['ri-delete-bin-line', 'Eliminar gasto', `deleteGasto(${id})`]);
    m.innerHTML = items.map(([i, l, a]) => `<button type="button" role="menuitem" onclick="Compras.cerrarMenu();${a}"><i class="${i}" aria-hidden="true"></i> ${l}</button>`).join('');
    const r = btn.getBoundingClientRect();
    m.style.top = (r.bottom + window.scrollY + 4) + 'px'; m.style.left = Math.max(8, r.right + window.scrollX - 240) + 'px';
    m.hidden = false;
    setTimeout(() => document.addEventListener('click', cerrarMenu, { once: true }), 0);
  }
  function cerrarMenu() { const m = $('comprasMenu'); if (m) m.hidden = true; }

  async function generarOC(id) {
    const g = D.g.find(x => x.id == id); if (!g) return;
    if (!g.obra_id) { Toast.warning('La orden de compra necesita una obra.'); return; }
    try {
      const codigo = await generateCodigoOrden(g.obra_id);
      const { data: result, error } = await sb.rpc('crear_orden_compra', { p_user_id: currentUser.id, p_obra_id: g.obra_id, p_codigo_orden: codigo, p_fecha_orden: g.fecha_solicitud || hoyISO(), p_descripcion: g.descripcion || g.categoria, p_proveedor_id: g.proveedor_id, p_monto_estimado: g.monto_neto, p_estatus: g.aprobado_at ? 'Aprobada' : 'Pendiente', p_solicitante: g.solicitante || currentUser.nombre, p_fecha_entrega_estimada: null, p_notas: 'Generada desde el gasto #' + g.id });
      if (error) throw error;
      if (result && result.success === false) throw new Error(result.error);
      const ocId = result?.orden_id;
      const { data: row } = await sb.from('gastos').update({ orden_compra_id: ocId, orden_compra: codigo }).eq('id', id).select().single();
      if (row) Object.assign(g, row);
      const { data: oc } = await sb.from('ordenes_compra').select('*').eq('id', ocId).single(); if (oc) (D.oc = D.oc || []).unshift(oc);
      Toast.success(`Orden ${codigo} generada.`);
      if (typeof verOrdenPDF === 'function') verOrdenPDF(ocId);
      refrescar();
    } catch (err) { Toast.error(humanizeError(err, 'No se pudo generar la orden')); }
  }

  function pedirFactura(ids) {
    ids = [...new Set((ids || []).map(Number).filter(Boolean))];
    const gs = ids.map(id => D.g.find(x => x.id == id)).filter(g => g && g.proveedor_id && g.comprobacion !== 'facturado');
    if (!gs.length) { Toast.warning('Selecciona gastos con proveedor que aún no estén facturados.'); return; }
    const emp = (D.e || []).find(x => x.id === currentUser.empresa_id) || {};
    const datos = [emp.razon_social || emp.nombre || 'SUPERNOVA ARQUITECTOS', emp.rfc ? 'RFC ' + emp.rfc : '', emp.regimen_fiscal ? 'Régimen ' + emp.regimen_fiscal : '', emp.codigo_postal ? 'C.P. ' + emp.codigo_postal : '', 'Uso de CFDI: G03 Gastos en general'].filter(Boolean).join(', ');
    const porProv = {}; gs.forEach(g => { (porProv[g.proveedor_id] = porProv[g.proveedor_id] || []).push(g); });
    let dlg = $('dlgFactura');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'dlgFactura'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
    dlg.innerHTML = `<h2 class="font-bold mb-2">Pedir factura</h2><p class="text-sm text-ink-muted mb-3">Se abre WhatsApp o correo con la lista de tickets y los datos fiscales de la empresa. Al enviar, los gastos quedan como «factura pendiente» con fecha de solicitud.</p>
<div class="space-y-2">${Object.entries(porProv).map(([pid, list]) => {
      const p = D.pv.find(x => x.id == pid) || {};
      const texto = `Hola ${p.contacto || p.nombre_proveedor || ''}, te pido factura de:\n${list.map(g => `- ${(g.fecha_solicitud || '').slice(0, 10)} ${g.descripcion || g.categoria}: ${F(g.monto_neto)}${g.factura_numero ? ' (ticket ' + g.factura_numero + ')' : ''}`).join('\n')}\nDatos: ${datos}. Gracias.`;
      const tel = (p.telefono || '').replace(/\D/g, ''); const wa = tel ? `https://wa.me/${tel.length === 10 ? '52' + tel : tel}?text=${encodeURIComponent(texto)}` : '';
      const mail = p.email ? `mailto:${p.email}?subject=${encodeURIComponent('Solicitud de factura')}&body=${encodeURIComponent(texto)}` : '';
      return `<div class="border border-line rounded-lg p-2 flex flex-wrap items-center gap-2"><div class="flex-1 min-w-0"><p class="text-sm font-medium truncate">${S(p.nombre_proveedor || 'Proveedor')}</p><p class="text-xs text-ink-subtle">${list.length} gasto(s) · ${F(list.reduce((s, g) => s + num(g.monto_neto), 0))}</p></div>
${wa ? `<a class="btn btn-p text-xs" href="${wa}" target="_blank" rel="noopener" onclick="Compras.marcarSolicitada([${list.map(g => g.id).join(',')}])"><i class="ri-whatsapp-line" aria-hidden="true"></i> WhatsApp</a>` : ''}
${mail ? `<a class="btn btn-s text-xs" href="${mail}" onclick="Compras.marcarSolicitada([${list.map(g => g.id).join(',')}])"><i class="ri-mail-line" aria-hidden="true"></i> Correo</a>` : ''}
<button type="button" class="btn btn-s text-xs" onclick="navigator.clipboard.writeText(${JSON.stringify(texto).replace(/"/g, '&quot;')});Toast.success('Mensaje copiado');Compras.marcarSolicitada([${list.map(g => g.id).join(',')}])"><i class="ri-file-copy-line" aria-hidden="true"></i> Copiar</button></div>`;
    }).join('')}</div>
<div class="flex justify-end mt-3"><button type="button" class="btn btn-s" onclick="this.closest('dialog').close()">Cerrar</button></div>`;
    dlg.showModal();
  }
  async function marcarSolicitada(ids) {
    const now = new Date().toISOString();
    const { error } = await sb.from('gastos').update({ comprobacion: 'factura_pendiente', factura_solicitada_at: now }).in('id', ids).neq('comprobacion', 'facturado');
    if (!error) { ids.forEach(id => { const g = D.g.find(x => x.id == id); if (g && g.comprobacion !== 'facturado') { g.comprobacion = 'factura_pendiente'; g.factura_solicitada_at = now; } }); repintar(); }
    try { clearGastosSelection(); } catch (e) { }
  }

  function cambiarDestinoLote(ids) {
    ids = [...new Set((ids || []).map(Number).filter(Boolean))]; if (!ids.length) { Toast.warning('Selecciona al menos un gasto.'); return; }
    let dlg = $('dlgDestino');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'dlgDestino'; dlg.className = 'dlg'; document.body.appendChild(dlg); }
    const obras = getObrasPermitidas().filter(o => !['Archivada', 'Completada', 'Finalizada'].includes(o.estatus));
    dlg.innerHTML = `<form method="dialog" onsubmit="Compras._cambiarDestino(event,[${ids.join(',')}])"><h2 class="font-bold mb-2">Cambiar destino de ${ids.length} gasto(s)</h2>
<label class="text-xs mb-1 block" for="cdDestino">Destino</label><select id="cdDestino" class="inp" onchange="$('cdObra').classList.toggle('hidden',this.value!=='obra');$('cdSocio').classList.toggle('hidden',this.value!=='socio')"><option value="obra">Obra</option><option value="indirecto">Indirecto</option>${esAdmin() ? '<option value="socio">Gasto personal de socio</option>' : ''}</select>
<select id="cdObra" class="inp mt-2" aria-label="Obra">${obras.map(o => `<option value="${o.id}">${S(o.codigo_obra ? o.codigo_obra + ' · ' : '')}${S(o.nombre_obra)}</option>`).join('')}</select>
<select id="cdSocio" class="inp mt-2 hidden" aria-label="Socio">${socios().map(s => `<option value="${s.id}">${S(s.nombre)}</option>`).join('')}</select>
<div class="flex gap-2 mt-3"><button type="button" class="btn btn-s flex-1" onclick="this.closest('dialog').close()">Cancelar</button><button type="submit" class="btn btn-p flex-1">Cambiar</button></div></form>`;
    dlg.showModal();
  }
  async function _cambiarDestino(e, ids) {
    e.preventDefault();
    const destino = $('cdDestino').value; const obraId = parseInt($('cdObra').value) || null; const socioId = parseInt($('cdSocio').value) || null;
    const upd = { destino, obra_id: destino === 'obra' ? obraId : null, socio_id: destino === 'socio' ? socioId : null, updated_at: new Date().toISOString() };
    if (destino === 'socio') upd.categoria = catInfo('Gasto personal de socio')?.nombre || 'Gasto personal de socio';
    const { error } = await sb.from('gastos').update(upd).in('id', ids);
    if (error) { Toast.error(humanizeError(error, 'No se pudo cambiar el destino')); return; }
    ids.forEach(id => { const g = D.g.find(x => x.id == id); if (g) Object.assign(g, upd); });
    $('dlgDestino').close(); try { clearGastosSelection(); } catch (e2) { }
    Toast.success('Destino actualizado.'); refrescar();
  }

  // ---------- reclasificación asistida (US-104) ----------
  function revisarClasificacion() {
    const sug = GastosRules.revisar(base().filter(g => destinoDe(g) !== 'socio' || esAdmin()), D.pv || []);
    let dlg = $('dlgReclas');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'dlgReclas'; dlg.className = 'dlg dlg-wide'; document.body.appendChild(dlg); }
    if (!sug.length) { dlg.innerHTML = `<h2 class="font-bold mb-2">Revisar clasificación</h2><p class="text-sm">Todo coincide con las reglas: no hay gastos que reclasificar.</p><div class="flex justify-end mt-3"><button type="button" class="btn btn-s" onclick="this.closest('dialog').close()">Cerrar</button></div>`; dlg.showModal(); return; }
    dlg.innerHTML = `<div class="flex justify-between items-center mb-2"><h2 class="font-bold">Revisar clasificación · ${sug.length} sugerencias</h2><button type="button" class="btn-icon" onclick="this.closest('dialog').close()" aria-label="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></div>
<p class="text-sm text-ink-muted mb-2">Gastos cuya descripción o proveedor sugieren otra categoría o destino. Marca los que quieras corregir.</p>
<div class="overflow-auto" style="max-height:60vh"><table class="w-full text-sm"><thead class="bg-slate-50 text-xs text-ink-muted"><tr><th class="p-2"><input type="checkbox" checked aria-label="Seleccionar todos" onchange="document.querySelectorAll('.rcChk').forEach(c=>c.checked=this.checked)"></th><th class="p-2 text-left">Gasto</th><th class="p-2 text-left">Hoy</th><th class="p-2 text-left">Sugerido</th></tr></thead><tbody>
${sug.map(({ gasto: g, sugerencia: s, cambiaDestino, cambiaCategoria }) => {
      const hoy = `${destinoDe(g) === 'obra' ? (obraDe(g)?.codigo_obra || 'Obra') : destinoDe(g)} · ${g.categoria || 'sin categoría'}`;
      const nuevo = `${s.destino === 'obra' ? (obraDe(g)?.codigo_obra || 'Obra') : s.destino} · ${s.categoria}`;
      const socioSel = s.destino === 'socio' ? `<select class="inp text-xs py-0.5 mt-1 rcSocio" data-id="${g.id}">${socios().map(x => `<option value="${x.id}" ${g.pagado_por_socio_id == x.id ? 'selected' : ''}>${S(x.nombre)}</option>`).join('')}</select>` : '';
      return `<tr class="border-t border-line"><td class="p-2 text-center"><input type="checkbox" class="rcChk" checked data-id="${g.id}" data-destino="${s.destino}" data-categoria="${S(s.categoria)}" aria-label="Reclasificar ${S(g.descripcion || g.id)}"></td><td class="p-2"><div class="font-medium">${S(g.descripcion || g.comentarios || '')}</div><div class="text-xs text-ink-subtle">${(g.fecha_solicitud || '').slice(0, 10)} · ${F(g.monto_neto)}${g.proveedor_id ? ' · ' + S(provNombre(g.proveedor_id)) : ''}</div></td><td class="p-2 text-xs">${S(hoy)}</td><td class="p-2 text-xs"><b class="${cambiaDestino ? 'text-warn' : ''}">${S(nuevo)}</b> <span class="text-ink-subtle">(«${S(s.motivo)}»)</span>${socioSel}</td></tr>`;
    }).join('')}</tbody></table></div>
<div class="flex justify-end gap-2 mt-3"><button type="button" class="btn btn-s" onclick="this.closest('dialog').close()">Cancelar</button><button type="button" class="btn btn-p" onclick="Compras.aplicarReclasificacion()">Aplicar a los marcados</button></div>`;
    dlg.showModal();
  }
  async function aplicarReclasificacion() {
    const chks = [...document.querySelectorAll('#dlgReclas .rcChk:checked')];
    if (!chks.length) { Toast.warning('No hay gastos marcados.'); return; }
    let ok = 0;
    for (const c of chks) {
      const id = parseInt(c.dataset.id); const g = D.g.find(x => x.id === id); if (!g) continue;
      const destino = c.dataset.destino; const categoria = catInfo(c.dataset.categoria)?.nombre || c.dataset.categoria;
      const upd = { categoria, destino, updated_at: new Date().toISOString() };
      if (destino === 'obra') { if (!g.obra_id) continue; }
      else if (destino === 'indirecto') { upd.obra_id = null; }
      else if (destino === 'socio') { const sel = document.querySelector(`#dlgReclas .rcSocio[data-id="${id}"]`); const sid = parseInt(sel?.value) || null; if (!sid) continue; upd.obra_id = null; upd.socio_id = sid; }
      const { data: row, error } = await sb.from('gastos').update(upd).eq('id', id).select().single();
      if (!error && row) { Object.assign(g, row); ok++; }
    }
    $('dlgReclas').close();
    Toast.success(`${ok} gasto(s) reclasificados.`);
    try { Telemetry.track('gastos_reclasificados', { n: ok }); } catch (e) { }
    refrescar();
  }

  function proveedor(id) { if (typeof abrirProveedor === 'function') abrirProveedor(id); else { M = 'v'; R(); } }
  function importarXML() { if (typeof CFDI !== 'undefined' && CFDI.abrirImportador) CFDI.abrirImportador(); else Toast.info('La importación de XML llega en la siguiente actualización.'); }

  function exportar() {
    const list = lista(); if (!list.length) { Toast.warning('No hay gastos para exportar.'); return; }
    const datos = list.map(g => ({
      'Fecha': (g.fecha_solicitud || '').slice(0, 10), 'Qué': g.descripcion || '', 'Categoría': g.categoria || '',
      'Destino': destinoDe(g) === 'obra' ? (obraDe(g)?.codigo_obra || obraDe(g)?.nombre_obra || '') : destinoDe(g) === 'socio' ? 'Socio: ' + socioNombre(g.socio_id) : 'Indirecto',
      'Proveedor': provNombre(g.proveedor_id), 'RFC proveedor': (D.pv.find(p => p.id == g.proveedor_id) || {}).rfc || '',
      'Subtotal': num(g.subtotal), 'IVA': num(g.iva), 'Total': num(g.monto_neto), 'Pagado': num(g.monto_pagado), 'Saldo': saldo(g),
      'Estado': ESTADO[estado(g)][0], 'Comprobación': (COMPROBACION[g.comprobacion || 'sin_comprobante'] || [''])[0], 'Folio fiscal': g.folio_fiscal || '', 'No. factura': g.factura_numero || '',
      'Pagó': g.pagado_por_socio_id ? socioNombre(g.pagado_por_socio_id) : 'Empresa', 'Partida': g.partida || '', 'Folio OC': g.orden_compra || '', 'Solicitante': g.solicitante || '', 'Comentarios': g.comentarios || ''
    }));
    const ws = XLSX.utils.json_to_sheet(datos); ws['!cols'] = Object.keys(datos[0]).map(k => ({ wch: Math.min(40, Math.max(10, k.length + 6)) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Compras');
    XLSX.writeFile(wb, `Compras_${hoyISO()}.xlsx`);
  }

  return { render, filas, lista, setTab, buscar, filtro, limpiar, nuevo, rapido, editar, guardar, setDestino, onObra, onEstatus, calcIVA, catManual, sugerir, aplicarSugerencia, foto, provInput, provPick, provCerrar, provNuevo, cambiarComprobacion, cambiarEstado, reponer, verDe, aprobar, rechazar, _rechazar, pagar, marcarPagado, menu, cerrarMenu, generarOC, pedirFactura, marcarSolicitada, cambiarDestinoLote, _cambiarDestino, revisarClasificacion, aplicarReclasificacion, proveedor, importarXML, exportar, verComprobante, estado, destinoDe, saldo, refrescar, get tab() { return tab; } };
})();
