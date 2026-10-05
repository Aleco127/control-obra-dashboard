/**
 * Banco de precios (PRD licitaciones · épica D). Módulo de la barra `bp`, sólo nivel >= 80 (D3: los precios no los ve
 * nadie más; la RLS de insumos, insumo_precios, conceptos_historicos, concepto_precios, matriz_componentes,
 * insumo_componentes, insumo_sugerencias y banco_importaciones lo exige también para leer).
 *
 * Carga perezosa (D4): NO entra a load_all_data_seguro. Al abrirse, `cargar()` lee public.insumos_resumen (último
 * precio, mediana, mínimo, máximo, muestras y variación contra el anterior) y lo deja en `D.ins = { filas, total,
 * limite }` (propiedad NO enumerable de D: no se guarda en localStorage). En el build sale como módulo diferido.
 *
 * Pestañas: Insumos (US-822, ficha con historial US-823) · Conceptos (US-826) · Mano de obra (US-831) ·
 * Por clasificar (US-832) · Importar de OPUS (US-825).
 * Precios SIN IVA en todo el banco (como en OPUS). La mediana, el mínimo, el máximo y la variación salen de la vista
 * insumos_resumen; la variación anual se calcula con la historia del insumo.
 * Depende de (navegador): sb, D, M, S, $, F, Skeleton, EmptyState, humanizeError, Toast, Dialog, openMdl, closeMdl,
 * Chart (Chart.js) y XLSX (respaldo de Excel). Las funciones puras se exportan con module.exports y se prueban en
 * scripts/qa/banco-precios.test.mjs y scripts/qa/fsr.test.mjs.
 */
const BancoPrecios = (() => {
  'use strict';

  // ---- Catálogos ------------------------------------------------------------------------------------------------------
  const TIPOS = { material: 'Material', mano_obra: 'Mano de obra', equipo: 'Equipo', herramienta: 'Herramienta', auxiliar: 'Auxiliar', flete: 'Flete' };
  const PLAZAS = { cuauhtemoc: 'Cd. Cuauhtémoc', chihuahua: 'Chihuahua', juarez: 'Cd. Juárez', parral: 'Parral', casas_grandes: 'Casas Grandes', otra: 'Otra' };
  const FUENTES = { opus: 'OPUS', cotizacion: 'Cotización', compra: 'Compra', manual: 'Manual', referencia: 'Referencia' };
  /** Un precio con más de estos días se marca como viejo (US-823, US-829). */
  const DIAS_PRECIO_VIEJO = 180;
  const LIMITE_PAGINA = 1000;
  const LIMITE_TOTAL = 10000;
  const COLUMNAS = 'id,clave,descripcion,unidad,tipo,familia,activo,ultimo_precio,ultima_fecha,ultima_plaza,ultima_fuente,precio_anterior,fecha_anterior,variacion_pct,mediana,minimo,maximo,muestras,compuesto';
  /** Umbral de «parecido por descripción» de la conciliación (US-825). */
  const UMBRAL_PARECIDO = 0.6;

  // ---- Funciones puras ------------------------------------------------------------------------------------------------
  function hoyMx(d) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
  }
  /** Misma normalización que control_obra.texto_norm (minúsculas, sin acentos, sin puntuación, espacios simples). */
  function normalizarTexto(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /** Días entre la fecha de un precio y hoy (YYYY-MM-DD). */
  function antiguedadDias(fecha, hoy) {
    if (!fecha) return null;
    const u = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
    return Math.round((u(String(hoy || hoyMx())) - u(String(fecha).slice(0, 10))) / 86400000);
  }
  const esViejo = (fecha, hoy) => { const d = antiguedadDias(fecha, hoy); return d !== null && d > DIAS_PRECIO_VIEJO; };
  const ordenReciente = (a, b) => String(b.fecha).localeCompare(String(a.fecha)) || ((b.id || 0) - (a.id || 0));
  /**
   * Precio vigente (D5): el más reciente de la plaza; si la plaza no tiene, el más reciente de cualquier plaza.
   * precios: [{precio, fecha, plaza, id?}] · devuelve {precio, fecha, plaza, de_otra_plaza} o null.
   */
  function precioVigente(precios, plaza) {
    const lista = (precios || []).filter((p) => p && p.precio !== null && p.precio !== undefined && p.fecha).slice().sort(ordenReciente);
    if (!lista.length) return null;
    const dePlaza = plaza ? lista.find((p) => p.plaza === plaza) : null;
    const p = dePlaza || lista[0];
    return { precio: Number(p.precio), fecha: String(p.fecha).slice(0, 10), plaza: p.plaza, de_otra_plaza: !!plaza && !dePlaza };
  }
  /**
   * Variación anual (US-823): último precio contra el más reciente que tenga al menos 365 días menos que él.
   * Devuelve {pct, desde, hasta, precio_desde} o null si no hay historia de un año.
   */
  function variacionAnual(precios) {
    const lista = (precios || []).filter((p) => p && p.fecha && Number(p.precio) > 0).slice().sort(ordenReciente);
    if (lista.length < 2) return null;
    const u = lista[0];
    const ant = lista.find((p) => antiguedadDias(p.fecha, String(u.fecha).slice(0, 10)) >= 365);
    if (!ant) return null;
    return { pct: Math.round((Number(u.precio) - Number(ant.precio)) / Number(ant.precio) * 10000) / 100,
      desde: String(ant.fecha).slice(0, 10), hasta: String(u.fecha).slice(0, 10), precio_desde: Number(ant.precio) };
  }
  /** Propuesta (opus, referencia, cotización, manual) o compra (factura): la gráfica los distingue (US-832). */
  const grupoFuente = (f) => (f === 'compra' ? 'compra' : 'propuesta');
  /** Series de la gráfica: una por plaza, puntos ordenados por fecha con la fuente de cada uno. */
  function seriesPorPlaza(precios) {
    const out = {};
    (precios || []).filter((p) => p && p.fecha && p.precio !== null && p.precio !== undefined)
      .slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || ((a.id || 0) - (b.id || 0)))
      .forEach((p) => { (out[p.plaza || 'otra'] = out[p.plaza || 'otra'] || []).push({ fecha: String(p.fecha).slice(0, 10), precio: Number(p.precio), fuente: p.fuente, grupo: grupoFuente(p.fuente) }); });
    return out;
  }

  // ---- Datos (navegador) --------------------------------------------------------------------------------------------
  let enVuelo = null;
  let pintadas = 0;
  const est = { tab: 'insumos', tipo: '', q: '', plaza: '', resultados: null, buscando: 0 };
  function guardarEnD(clave, valor) {
    Object.defineProperty(D, clave, { value: valor, writable: true, configurable: true, enumerable: false });
  }
  async function cargar(force) {
    if (!force && D.ins && Array.isArray(D.ins.filas)) return D.ins;
    if (enVuelo && !force) return enVuelo;
    enVuelo = (async () => {
      const filas = []; let total = 0;
      for (let desde = 0; desde < LIMITE_TOTAL; desde += LIMITE_PAGINA) {
        const { data, error, count } = await sb.from('insumos_resumen').select(COLUMNAS, desde === 0 ? { count: 'exact' } : undefined)
          .order('tipo').order('clave').order('id').range(desde, desde + LIMITE_PAGINA - 1);
        if (error) throw error;
        if (desde === 0) total = count ?? (data || []).length;
        filas.push(...(data || []));
        if (!data || data.length < LIMITE_PAGINA) break;
      }
      guardarEnD('ins', { filas, total: Math.max(total, filas.length), limite: LIMITE_TOTAL });
      return D.ins;
    })();
    try { return await enVuelo; } finally { enVuelo = null; }
  }
  const filaPorId = (id) => (D.ins && D.ins.filas || []).find((x) => x.id === id);
  const proveedorNombre = (id) => { const p = (D.pv || []).find((x) => x.id === id); return p ? (p.nombre_proveedor || p.nombre || '') : ''; };
  const plazaOpts = (sel, vacio) => (vacio ? `<option value="">${S(vacio)}</option>` : '') + Object.entries(PLAZAS).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${S(v)}</option>`).join('');
  const tipoOpts = (sel) => Object.entries(TIPOS).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${S(v)}</option>`).join('');
  const num = (v, d = 2) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${Number(v).toLocaleString('es-MX', { maximumFractionDigits: 2 })} %`);
  const fechaCorta = (iso) => { if (!iso) return '—'; const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };

  // ---- Interfaz: armazón --------------------------------------------------------------------------------------------
  const PESTANAS = [['insumos', 'Insumos', 'ri-price-tag-3-line'], ['conceptos', 'Conceptos', 'ri-file-list-3-line'],
    ['mano_obra', 'Mano de obra', 'ri-user-settings-line'], ['clasificar', 'Por clasificar', 'ri-inbox-archive-line'],
    ['importar', 'Importar de OPUS', 'ri-upload-cloud-2-line']];
  function cabecera() {
    return `<div class="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-3"><div>
