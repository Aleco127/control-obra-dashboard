/**
 * WizardObra: alta guiada de proyecto en 5 pasos
 *   1 Datos y monto (con / sin IVA)  → obras (RPC crear_obra)
 *   2 Catálogo (XLSX/CSV/OPUS o etapas de honorarios) → catalogo_conceptos
 *   3 Programa por semanas (matriz concepto × semana + hitos) → programas_obra + actividades_programa
 *   4 Plan de pagos (exhibiciones) → cuentas_por_cobrar (+ anticipo en pagos_recibidos)
 *   5 Resumen
 *
 * Depende de globales de index.html: sb, D, currentUser, S, fmt, Toast, Dialog, humanizeError,
 * openMdl/closeMdl, clienteComboHtml/resolveClienteCombo, L, Cache, abrirFichaObra.
 * Reglas de BD: no enviar importe / duracion_dias / subtotal / monto_iva / monto_pendiente (columnas generadas).
 */
const WizardObra = (() => {
  const PARTIDAS_DEFAULT = ['Preliminares', 'Cimentación', 'Estructura', 'Albañilería', 'Instalación Hidráulica', 'Instalación Sanitaria', 'Instalación Eléctrica', 'Acabados', 'Carpintería', 'Herrería', 'Cancelería', 'Pintura', 'Limpieza', 'Otros'];
  const TIPOS = ['Proyecto arquitectónico', 'Obra', 'Remodelación', 'Otro'];
  const PLANTILLAS_PAGO = {
    '50-25-25': [{ n: 'Anticipo', p: 50 }, { n: 'Avance', p: 25 }, { n: 'Liquidación contra entrega', p: 25 }],
    '30-30-20-20': [{ n: 'Anticipo', p: 30 }, { n: 'Avance', p: 30 }, { n: 'Avance', p: 20 }, { n: 'Liquidación contra acta de entrega', p: 20 }],
    '100': [{ n: 'Pago único', p: 100 }]
  };
  const ORD = ['1º', '2º', '3º', '4º', '5º', '6º', '7º', '8º'];
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const dmy = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : '';
  const num = v => { const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, '')); return isNaN(n) ? 0 : n; };
  const r2 = n => Math.round(n * 100) / 100;
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const track = (ev, meta) => { try { if (window.Telemetry) Telemetry.track(ev, meta); } catch (e) { } };

  // ---------- estado ----------
  let st = null;
  function fresh() {
    return {
      step: 1, obraId: null, obra: null, clienteId: null, editMode: false,
      ivaMode: 'sin', monto: 0,
      catMode: null, conceptos: [], descuento: 0, catSaved: false, etapas: [{ n: 'Etapa A', p: 50 }, { n: 'Etapa B', p: 50 }],
      startDow: 1, rows: [], hitos: [], editPct: false, progSaved: false, programaId: null,
      pagos: [], anticipo: { si: false, fecha: iso(new Date()), metodo: 'Transferencia', ref: '', banco: '' }, pagosSaved: false, cxcIds: [], pagoNumero: null,
      resumen: {}
    };
  }

  // ---------- modal ----------
  function ensureModal() {
    if (document.getElementById('mdlWizardObra')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="mdlWizardObra" class="modal">
      <div class="g rounded-2xl w-full max-w-5xl mx-4 max-h-[95vh] overflow-y-auto p-5 md:p-6" role="dialog" aria-modal="true" aria-labelledby="wzTitle">
        <div class="flex justify-between items-start gap-3 mb-3">
          <div><h2 id="wzTitle" class="text-lg font-bold n">Nuevo proyecto</h2><p id="wzSub" class="text-sm text-ink-muted"></p></div>
          <button type="button" class="btn-icon" onclick="WizardObra.close()" aria-label="Cerrar asistente"><i class="ri-close-line text-xl" aria-hidden="true"></i></button>
        </div>
        <div id="wzSteps" class="wz-steps" role="list"></div>
        <div id="wzContent"></div>
      </div></div>`);
  }

  async function open(opts = {}) {
    ensureModal();
    st = fresh();
    if (opts.obraId) {
      if (!(D.o || []).some(x => x.id == opts.obraId)) {
        // La obra no está en memoria (caché vieja): se trae de la base
        const { data } = await sb.from('obras').select('*').eq('id', opts.obraId).single();
        if (data) D.o.unshift(data);
      }
      loadObra(opts.obraId);
    }
    if (opts.clienteId) st.clienteId = opts.clienteId;
    st.step = opts.step || 1;
    if (st.step > 1 && !st.obraId) st.step = 1;
    openMdl('mdlWizardObra');
    render();
    track('wizard_abierto', { paso: st.step, edit: !!opts.obraId });
  }

  function loadObra(id) {
    const o = (D.o || []).find(x => x.id == id);
    if (!o) return;
    st.obraId = o.id; st.obra = o; st.editMode = true; st.clienteId = o.cliente_id || null;
    st.ivaMode = (o.porcentaje_iva || 0) > 0 ? 'con' : 'exento';
    st.monto = o.presupuesto_total || 0;
    // Catálogo existente
    const cc = (D.cc || []).filter(c => c.obra_id == o.id).sort((a, b) => (a.orden || 0) - (b.orden || 0));
    if (cc.length) { st.catSaved = true; st.conceptos = cc.map(c => ({ id: c.id, clave: c.clave, descripcion: c.descripcion, unidad: c.unidad, cantidad: +c.cantidad || 0, pu: +c.precio_unitario || 0, partida: c.partida || '', categoria: c.categoria || '' })); st.catMode = 'existente'; }
    const pg = (D.pg || []).find(p => p.obra_id == o.id);
    if (pg) { st.progSaved = true; st.programaId = pg.id; }
    const cxc = (D.cxc || []).filter(c => c.obra_id == o.id);
    if (cxc.length) { st.pagosSaved = true; st.cxcIds = cxc.map(c => c.id); }
  }

  function close() { closeMdl('mdlWizardObra'); }

  function goto(n) {
    if (n > 1 && st.obraId && !st.obra) { st.obra = (D.o || []).find(x => x.id == st.obraId) || null; }
    if (n > 1 && !st.obra) { n = 1; Toast.warning('Primero guarda los datos de la obra.'); }
    st.step = n; render(); track('wizard_paso', { paso: n });
  }

  // ---------- helpers de cálculo ----------
  function desglose(monto, mode) {
    monto = num(monto);
    if (mode === 'sin') return { sub: monto, iva: r2(monto * 0.16), tot: r2(monto * 1.16), pct: 16 };
    if (mode === 'con') return { sub: r2(monto / 1.16), iva: r2(monto - monto / 1.16), tot: monto, pct: 16 };
    return { sub: monto, iva: 0, tot: monto, pct: 0 };
  }
  function obraDesglose() {
    const o = st.obra; if (!o) return desglose(st.monto, st.ivaMode);
    const pct = +o.porcentaje_iva || 0; const tot = +o.presupuesto_total || 0;
    return { sub: pct ? r2(tot / (1 + pct / 100)) : tot, iva: pct ? r2(tot - tot / (1 + pct / 100)) : 0, tot, pct };
  }
  function totalCatalogoBruto() { return st.conceptos.filter(c => c.cantidad * c.pu > 0).reduce((s, c) => s + c.cantidad * c.pu, 0); }
  function totalCatalogo() { return st.conceptos.reduce((s, c) => s + c.cantidad * c.pu, 0); }
  function sugerirCodigo(nombre, cliente) {
    const stop = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'para', 'con', 'a', 'un', 'una', 'proyecto', 'obra']);
    const ini = String(nombre || '').split(/\s+/).filter(w => w && !stop.has(norm(w))).map(w => w[0].toUpperCase()).join('').slice(0, 4);
    const cli = String(cliente || '').split(/\s+/).filter(w => w && !stop.has(norm(w))).map(w => w[0].toUpperCase()).join('').slice(0, 2);
    const yy = String(new Date().getFullYear()).slice(2);
    const seq = String((D.o || []).filter(o => o.empresa_id === currentUser?.empresa_id).length + 1).padStart(2, '0');
    return [ini || 'OBR', cli, yy + '-' + seq].filter(Boolean).join('-');
  }

  // ---------- render ----------
  const STEPS = ['Datos', 'Catálogo', 'Programa', 'Pagos', 'Resumen'];
  function render() {
    const done = n => (n === 1 && st.obraId) || (n === 2 && st.catSaved) || (n === 3 && st.progSaved) || (n === 4 && st.pagosSaved);
    document.getElementById('wzSteps').innerHTML = STEPS.map((s, i) => {
      const n = i + 1; const cls = n === st.step ? 'current' : (done(n) ? 'done' : '');
      const clickable = n === 1 || st.obraId;
      return `<div class="wz-step ${cls}" role="listitem" ${clickable ? `onclick="WizardObra.goto(${n})" style="cursor:pointer"` : ''} aria-current="${n === st.step ? 'step' : 'false'}"><span class="num">${done(n) && n !== st.step ? '<i class="ri-check-line" aria-hidden="true"></i>' : n}</span><span class="tx">${s}</span></div>`;
    }).join('');
    document.getElementById('wzTitle').textContent = st.obra ? (st.obra.codigo_obra ? st.obra.codigo_obra + ' · ' : '') + st.obra.nombre_obra : 'Nuevo proyecto';
    document.getElementById('wzSub').textContent = ['Paso 1 de 5: datos del contrato y monto', 'Paso 2 de 5: catálogo de conceptos', 'Paso 3 de 5: programa por semanas', 'Paso 4 de 5: plan de pagos', 'Paso 5 de 5: resumen'][st.step - 1];
    const c = document.getElementById('wzContent');
    ({ 1: step1, 2: step2, 3: step3, 4: step4, 5: step5 })[st.step](c);
    c.querySelector('input,select,textarea,button.btn-p')?.focus();
  }

  // ===== PASO 1 =====
  function step1(c) {
    const o = st.obra || {};
    const users = (D.u || []).filter(u => u.activo);
    const modeChecked = m => st.ivaMode === m ? 'checked' : '';
    c.innerHTML = `<form id="wzF1" onsubmit="return false" class="space-y-4">
      <div class="grid md:grid-cols-2 gap-4">
        <div class="md:col-span-2"><label class="text-xs mb-1 block" for="wzNombre">Nombre del proyecto *</label><input id="wzNombre" class="inp" required value="${S(o.nombre_obra || '')}" placeholder="Ej. Remodelación local Luminae Studio" oninput="WizardObra.sugCodigo()"></div>
        <div><label class="text-xs mb-1 block" for="wzCodigo">Código</label><input id="wzCodigo" class="inp font-mono" value="${S(o.codigo_obra || '')}" placeholder="Ej. LL-LS-01"><p class="field-hint">Se sugiere a partir del nombre; puedes cambiarlo.</p></div>
        <div><label class="text-xs mb-1 block" for="wzTipo">Tipo de proyecto</label><select id="wzTipo" class="inp">${TIPOS.map(t => `<option ${o.tipo_proyecto === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="md:col-span-2"><label class="text-xs mb-1 block" for="wzCliente">Cliente</label>${clienteComboHtml('wzCliente', st.clienteId, o.cliente || '')}</div>
        <div class="md:col-span-2"><label class="text-xs mb-1 block" for="wzUbicacion">Ubicación</label><input id="wzUbicacion" class="inp" value="${S(o.ubicacion || '')}" placeholder="Ej. Plaza Encino, Av. Monteverde s/n, Fracc. Monteverde, Chihuahua"></div>
        <div><label class="text-xs mb-1 block" for="wzInicio">Fecha de inicio *</label><input type="date" id="wzInicio" class="inp" required value="${S((o.fecha_inicio || '').slice(0, 10))}"></div>
        <div><label class="text-xs mb-1 block" for="wzFin">Fecha de entrega *</label><input type="date" id="wzFin" class="inp" required value="${S((o.fecha_fin_estimada || '').slice(0, 10))}"></div>
        <div><label class="text-xs mb-1 block" for="wzResp">Responsable</label><select id="wzResp" class="inp"><option value="">Sin asignar</option>${users.map(u => `<option value="${S(u.nombre)}" ${o.responsable === u.nombre ? 'selected' : ''}>${S(u.nombre)}</option>`).join('')}</select></div>
        <div><label class="text-xs mb-1 block" for="wzEstatus">Estatus</label><select id="wzEstatus" class="inp">${['En Proceso', 'Activa', 'Pausada', 'Completada'].map(e => `<option ${(o.estatus || 'En Proceso') === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      </div>
      <fieldset class="g rounded-xl p-4">
        <legend class="text-sm font-bold px-1">Monto del contrato</legend>
        <div class="grid md:grid-cols-2 gap-4 items-start">
          <div><label class="text-xs mb-1 block" for="wzMonto">Monto tal como viene en la cotización *</label><input type="number" step="0.01" min="0" id="wzMonto" class="inp text-lg" required value="${st.obra ? (st.ivaMode === 'con' ? o.presupuesto_total : obraDesglose().sub) : (st.monto || '')}" placeholder="Ej. 284403.19" oninput="WizardObra.previewIva()"></div>
          <div role="radiogroup" aria-label="El monto es" class="space-y-2">
            <p class="text-xs">El monto es:</p>
            <label class="wz-radio"><input type="radio" name="wzIva" value="sin" ${modeChecked('sin')} onchange="WizardObra.previewIva()"> Sin IVA (se agrega 16 %)</label>
            <label class="wz-radio"><input type="radio" name="wzIva" value="con" ${modeChecked('con')} onchange="WizardObra.previewIva()"> Con IVA incluido</label>
            <label class="wz-radio"><input type="radio" name="wzIva" value="exento" ${modeChecked('exento')} onchange="WizardObra.previewIva()"> Exento o sin IVA (0 %), típico en honorarios</label>
          </div>
        </div>
        <div id="wzIvaPrev" class="wz-preview mt-3"></div>
      </fieldset>
      <div><label class="text-xs mb-1 block" for="wzDesc">Descripción</label><textarea id="wzDesc" class="inp" rows="2" placeholder="Alcance resumido del contrato">${S(o.descripcion || '')}</textarea></div>
      <div class="flex flex-wrap gap-2 justify-end pt-2 border-t border-slate-200">
        <button type="button" class="btn btn-s" onclick="WizardObra.save1(false)">Guardar y salir</button>
        <button type="button" class="btn btn-p" onclick="WizardObra.save1(true)">Guardar y continuar <i class="ri-arrow-right-line" aria-hidden="true"></i></button>
      </div></form>`;
    previewIva();
  }
  function sugCodigo() {
    const cod = document.getElementById('wzCodigo');
    if (!cod || cod.dataset.touched === '1' || st.obraId) return;
    cod.value = sugerirCodigo(document.getElementById('wzNombre').value, document.getElementById('wzCliente')?.value);
    cod.addEventListener('input', () => cod.dataset.touched = '1', { once: true });
  }
  function previewIva() {
    const m = document.querySelector('input[name=wzIva]:checked')?.value || 'sin';
    st.ivaMode = m; st.monto = num(document.getElementById('wzMonto')?.value);
    const d = desglose(st.monto, m);
    const el = document.getElementById('wzIvaPrev');
    if (el) el.innerHTML = `<div><p>Subtotal</p><p>${fmt(d.sub)}</p></div><div><p>IVA ${d.pct} %</p><p>${fmt(d.iva)}</p></div><div><p>Total (se guarda como presupuesto)</p><p class="text-accent">${fmt(d.tot)}</p></div>`;
  }
  async function save1(cont) {
    const f = document.getElementById('wzF1');
    if (!f.reportValidity()) return;
    const cli = resolveClienteCombo('wzCliente');
    const d = desglose(document.getElementById('wzMonto').value, st.ivaMode);
    const ini = document.getElementById('wzInicio').value, fin = document.getElementById('wzFin').value;
    if (fin < ini) { Toast.error('La fecha de entrega debe ser posterior al inicio.'); return; }
    const data = {
      nombre_obra: document.getElementById('wzNombre').value.trim(),
      codigo_obra: document.getElementById('wzCodigo').value.trim() || null,
      estatus: document.getElementById('wzEstatus').value,
      presupuesto_total: d.tot, porcentaje_iva: d.pct, es_zona_frontera: false,
      fecha_inicio: ini, fecha_fin_estimada: fin,
      responsable: document.getElementById('wzResp').value || null,
      ubicacion: document.getElementById('wzUbicacion').value.trim() || null,
      descripcion: document.getElementById('wzDesc').value.trim() || null,
      cliente: document.getElementById('wzCliente').value.trim() || null,
      cliente_id: cli ? cli.id : null,
      tipo_proyecto: document.getElementById('wzTipo').value
    };
    try {
      if (st.obraId) {
        const { error } = await sb.from('obras').update({ ...data, updated_at: new Date().toISOString() }).eq('id', st.obraId);
        if (error) throw error;
      } else {
        const { data: res, error } = await sb.rpc('crear_obra', {
          p_user_id: currentUser?.id, p_codigo_obra: data.codigo_obra, p_nombre_obra: data.nombre_obra,
          p_presupuesto_total: data.presupuesto_total, p_estatus: data.estatus, p_fecha_inicio: data.fecha_inicio,
          p_fecha_fin_estimada: data.fecha_fin_estimada, p_responsable: data.responsable, p_ubicacion: data.ubicacion,
          p_descripcion: data.descripcion, p_cliente: data.cliente, p_porcentaje_iva: data.porcentaje_iva,
          p_es_zona_frontera: false, p_cliente_id: data.cliente_id
        });
        if (error) throw error;
        if (!res?.success) throw new Error(res?.error || 'No se pudo crear la obra');
        st.obraId = res.obra_id;
        await sb.from('obras').update({ tipo_proyecto: data.tipo_proyecto }).eq('id', st.obraId);
      }
      // Refrescar la obra en D sin recargar todo
      const { data: row } = await sb.from('obras').select('*').eq('id', st.obraId).single();
      if (row) { const i = D.o.findIndex(o => o.id === row.id); if (i >= 0) D.o[i] = row; else D.o.unshift(row); st.obra = row; }
      st.clienteId = data.cliente_id;
      Cache.saveAppData(D, currentUser?.empresa_id || 'global');
      if (typeof invalidateFilterCache === 'function') invalidateFilterCache();
      if (typeof populateObraFilter === 'function') populateObraFilter();
      Toast.success(st.editMode ? 'Obra actualizada' : 'Obra creada: ' + (row?.codigo_obra || row?.nombre_obra));
      track('wizard_paso_guardado', { paso: 1 });
      if (cont) goto(2); else { close(); if (typeof R === 'function') R(); }
    } catch (err) { Toast.error(humanizeError(err, 'No se guardó la obra')); }
  }

  // ===== PASO 2 =====
  function partidasDisponibles() {
    const set = new Set(PARTIDAS_DEFAULT);
    st.conceptos.forEach(c => { if (c.partida) set.add(c.partida); });
    (D.cc || []).filter(c => c.obra_id == st.obraId && c.partida).forEach(c => set.add(c.partida));
    return [...set];
  }
  function step2(c) {
    const d = obraDesglose();
    const tot = totalCatalogo();
    const diff = r2(tot - d.sub);
    const header = `<div class="flex flex-wrap items-center gap-3 mb-4 text-sm">
      <span class="px-3 py-1 rounded-full bg-slate-100">Subtotal del contrato: <b>${fmt(d.sub)}</b></span>
      ${st.conceptos.length ? `<span class="px-3 py-1 rounded-full ${Math.abs(diff) > 1 ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}">Catálogo: <b>${fmt(tot)}</b>${Math.abs(diff) > 1 ? ` · difiere ${fmt(diff)} del contrato` : ' · cuadra'}</span>` : ''}
    </div>`;
    if (!st.catMode) {
      c.innerHTML = header + `<div class="grid md:grid-cols-3 gap-3">
        <button type="button" class="g rounded-xl p-5 text-left hover:border-accent" onclick="WizardObra.setCat('archivo')"><i class="ri-file-excel-2-line text-2xl text-ok" aria-hidden="true"></i><p class="font-bold mt-2">Importar archivo</p><p class="text-sm text-ink-muted">XLSX o CSV exportado de OPUS o Excel con clave, descripción, unidad, cantidad y precio unitario.</p></button>
        <button type="button" class="g rounded-xl p-5 text-left hover:border-accent" onclick="WizardObra.setCat('etapas')"><i class="ri-stack-line text-2xl text-accent" aria-hidden="true"></i><p class="font-bold mt-2">Etapas de honorarios</p><p class="text-sm text-ink-muted">Proyecto arquitectónico: 2 a 4 etapas con porcentaje (anteproyecto, ejecutivo, entrega).</p></button>
        <button type="button" class="g rounded-xl p-5 text-left hover:border-accent" onclick="WizardObra.goto(3)"><i class="ri-skip-forward-line text-2xl text-ink-subtle" aria-hidden="true"></i><p class="font-bold mt-2">Omitir por ahora</p><p class="text-sm text-ink-muted">Podrás cargar el catálogo después desde el módulo Presupuesto.</p></button>
      </div>`;
      return;
    }
    if (st.catMode === 'archivo' && !st.conceptos.length) {
      c.innerHTML = header + `<div class="wz-dropzone" id="wzDrop" onclick="document.getElementById('wzFile').click()" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="event.preventDefault();this.classList.remove('over');WizardObra.file(event.dataTransfer.files[0])" tabindex="0" role="button" aria-label="Seleccionar archivo de catálogo" onkeydown="if(event.key==='Enter')document.getElementById('wzFile').click()">
        <input type="file" id="wzFile" class="hidden" accept=".xlsx,.xls,.csv,.txt" onchange="WizardObra.file(this.files[0])">
        <i class="ri-upload-cloud-2-line text-3xl" aria-hidden="true"></i><p class="font-medium mt-2">Arrastra el XLSX o CSV aquí, o haz clic para elegirlo</p>
        <p class="text-xs mt-1">Encabezados reconocidos: Clave, Descripción, Unidad, Cantidad, P.U. (mayúsculas y acentos no importan). Las filas sin cantidad se toman como partidas.</p></div>
        <div class="flex justify-between mt-4"><button type="button" class="btn btn-s" onclick="WizardObra.setCat(null)"><i class="ri-arrow-left-line" aria-hidden="true"></i> Otra opción</button></div>`;
      return;
    }
    if (st.catMode === 'etapas' && !st.conceptos.length) {
      c.innerHTML = header + `<p class="text-sm text-ink-muted mb-3">Define de 2 a 4 etapas. El importe se calcula sobre el subtotal del contrato; la última etapa absorbe los centavos.</p>
        <table class="w-full text-sm mb-3"><thead><tr class="text-left text-ink-subtle"><th class="py-1">Etapa</th><th class="w-24">%</th><th class="text-right">Importe</th><th></th></tr></thead><tbody id="wzEtapas">${st.etapas.map((e, i) => etapaRow(e, i)).join('')}</tbody></table>
        <div class="flex flex-wrap gap-2 items-center">
          ${st.etapas.length < 4 ? `<button type="button" class="btn btn-s" onclick="WizardObra.addEtapa()"><i class="ri-add-line" aria-hidden="true"></i> Agregar etapa</button>` : ''}
          <span id="wzEtapasSum" class="text-sm ml-auto"></span>
        </div>
        <div class="flex justify-between mt-4"><button type="button" class="btn btn-s" onclick="WizardObra.setCat(null)"><i class="ri-arrow-left-line" aria-hidden="true"></i> Otra opción</button><button type="button" class="btn btn-p" onclick="WizardObra.etapasToConceptos()">Generar conceptos <i class="ri-arrow-right-line" aria-hidden="true"></i></button></div>`;
      updEtapas();
      return;
    }
    // Vista previa editable
    const partidas = partidasDisponibles();
    const groups = {};
    st.conceptos.forEach((x, i) => { const k = x.partida || 'Sin partida'; (groups[k] = groups[k] || []).push(i); });
    const optsP = p => `<option value="">Sin partida</option>` + partidas.map(x => `<option ${x === p ? 'selected' : ''}>${S(x)}</option>`).join('');
    c.innerHTML = header + `<div class="table-wrap g rounded-xl mb-3" style="max-height:52vh;overflow:auto">
      <table class="w-full text-xs"><thead class="sticky top-0 bg-slate-50"><tr class="text-left text-ink-subtle"><th class="p-2">Clave</th><th class="p-2">Descripción</th><th class="p-2">Unidad</th><th class="p-2 text-right">Cantidad</th><th class="p-2 text-right">P.U.</th><th class="p-2 text-right">Importe</th><th class="p-2">Partida</th><th class="p-2"></th></tr></thead>
      <tbody>${Object.entries(groups).map(([g, idxs]) => `<tr class="bg-slate-100"><td colspan="5" class="p-2 font-bold">${S(g)}</td><td class="p-2 text-right font-bold">${fmt(idxs.reduce((s, i) => s + st.conceptos[i].cantidad * st.conceptos[i].pu, 0))}</td><td colspan="2"></td></tr>` + idxs.map(i => { const x = st.conceptos[i]; return `<tr>
        <td class="p-1"><input class="inp py-1 px-2 min-h-0 font-mono w-24" value="${S(x.clave)}" oninput="WizardObra.cc(${i},'clave',this.value)" aria-label="Clave"></td>
        <td class="p-1"><input class="inp py-1 px-2 min-h-0 w-full" style="min-width:220px" value="${S(x.descripcion)}" oninput="WizardObra.cc(${i},'descripcion',this.value)" aria-label="Descripción"></td>
        <td class="p-1"><input class="inp py-1 px-2 min-h-0 w-16" value="${S(x.unidad)}" oninput="WizardObra.cc(${i},'unidad',this.value)" aria-label="Unidad"></td>
        <td class="p-1"><input type="number" step="0.01" class="inp py-1 px-2 min-h-0 w-20 text-right" value="${x.cantidad}" oninput="WizardObra.cc(${i},'cantidad',this.value)" aria-label="Cantidad"></td>
        <td class="p-1"><input type="number" step="0.01" class="inp py-1 px-2 min-h-0 w-24 text-right" value="${x.pu}" oninput="WizardObra.cc(${i},'pu',this.value)" aria-label="Precio unitario"></td>
        <td class="p-2 text-right font-medium" id="wzImp${i}">${fmt(x.cantidad * x.pu)}</td>
        <td class="p-1"><select class="inp py-1 px-2 min-h-0" onchange="WizardObra.cc(${i},'partida',this.value);WizardObra.render()" aria-label="Partida">${optsP(x.partida)}</select></td>
        <td class="p-1"><button type="button" class="btn-icon" style="width:32px;height:32px" onclick="WizardObra.delC(${i})" aria-label="Quitar concepto"><i class="ri-delete-bin-line" aria-hidden="true"></i></button></td></tr>`; }).join('')).join('')}</tbody></table></div>
      <div class="flex flex-wrap gap-2 items-center mb-4">
        <button type="button" class="btn btn-s" onclick="WizardObra.addC()"><i class="ri-add-line" aria-hidden="true"></i> Agregar concepto</button>
        ${st.conceptos.some(x => x.pu < 0) ? '' : `<button type="button" class="btn btn-s" onclick="WizardObra.addDescuento()"><i class="ri-subtract-line" aria-hidden="true"></i> Descuento contractual</button>`}
        ${st.catMode !== 'existente' ? `<button type="button" class="btn btn-s" onclick="WizardObra.resetCat()">Volver a cargar</button>` : ''}
        <span class="ml-auto text-sm">Total catálogo: <b id="wzTot">${fmt(tot)}</b> <span id="wzDiff" class="${Math.abs(diff) > 1 ? 'text-amber-700' : 'text-ok'}">${Math.abs(diff) > 1 ? `(difiere ${fmt(diff)} del subtotal ${fmt(d.sub)})` : '(cuadra con el contrato)'}</span></span>
      </div>
      <div class="flex flex-wrap justify-between gap-2 pt-2 border-t border-slate-200">
        <button type="button" class="btn btn-s" onclick="WizardObra.goto(1)"><i class="ri-arrow-left-line" aria-hidden="true"></i> Datos</button>
        <div class="flex gap-2"><button type="button" class="btn btn-s" onclick="WizardObra.goto(3)">Continuar sin guardar</button><button type="button" class="btn btn-p" onclick="WizardObra.save2()"><i class="ri-save-line" aria-hidden="true"></i> Guardar catálogo y continuar</button></div>
      </div>`;
  }
  function etapaRow(e, i) {
    const d = obraDesglose();
    return `<tr><td class="py-1 pr-2"><input class="inp py-1 min-h-0" value="${S(e.n)}" oninput="WizardObra.et(${i},'n',this.value)" aria-label="Nombre de etapa"></td><td class="py-1 pr-2"><input type="number" step="0.01" min="0" max="100" class="inp py-1 min-h-0 w-20" value="${e.p}" oninput="WizardObra.et(${i},'p',this.value)" aria-label="Porcentaje"></td><td class="py-1 text-right" id="wzEtImp${i}">${fmt(d.sub * e.p / 100)}</td><td class="py-1 text-right">${st.etapas.length > 2 ? `<button type="button" class="btn-icon" style="width:32px;height:32px" onclick="WizardObra.delEtapa(${i})" aria-label="Quitar etapa"><i class="ri-close-line" aria-hidden="true"></i></button>` : ''}</td></tr>`;
  }
  function et(i, k, v) { st.etapas[i][k] = k === 'p' ? num(v) : v; const d = obraDesglose(); const el = document.getElementById('wzEtImp' + i); if (el) el.textContent = fmt(d.sub * st.etapas[i].p / 100); updEtapas(); }
  function updEtapas() { const s = r2(st.etapas.reduce((a, e) => a + e.p, 0)); const el = document.getElementById('wzEtapasSum'); if (el) el.innerHTML = `Suma: <b class="${Math.abs(s - 100) < 0.01 ? 'text-ok' : 'text-danger'}">${s} %</b>${Math.abs(s - 100) < 0.01 ? '' : ' (debe ser 100 %)'}`; }
  function addEtapa() { if (st.etapas.length >= 4) return; st.etapas.push({ n: 'Etapa ' + 'ABCD'[st.etapas.length], p: 0 }); render(); }
  function delEtapa(i) { st.etapas.splice(i, 1); render(); }
  function etapasToConceptos() {
    const s = r2(st.etapas.reduce((a, e) => a + e.p, 0));
    if (Math.abs(s - 100) > 0.01) { Toast.error('Los porcentajes deben sumar 100 %.'); return; }
    const d = obraDesglose(); let acum = 0;
    st.conceptos = st.etapas.map((e, i) => {
      let imp = r2(d.sub * e.p / 100); if (i === st.etapas.length - 1) imp = r2(d.sub - acum); acum += imp;
      return { clave: 'ETAPA-' + 'ABCD'[i], descripcion: e.n, unidad: 'lote', cantidad: 1, pu: imp, partida: 'Otros', categoria: 'HONORARIOS' };
    });
    render();
  }
  function setCat(m) { st.catMode = m; if (m !== 'existente') st.conceptos = []; render(); }
  function resetCat() { st.conceptos = []; render(); }
  function cc(i, k, v) { st.conceptos[i][k] = (k === 'cantidad' || k === 'pu') ? num(v) : v; const x = st.conceptos[i]; const el = document.getElementById('wzImp' + i); if (el) el.textContent = fmt(x.cantidad * x.pu); const t = totalCatalogo(); const d = obraDesglose(); const diff = r2(t - d.sub); const tt = document.getElementById('wzTot'); if (tt) tt.textContent = fmt(t); const df = document.getElementById('wzDiff'); if (df) { df.className = Math.abs(diff) > 1 ? 'text-amber-700' : 'text-ok'; df.textContent = Math.abs(diff) > 1 ? `(difiere ${fmt(diff)} del subtotal ${fmt(d.sub)})` : '(cuadra con el contrato)'; } }
  function addC() { st.conceptos.push({ clave: 'C' + String(st.conceptos.length + 1).padStart(3, '0'), descripcion: '', unidad: 'pza', cantidad: 1, pu: 0, partida: st.conceptos[st.conceptos.length - 1]?.partida || '' }); render(); }
  function delC(i) { st.conceptos.splice(i, 1); render(); }
  function addDescuento() { const d = obraDesglose(); const diff = r2(totalCatalogo() - d.sub); st.conceptos.push({ clave: 'DESC-01', descripcion: 'Descuento contractual', unidad: 'lote', cantidad: 1, pu: diff > 0 ? -diff : 0, partida: 'Otros', categoria: 'DESCUENTO' }); render(); }

  // Lectura de XLSX/CSV con SheetJS
  function file(f) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: false, codepage: 65001 });
        let best = null;
        wb.SheetNames.forEach(n => { const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }); const parsed = parseRows(rows); if (parsed && (!best || parsed.length > best.length)) best = parsed; });
        if (!best || !best.length) { Toast.error('No se reconocieron conceptos. Verifica que el archivo tenga columnas Clave, Descripción, Unidad, Cantidad y P.U.'); return; }
        st.conceptos = best;
        Toast.success(`${best.length} conceptos leídos de ${f.name}`);
        track('wizard_catalogo_importado', { filas: best.length });
        render();
      } catch (err) { console.error(err); Toast.error('No se pudo leer el archivo. Guarda el catálogo como XLSX o CSV e intenta de nuevo.'); }
    };
    reader.readAsArrayBuffer(f);
  }
  function parseRows(rows) {
    const H = { clave: /^(clave|c[oó]digo|code|no\.?|num|key)/, descripcion: /(descrip|concepto|nombre|partida y concepto)/, unidad: /^(unidad|unid|u\.?m?\.?|unit)/, cantidad: /^(cant|qty|volumen)/, pu: /(p\.?\s*u\.?|precio|unitario|costo unit|pu$)/, importe: /(importe|total|monto)/, partida: /^(partida|cap[ií]tulo|grupo)/ };
    let hi = -1, map = {};
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const m = {}; rows[i].forEach((cell, j) => { const t = norm(cell); if (!t) return; for (const k in H) { if (!(k in m) && H[k].test(t)) { m[k] = j; break; } } });
      if ('descripcion' in m && (('cantidad' in m && 'pu' in m) || 'importe' in m)) { hi = i; map = m; break; }
    }
    if (hi < 0) {
      // Sin encabezado: heurística por posición (clave, descripción, unidad, cantidad, pu)
      const sample = rows.find(r => r.filter(x => String(x).trim()).length >= 4); if (!sample) return null;
      map = { clave: 0, descripcion: 1, unidad: 2, cantidad: 3, pu: 4 }; hi = -1;
    }
    const out = []; let partida = ''; const partidaByPrefix = {};
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i]; const get = k => (k in map) ? String(r[map[k]] ?? '').trim() : '';
      const clave = get('clave'), desc = get('descripcion'), uni = get('unidad');
      const cant = num(get('cantidad')), pu = num(get('pu')), imp = num(get('importe'));
      if (!clave && !desc) continue;
      if (/^(subtotal|total|suma|iva|gran total)/i.test(norm(desc)) || /^(subtotal|total)/i.test(norm(clave))) continue;
      const esPartida = (!cant && !pu && !imp) || (!uni && !cant && desc && !pu);
      if (esPartida) { partida = (clave ? clave + ' ' : '') + desc; partida = partida.trim(); const pre = clave.match(/^(\d{1,2}-[A-Z]{2,4})/); if (pre) partidaByPrefix[pre[1]] = partida; continue; }
      let part = get('partida') || partida;
      if (!part) { const pre = clave.match(/^(\d{1,2}-[A-Z]{2,4})/); if (pre) part = partidaByPrefix[pre[1]] || pre[1]; }
      const precio = pu || (cant ? r2(imp / cant) : imp);
      out.push({ clave: clave || 'C' + String(out.length + 1).padStart(3, '0'), descripcion: desc || 'Sin descripción', unidad: uni || 'pza', cantidad: cant || (imp && !pu ? 1 : 0), pu: precio, partida: mapPartida(part), categoria: part || '' });
    }
    return out;
  }
  // Partida del archivo → partida canónica de la app (se conserva la original en categoria)
  function mapPartida(p) {
    const t = norm(p);
    if (!t) return '';
    const rules = [[/prelim|demol|desmont/, 'Preliminares'], [/ciment|zapata|losa de cim/, 'Cimentación'], [/estruct|acero|concreto|columna|trabe/, 'Estructura'], [/alba|muro|tablaroca|plafon|plafón|block/, 'Albañilería'], [/hidr[aá]ul|agua/, 'Instalación Hidráulica'], [/sanit|drenaje/, 'Instalación Sanitaria'], [/el[eé]ctr|ilumin|luminar|contacto|canaliz/, 'Instalación Eléctrica'], [/acab|piso|azulejo|recubr|yeso|pasta|texturiz|tapiz/, 'Acabados'], [/carpint|madera|mobiliario|muebl/, 'Carpintería'], [/herrer|metal|estructura met|se[ñn]al|letrero|r[oó]tulo/, 'Herrería'], [/cancel|aluminio|vidrio|cristal/, 'Cancelería'], [/pintura|pint/, 'Pintura'], [/limpieza|retiro|acarreo/, 'Limpieza']];
    for (const [re, name] of rules) if (re.test(t)) return name;
    return p.length <= 40 ? p : 'Otros';
  }
  async function save2() {
    if (!st.obraId) { Toast.error('Primero guarda los datos de la obra.'); return; }
    const bad = st.conceptos.find(x => !x.descripcion.trim());
    if (bad) { Toast.error('Hay conceptos sin descripción.'); return; }
    const d = obraDesglose(); const diff = r2(totalCatalogo() - d.sub);
    if (Math.abs(diff) > 1 && !(await Dialog.confirm({ title: 'El catálogo no cuadra con el contrato', body: `El catálogo suma ${fmt(totalCatalogo())} y el subtotal del contrato es ${fmt(d.sub)} (diferencia ${fmt(diff)}). Puedes agregar una fila de descuento contractual o continuar así.`, confirmText: 'Guardar de todos modos' }))) return;
    try {
      const existentes = (D.cc || []).filter(c => c.obra_id == st.obraId);
      if (existentes.length && st.catMode !== 'existente') {
        if (!(await Dialog.confirm({ title: 'Reemplazar catálogo', body: `La obra ya tiene ${existentes.length} conceptos. Se eliminarán y se cargarán los ${st.conceptos.length} nuevos.`, confirmText: 'Reemplazar catálogo', tone: 'danger' }))) return;
        const { error: e0 } = await sb.from('catalogo_conceptos').delete().eq('obra_id', st.obraId); if (e0) throw e0;
      }
      if (st.catMode === 'existente') {
        // Actualiza en sitio (upsert por id) y crea los nuevos
        const upd = st.conceptos.filter(x => x.id), nue = st.conceptos.filter(x => !x.id);
        for (const x of upd) { const { error } = await sb.from('catalogo_conceptos').update({ clave: x.clave, descripcion: x.descripcion, unidad: x.unidad, cantidad: x.cantidad, precio_unitario: x.pu, partida: x.partida || null, categoria: x.categoria || null }).eq('id', x.id); if (error) throw error; }
        const borrados = existentes.filter(e => !upd.some(u => u.id === e.id)).map(e => e.id);
        if (borrados.length) { const { error } = await sb.from('catalogo_conceptos').delete().in('id', borrados); if (error) throw error; }
        if (nue.length) { const { error } = await sb.from('catalogo_conceptos').insert(nue.map((x, i) => rowConcepto(x, upd.length + i + 1))); if (error) throw error; }
      } else {
        const rows = st.conceptos.map((x, i) => rowConcepto(x, i + 1));
        for (let i = 0; i < rows.length; i += 200) { const { error } = await sb.from('catalogo_conceptos').insert(rows.slice(i, i + 200)); if (error) throw error; }
      }
      const { data: cc } = await sb.from('catalogo_conceptos').select('*').eq('obra_id', st.obraId).order('orden');
      D.cc = (D.cc || []).filter(c => c.obra_id != st.obraId).concat(cc || []);
      st.conceptos = (cc || []).map(c => ({ id: c.id, clave: c.clave, descripcion: c.descripcion, unidad: c.unidad, cantidad: +c.cantidad || 0, pu: +c.precio_unitario || 0, partida: c.partida || '', categoria: c.categoria || '' }));
      st.catMode = 'existente'; st.catSaved = true;
      Cache.saveAppData(D, currentUser?.empresa_id || 'global');
      Toast.success(`Catálogo guardado: ${st.conceptos.length} conceptos`);
      track('wizard_paso_guardado', { paso: 2, conceptos: st.conceptos.length });
      goto(3);
    } catch (err) { Toast.error(humanizeError(err, 'No se guardó el catálogo')); }
  }
  function rowConcepto(x, orden) { return { obra_id: st.obraId, empresa_id: currentUser?.empresa_id || null, clave: x.clave, descripcion: x.descripcion, unidad: x.unidad || 'pza', cantidad: x.cantidad, precio_unitario: x.pu, partida: x.partida || null, categoria: x.categoria || null, orden }; }

  // ===== PASO 3 =====
  function weekList(start, end, startDow) {
    const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00');
    const d = new Date(s); d.setDate(d.getDate() - ((d.getDay() - startDow + 7) % 7));
    const out = []; let n = 1;
    while (d <= e && out.length < 120) { const ws = new Date(d), we = new Date(d); we.setDate(we.getDate() + 6); out.push({ n: n++, start: iso(ws < s ? s : ws), end: iso(we > e ? e : we), ws: iso(ws), we: iso(we) }); d.setDate(d.getDate() + 7); }
    // Un residuo de 1 o 2 días al final se absorbe en la última semana (como en los contratos: "S9 23 a 30 de octubre")
    if (out.length >= 2) { const last = out[out.length - 1]; const dias = (new Date(last.end + 'T00:00:00') - new Date(last.start + 'T00:00:00')) / 86400000 + 1; if (dias <= 2) { out.pop(); out[out.length - 1].end = last.end; out[out.length - 1].we = last.end; } }
    return out;
  }
  function initRows() {
    if (st.rows.length) return;
    st.rows = st.conceptos.filter(x => x.cantidad * x.pu > 0).map(x => ({ key: x.id || x.clave, clave: x.clave, nombre: x.descripcion, partida: x.partida || 'Sin partida', importe: r2(x.cantidad * x.pu), conceptoId: x.id || null, weeks: {}, manual: false }));
    // Si la obra ya tiene programa, se precargan las semanas y los hitos existentes para editarlos
    const pg = (D.pg || []).find(p => p.obra_id == st.obraId);
    if (pg && typeof pesoPorSemana === 'function') {
      const weeks = weekList(st.obra.fecha_inicio, st.obra.fecha_fin_estimada, st.startDow);
      (D.ap || []).filter(a => a.programa_id === pg.id).forEach(a => {
        if (a.es_hito) { if (!/^Pago: /.test(a.nombre || '')) st.hitos.push({ nombre: a.nombre, fecha: a.fecha_inicio, resp: /cliente|terceros/i.test(a.responsable || '') ? a.responsable : 'Nosotros' }); return; }
        const row = st.rows.find(r => (a.concepto_id && r.conceptoId === a.concepto_id) || (a.wbs && r.clave === a.wbs));
        if (!row) return;
        const d = pesoPorSemana(a, weeks);
        Object.keys(d).forEach(k => { if (d[k] > 0) row.weeks[k] = r2(d[k]); });
        row.manual = Object.keys(row.weeks).length > 0;
      });
    }
  }
  function step3(c) {
    const o = st.obra;
    if (!o?.fecha_inicio || !o?.fecha_fin_estimada) { c.innerHTML = EmptyState({ icon: 'ri-calendar-line', title: 'Faltan las fechas de la obra', body: 'El programa se arma por semanas entre la fecha de inicio y la de entrega.', action: { label: 'Capturar fechas', onClick: 'WizardObra.goto(1)' } }); return; }
    if (!st.rows.length && !st.hitos.length && st.startDow === 1) st.startDow = new Date(o.fecha_inicio + 'T00:00:00').getDay();
    if (!st.conceptos.length) { c.innerHTML = EmptyState({ icon: 'ri-file-list-3-line', title: 'Sin catálogo no hay programa', body: 'Carga el catálogo (o etapas) en el paso 2 para marcar semanas por concepto. También puedes saltar al plan de pagos.', action: { label: 'Ir al catálogo', onClick: 'WizardObra.goto(2)' }, secondary: { label: 'Ir al plan de pagos', onClick: 'WizardObra.goto(4)' } }); return; }
    initRows();
    const weeks = weekList(o.fecha_inicio, o.fecha_fin_estimada, st.startDow);
    const today = iso(new Date());
    const existente = st.progSaved && st.programaId;
    const groups = {}; st.rows.forEach((r, i) => (groups[r.partida] = groups[r.partida] || []).push(i));
    const totalBruto = st.rows.reduce((s, r) => s + r.importe, 0);
    const cell = (i, w) => { const r = st.rows[i]; const v = r.weeks[w.n]; const on = v != null; const now = today >= w.ws && today <= w.we ? ' now' : ''; return `<td class="cell${on ? ' on' : ''}${now}" data-r="${i}" data-w="${w.n}" role="gridcell" aria-selected="${on}" tabindex="-1" onmousedown="WizardObra.md(event,${i},${w.n})" onmouseenter="WizardObra.me(${i},${w.n})">${on ? (st.editPct ? `<input type="number" min="0" max="100" class="inp real" style="width:52px" value="${r2(v)}" onmousedown="event.stopPropagation()" onchange="WizardObra.setPct(${i},${w.n},this.value)" aria-label="Porcentaje semana ${w.n}">` : r2(v) + '%') : ''}</td>`; };
    c.innerHTML = `
      ${existente ? `<div class="p-3 rounded-lg bg-amber-50 text-amber-800 text-sm mb-3"><i class="ri-information-line" aria-hidden="true"></i> Esta obra ya tiene un programa. Guardar aquí lo reemplazará por el programa contractual que definas abajo.</div>` : ''}
      <div class="flex flex-wrap items-center gap-3 mb-3 text-sm">
        <label class="flex items-center gap-2">Semana inicia en <select class="inp py-1 min-h-0 w-auto" onchange="WizardObra.setDow(this.value)" aria-label="Día de inicio de semana">${['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'].map((d, i) => `<option value="${i}" ${i === st.startDow ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <span class="text-ink-subtle">${weeks.length} semanas · ${dmy(o.fecha_inicio)} a ${dmy(o.fecha_fin_estimada)}</span>
        <label class="flex items-center gap-2 ml-auto"><input type="checkbox" ${st.editPct ? 'checked' : ''} onchange="WizardObra.toggleEditPct(this.checked)"> Editar porcentajes</label>
        <button type="button" class="btn btn-s" onclick="WizardObra.addHito()"><i class="ri-flag-line" aria-hidden="true"></i> Agregar hito</button>
      </div>
      <p class="text-xs text-ink-subtle mb-2">Haz clic o arrastra sobre las semanas en que se ejecuta cada concepto. El porcentaje se reparte uniforme; activa "Editar porcentajes" para ajustarlo.</p>
      <div class="wk-wrap g rounded-xl" style="max-height:50vh;overflow:auto" onmouseup="WizardObra.mu()" onmouseleave="WizardObra.mu()">
      <table class="wk" role="grid" aria-label="Programa por semanas"><thead><tr><th class="lbl" style="left:0;z-index:2">Concepto</th><th class="text-right">Importe</th><th>Peso</th>${weeks.map(w => `<th class="${today >= w.ws && today <= w.we ? 'now' : ''}" title="${w.start} a ${w.end}">S${w.n}<br><span class="font-normal">${dmy(w.start)}</span></th>`).join('')}</tr></thead>
      <tbody>${Object.entries(groups).map(([g, idxs]) => `<tr><td class="part" colspan="${3 + weeks.length}">${S(g)}</td></tr>` + idxs.map(i => { const r = st.rows[i]; const sum = r2(Object.values(r.weeks).reduce((a, b) => a + b, 0)); return `<tr><td class="lbl" title="${S(r.nombre)}"><span class="font-mono text-ink-subtle">${S(r.clave)}</span> ${S(r.nombre)}${Object.keys(r.weeks).length && Math.abs(sum - 100) > 0.5 ? ` <span class="text-danger" title="Suma ${sum}%">${sum}%</span>` : ''}</td><td class="text-right">${fmt(r.importe)}</td><td class="text-center text-ink-subtle">${totalBruto ? r2(r.importe / totalBruto * 100) : 0}%</td>${weeks.map(w => cell(i, w)).join('')}</tr>`; }).join('')).join('')}
      ${st.hitos.length ? `<tr><td class="part" colspan="${3 + weeks.length}">Hitos</td></tr>` + st.hitos.map((h, i) => `<tr><td class="lbl"><div class="flex gap-1 items-center"><input class="inp py-1 px-2 min-h-0" style="width:150px" value="${S(h.nombre)}" oninput="WizardObra.hito(${i},'nombre',this.value)" aria-label="Nombre del hito"><input type="date" class="inp py-1 px-2 min-h-0" style="width:135px" value="${h.fecha}" min="${o.fecha_inicio}" max="${o.fecha_fin_estimada}" onchange="WizardObra.hito(${i},'fecha',this.value);WizardObra.render()" aria-label="Fecha del hito"><select class="inp py-1 px-2 min-h-0" style="width:110px" onchange="WizardObra.hito(${i},'resp',this.value);WizardObra.render()" aria-label="Responsable"><option ${h.resp === 'Nosotros' ? 'selected' : ''}>Nosotros</option><option ${h.resp === 'Cliente' ? 'selected' : ''}>Cliente</option><option ${h.resp === 'Terceros' ? 'selected' : ''}>Terceros</option></select><button type="button" class="btn-icon" style="width:28px;height:28px" onclick="WizardObra.delHito(${i})" aria-label="Quitar hito"><i class="ri-close-line" aria-hidden="true"></i></button></div></td><td></td><td></td>${weeks.map(w => `<td class="cell ${h.fecha >= w.ws && h.fecha <= w.we ? 'hito' : ''}${h.resp !== 'Nosotros' && h.fecha >= w.ws && h.fecha <= w.we ? ' on ext' : ''}">${h.fecha >= w.ws && h.fecha <= w.we ? '◆' : ''}</td>`).join('')}</tr>`).join('') : ''}
      </tbody></table></div>
      <div class="flex flex-wrap justify-between gap-2 pt-3 mt-3 border-t border-slate-200">
        <button type="button" class="btn btn-s" onclick="WizardObra.goto(2)"><i class="ri-arrow-left-line" aria-hidden="true"></i> Catálogo</button>
        <div class="flex gap-2"><button type="button" class="btn btn-s" onclick="WizardObra.goto(4)">Continuar sin guardar</button><button type="button" class="btn btn-p" onclick="WizardObra.save3()"><i class="ri-save-line" aria-hidden="true"></i> Guardar programa y continuar</button></div>
      </div>`;
  }
  let drag = null;
  function md(ev, i, w) { ev.preventDefault(); const r = st.rows[i]; const on = r.weeks[w] != null; drag = { i, on: !on }; toggle(i, w, !on); }
  function me(i, w) { if (!drag || drag.i !== i) return; toggle(i, w, drag.on); }
  function mu() { drag = null; }
  function toggle(i, w, on) {
    const r = st.rows[i];
    if (on) { if (r.weeks[w] == null) r.weeks[w] = 0; } else delete r.weeks[w];
    if (!r.manual) { const ks = Object.keys(r.weeks); ks.forEach((k, idx) => { r.weeks[k] = r2(100 / ks.length); }); if (ks.length) { const s = ks.reduce((a, k) => a + r.weeks[k], 0); r.weeks[ks[ks.length - 1]] = r2(r.weeks[ks[ks.length - 1]] + 100 - s); } }
    // repintar sólo la fila
    const tr = document.querySelector(`td[data-r="${i}"]`)?.closest('tr'); if (tr) { tr.querySelectorAll('td.cell').forEach(td => { const wn = +td.dataset.w; const v = r.weeks[wn]; td.classList.toggle('on', v != null); td.setAttribute('aria-selected', v != null); td.innerHTML = v != null ? (st.editPct ? `<input type="number" min="0" max="100" class="inp real" style="width:52px" value="${r2(v)}" onmousedown="event.stopPropagation()" onchange="WizardObra.setPct(${i},${wn},this.value)" aria-label="Porcentaje semana ${wn}">` : r2(v) + '%') : ''; }); }
  }
  function setPct(i, w, v) { const r = st.rows[i]; r.manual = true; r.weeks[w] = num(v); render(); }
  function toggleEditPct(v) { st.editPct = v; render(); }
  function setDow(v) { st.startDow = +v; st.rows.forEach(r => { r.weeks = {}; r.manual = false; }); render(); }
  function addHito() { st.hitos.push({ nombre: 'Entrega al cliente', fecha: st.obra.fecha_fin_estimada, resp: 'Nosotros' }); render(); }
  function hito(i, k, v) { st.hitos[i][k] = v; }
  function delHito(i) { st.hitos.splice(i, 1); render(); }
  async function save3() {
    const o = st.obra; const weeks = weekList(o.fecha_inicio, o.fecha_fin_estimada, st.startDow);
    const rows = st.rows.filter(r => Object.keys(r.weeks).length);
    if (!rows.length && !st.hitos.length) { Toast.error('Marca al menos una semana en algún concepto o agrega un hito.'); return; }
    const totalBruto = st.rows.reduce((s, r) => s + r.importe, 0);
    try {
      // Reemplazar programa contractual previo si existe
      const prev = (D.pg || []).filter(p => p.obra_id == st.obraId);
      if (prev.length && !(await Dialog.confirm({ title: 'Reemplazar programa', body: `La obra tiene ${prev.length} programa(s) con ${(D.ap || []).filter(a => prev.some(p => p.id === a.programa_id)).length} actividades. Se eliminarán y se creará el programa contractual con ${rows.length} conceptos y ${st.hitos.length} hitos.`, confirmText: 'Reemplazar programa', tone: 'danger' }))) return;
      for (const p of prev) { await sb.from('actividades_programa').delete().eq('programa_id', p.id); const { error } = await sb.from('programas_obra').delete().eq('id', p.id); if (error) throw error; }
      const { data: pg, error: e1 } = await sb.from('programas_obra').insert({ obra_id: st.obraId, empresa_id: currentUser?.empresa_id || null, nombre: 'Programa contractual', descripcion: `Semanas de ${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][st.startDow]} a ${['sábado', 'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes'][st.startDow]}`, fecha_inicio: o.fecha_inicio, fecha_fin: o.fecha_fin_estimada, estatus: 'Activo', version: 1, created_by: currentUser?.nombre || 'Sistema' }).select().single();
      if (e1) throw e1;
      st.programaId = pg.id;
      let orden = 1; const acts = [];
      const colores = ['#0369a1', '#047857', '#b45309', '#9333ea', '#2563eb', '#be185d', '#4338ca', '#0f766e'];
      const partidasIdx = {}; let pi = 0;
      for (const r of rows) {
        const ws = Object.keys(r.weeks).map(Number).sort((a, b) => a - b);
        const w0 = weeks.find(w => w.n === ws[0]), w1 = weeks.find(w => w.n === ws[ws.length - 1]);
        if (!(r.partida in partidasIdx)) partidasIdx[r.partida] = pi++;
        acts.push({ programa_id: pg.id, concepto_id: r.conceptoId, nombre: String(r.nombre).slice(0, 200), wbs: r.clave, fecha_inicio: w0.start, fecha_fin: w1.end, porcentaje_avance: 0, peso_porcentual: totalBruto ? r2(r.importe / totalBruto * 100) : 0, costo_planeado: r.importe, estatus: 'Pendiente', color: colores[partidasIdx[r.partida] % colores.length], es_hito: false, orden: orden++, notas: ws.map(n => `S${n} ${r2(r.weeks[n])} %`).join(' · '), responsable: null });
      }
      for (const h of st.hitos) acts.push({ programa_id: pg.id, nombre: h.nombre, fecha_inicio: h.fecha, fecha_fin: h.fecha, porcentaje_avance: 0, peso_porcentual: 0, costo_planeado: 0, estatus: 'Pendiente', color: h.resp === 'Nosotros' ? '#b45309' : '#b45309', es_hito: true, orden: orden++, responsable: h.resp === 'Nosotros' ? null : h.resp, notas: null });
      // ajustar pesos a 100
      const sumPeso = r2(acts.reduce((s, a) => s + a.peso_porcentual, 0)); if (sumPeso && Math.abs(sumPeso - 100) > 0.001) { const last = acts.filter(a => !a.es_hito).pop(); if (last) last.peso_porcentual = r2(last.peso_porcentual + 100 - sumPeso); }
      for (let i = 0; i < acts.length; i += 200) { const { error } = await sb.from('actividades_programa').insert(acts.slice(i, i + 200)); if (error) throw error; }
      const { data: ap } = await sb.from('actividades_programa').select('*').eq('programa_id', pg.id).order('orden');
      D.pg = (D.pg || []).filter(p => p.obra_id != st.obraId).concat([pg]);
      D.ap = (D.ap || []).filter(a => !prev.some(p => p.id === a.programa_id)).concat(ap || []);
      st.progSaved = true;
      Cache.saveAppData(D, currentUser?.empresa_id || 'global');
      Toast.success(`Programa guardado: ${rows.length} conceptos y ${st.hitos.length} hitos en ${weeks.length} semanas`);
      track('wizard_paso_guardado', { paso: 3, actividades: acts.length });
      goto(4);
    } catch (err) { Toast.error(humanizeError(err, 'No se guardó el programa')); }
  }

  // ===== PASO 4 =====
  function initPagos(tpl) {
    const o = st.obra; const tot = +o.presupuesto_total || 0;
    const t = PLANTILLAS_PAGO[tpl] || PLANTILLAS_PAGO['30-30-20-20'];
    let acum = 0;
    st.pagos = t.map((x, i) => {
      let monto = r2(tot * x.p / 100); if (i === t.length - 1) monto = r2(tot - acum); acum += monto;
      const fecha = i === 0 ? o.fecha_inicio : (i === t.length - 1 ? o.fecha_fin_estimada : midDate(o.fecha_inicio, o.fecha_fin_estimada, i / (t.length - 1)));
      return { nombre: `${ORD[i]} pago · ${x.n} ${x.p} %`, pct: x.p, monto, fecha, cond: i === 0 ? 'A la firma del contrato' : (i === t.length - 1 ? 'Contra entrega / acta de recepción' : 'Según avance de obra') };
    });
  }
  function midDate(a, b, f) { const da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00'); return iso(new Date(da.getTime() + (db - da) * f)); }
  function step4(c) {
    const o = st.obra; const tot = +o.presupuesto_total || 0;
    const existentes = (D.cxc || []).filter(x => x.obra_id == st.obraId).sort((a, b) => String(a.fecha_vencimiento).localeCompare(String(b.fecha_vencimiento)));
    if (!st.pagos.length && !existentes.length) initPagos('30-30-20-20');
    const sum = r2(st.pagos.reduce((s, p) => s + p.monto, 0));
    const ok = Math.abs(sum - tot) <= 0.01;
    c.innerHTML = `
      ${existentes.length ? `<div class="g rounded-xl p-3 mb-4"><p class="text-sm font-bold mb-2">Exhibiciones ya registradas (${existentes.length})</p>${existentes.map(x => `<div class="flex justify-between text-sm py-1 border-t border-slate-100"><span>${S(x.concepto || x.numero_factura || 'CxC')} · vence ${dmy(x.fecha_vencimiento)}</span><span>${fmt(x.monto_total)} <span class="text-ink-subtle">(${S(x.estatus)})</span></span></div>`).join('')}<p class="text-xs text-ink-subtle mt-2">Las filas de abajo se agregarán como exhibiciones nuevas.</p></div>` : ''}
      <div class="flex flex-wrap items-center gap-2 mb-3 text-sm">
        <span>Plantilla:</span>
        ${Object.keys(PLANTILLAS_PAGO).map(k => `<button type="button" class="btn btn-s py-1" onclick="WizardObra.tpl('${k}')">${k === '100' ? 'Pago único' : k}</button>`).join('')}
        <button type="button" class="btn btn-s py-1" onclick="WizardObra.addPago()"><i class="ri-add-line" aria-hidden="true"></i> Personalizado</button>
        <span class="ml-auto">Total del contrato: <b>${fmt(tot)}</b></span>
      </div>
      <div class="table-wrap g rounded-xl mb-3"><table class="w-full text-sm"><thead><tr class="text-left text-ink-subtle"><th class="p-2">Exhibición</th><th class="p-2 w-20">%</th><th class="p-2 text-right">Monto</th><th class="p-2">Fecha límite</th><th class="p-2">Condición</th><th></th></tr></thead>
      <tbody>${st.pagos.map((p, i) => `<tr class="border-t border-slate-100">
        <td class="p-1"><input class="inp py-1 min-h-0" value="${S(p.nombre)}" oninput="WizardObra.pg(${i},'nombre',this.value)" aria-label="Nombre de la exhibición"></td>
        <td class="p-1"><input type="number" step="0.01" class="inp py-1 min-h-0 w-20" value="${p.pct}" onchange="WizardObra.pg(${i},'pct',this.value)" aria-label="Porcentaje"></td>
        <td class="p-1"><input type="number" step="0.01" class="inp py-1 min-h-0 w-32 text-right" value="${p.monto}" onchange="WizardObra.pg(${i},'monto',this.value)" aria-label="Monto"></td>
        <td class="p-1"><input type="date" class="inp py-1 min-h-0" value="${p.fecha}" onchange="WizardObra.pg(${i},'fecha',this.value)" aria-label="Fecha límite"></td>
        <td class="p-1"><input class="inp py-1 min-h-0" value="${S(p.cond)}" oninput="WizardObra.pg(${i},'cond',this.value)" aria-label="Condición"></td>
        <td class="p-1"><button type="button" class="btn-icon" style="width:32px;height:32px" onclick="WizardObra.delPago(${i})" aria-label="Quitar exhibición"><i class="ri-delete-bin-line" aria-hidden="true"></i></button></td></tr>`).join('')}</tbody>
      <tfoot><tr class="border-t border-slate-200 font-bold"><td class="p-2">Suma</td><td class="p-2">${r2(st.pagos.reduce((s, p) => s + p.pct, 0))} %</td><td class="p-2 text-right ${ok ? 'text-ok' : 'text-danger'}">${fmt(sum)}${ok ? '' : ` (faltan ${fmt(r2(tot - sum))})`}</td><td colspan="3" class="p-2 text-xs font-normal text-ink-subtle">El último renglón absorbe los centavos.</td></tr></tfoot></table></div>
      ${st.pagos.length ? `<div class="g rounded-xl p-4 mb-4">
        <label class="flex items-center gap-2 font-medium"><input type="checkbox" ${st.anticipo.si ? 'checked' : ''} onchange="WizardObra.ant('si',this.checked);WizardObra.render()"> Ya recibí el anticipo (${S(st.pagos[0].nombre)}: ${fmt(st.pagos[0].monto)})</label>
        ${st.anticipo.si ? `<div class="grid md:grid-cols-4 gap-3 mt-3">
          <div><label class="text-xs mb-1 block" for="wzAntFecha">Fecha</label><input type="date" id="wzAntFecha" class="inp" value="${st.anticipo.fecha}" onchange="WizardObra.ant('fecha',this.value)"></div>
          <div><label class="text-xs mb-1 block" for="wzAntMet">Método</label><select id="wzAntMet" class="inp" onchange="WizardObra.ant('metodo',this.value)">${['Transferencia', 'Efectivo', 'Cheque'].map(m => `<option ${st.anticipo.metodo === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
          <div><label class="text-xs mb-1 block" for="wzAntRef">Referencia</label><input id="wzAntRef" class="inp" value="${S(st.anticipo.ref)}" placeholder="Ej. 4587213" oninput="WizardObra.ant('ref',this.value)"></div>
          <div><label class="text-xs mb-1 block" for="wzAntBanco">Banco</label><input id="wzAntBanco" class="inp" value="${S(st.anticipo.banco)}" placeholder="Ej. BBVA" oninput="WizardObra.ant('banco',this.value)"></div></div>` : ''}
      </div>` : ''}
      <div class="flex flex-wrap justify-between gap-2 pt-2 border-t border-slate-200">
        <button type="button" class="btn btn-s" onclick="WizardObra.goto(3)"><i class="ri-arrow-left-line" aria-hidden="true"></i> Programa</button>
        <div class="flex gap-2"><button type="button" class="btn btn-s" onclick="WizardObra.goto(5)">Continuar sin guardar</button><button type="button" class="btn btn-p" onclick="WizardObra.save4()" ${st.pagos.length && !ok ? 'disabled' : ''}><i class="ri-save-line" aria-hidden="true"></i> Guardar plan de pagos y continuar</button></div>
      </div>`;
  }
  function tpl(k) { initPagos(k); render(); }
  function pg(i, k, v) {
    const p = st.pagos[i]; const tot = +st.obra.presupuesto_total || 0;
    if (k === 'pct') { p.pct = num(v); p.monto = r2(tot * p.pct / 100); balance(); render(); }
    else if (k === 'monto') { p.monto = num(v); p.pct = tot ? r2(p.monto / tot * 100) : 0; balance(); render(); }
    else p[k] = v;
  }
  function balance() { const tot = +st.obra.presupuesto_total || 0; if (st.pagos.length < 2) return; const last = st.pagos[st.pagos.length - 1]; const others = st.pagos.slice(0, -1).reduce((s, p) => s + p.monto, 0); last.monto = r2(tot - others); last.pct = tot ? r2(last.monto / tot * 100) : 0; }
  function addPago() { const i = st.pagos.length; st.pagos.push({ nombre: `${ORD[i] || (i + 1) + 'º'} pago`, pct: 0, monto: 0, fecha: st.obra.fecha_fin_estimada, cond: '' }); render(); }
  function delPago(i) { st.pagos.splice(i, 1); balance(); render(); }
  function ant(k, v) { st.anticipo[k] = v; }
  async function save4() {
    const o = st.obra; const tot = +o.presupuesto_total || 0;
    const sum = r2(st.pagos.reduce((s, p) => s + p.monto, 0));
    if (st.pagos.length && Math.abs(sum - tot) > 0.01) { Toast.error(`Las exhibiciones suman ${fmt(sum)} y el contrato es ${fmt(tot)}.`); return; }
    if (!st.pagos.length) { goto(5); return; }
    try {
      const cliente = (D.cli || []).find(c => c.id == (o.cliente_id || st.clienteId));
      const clienteNombre = cliente?.nombre || o.cliente || null;
      const rows = st.pagos.map(p => { const emis = o.fecha_inicio || iso(new Date()); const dias = Math.max(0, Math.round((new Date(p.fecha + 'T00:00:00') - new Date(emis + 'T00:00:00')) / 86400000)); return { empresa_id: currentUser?.empresa_id || null, obra_id: st.obraId, cliente_nombre: clienteNombre, concepto: p.nombre + (p.cond ? ' · ' + p.cond : ''), monto_total: p.monto, fecha_emision: emis, dias_credito: dias, fecha_vencimiento: p.fecha, estatus: 'Pendiente' }; });
      const { data: cxc, error } = await sb.from('cuentas_por_cobrar').insert(rows).select();
      if (error) throw error;
      st.cxcIds = (cxc || []).map(c => c.id);
      D.cxc = (D.cxc || []).concat(cxc || []);
      // Hitos de pago en el programa
      const pgId = st.programaId || (D.pg || []).find(p => p.obra_id == st.obraId)?.id;
      if (pgId) {
        const maxOrden = (D.ap || []).filter(a => a.programa_id === pgId).reduce((m, a) => Math.max(m, a.orden || 0), 0);
        const hitos = st.pagos.map((p, i) => ({ programa_id: pgId, nombre: 'Pago: ' + p.nombre, fecha_inicio: p.fecha, fecha_fin: p.fecha, porcentaje_avance: 0, peso_porcentual: 0, costo_planeado: 0, estatus: 'Pendiente', color: '#b45309', es_hito: true, orden: maxOrden + i + 1, responsable: 'Cliente', notas: p.cond || null }));
        const { data: ap, error: e2 } = await sb.from('actividades_programa').insert(hitos).select();
        if (!e2 && ap) D.ap = (D.ap || []).concat(ap);
      }
      // Anticipo
      if (st.anticipo.si && cxc?.length) {
        const { data: numero } = await sb.rpc('get_next_pago_recibido_numero');
        const pago = { empresa_id: currentUser?.empresa_id || null, obra_id: st.obraId, cuenta_cobrar_id: cxc[0].id, numero_pago: numero || ('PR-' + Date.now()), fecha_pago: st.anticipo.fecha, monto: st.pagos[0].monto, metodo_pago: st.anticipo.metodo, referencia: st.anticipo.ref || null, banco: st.anticipo.banco || null, concepto: st.pagos[0].nombre, created_by: currentUser?.id || null };
        const { data: pr, error: e3 } = await sb.from('pagos_recibidos').insert(pago).select().single();
        if (e3) throw e3;
        st.pagoNumero = pr.numero_pago;
        D.prc = (D.prc || []).concat([pr]);
        const { data: c0 } = await sb.from('cuentas_por_cobrar').select('*').eq('id', cxc[0].id).single();
        if (c0) { const i = D.cxc.findIndex(x => x.id === c0.id); if (i >= 0) D.cxc[i] = c0; }
      }
      st.pagosSaved = true;
      Cache.saveAppData(D, currentUser?.empresa_id || 'global');
      Toast.success(`${rows.length} exhibiciones creadas${st.pagoNumero ? ' y anticipo ' + st.pagoNumero + ' registrado' : ''}`);
      track('wizard_paso_guardado', { paso: 4, exhibiciones: rows.length, anticipo: !!st.pagoNumero });
      goto(5);
    } catch (err) { Toast.error(humanizeError(err, 'No se guardó el plan de pagos')); }
  }

  // ===== PASO 5 =====
  function step5(c) {
    const o = st.obra || {};
    const cli = (D.cli || []).find(x => x.id == (o.cliente_id || st.clienteId));
    const cc = (D.cc || []).filter(x => x.obra_id == st.obraId).length;
    const pg = (D.pg || []).find(p => p.obra_id == st.obraId);
    const acts = pg ? (D.ap || []).filter(a => a.programa_id === pg.id) : [];
    const weeks = o.fecha_inicio && o.fecha_fin_estimada ? weekList(o.fecha_inicio, o.fecha_fin_estimada, st.startDow).length : 0;
    const cxc = (D.cxc || []).filter(x => x.obra_id == st.obraId);
    const cobrado = cxc.reduce((s, x) => s + (+x.monto_cobrado || 0), 0);
    const d = obraDesglose();
    const row = (l, v, ok) => `<div class="flex items-start justify-between gap-3 py-2 border-b border-slate-100"><span class="text-ink-muted">${l}</span><span class="text-right font-medium ${ok === false ? 'text-amber-700' : ''}">${v}</span></div>`;
    c.innerHTML = `<div class="g rounded-xl p-4 mb-4 text-sm">
      ${row('Obra', `${S(o.codigo_obra || '')} ${S(o.nombre_obra || '')}`)}
      ${row('Cliente', cli ? S(cli.nombre) : (o.cliente ? S(o.cliente) + ' <span class="text-ink-subtle">(texto, sin ficha)</span>' : 'Sin cliente'), !!cli)}
      ${row('Monto', `${fmt(d.tot)} ${d.pct ? `(subtotal ${fmt(d.sub)} + IVA ${d.pct} %)` : '(sin IVA)'}`)}
      ${row('Periodo', `${dmy(o.fecha_inicio)} a ${dmy(o.fecha_fin_estimada)} · ${weeks} semanas`)}
      ${row('Catálogo', cc ? `${cc} conceptos` : 'Sin catálogo', cc > 0)}
      ${row('Programa', pg ? `${acts.filter(a => !a.es_hito).length} actividades y ${acts.filter(a => a.es_hito).length} hitos` : 'Sin programa', !!pg)}
      ${row('Plan de pagos', cxc.length ? `${cxc.length} exhibiciones · cobrado ${fmt(cobrado)} · pendiente ${fmt(cxc.reduce((s, x) => s + (+x.monto_total || 0), 0) - cobrado)}` : 'Sin plan de pagos', cxc.length > 0)}
      ${st.pagoNumero ? row('Anticipo', `Registrado como ${st.pagoNumero}`) : ''}
    </div>
    <div class="flex flex-wrap justify-between gap-2">
      <div class="flex gap-2">${!cc ? `<button type="button" class="btn btn-s" onclick="WizardObra.goto(2)">Cargar catálogo</button>` : ''}${!pg ? `<button type="button" class="btn btn-s" onclick="WizardObra.goto(3)">Definir programa</button>` : ''}${!cxc.length ? `<button type="button" class="btn btn-s" onclick="WizardObra.goto(4)">Definir plan de pagos</button>` : ''}</div>
      <button type="button" class="btn btn-p" onclick="WizardObra.finish()">Ir a la obra <i class="ri-arrow-right-line" aria-hidden="true"></i></button>
    </div>`;
    track('wizard_completado', { catalogo: cc > 0, programa: !!pg, pagos: cxc.length > 0 });
  }
  async function finish() {
    const id = st.obraId; close();
    Cache.clear();
    await L();
    if (typeof abrirFichaObra === 'function' && id) abrirFichaObra(id);
  }

  return { open, close, goto, render, sugCodigo, previewIva, save1, setCat, file, cc, addC, delC, addDescuento, resetCat, et, addEtapa, delEtapa, etapasToConceptos, save2, md, me, mu, setPct, toggleEditPct, setDow, addHito, hito, delHito, save3, tpl, pg, addPago, delPago, ant, save4, finish, weekList, parseRows, mapPartida, PARTIDAS_DEFAULT, get state() { return st; } };
})();