<h1 class="text-xl font-bold"><i class="ri-price-tag-3-line" aria-hidden="true"></i> Banco de precios</h1>
<p class="text-sm text-ink-muted mt-1">Cada precio con su fecha, plaza y fuente, sin IVA, para reutilizarlo en tus propuestas y cargarlo a OPUS.</p></div>
<div class="flex flex-wrap gap-2"><button type="button" class="btn btn-s" onclick="BancoPrecios.irA('importar')"><i class="ri-upload-cloud-2-line" aria-hidden="true"></i> Importar de OPUS</button>
<button type="button" class="btn btn-p" onclick="BancoPrecios.nuevoInsumo()"><i class="ri-add-line" aria-hidden="true"></i> Agregar insumo</button></div></div>
<div class="tabs mb-4" role="tablist" aria-label="Secciones del banco de precios">${PESTANAS.map(([k, t, ic]) => `<button type="button" role="tab" id="bpTab-${k}" aria-selected="${est.tab === k}" aria-controls="bpCuerpo" class="tab${est.tab === k ? ' active' : ''}" onclick="BancoPrecios.irA('${k}')"><i class="${ic}" aria-hidden="true"></i> ${t}${k === 'clasificar' ? '<span class="tab-n" id="bpNClasificar" hidden></span>' : ''}</button>`).join('')}</div>`;
  }
  function vacio() {
    return EmptyState({
      icon: 'ri-price-tag-3-line', title: 'El banco de precios está vacío',
      body: 'Aquí se guardará cada insumo con su historial de precios por plaza y fuente: propuestas de OPUS, cotizaciones y compras reales.',
      action: { label: 'Agregar insumo', icon: 'ri-add-line', onClick: 'BancoPrecios.nuevoInsumo()' },
      secondary: { label: 'Importar de OPUS', onClick: "BancoPrecios.irA('importar')" },
    });
  }
  function errorHtml(e) {
    return EmptyState({
      icon: 'ri-error-warning-line', title: 'No se pudo cargar el banco de precios',
      body: humanizeError(e), action: { label: 'Reintentar', icon: 'ri-refresh-line', onClick: 'BancoPrecios.recargar()' },
    });
  }
  const VISTAS = {};
  async function render(c, force) {
    const turno = ++pintadas;
    c.innerHTML = cabecera() + `<div id="bpCuerpo" role="tabpanel" aria-labelledby="bpTab-${est.tab}" aria-busy="true" aria-live="polite">${Skeleton.table(5, 6)}</div>`;
    const cuerpo = () => (turno === pintadas && M === 'bp' ? $('bpCuerpo') : null);
    try {
      const ins = await cargar(force);
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      const vista = VISTAS[est.tab] || VISTAS.insumos;
      await vista(el, ins);
      contarPorClasificar();
    } catch (e) {
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      el.innerHTML = errorHtml(e);
    }
  }
  function recargar() { const c = $('c'); if (c && M === 'bp') render(c, true); }
  function irA(tab) { est.tab = PESTANAS.some((p) => p[0] === tab) ? tab : 'insumos'; const c = $('c'); if (c && M === 'bp') render(c); }
  /** Contador de la pestaña «Por clasificar» (US-832); si la tabla no existe todavía, no estorba. */
  async function contarPorClasificar() {
    try {
      const { count, error } = await sb.from('insumo_sugerencias').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
      const el = $('bpNClasificar'); if (!el || error) return;
      el.textContent = String(count || 0); el.hidden = !count;
    } catch (e) { /* sin contador */ }
  }

  // ---- Insumos (US-822) ---------------------------------------------------------------------------------------------
  function filasVisibles(ins) {
    const base = est.resultados || ins.filas;
    return est.tipo ? base.filter((i) => i.tipo === est.tipo) : base;
  }
  function tablaInsumos(filas) {
    const hoy = hoyMx();
    const cuerpo = filas.map((i) => {
      const precio = i._precio !== undefined ? i._precio : i.ultimo_precio;
      const fecha = i._fecha !== undefined ? i._fecha : i.ultima_fecha;
      const viejo = esViejo(fecha, hoy);
      const otra = i._otraPlaza ? ` <span class="chip chip-ind" title="No hay precio de ${S(PLAZAS[est.plaza] || '')}; se muestra el de ${S(PLAZAS[i._plaza] || i._plaza || '')}">${S(PLAZAS[i._plaza] || i._plaza || '')}</span>` : '';
      const pr = i.compuesto && (precio === null || precio === undefined) ? '<span class="text-ink-muted">De su matriz</span>'
        : (precio === null || precio === undefined ? '<span class="text-ink-muted">Sin precio</span>' : F(precio));
      return `<tr class="cursor-pointer" onclick="BancoPrecios.abrirInsumo(${i.id})">
<td data-et="Clave"><button type="button" class="link font-mono text-xs text-left" onclick="event.stopPropagation();BancoPrecios.abrirInsumo(${i.id})">${S(i.clave)}</button></td>
<td data-et="Descripción">${S(i.descripcion)}${i.compuesto ? ' <span class="chip chip-ind">Compuesto</span>' : ''}${i.activo === false ? ' <span class="chip chip-ind">Inactivo</span>' : ''}</td>
<td data-et="Unidad">${S(i.unidad)}</td><td data-et="Tipo">${S(TIPOS[i.tipo] || i.tipo)}</td>
<td data-et="Último precio" class="text-right">${pr}${otra}</td>
<td data-et="Fecha"${viejo ? ' class="bp-viejo" title="Precio con más de 180 días"' : ''}>${viejo ? '<i class="ri-time-line" aria-hidden="true"></i> ' : ''}${S(fechaCorta(fecha))}</td>
<td data-et="Muestras" class="text-right">${Number(i.muestras) || 0}</td></tr>`;
    }).join('');
    return `<div class="table-wrap g rounded-xl" tabindex="0" role="region" aria-label="Insumos del banco de precios"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Clave</th><th scope="col">Descripción</th><th scope="col">Unidad</th><th scope="col">Tipo</th><th scope="col" class="text-right">${est.plaza ? 'Precio vigente' : 'Último precio'}</th><th scope="col">Fecha</th><th scope="col" class="text-right">Muestras</th></tr></thead><tbody>${cuerpo}</tbody></table></div>`;
  }
  function pintarListaInsumos() {
    const el = $('bpLista'); if (!el || !D.ins) return;
    const filas = filasVisibles(D.ins);
    const base = est.resultados || D.ins.filas;
    const cuenta = (t) => (t ? base.filter((i) => i.tipo === t).length : base.length);
    $('bpTipos').innerHTML = [['', 'Todos'], ...Object.entries(TIPOS)].map(([k, v]) => `<button type="button" class="seg-btn${est.tipo === k ? ' active' : ''}" aria-pressed="${est.tipo === k}" onclick="BancoPrecios.filtrarTipo('${k}')">${S(v)} <span class="tab-n">${cuenta(k)}</span></button>`).join('');
    const pie = est.resultados ? `<p class="text-xs text-ink-muted mt-2">${filas.length} resultado${filas.length === 1 ? '' : 's'}${est.q ? ` para «${S(est.q)}»` : ''}${est.plaza ? ` con el precio vigente de ${S(PLAZAS[est.plaza])}` : ''}.</p>`
      : (D.ins.total > D.ins.filas.length ? `<p class="text-xs text-ink-muted mt-2">Se muestran ${D.ins.filas.length} de ${D.ins.total} insumos. Usa la búsqueda para encontrar el resto.</p>` : '');
    el.innerHTML = filas.length ? tablaInsumos(filas) + pie
      : EmptyState({ icon: 'ri-search-line', title: 'Sin insumos que coincidan', body: est.q ? 'Prueba con otra palabra o con la clave. La búsqueda tolera acentos y errores de dedo.' : 'No hay insumos de este tipo todavía.', action: { label: 'Agregar insumo', icon: 'ri-add-line', onClick: 'BancoPrecios.nuevoInsumo()' } });
  }
  VISTAS.insumos = (el, ins) => {
    if (!ins.filas.length && !est.q) { el.innerHTML = vacio(); return; }
    el.innerHTML = `<div class="flex flex-col md:flex-row gap-2 mb-3">
<label class="flex-1"><span class="sr-only">Buscar insumo</span><input id="bpBuscar" type="search" class="inp w-full" placeholder="Buscar por clave o descripción (tolera acentos y errores)" value="${S(est.q)}" oninput="BancoPrecios.buscar(this.value)" autocomplete="off"></label>
<label class="md:w-56"><span class="sr-only">Plaza del precio</span><select id="bpPlaza" class="inp w-full" onchange="BancoPrecios.filtrarPlaza(this.value)">${plazaOpts(est.plaza, 'Todas las plazas (último precio)')}</select></label></div>
<div class="seg mb-3 bp-seg" id="bpTipos" role="group" aria-label="Tipo de insumo"></div><div id="bpLista"></div>`;
    pintarListaInsumos();
  };
  let tBuscar = null;
  function buscar(q) { est.q = String(q || ''); clearTimeout(tBuscar); tBuscar = setTimeout(ejecutarBusqueda, 300); }
  function filtrarPlaza(p) { est.plaza = p || ''; ejecutarBusqueda(); }
  function filtrarTipo(t) { est.tipo = t || ''; pintarListaInsumos(); }
  async function ejecutarBusqueda() {
    const turno = ++est.buscando;
    if (!est.q.trim() && !est.plaza) { est.resultados = null; pintarListaInsumos(); return; }
    try {
      const { data, error } = await sb.rpc('buscar_insumos', { p_texto: est.q.trim(), p_tipo: null, p_plaza: est.plaza || null, p_limite: 200 });
      if (error) throw error;
      if (turno !== est.buscando) return;
      est.resultados = (data || []).map((r) => {
        const base = filaPorId(r.id) || {};
        return { ...base, ...r, compuesto: base.compuesto, _precio: r.precio_vigente, _fecha: r.fecha_vigente, _plaza: r.plaza_vigente, _otraPlaza: !!(est.plaza && r.de_otra_plaza && r.precio_vigente !== null) };
      });
      pintarListaInsumos();
    } catch (e) { Toast.error(humanizeError(e, 'Búsqueda')); }
  }

  // ---- Modales (se inyectan una vez) ----------------------------------------------------------------------------------
  const MDL_INSUMO = `<div id="mdlBpInsumo" class="modal"><div class="modal-content g rounded-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="bpInsTitulo">
<div class="flex items-start justify-between gap-3 mb-3"><h3 id="bpInsTitulo" class="font-bold">Agregar insumo</h3><button type="button" class="btn-icon" onclick="closeMdl('mdlBpInsumo')" aria-label="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></div>
<form id="bpInsForm" class="grid grid-cols-2 gap-3" onsubmit="event.preventDefault();BancoPrecios.guardarInsumo()">
<input type="hidden" id="bpInsId">
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Clave *</span><input id="bpInsClave" class="inp w-full" required maxlength="60" autocomplete="off"></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Tipo *</span><select id="bpInsTipo" class="inp w-full">${Object.entries({ material: 'Material', mano_obra: 'Mano de obra', equipo: 'Equipo', herramienta: 'Herramienta', auxiliar: 'Auxiliar', flete: 'Flete' }).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
<label class="col-span-2"><span class="text-xs mb-1 block">Descripción *</span><input id="bpInsDesc" class="inp w-full" required maxlength="400"></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Unidad *</span><input id="bpInsUnidad" class="inp w-full" required maxlength="20" placeholder="M3, PZA, JOR…"></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Familia</span><input id="bpInsFamilia" class="inp w-full" maxlength="80"></label>
<label class="col-span-2"><span class="text-xs mb-1 block">Notas</span><textarea id="bpInsNotas" class="inp w-full" rows="2" maxlength="1000"></textarea></label>
<label class="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" id="bpInsActivo" class="w-4 h-4 rounded" checked> Activo (aparece en las búsquedas para nuevas propuestas)</label>
<p class="col-span-2 text-xs text-ink-muted">La clave, la unidad y el tipo identifican al insumo: no se pueden repetir juntos.</p>
<div class="col-span-2 flex gap-2 justify-end"><button type="button" class="btn btn-s" onclick="closeMdl('mdlBpInsumo')">Cancelar</button><button type="submit" class="btn btn-p" id="bpInsGuardar"><i class="ri-save-line" aria-hidden="true"></i> Guardar insumo</button></div>
</form></div></div>`;
  const MDL_FUSION = `<div id="mdlBpFusion" class="modal"><div class="modal-content g rounded-2xl p-6 w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="bpFusTitulo">
<div class="flex items-start justify-between gap-3 mb-2"><div><h3 id="bpFusTitulo" class="font-bold">Fusionar insumo duplicado</h3><p id="bpFusOrigen" class="text-xs text-ink-muted"></p></div><button type="button" class="btn-icon" onclick="closeMdl('mdlBpFusion')" aria-label="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></div>
<p class="text-sm text-ink-muted mb-3">Elige el insumo que se queda. Sus precios y su lugar en las matrices pasan a él y este se borra. Si los dos tienen un precio del mismo día, plaza y fuente, manda el del que se queda.</p>
<label class="block mb-2"><span class="sr-only">Buscar el insumo que se queda</span><input id="bpFusBuscar" type="search" class="inp w-full" placeholder="Buscar el insumo que se queda" oninput="BancoPrecios.buscarDestino(this.value)" autocomplete="off"></label>
<div id="bpFusLista" class="max-h-72 overflow-y-auto" role="radiogroup" aria-label="Insumo que se queda"></div>
<label class="block mt-3"><span class="text-xs mb-1 block">Motivo (opcional)</span><input id="bpFusMotivo" class="inp w-full" maxlength="200" placeholder="Por ejemplo: misma pieza con otra clave en OPUS"></label>
<div class="flex gap-2 justify-end mt-4"><button type="button" class="btn btn-s" onclick="closeMdl('mdlBpFusion')">Cancelar</button><button type="button" class="btn btn-danger" id="bpFusOk" onclick="BancoPrecios.confirmarFusion()" disabled><i class="ri-git-merge-line" aria-hidden="true"></i> Fusionar insumos</button></div>
</div></div>`;
  function asegurarModales() {
    if (!$('mdlBpInsumo')) document.body.insertAdjacentHTML('beforeend', MDL_INSUMO);
    if (!$('mdlBpFusion')) document.body.insertAdjacentHTML('beforeend', MDL_FUSION);
    if (!$('bpDrawer')) {
      document.body.insertAdjacentHTML('beforeend', `<div id="bpDrawerBack" class="drawer-backdrop" onclick="BancoPrecios.cerrarInsumo()"></div><aside id="bpDrawer" class="drawer" role="dialog" aria-modal="true" aria-labelledby="bpDrawerTitulo" aria-hidden="true"><div class="drawer-h"><h2 id="bpDrawerTitulo" class="font-bold text-lg">Insumo</h2><button type="button" class="btn-icon" onclick="BancoPrecios.cerrarInsumo()" aria-label="Cerrar ficha del insumo"><i class="ri-close-line text-xl" aria-hidden="true"></i></button></div><div id="bpDrawerCuerpo" class="drawer-b"></div></aside>`);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('bpDrawer')?.classList.contains('ac') && !document.querySelector('.modal.ac')) cerrarInsumo(); });
    }
  }

  // ---- Alta y edición de insumo (US-822) ----------------------------------------------------------------------------
  function nuevoInsumo(pre) {
    asegurarModales();
    const p = pre || {};
    $('bpInsTitulo').textContent = p.id ? 'Editar insumo' : 'Agregar insumo';
    $('bpInsId').value = p.id || '';
    $('bpInsClave').value = p.clave || ''; $('bpInsDesc').value = p.descripcion || ''; $('bpInsUnidad').value = p.unidad || '';
    $('bpInsTipo').value = p.tipo || (est.tipo || 'material'); $('bpInsFamilia').value = p.familia || ''; $('bpInsNotas').value = p.notas || '';
    $('bpInsActivo').checked = p.activo !== false;
    openMdl('mdlBpInsumo'); setTimeout(() => $('bpInsClave').focus(), 50);
  }
  async function editarInsumo(id) {
    try {
      const { data, error } = await sb.from('insumos').select('id,clave,descripcion,unidad,tipo,familia,activo,notas').eq('id', id).single();
      if (error) throw error;
      nuevoInsumo(data);
    } catch (e) { Toast.error(humanizeError(e, 'Insumo')); }
  }
  async function guardarInsumo() {
    const id = parseInt($('bpInsId').value, 10) || null;
    const fila = { clave: $('bpInsClave').value.trim(), descripcion: $('bpInsDesc').value.trim(), unidad: $('bpInsUnidad').value.trim(),
      tipo: $('bpInsTipo').value, familia: $('bpInsFamilia').value.trim() || null, notas: $('bpInsNotas').value.trim() || null, activo: $('bpInsActivo').checked };
    if (!fila.clave || !fila.descripcion || !fila.unidad) { Toast.warning('Clave, descripción y unidad son obligatorias.'); return; }
    const btn = $('bpInsGuardar'); btn.disabled = true;
    try {
      const q = id ? sb.from('insumos').update(fila).eq('id', id) : sb.from('insumos').insert(fila);
      const { data, error } = await q.select('id').single();
      if (error) throw error;
      closeMdl('mdlBpInsumo');
      Toast.success(id ? 'Insumo actualizado.' : 'Insumo agregado al banco.');
      await cargar(true);
      if (est.resultados) await ejecutarBusqueda(); else if ($('bpLista')) pintarListaInsumos(); else recargar();
      if (id && $('bpDrawer')?.classList.contains('ac')) abrirInsumo(id);
      return data.id;
    } catch (e) {
      Toast.error(e && e.code === '23505' ? 'Ya existe un insumo con esa clave, unidad y tipo. Usa otra clave o edita el existente.' : humanizeError(e, 'Insumo'));
    } finally { btn.disabled = false; }
  }

  // ---- Fusionar (US-822) ---------------------------------------------------------------------------------------------
  let fusion = { origen: null, destino: null, lista: [] };
  function abrirFusion(id) {
    asegurarModales();
    const o = filaPorId(id) || (ficha && ficha.insumo && ficha.insumo.id === id ? ficha.insumo : null);
    if (!o) return;
    fusion = { origen: o, destino: null, lista: [] };
    $('bpFusOrigen').textContent = `${o.clave} · ${o.descripcion} · ${o.unidad} · ${TIPOS[o.tipo] || o.tipo}`;
    $('bpFusBuscar').value = ''; $('bpFusMotivo').value = ''; $('bpFusOk').disabled = true;
    $('bpFusLista').innerHTML = '<p class="text-sm text-ink-muted">Escribe para buscar insumos del mismo tipo.</p>';
    openMdl('mdlBpFusion'); setTimeout(() => $('bpFusBuscar').focus(), 50);
    buscarDestino(o.descripcion.split(/\s+/).slice(0, 3).join(' '));
  }
  let tDestino = null;
  function buscarDestino(q) {
    clearTimeout(tDestino);
    tDestino = setTimeout(async () => {
      try {
        const { data, error } = await sb.rpc('buscar_insumos', { p_texto: String(q || ''), p_tipo: fusion.origen.tipo, p_plaza: null, p_limite: 30 });
        if (error) throw error;
        fusion.lista = (data || []).filter((x) => x.id !== fusion.origen.id);
        $('bpFusLista').innerHTML = fusion.lista.length ? fusion.lista.map((x) => `<label class="flex items-start gap-2 p-2 rounded hover:bg-slate-50 cursor-pointer"><input type="radio" name="bpFusDest" value="${x.id}" class="mt-1" onchange="BancoPrecios.elegirDestino(${x.id})"${fusion.destino === x.id ? ' checked' : ''}><span class="text-sm"><span class="font-mono text-xs">${S(x.clave)}</span> · ${S(x.descripcion)} <span class="text-ink-muted">· ${S(x.unidad)} · ${Number(x.muestras) || 0} precio${Number(x.muestras) === 1 ? '' : 's'}</span>${x.unidad.toLowerCase() !== fusion.origen.unidad.toLowerCase() ? ' <span class="chip chip-ind">Otra unidad</span>' : ''}</span></label>`).join('')
          : '<p class="text-sm text-ink-muted">Sin coincidencias del mismo tipo.</p>';
      } catch (e) { $('bpFusLista').innerHTML = `<p class="text-sm text-danger">${S(humanizeError(e))}</p>`; }
    }, 250);
  }
  function elegirDestino(id) { fusion.destino = id; $('bpFusOk').disabled = false; }
  async function confirmarFusion() {
    const d = fusion.lista.find((x) => x.id === fusion.destino); const o = fusion.origen;
    if (!d || !o) return;
    const otraUnidad = d.unidad.toLowerCase() !== o.unidad.toLowerCase();
    const ok = await Dialog.confirm({ title: 'Fusionar insumos', tone: 'danger', confirmText: 'Fusionar insumos',
      body: `«${o.clave}» se borra y sus precios y componentes pasan a «${d.clave}». ${otraUnidad ? `Ojo: las unidades son distintas (${o.unidad} y ${d.unidad}); los precios no se convierten. ` : ''}No se puede deshacer.` });
    if (!ok) return;
    const btn = $('bpFusOk'); btn.disabled = true;
    try {
      const { data, error } = await sb.rpc('fusionar_insumos', { p_origen: o.id, p_destino: d.id, p_motivo: $('bpFusMotivo').value || null });
      if (error) throw error;
      closeMdl('mdlBpFusion');
      Toast.success(`Fusionados: ${data.precios_movidos} precio${data.precios_movidos === 1 ? '' : 's'} y ${data.componentes_movidos} componente${data.componentes_movidos === 1 ? '' : 's'} pasaron a ${d.clave}.`);
      await cargar(true);
      if (est.resultados) await ejecutarBusqueda(); else if ($('bpLista')) pintarListaInsumos();
      abrirInsumo(d.id);
    } catch (e) { Toast.error(humanizeError(e, 'Fusionar')); btn.disabled = false; }
  }

  // ---- Ficha del insumo con historial (US-823) -------------------------------------------------------------------------
  let ficha = null; let grafica = null; let focoAntes = null;
  function cerrarInsumo() {
    const d = $('bpDrawer'); if (!d) return;
    d.classList.remove('ac'); d.setAttribute('aria-hidden', 'true'); $('bpDrawerBack').classList.remove('ac');
    if (grafica) { grafica.destroy(); grafica = null; }
    if (focoAntes && focoAntes.focus) try { focoAntes.focus(); } catch (e) { /* nada */ }
  }
  async function abrirInsumo(id) {
    asegurarModales();
    if (!$('bpDrawer').classList.contains('ac')) focoAntes = document.activeElement;
    $('bpDrawer').classList.add('ac'); $('bpDrawer').setAttribute('aria-hidden', 'false'); $('bpDrawerBack').classList.add('ac');
    $('bpDrawerCuerpo').innerHTML = Skeleton.table(4, 3);
    try {
      const [ins, res, pre, comp] = await Promise.all([
        sb.from('insumos').select('id,clave,descripcion,unidad,tipo,familia,activo,notas,compuesto').eq('id', id).single(),
        sb.from('insumos_resumen').select(COLUMNAS).eq('id', id).maybeSingle(),
        sb.from('insumo_precios').select('id,precio,fecha,plaza,fuente,licitacion_id,proveedor_id,gasto_id,datos,notas').eq('insumo_id', id).order('fecha', { ascending: false }).order('id', { ascending: false }).limit(500),
        sb.from('insumo_componentes').select('componente_id,cantidad,licitacion_id,orden').eq('insumo_id', id).order('orden'),
      ]);
      for (const r of [ins, res, pre, comp]) if (r.error) throw r.error;
      const licIds = [...new Set([...(pre.data || []).map((p) => p.licitacion_id), ...(comp.data || []).map((p) => p.licitacion_id)].filter(Boolean))];
      const compIds = [...new Set((comp.data || []).map((c) => c.componente_id))];
      const [lics, comps] = await Promise.all([
        licIds.length ? sb.from('licitaciones').select('id,codigo,nombre').in('id', licIds) : { data: [] },
        compIds.length ? sb.from('insumos_resumen').select('id,clave,descripcion,unidad,tipo,ultimo_precio').in('id', compIds) : { data: [] },
      ]);
      ficha = { insumo: ins.data, resumen: res.data || {}, precios: pre.data || [], componentes: comp.data || [],
        lics: Object.fromEntries((lics.data || []).map((l) => [l.id, l])), comps: Object.fromEntries((comps.data || []).map((c) => [c.id, c])) };
      if ($('bpDrawer').classList.contains('ac')) pintarFicha();
    } catch (e) { $('bpDrawerCuerpo').innerHTML = errorHtml(e); }
  }
  function origenPrecio(p) {
    const partes = [];
    if (p.licitacion_id) { const l = ficha.lics[p.licitacion_id]; partes.push(l ? `Licitación ${S(l.codigo)}` : 'Licitación'); }
    if (p.proveedor_id) partes.push(S(proveedorNombre(p.proveedor_id) || 'Proveedor'));
    if (p.gasto_id) partes.push(`Gasto #${p.gasto_id}`);
    if (!partes.length && p.datos && p.datos.proyecto) partes.push(S(p.datos.proyecto));
    if (!partes.length && p.datos && p.datos.grupo) partes.push(S(p.datos.grupo));
    return partes.join(' · ') || '—';
  }
  function pintarFicha() {
    const { insumo: i, resumen: r, precios } = ficha;
    const hoy = hoyMx();
    $('bpDrawerTitulo').textContent = i.clave;
    const ult = precios[0];
    const viejo = ult && esViejo(ult.fecha, hoy);
    const va = variacionAnual(precios);
    const kpi = (v, l) => `<div class="kpi"><div class="kpi-v">${v}</div><div class="kpi-l">${l}</div></div>`;
    const datosMo = (p) => (p.datos && (p.datos.salario_base || p.datos.fsr) ? `<span class="block text-xs text-ink-muted">SB ${num(p.datos.salario_base)} · FSR ${num(p.datos.fsr, 5)}</span>` : '');
    const filasPre = precios.map((p) => `<tr><td data-et="Fecha">${S(fechaCorta(p.fecha))}</td><td data-et="Plaza">${S(PLAZAS[p.plaza] || p.plaza)}</td><td data-et="Fuente"><span class="chip ${p.fuente === 'compra' ? 'chip-obra' : 'chip-ind'}">${S(FUENTES[p.fuente] || p.fuente)}</span></td><td data-et="Precio" class="text-right">${F(p.precio)}${datosMo(p)}</td><td data-et="Origen">${origenPrecio(p)}${p.notas ? `<span class="block text-xs text-ink-muted">${S(p.notas)}</span>` : ''}</td></tr>`).join('');
    const compHtml = i.compuesto ? `<h3 class="font-bold mt-5 mb-2">Su matriz</h3>${ficha.componentes.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Componentes del insumo compuesto"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Insumo</th><th scope="col" class="text-right">Cantidad</th><th scope="col" class="text-right">Precio</th></tr></thead><tbody>${ficha.componentes.map((c) => { const x = ficha.comps[c.componente_id] || {}; return `<tr><td data-et="Insumo"><span class="font-mono text-xs">${S(x.clave || '')}</span> ${S(x.descripcion || '')}</td><td data-et="Cantidad" class="text-right">${num(c.cantidad, 4)} ${S(x.unidad || '')}</td><td data-et="Precio" class="text-right">${x.ultimo_precio != null ? F(x.ultimo_precio) : '—'}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="text-sm text-ink-muted">Sin componentes cargados.</p>'}<p class="text-xs text-ink-muted mt-1">Es una cuadrilla o un auxiliar: su precio sale de su matriz, no de una cotización.</p>` : '';
    $('bpDrawerCuerpo').innerHTML = `<p class="text-sm">${S(i.descripcion)}</p>
<p class="text-xs text-ink-muted mt-1">${S(TIPOS[i.tipo] || i.tipo)} · ${S(i.unidad)}${i.familia ? ' · ' + S(i.familia) : ''}${i.activo === false ? ' · Inactivo' : ''}</p>
<div class="flex flex-wrap gap-2 mt-3"><button type="button" class="btn btn-s text-xs" onclick="BancoPrecios.editarInsumo(${i.id})"><i class="ri-edit-line" aria-hidden="true"></i> Editar insumo</button><button type="button" class="btn btn-s text-xs" onclick="BancoPrecios.abrirFusion(${i.id})"><i class="ri-git-merge-line" aria-hidden="true"></i> Fusionar con otro</button><button type="button" class="btn btn-p text-xs" onclick="BancoPrecios.mostrarCaptura()"><i class="ri-add-line" aria-hidden="true"></i> Registrar precio</button></div>
${viejo ? `<div class="g rounded-xl p-3 mt-3 text-sm bp-aviso" role="status"><i class="ri-time-line" aria-hidden="true"></i> El último precio es del ${S(fechaCorta(ult.fecha))} (${antiguedadDias(ult.fecha, hoy)} días). Es un precio viejo: cotízalo de nuevo antes de usarlo en una propuesta.</div>` : ''}
<div id="bpCaptura" hidden></div>
<div class="kpi-strip mt-4">${kpi(ult ? F(ult.precio) : '—', ult ? `Último · ${S(fechaCorta(ult.fecha))} · ${S(PLAZAS[ult.plaza] || ult.plaza)}` : 'Último')}${kpi(r.mediana != null ? F(r.mediana) : '—', 'Mediana')}${kpi(r.minimo != null ? F(r.minimo) : '—', 'Mínimo')}${kpi(r.maximo != null ? F(r.maximo) : '—', 'Máximo')}${kpi(va ? pct(va.pct) : '—', va ? `Variación anual (desde ${S(fechaCorta(va.desde))})` : 'Variación anual (sin un año de historia)')}${kpi(pct(r.variacion_pct), 'Contra el precio anterior')}</div>
${precios.length ? `<div class="g rounded-xl p-3 mt-2"><div style="position:relative;height:220px"><canvas id="bpGrafica" role="img" aria-label="Precio de ${S(i.clave)} en el tiempo, una serie por plaza"></canvas></div><p class="text-xs text-ink-muted mt-2"><i class="ri-checkbox-blank-circle-fill" aria-hidden="true"></i> Propuesta, cotización o referencia · <i class="ri-triangle-fill" aria-hidden="true"></i> Compra con factura</p></div>` : ''}
<h3 class="font-bold mt-5 mb-2">Muestras <span class="text-ink-muted font-normal">(${precios.length})</span></h3>
${precios.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Precios registrados del insumo"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Fecha</th><th scope="col">Plaza</th><th scope="col">Fuente</th><th scope="col" class="text-right">Precio</th><th scope="col">Origen</th></tr></thead><tbody>${filasPre}</tbody></table></div>` : `<p class="text-sm text-ink-muted">${i.compuesto ? 'Sin precios propios.' : 'Todavía no tiene precios. Registra una cotización.'}</p>`}
${compHtml}`;
    if (precios.length) pintarGrafica();
  }
  function colorToken(nombre, defecto) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || defecto; } catch (e) { return defecto; }
  }
  function pintarGrafica() {
    const cv = $('bpGrafica'); if (!cv || typeof Chart === 'undefined') return;
    if (grafica) { grafica.destroy(); grafica = null; }
    const series = seriesPorPlaza(ficha.precios);
    const colores = { cuauhtemoc: '--accent-fill', chihuahua: '--ok', juarez: '--violet', parral: '--warn', casas_grandes: '--info', otra: '--ink-muted' };
    const ms = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
    const datasets = Object.entries(series).map(([plaza, pts]) => {
      const c = colorToken(colores[plaza] || '--ink-muted', '#475569');
      return { label: PLAZAS[plaza] || plaza, data: pts.map((p) => ({ x: ms(p.fecha), y: p.precio, fuente: p.fuente })),
        borderColor: c, backgroundColor: c, pointStyle: pts.map((p) => (p.grupo === 'compra' ? 'triangle' : 'circle')),
        pointRadius: pts.map((p) => (p.grupo === 'compra' ? 6 : 4)), tension: 0, spanGaps: true };
    });
    grafica = new Chart(cv.getContext('2d'), {
      type: 'line', data: { datasets },
      options: { responsive: true, maintainAspectRatio: false, animation: false, parsing: true,
        scales: { x: { type: 'linear', ticks: { maxTicksLimit: 6, callback: (v) => { const d = new Date(v); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}`; } } },
          y: { ticks: { callback: (v) => '$' + Number(v).toLocaleString('es-MX') } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } },
          tooltip: { callbacks: { title: (it) => { const d = new Date(it[0].parsed.x); return d.toISOString().slice(0, 10); },
            label: (it) => `${it.dataset.label} · ${FUENTES[it.raw.fuente] || it.raw.fuente}: ${F(it.parsed.y)}` } } } },
    });
  }
  function mostrarCaptura() {
    const el = $('bpCaptura'); if (!el || !ficha) return;
    const hoy = hoyMx();
    const provs = (D.pv || []).slice().sort((a, b) => String(a.nombre_proveedor || '').localeCompare(String(b.nombre_proveedor || '')));
    el.hidden = false;
    el.innerHTML = `<form class="g rounded-xl p-3 mt-3 grid grid-cols-2 gap-3" onsubmit="event.preventDefault();BancoPrecios.guardarPrecio()" aria-label="Registrar precio">
<p class="col-span-2 font-bold text-sm">Registrar precio de ${S(ficha.insumo.clave)} <span class="font-normal text-ink-muted">(sin IVA, por ${S(ficha.insumo.unidad)})</span></p>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Precio sin IVA *</span><input id="bpPreMonto" type="number" min="0" step="0.01" class="inp w-full" required inputmode="decimal"></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Fecha *</span><input id="bpPreFecha" type="date" class="inp w-full" value="${hoy}" max="${hoy}" required></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Plaza *</span><select id="bpPrePlaza" class="inp w-full">${plazaOpts(est.plaza || 'cuauhtemoc')}</select></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Fuente</span><select id="bpPreFuente" class="inp w-full"><option value="cotizacion">Cotización</option><option value="manual">Manual</option></select></label>
<label class="col-span-2"><span class="text-xs mb-1 block">Proveedor</span><select id="bpPreProv" class="inp w-full"><option value="">Sin proveedor</option>${provs.map((p) => `<option value="${p.id}">${S(p.nombre_proveedor || p.nombre || '')}</option>`).join('')}</select></label>
<label class="col-span-2"><span class="text-xs mb-1 block">Nota</span><input id="bpPreNota" class="inp w-full" maxlength="300" placeholder="Por ejemplo: cotización por WhatsApp, vigencia 15 días"></label>
<div class="col-span-2 flex gap-2 justify-end"><button type="button" class="btn btn-s" onclick="BancoPrecios.ocultarCaptura()">Cancelar</button><button type="submit" class="btn btn-p" id="bpPreGuardar"><i class="ri-save-line" aria-hidden="true"></i> Guardar precio</button></div></form>`;
    setTimeout(() => $('bpPreMonto').focus(), 30);
  }
  function ocultarCaptura() { const el = $('bpCaptura'); if (el) { el.hidden = true; el.innerHTML = ''; } }
  async function guardarPrecio() {
    const precio = parseFloat($('bpPreMonto').value);
    if (!(precio >= 0)) { Toast.warning('Captura un precio válido (sin IVA).'); return; }
    const fila = { insumo_id: ficha.insumo.id, precio, fecha: $('bpPreFecha').value, plaza: $('bpPrePlaza').value, fuente: $('bpPreFuente').value,
      proveedor_id: parseInt($('bpPreProv').value, 10) || null, notas: $('bpPreNota').value.trim() || null };
    if (!fila.fecha) { Toast.warning('Falta la fecha del precio.'); return; }
    const btn = $('bpPreGuardar'); btn.disabled = true;
    try {
      const { error } = await sb.from('insumo_precios').insert(fila);
      if (error) throw error;
      Toast.success('Precio registrado.');
      await cargar(true);
      if (est.resultados) await ejecutarBusqueda(); else if ($('bpLista')) pintarListaInsumos();
      abrirInsumo(fila.insumo_id);
    } catch (e) {
      Toast.error(e && e.code === '23505' ? 'Ya hay un precio de ese día, plaza y fuente para este insumo. Cambia la fecha o la fuente.' : humanizeError(e, 'Precio'));
      btn.disabled = false;
    }
  }

  return {
    render, cargar, recargar, irA, nuevoInsumo, editarInsumo, guardarInsumo, buscar, filtrarPlaza, filtrarTipo,
    abrirInsumo, cerrarInsumo, mostrarCaptura, ocultarCaptura, guardarPrecio,
    abrirFusion, buscarDestino, elegirDestino, confirmarFusion,
    // puras
    hoyMx, normalizarTexto, antiguedadDias, esViejo, precioVigente, variacionAnual, seriesPorPlaza, grupoFuente,
    TIPOS, PLAZAS, FUENTES, DIAS_PRECIO_VIEJO, LIMITE_PAGINA, COLUMNAS, UMBRAL_PARECIDO,
  };
})();
if (typeof module !== 'undefined') module.exports = BancoPrecios;
