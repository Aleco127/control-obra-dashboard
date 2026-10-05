/**
 * Licitaciones (PRD licitaciones · épica C, US-813 a US-821). Módulo de la barra `lc` (grupo «Licitaciones»),
 * sólo nivel >= 80 (RLS y RPC lo exigen en el servidor).
 *
 * Carga perezosa (D4): NO entra a load_all_data_seguro. Al abrirse, `cargar()` lee public.licitaciones y deja la lista
 * en `D.lic` (propiedad NO enumerable: no va a obra_cache ni a localStorage). La ficha pide sus hijos (requisitos,
 * archivos, historial) al abrirse y los guarda en el estado del módulo, no en D.
 * En el build el archivo sale como módulo diferido (js/licitaciones.<hash>.js en __LAZY['lc']); sin build lo carga
 * abrirModuloArchivo() de index.html. Calendario, Documentos y Configuración lo piden con conModuloArchivo('lc').
 *
 * Pestañas ampliables: LISTA_PESTANAS (nivel de la lista) y FICHA_PESTANAS (ficha de una licitación) son arreglos de
 * {k, t, ic, pintar(el, ctx)}. Otra épica agrega las suyas con registrarPestana('lista'|'ficha', def, despuesDe).
 *
 * Escrituras por RPC (migración 092 y siguientes): guardar_licitacion, guardar_requisito, cambiar_estado_requisito,
 * ordenar_requisitos. Fechas clave: timestamptz; en pantalla siempre en hora de México (sin horario de verano desde
 * 2022: UTC-6).
 *
 * Depende de (navegador): sb, D, M, S, $, fmt, Skeleton, EmptyState, humanizeError, Toast, Dialog, openMdl, closeMdl,
 * currentUser, irAModulo. Las funciones puras se exportan con module.exports para node --test.
 */
const Licitaciones = (() => {
  'use strict';

  // ---- Catálogos (slugs de la BD → etiquetas) ----------------------------------------------------------------------
  const ESTATUS = {
    en_preparacion: 'En preparación', presentada: 'Presentada', ganada: 'Ganada', perdida: 'Perdida',
    desierta: 'Desierta', cancelada: 'Cancelada', no_participamos: 'No participamos',
  };
  const MODALIDADES = {
    licitacion_publica: 'Licitación pública', invitacion: 'Invitación a cuando menos tres personas',
    adjudicacion_directa: 'Adjudicación directa', privada: 'Privada',
  };
  const PLAZAS = {
    cuauhtemoc: 'Cd. Cuauhtémoc', chihuahua: 'Chihuahua', juarez: 'Cd. Juárez', parral: 'Parral',
    casas_grandes: 'Casas Grandes', otra: 'Otra',
  };
  const SOBRES = { legal: 'Legal', tecnico: 'Técnico', economico: 'Económico' };
  const ORIGENES = { expediente: 'Del expediente', se_genera: 'Se genera', opus: 'Sale de OPUS', dependencia: 'Lo entrega la dependencia' };
  const ESTADOS_REQUISITO = {
    pendiente: 'Pendiente', en_revision: 'En revisión', listo: 'Listo', firmado: 'Firmado', escaneado: 'Escaneado',
    foliado: 'Foliado', validado: 'Validado',
  };
  /** Estados que cuentan como «terminado» para el avance (de «Listo» en adelante). */
  const ESTADOS_HECHOS = ['listo', 'firmado', 'escaneado', 'foliado', 'validado'];
  const CATEGORIAS_ARCHIVO = {
    bases: 'Bases', anexo: 'Anexo', acta_junta: 'Acta de junta', plano: 'Plano', catalogo: 'Catálogo',
    circular: 'Circular', fallo: 'Fallo', otro: 'Otro',
  };
  /** Fechas clave en el orden en que ocurren en un concurso. */
  const FECHAS_CLAVE = [
    ['visita', 'Visita de obra'], ['junta_aclaraciones', 'Junta de aclaraciones'],
    ['presentacion', 'Presentación'], ['fallo', 'Fallo'],
  ];
  const METODOS_EVALUACION = { puntos_y_porcentajes: 'Puntos y porcentajes', binario: 'Binario (cumple / no cumple)', precio_mas_bajo: 'Precio más bajo', otro: 'Otro' };
  /** Columnas que pide la lista (lista explícita, como las vistas). */
  const COLUMNAS = 'id,codigo,nombre,convocante,perfil_id,modalidad,plaza,visita,junta_aclaraciones,presentacion,fallo,estatus,monto_propuesto,monto_ganador,obra_id,updated_at,created_at';
  const COLUMNAS_FICHA = 'id,codigo,nombre,convocante,perfil_id,modalidad,ubicacion,plaza,visita,junta_aclaraciones,presentacion,fallo,inicio_obra,plazo_dias,anticipo_pct,presupuesto_base,monto_propuesto,monto_ganador,ganador,estatus,bases,opus_proyecto,obra_id,notas,created_at,updated_at,lecciones';
  const COLUMNAS_REQ = 'id,licitacion_id,anexo_id,sobre,descripcion,origen,estado,requiere_firma,categoria_expediente,empresa_documento_id,archivo_path,responsable,orden,notas,updated_at';
  const TZ = 'America/Mexico_City';
  const OFFSET_MX = '-06:00';

  // ---- Funciones puras ------------------------------------------------------------------------------------------------
  /** Fecha civil de hoy en México (YYYY-MM-DD). */
  function hoyMx(d) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
  }
  /** Fecha civil (YYYY-MM-DD) en México de una fecha o timestamp. */
  function fechaMx(v) {
    if (!v) return null;
    const s = String(v);
    return s.length > 10 ? hoyMx(new Date(s)) : s.slice(0, 10);
  }
  /** Días civiles entre hoy (YYYY-MM-DD) y una fecha/timestamp, contada en México. Negativo si ya pasó. */
  function diasHasta(fecha, hoy) {
    if (!fecha) return null;
    const f = fechaMx(fecha);
    const a = Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10));
    const h = String(hoy || hoyMx());
    const b = Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 1, +h.slice(8, 10));
    return Math.round((a - b) / 86400000);
  }
  /** Próxima fecha clave (hoy o después) de una licitación: {campo, etiqueta, fecha, dias} o null. */
  function proximaFechaClave(lic, hoy) {
    if (!lic) return null;
    for (const [campo, etiqueta] of FECHAS_CLAVE) {
      const dias = diasHasta(lic[campo], hoy);
      if (dias !== null && dias >= 0) return { campo, etiqueta, fecha: lic[campo], dias };
    }
    return null;
  }
  /** KPIs de la lista: en preparación, presentadas, ganadas en el año y % de éxito (ganadas / con fallo del año). */
  function resumen(lics, anio) {
    const a = String(anio || hoyMx().slice(0, 4));
    const delAnio = (l) => String(l.fallo || l.presentacion || '').slice(0, 4) === a;
    const lista = Array.isArray(lics) ? lics : [];
    const enPrep = lista.filter((l) => l.estatus === 'en_preparacion').length;
    const presentadas = lista.filter((l) => l.estatus === 'presentada').length;
    const ganadas = lista.filter((l) => l.estatus === 'ganada' && delAnio(l)).length;
    const resueltas = lista.filter((l) => ['ganada', 'perdida', 'desierta'].includes(l.estatus) && delAnio(l)).length;
    return { en_preparacion: enPrep, presentadas, ganadas_anio: ganadas, resueltas_anio: resueltas, pct_exito: resueltas ? Math.round((ganadas / resueltas) * 100) : null };
  }
  const etiqueta = (mapa, v) => (v && mapa[v]) || v || '';
  /** Año de una licitación para el filtro: el de su presentación (en México) o, sin fecha, el de su alta. */
  function anioDe(l) { return String(fechaMx(l.presentacion) || fechaMx(l.created_at) || '').slice(0, 4); }
  /** Filtra la lista por estatus y año ('' = todos). */
  function filtrar(lics, f) {
    const est = (f && f.estatus) || ''; const anio = (f && f.anio) || '';
    return (lics || []).filter((l) => (!est || l.estatus === est) && (!anio || anioDe(l) === String(anio)));
  }
  /** Años presentes en la lista, del más reciente al más viejo. */
  function aniosDe(lics) { return [...new Set((lics || []).map(anioDe).filter(Boolean))].sort().reverse(); }
  /** Valor de <input type="datetime-local"> (YYYY-MM-DDTHH:MM, hora de México) desde un timestamptz. */
  function aLocalMx(ts) {
    if (!ts) return '';
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ts)).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  /** timestamptz ISO (hora de México) desde 'YYYY-MM-DD' o 'YYYY-MM-DDTHH:MM'. Una fecha sola queda a las 10:00. */
  function aIsoMx(v) {
    const s = String(v || '').trim();
    if (!s) return null;
    const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return null;
    return `${m[1]}T${m[2] || '10'}:${m[3] || '00'}:00${OFFSET_MX}`;
  }
  /** «12 oct 2026, 10:00» en hora de México. */
  function fmtFechaHora(ts) {
    if (!ts) return '';
    return new Intl.DateTimeFormat('es-MX', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
  }
  function fmtFecha(f) {
    if (!f) return '';
    const s = fechaMx(f);
    return new Date(s + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  /** Avance de requisitos por sobre: {legal:{total, hechos, pct}, ..., total:{...}}. */
  function avancePorSobre(reqs) {
    const out = {};
    for (const s of [...Object.keys(SOBRES), 'total']) out[s] = { total: 0, hechos: 0, pct: 0 };
    for (const r of reqs || []) {
      for (const k of [r.sobre, 'total']) {
        if (!out[k]) continue;
        out[k].total += 1;
        if (ESTADOS_HECHOS.includes(r.estado)) out[k].hechos += 1;
      }
    }
    for (const k of Object.keys(out)) out[k].pct = out[k].total ? Math.round((out[k].hechos / out[k].total) * 100) : 0;
    return out;
  }
  /** Escape HTML propio (el Calendario pinta título y ubicación sin escapar: se entregan ya escapados). */
  const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  /**
   * Eventos virtuales del Calendario (US-814): visita, junta, presentación y fallo de cada licitación viva.
   * Id negativo y estable (-(id*10 + k)) para no chocar con los eventos reales; `_lic` lleva el id de la licitación.
   */
  function eventosDeLicitacion(lics, hoy) {
    const h = hoy || hoyMx();
    const out = [];
    for (const l of lics || []) {
      if (['cancelada', 'no_participamos'].includes(l.estatus)) continue;
      FECHAS_CLAVE.forEach(([campo, et], k) => {
        if (!l[campo]) return;
        const local = aLocalMx(l[campo]);
        const fecha = local.slice(0, 10);
        out.push({
          id: -(l.id * 10 + k + 1), _lic: l.id, _campo: campo, tipo: 'Licitación', color: 'amber',
          titulo: esc(`${et} · ${l.codigo}`), descripcion: esc(l.nombre || ''), fecha_inicio: fecha,
          hora_inicio: local.slice(11, 16) + ':00', ubicacion: esc(l.convocante || ''), obra_id: null,
          estatus: fecha < h ? 'Completado' : 'Pendiente',
        });
      });
    }
    return out.sort((a, b) => (a.fecha_inicio + a.hora_inicio).localeCompare(b.fecha_inicio + b.hora_inicio));
  }
  /** Mensaje de error: el texto en español de nuestras RPC tal cual; lo demás por humanizeError. */
  function errTxt(e, ctx) {
    const m = e && e.message ? String(e.message) : '';
    if (m && /[áéíóúñ¿]/i.test(m) && !/duplicate key|violates|permission denied|row-level/i.test(m)) return (ctx ? ctx + ': ' : '') + m;
    return typeof humanizeError === 'function' ? humanizeError(e, ctx) : (ctx ? ctx + ': ' : '') + m;
  }

  // ---- Estado y datos (navegador) -----------------------------------------------------------------------------------
  let enVuelo = null;
  let pintadas = 0;
  const st = { lista: 'licitaciones', ficha: null, tab: 'resumen', filtro: { estatus: '', anio: '' }, sobre: 'legal' };
  /** Datos de la ficha abierta: {lic, reqs, archivos} (se piden al abrirla). */
  let F = null;
  let perfiles = null;

  function guardarEnD(clave, valor) {
    Object.defineProperty(D, clave, { value: valor, writable: true, configurable: true, enumerable: false });
  }
  /** Lee las licitaciones de la empresa y las deja en D.lic. Con force vuelve a pedirlas. Devuelve el arreglo. */
  async function cargar(force) {
    if (!force && Array.isArray(D.lic)) return D.lic;
    if (enVuelo && !force) return enVuelo;
    enVuelo = (async () => {
      const { data, error } = await sb.from('licitaciones').select(COLUMNAS)
        .order('presentacion', { ascending: false, nullsFirst: false }).order('id', { ascending: false });
      if (error) throw error;
      guardarEnD('lic', data || []);
      guardarEnD('licCal', eventosDeLicitacion(D.lic));
      return D.lic;
    })();
    try { return await enVuelo; } finally { enVuelo = null; }
  }
  /** Perfiles de convocante visibles (fábrica + empresa), activos primero. */
  async function cargarPerfiles(force) {
    if (perfiles && !force) return perfiles;
    const { data, error } = await sb.from('perfiles_convocante').select('id,empresa_id,nombre,descripcion,naming_pattern,sobres_json,requisitos_json,es_fabrica,activo,updated_at').order('es_fabrica', { ascending: false }).order('nombre');
    if (error) throw error;
    perfiles = data || [];
    return perfiles;
  }
  /** Eventos del Calendario (D.licCal). El Calendario lo llama al pintar; devuelve la promesa de la carga. */
  async function cargarCalendario() {
    if (!Array.isArray(D.licCal)) await cargar(true);
    return D.licCal || [];
  }
  /** Tras guardar: actualiza la fila en D.lic y los eventos del Calendario sin volver a pedir todo. */
  function actualizarEnLista(row) {
    if (!row || !Array.isArray(D.lic)) return;
    const base = {}; COLUMNAS.split(',').forEach((c) => { base[c] = row[c] === undefined ? null : row[c]; });
    const i = D.lic.findIndex((l) => l.id === row.id);
    if (i >= 0) D.lic[i] = Object.assign(D.lic[i], base); else D.lic.unshift(base);
    guardarEnD('licCal', eventosDeLicitacion(D.lic));
  }
  async function rpc(nombre, args, ctx) {
    const { data, error } = await sb.rpc(nombre, args);
    if (error) throw Object.assign(error, { _ctx: ctx });
    if (data && data.success === false) throw new Error(data.error || 'No se pudo completar la acción.');
    return data;
  }

  // ---- Modal propio del módulo ----------------------------------------------------------------------------------------
  function modal(titulo, cuerpo, ancho) {
    let m = document.getElementById('mdlLic');
    if (!m) {
      document.body.insertAdjacentHTML('beforeend', '<div id="mdlLic" class="modal"><div id="mdlLicC" class="modal-content g rounded-2xl p-5 w-full mx-4 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="mdlLicT"></div></div>');
      m = document.getElementById('mdlLic');
      m.addEventListener('click', (e) => { if (e.target === m) cerrarModal(); });
    }
    const c = document.getElementById('mdlLicC');
    c.className = `modal-content g rounded-2xl p-5 w-full mx-4 max-h-[90vh] overflow-y-auto ${ancho || 'max-w-2xl'}`;
    c.innerHTML = `<div class="flex items-start justify-between gap-3 mb-4"><h2 id="mdlLicT" class="text-lg font-bold n">${S(titulo)}</h2>
<button type="button" class="btn-icon" onclick="Licitaciones.cerrarModal()" aria-label="Cerrar"><i class="ri-close-line text-xl" aria-hidden="true"></i></button></div>${cuerpo}`;
    openMdl('mdlLic');
    setTimeout(() => { const f = c.querySelector('input:not([type=hidden]),select,textarea'); if (f) f.focus(); }, 30);
    return c;
  }
  function cerrarModal() { closeMdl('mdlLic'); }
  const campo = (id, et, html, cls) => `<div class="${cls || ''}"><label class="text-xs mb-1 block" for="${id}">${et}</label>${html}</div>`;
  const opciones = (mapa, sel, vacio) => (vacio !== undefined ? `<option value="">${S(vacio)}</option>` : '') + Object.entries(mapa).map(([k, v]) => `<option value="${S(k)}" ${k === sel ? 'selected' : ''}>${S(v)}</option>`).join('');
  const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };

  // ---- Pestañas ampliables --------------------------------------------------------------------------------------------
  const LISTA_PESTANAS = [
    { k: 'licitaciones', t: 'Licitaciones', ic: 'ri-auction-line', pintar: pintarLista },
  ];
  const FICHA_PESTANAS = [
    { k: 'resumen', t: 'Resumen', ic: 'ri-dashboard-line', pintar: pintarResumen },
    { k: 'bases', t: 'Bases', ic: 'ri-file-list-3-line', pintar: pintarBases },
    { k: 'archivos', t: 'Archivos', ic: 'ri-folder-3-line', pintar: pintarArchivos },
    { k: 'requisitos', t: 'Requisitos', ic: 'ri-checkbox-multiple-line', pintar: pintarRequisitos },
    { k: 'precios', t: 'Precios', ic: 'ri-price-tag-3-line', pintar: pintarPrecios },
    { k: 'cierre', t: 'Cierre', ic: 'ri-flag-2-line', pintar: pintarCierre },
  ];
  /** Agrega una pestaña ({k, t, ic, pintar(el, ctx)}) a la lista o a la ficha; despuesDe = clave de otra pestaña. */
  function registrarPestana(donde, def, despuesDe) {
    const arr = donde === 'ficha' ? FICHA_PESTANAS : LISTA_PESTANAS;
    if (!def || !def.k || typeof def.pintar !== 'function' || arr.some((p) => p.k === def.k)) return false;
    const i = despuesDe ? arr.findIndex((p) => p.k === despuesDe) : -1;
    if (i >= 0) arr.splice(i + 1, 0, def); else arr.push(def);
    return true;
  }
  function tabsHtml(arr, activa, fn, etiquetaAria) {
    return `<div class="tabs mb-4" role="tablist" aria-label="${S(etiquetaAria)}">${arr.map((p) => `<button type="button" role="tab" id="lcTab-${S(p.k)}" aria-selected="${p.k === activa}" aria-controls="lcPanel" class="tab ${p.k === activa ? 'active' : ''}" onclick="Licitaciones.${fn}('${S(p.k)}')"><i class="${S(p.ic || 'ri-file-line')}" aria-hidden="true"></i> ${S(p.t)}</button>`).join('')}</div>`;
  }

  // ---- Lista (US-813) ---------------------------------------------------------------------------------------------------
  function cabecera() {
    return `<div class="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4"><div>
<h1 class="text-xl font-bold"><i class="ri-auction-line" aria-hidden="true"></i> Licitaciones</h1>
<p class="text-sm text-ink-muted mt-1">Cada concurso con sus fechas clave, los archivos de la convocante y los requisitos por sobre.</p></div>
<button type="button" class="btn btn-p" onclick="Licitaciones.nueva()"><i class="ri-add-line" aria-hidden="true"></i> Nueva licitación</button></div>`;
  }
  function chipEstatus(s) {
    const tono = { ganada: 'ok', presentada: 'accent', en_preparacion: 'warn', perdida: 'danger' }[s];   // --info sobre --info-soft no llega a 4.5:1
    const estilo = tono ? `background:var(--${tono}-soft);color:var(--${tono})` : 'background:var(--surface-2);color:var(--ink-muted)';
    return `<span class="chip" style="${estilo}">${S(etiqueta(ESTATUS, s))}</span>`;
  }
  function textoProxima(p) {
    if (!p) return '<span class="text-ink-subtle">Sin fechas próximas</span>';
    const cuando = p.dias === 0 ? 'hoy' : p.dias === 1 ? 'mañana' : `en ${p.dias} días`;
    const tono = p.dias <= 3 ? 'text-danger font-semibold' : p.dias <= 7 ? 'text-warn font-semibold' : '';
    return `${S(p.etiqueta)} · <span class="${tono}">${cuando}</span><span class="block text-xs text-ink-muted">${S(fmtFechaHora(p.fecha))}</span>`;
  }
  function pintarLista(el) {
    const lics = D.lic || [];
    if (!lics.length) { el.innerHTML = vacio(); return; }
    const hoy = hoyMx();
    const k = resumen(lics);
    const kpi = (t, v) => `<div class="kpi"><p class="kpi-v">${v}</p><p class="kpi-l">${t}</p></div>`;
    const anios = aniosDe(lics);
    const vis = filtrar(lics, st.filtro);
    const filas = vis.map((l) => {
      const p = proximaFechaClave(l, hoy);
      return `<tr class="cursor-pointer" onclick="Licitaciones.abrir(${+l.id})"><td data-et="Código" class="font-mono text-xs"><button type="button" class="text-accent hover:underline text-left" onclick="event.stopPropagation();Licitaciones.abrir(${+l.id})">${S(l.codigo)}</button></td><td data-et="Nombre"><span>${S(l.nombre)}</span></td><td data-et="Convocante"><span>${S(l.convocante || '—')}</span></td><td data-et="Estatus"><span>${chipEstatus(l.estatus)}</span></td><td data-et="Próxima fecha"><span>${textoProxima(p)}</span></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="text-center py-6 text-ink-muted">Ninguna licitación coincide con los filtros.</td></tr>';
    el.innerHTML = `<div class="kpi-strip">${kpi('En preparación', k.en_preparacion)}${kpi('Presentadas', k.presentadas)}${kpi('Ganadas en el año', k.ganadas_anio)}${kpi('Éxito en el año', k.pct_exito === null ? '—' : k.pct_exito + ' %')}</div>
<div class="flex flex-wrap gap-2 mb-3 items-end">
${campo('lcFEst', 'Estatus', `<select id="lcFEst" class="inp" onchange="Licitaciones.filtro('estatus',this.value)">${opciones(ESTATUS, st.filtro.estatus, 'Todos')}</select>`)}
${campo('lcFAnio', 'Año', `<select id="lcFAnio" class="inp" onchange="Licitaciones.filtro('anio',this.value)"><option value="">Todos</option>${anios.map((a) => `<option ${a === st.filtro.anio ? 'selected' : ''}>${S(a)}</option>`).join('')}</select>`)}
<p class="text-xs text-ink-muted ml-auto self-center">${vis.length} de ${lics.length}</p></div>
<div class="table-wrap g rounded-xl" tabindex="0" role="region" aria-label="Lista de licitaciones"><table class="table-modern lc-tbl w-full text-sm"><thead><tr><th scope="col">Código</th><th scope="col">Nombre</th><th scope="col">Convocante</th><th scope="col">Estatus</th><th scope="col">Próxima fecha</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  }
  function vacio() {
    return EmptyState({
      icon: 'ri-auction-line', title: 'Aún no hay licitaciones',
      body: 'Registra cada concurso con su convocante y su fecha de presentación; después le agregas las bases, los archivos y los requisitos por sobre.',
      action: { label: 'Nueva licitación', icon: 'ri-add-line', onClick: 'Licitaciones.nueva()' },
    });
  }
  function errorHtml(e) {
    return EmptyState({
      icon: 'ri-error-warning-line', title: 'No se pudieron cargar las licitaciones',
      body: errTxt(e), action: { label: 'Reintentar', icon: 'ri-refresh-line', onClick: 'Licitaciones.recargar()' },
    });
  }
  function filtro(k, v) { st.filtro[k] = v || ''; const el = $('lcPanel'); if (el) pintarLista(el); }

  /** Pinta el módulo en el contenedor: esqueleto mientras carga, lista/ficha, estado vacío o error. */
  async function render(c, force) {
    const turno = ++pintadas;
    if (st.ficha) return renderFicha(c, turno, force);
    c.innerHTML = cabecera() + `<div id="lcCuerpo" aria-busy="true" aria-live="polite">${Skeleton.table(4, 5)}</div>`;
    const cuerpo = () => (turno === pintadas && M === 'lc' ? $('lcCuerpo') : null);
    try {
      await cargar(force);
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      const tab = LISTA_PESTANAS.find((p) => p.k === st.lista) || LISTA_PESTANAS[0];
      el.innerHTML = (LISTA_PESTANAS.length > 1 ? tabsHtml(LISTA_PESTANAS, tab.k, 'tabLista', 'Secciones de licitaciones') : '') + '<div id="lcPanel" role="tabpanel"></div>';
      await tab.pintar($('lcPanel'), { lics: D.lic });
    } catch (e) {
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      el.innerHTML = errorHtml(e);
    }
  }
  function recargar() { const c = $('c'); if (c) render(c, true); }
  function tabLista(k) { st.lista = k; const c = $('c'); if (c && M === 'lc') render(c); }

  // ---- Alta y edición de datos generales (US-813) --------------------------------------------------------------------------
  async function nueva() { return editarDatos(null); }
  async function editarDatos(id) {
    let ps = [];
    try { ps = await cargarPerfiles(); } catch (e) { /* sin perfiles se puede dar de alta igual */ }
    const l = id ? (F && F.lic && F.lic.id === id ? F.lic : (D.lic || []).find((x) => x.id === id)) || {} : {};
    const optsPerfil = '<option value="">Sin perfil</option>' + ps.filter((p) => p.activo || p.id === l.perfil_id).map((p) => `<option value="${+p.id}" ${p.id === l.perfil_id ? 'selected' : ''}>${S(p.nombre)}${p.es_fabrica ? ' (de fábrica)' : ''}</option>`).join('');
    modal(id ? 'Editar datos de la licitación' : 'Nueva licitación', `<form id="lcFormAlta" onsubmit="event.preventDefault();Licitaciones.guardarDatos(${id ? +id : 'null'})" class="space-y-3">
<div class="grid sm:grid-cols-2 gap-3">
${campo('lcCodigo', 'Código o número de concurso *', `<input id="lcCodigo" class="inp font-mono" required maxlength="120" value="${S(l.codigo || '')}" placeholder="Ej. MC-2617057-057">`)}
${campo('lcPresentacion', 'Presentación de propuestas', `<input id="lcPresentacion" type="datetime-local" class="inp" value="${S(aLocalMx(l.presentacion))}">`)}
${campo('lcNombre', 'Nombre de la obra *', `<input id="lcNombre" class="inp" required maxlength="300" value="${S(l.nombre || '')}" placeholder="Ej. Construcción de Archivo Municipal II etapa">`, 'sm:col-span-2')}
${campo('lcConvocante', 'Convocante', `<input id="lcConvocante" class="inp" maxlength="200" value="${S(l.convocante || '')}" placeholder="Ej. Municipio de Cuauhtémoc">`)}
${campo('lcPerfil', 'Perfil de convocante', `<select id="lcPerfil" class="inp">${optsPerfil}</select><p class="field-hint">Trae la lista típica de anexos por sobre de esa dependencia.</p>`)}
</div>
<p class="text-xs text-ink-muted">Lo demás (bases, fechas, archivos y requisitos) lo completas después en la ficha.</p>
<div class="flex justify-end gap-2 pt-2"><button type="button" class="btn btn-s" onclick="Licitaciones.cerrarModal()">Cancelar</button>
<button type="submit" class="btn btn-p"><i class="ri-save-line" aria-hidden="true"></i> ${id ? 'Guardar cambios' : 'Crear licitación'}</button></div></form>`);
  }
  async function guardarDatos(id) {
    const f = document.getElementById('lcFormAlta');
    if (f && !f.reportValidity()) return;
    const datos = { codigo: val('lcCodigo'), nombre: val('lcNombre'), convocante: val('lcConvocante'), perfil_id: val('lcPerfil') || null, presentacion: aIsoMx(val('lcPresentacion')) };
    if (id) datos.id = id;
    try {
      const r = await rpc('guardar_licitacion', { p_datos: datos });
      cerrarModal();
      actualizarEnLista(r.licitacion);
      Toast.success(id ? 'Datos guardados' : 'Licitación creada: ' + r.licitacion.codigo);
      if (id && F && F.lic && F.lic.id === id) { Object.assign(F.lic, r.licitacion); repintarFicha(); } else if (!id) abrir(r.id);
    } catch (e) { Toast.error(errTxt(e, 'No se guardó la licitación')); }
  }

  // ---- Ficha (US-814) ---------------------------------------------------------------------------------------------------
  /** Abre la ficha de una licitación (desde la lista, el Calendario o Documentos). */
  function abrir(id, tab) {
    st.ficha = +id; st.tab = tab || 'resumen'; F = null;
    if (M !== 'lc') { if (typeof irAModulo === 'function') irAModulo('lc'); else { M = 'lc'; R(); } return; }
    const c = $('c'); if (c) render(c);
  }
  function volver() { st.ficha = null; F = null; const c = $('c'); if (c) render(c); }
  async function cargarFicha(id) {
    const [l, r, a] = await Promise.all([
      sb.from('licitaciones').select(COLUMNAS_FICHA).eq('id', id).maybeSingle(),
      sb.from('licitacion_requisitos').select(COLUMNAS_REQ).eq('licitacion_id', id).order('sobre').order('orden').order('id'),
      sb.from('licitacion_archivos').select('id,licitacion_id,categoria,nombre,archivo_path,tamano,hash_sha256,mime,created_at').eq('licitacion_id', id).order('created_at', { ascending: false }),
    ]);
    if (l.error) throw l.error; if (r.error) throw r.error; if (a.error) throw a.error;
    if (!l.data) return null;
    if (!l.data.bases || typeof l.data.bases !== 'object') l.data.bases = {};
    const ctx = { lic: l.data, reqs: r.data || [], archivos: a.data || [], docs: [], docsError: null };
    // Expediente (US-818): sólo lectura de la vista de la épica B; si falla, la ficha sigue sin ligas.
    try {
      const d = await sb.from('empresa_documentos_estado').select('id,categoria,nombre,archivo_path,mime,fecha_emision,fecha_vencimiento,reemplaza_id,reemplazado_por_id,estado,dias_restantes,hash_sha256').order('fecha_emision', { ascending: false, nullsFirst: false });
      if (d.error) throw d.error;
      ctx.docs = d.data || [];
    } catch (e) { ctx.docsError = e; }
    return ctx;
  }
  async function renderFicha(c, turno, force) {
    c.innerHTML = `<div id="lcCuerpo" aria-busy="true" aria-live="polite">${Skeleton.table(4, 4)}</div>`;
    try {
      if (!F || force || F.lic.id !== st.ficha) F = await cargarFicha(st.ficha);
      if (turno !== pintadas || M !== 'lc') return;
      if (!F) { st.ficha = null; Toast.warning('Esa licitación ya no existe.'); return render(c); }
      repintarFicha();
    } catch (e) {
      if (turno !== pintadas || M !== 'lc') return;
      c.innerHTML = EmptyState({ icon: 'ri-error-warning-line', title: 'No se pudo abrir la licitación', body: errTxt(e), action: { label: 'Volver a la lista', icon: 'ri-arrow-left-line', onClick: 'Licitaciones.volver()' } });
    }
  }
  function repintarFicha() {
    const c = $('c'); if (!c || !F || M !== 'lc') return;
    const l = F.lic;
    const tab = FICHA_PESTANAS.find((p) => p.k === st.tab) || FICHA_PESTANAS[0];
    c.innerHTML = `<nav aria-label="Ruta" class="text-sm mb-2"><button type="button" class="text-accent hover:underline" onclick="Licitaciones.volver()"><i class="ri-arrow-left-line" aria-hidden="true"></i> Licitaciones</button></nav>
<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3"><div class="min-w-0">
<p class="font-mono text-xs text-ink-muted">${S(l.codigo)}</p><h1 class="text-xl font-bold">${S(l.nombre)}</h1>
<p class="text-sm text-ink-muted mt-1">${S(l.convocante || 'Sin convocante')} · ${chipEstatus(l.estatus)}</p></div>
<div class="flex flex-wrap gap-2"><button type="button" class="btn btn-s" onclick="Licitaciones.editarDatos(${+l.id})"><i class="ri-edit-line" aria-hidden="true"></i> Editar datos</button></div></div>
${tabsHtml(FICHA_PESTANAS, tab.k, 'tabFicha', 'Secciones de la licitación')}<div id="lcPanel" role="tabpanel" aria-labelledby="lcTab-${S(tab.k)}"></div>`;
    tab.pintar($('lcPanel'), F);
  }
  function tabFicha(k) { st.tab = k; repintarFicha(); }

  // Resumen ------------------------------------------------------------------------------------------------------------
  function barraAvance(a, et) {
    return `<div class="mb-3"><div class="flex justify-between text-sm mb-1"><span>${S(et)}</span><span class="text-ink-muted">${a.hechos} de ${a.total} · ${a.pct} %</span></div>
<div class="lc-avance" role="progressbar" aria-label="Avance de ${S(et)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${a.pct}"><span style="width:${a.pct}%"></span></div></div>`;
  }
  function pintarResumen(el, ctx) {
    const l = ctx.lic; const hoy = hoyMx();
    const av = avancePorSobre(ctx.reqs);
    const fechas = FECHAS_CLAVE.map(([k, et]) => {
      const d = diasHasta(l[k], hoy);
      const extra = d === null ? '' : d < 0 ? '<span class="text-ink-muted"> · ya pasó</span>' : d === 0 ? ' · <b class="text-danger">hoy</b>' : ` · <span class="${d <= 3 ? 'text-danger font-semibold' : ''}">en ${d} día${d === 1 ? '' : 's'}</span>`;
      return `<li class="flex justify-between gap-3 py-2 border-b" style="border-color:var(--line)"><span class="text-ink-muted">${S(et)}</span><span class="text-right">${l[k] ? S(fmtFechaHora(l[k])) + extra : '<span class="text-ink-subtle">Sin fecha</span>'}</span></li>`;
    }).join('');
    const dato = (et, v) => `<div><p class="text-xs text-ink-muted">${S(et)}</p><p class="font-medium">${v || '<span class="text-ink-subtle">—</span>'}</p></div>`;
    el.innerHTML = `<div class="grid lg:grid-cols-2 gap-4">
<section class="g rounded-xl p-4" aria-labelledby="lcResFechas"><h2 id="lcResFechas" class="font-bold text-sm mb-2"><i class="ri-calendar-event-line" aria-hidden="true"></i> Fechas clave</h2><ul class="text-sm">${fechas}</ul>
<p class="text-xs text-ink-muted mt-2">Aparecen en el Calendario con el tipo «Licitación».</p></section>
<section class="g rounded-xl p-4" aria-labelledby="lcResAv"><h2 id="lcResAv" class="font-bold text-sm mb-3"><i class="ri-checkbox-multiple-line" aria-hidden="true"></i> Avance de requisitos por sobre</h2>
${av.total.total ? Object.keys(SOBRES).map((s) => barraAvance(av[s], 'Sobre ' + SOBRES[s].toLowerCase())).join('') + `<p class="text-xs text-ink-muted">Cuenta como hecho de «Listo» en adelante.</p>` : `<p class="text-sm text-ink-muted mb-3">Todavía no hay requisitos.</p><button type="button" class="btn btn-s" onclick="Licitaciones.tabFicha('requisitos')"><i class="ri-add-line" aria-hidden="true"></i> Capturar requisitos</button>`}</section>
<section class="g rounded-xl p-4 lg:col-span-2" aria-labelledby="lcResDatos"><h2 id="lcResDatos" class="font-bold text-sm mb-3"><i class="ri-information-line" aria-hidden="true"></i> Datos del concurso</h2>
<div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
${dato('Modalidad', S(etiqueta(MODALIDADES, l.modalidad)))}${dato('Plaza', S(etiqueta(PLAZAS, l.plaza)))}${dato('Plazo', l.plazo_dias ? S(l.plazo_dias + ' días') : '')}${dato('Anticipo', l.anticipo_pct != null ? S(l.anticipo_pct + ' %') : '')}
${dato('Presupuesto base', l.presupuesto_base != null ? S(fmt(l.presupuesto_base)) : '')}${dato('Nuestra propuesta', l.monto_propuesto != null ? S(fmt(l.monto_propuesto)) : '')}${dato('Inicio de obra', S(fmtFecha(l.inicio_obra)))}${dato('Archivos de la convocante', String((ctx.archivos || []).length))}
</div>${l.bases && l.bases.concurso && l.bases.concurso.objeto ? `<p class="text-sm mt-3"><span class="text-xs text-ink-muted block">Objeto</span>${S(l.bases.concurso.objeto)}</p>` : ''}</section></div>`;
  }

  // Bases (US-814): edición por secciones de lo que guarda bases.json --------------------------------------------------------
  const b = (o, ruta) => ruta.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
  function setRuta(o, ruta, v) {
    const ks = ruta.split('.'); let x = o;
    ks.slice(0, -1).forEach((k) => { if (!x[k] || typeof x[k] !== 'object' || Array.isArray(x[k])) x[k] = {}; x = x[k]; });
    if (v === null || v === '' || (Array.isArray(v) && !v.length)) delete x[ks[ks.length - 1]]; else x[ks[ks.length - 1]] = v;
  }
  const lineas = (t) => String(t || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  /** Secciones de la pestaña Bases: campo = columna de licitaciones (col) o ruta dentro de bases (ruta). */
  const SECCIONES_BASES = [
    { k: 'objeto', t: 'Objeto', ic: 'ri-building-2-line', campos: [
      { ruta: 'concurso.objeto', et: 'Objeto de la obra', tipo: 'area', ancho: 2 },
      { col: 'modalidad', et: 'Modalidad', tipo: 'sel', mapa: MODALIDADES },
      { col: 'plaza', et: 'Plaza', tipo: 'sel', mapa: PLAZAS },
      { col: 'ubicacion', et: 'Ubicación', tipo: 'txt', ancho: 2 },
      { ruta: 'concurso.fuente_recursos', et: 'Fuente de los recursos', tipo: 'txt' },
      { col: 'opus_proyecto', et: 'Proyecto de OPUS', tipo: 'txt' },
    ] },
    { k: 'plazo', t: 'Plazo', ic: 'ri-timer-line', campos: [
      { col: 'plazo_dias', et: 'Plazo de ejecución (días)', tipo: 'int' },
      { ruta: 'fechas.tipo_dias', et: 'Tipo de días', tipo: 'sel', mapa: { naturales: 'Naturales', habiles: 'Hábiles' } },
      { col: 'inicio_obra', et: 'Inicio de obra', tipo: 'fecha' },
      { ruta: 'fechas.termino_obra', et: 'Término de obra', tipo: 'fecha' },
    ] },
    { k: 'anticipo', t: 'Anticipo y pago', ic: 'ri-hand-coin-line', campos: [
      { col: 'anticipo_pct', et: 'Anticipo (%)', tipo: 'num' },
      { ruta: 'economicos.financiamiento_pct', et: 'Financiamiento (%)', tipo: 'num' },
      { col: 'presupuesto_base', et: 'Presupuesto base (sin IVA)', tipo: 'num' },
      { ruta: 'economicos.moneda', et: 'Moneda', tipo: 'txt' },
      { ruta: 'economicos.forma_pago', et: 'Forma de pago', tipo: 'txt', ancho: 2 },
      { ruta: 'economicos.ajuste_costos', et: 'Ajuste de costos', tipo: 'txt', ancho: 2 },
    ] },
    { k: 'garantias', t: 'Garantías', ic: 'ri-shield-check-line', campos: [
      { ruta: 'economicos.garantias.seriedad_propuesta', et: 'Seriedad de la propuesta', tipo: 'txt' },
      { ruta: 'economicos.garantias.anticipo', et: 'Anticipo', tipo: 'txt' },
      { ruta: 'economicos.garantias.cumplimiento', et: 'Cumplimiento', tipo: 'txt' },
      { ruta: 'economicos.garantias.vicios_ocultos', et: 'Vicios ocultos', tipo: 'txt' },
    ] },
    { k: 'fechas', t: 'Fechas', ic: 'ri-calendar-event-line', campos: [
      { ruta: 'fechas.publicacion', et: 'Publicación', tipo: 'fecha' },
      { col: 'visita', et: 'Visita de obra', tipo: 'fh' },
      { col: 'junta_aclaraciones', et: 'Junta de aclaraciones', tipo: 'fh' },
      { col: 'presentacion', et: 'Presentación y apertura', tipo: 'fh' },
      { col: 'fallo', et: 'Fallo', tipo: 'fh' },
      { ruta: 'fechas.firma_contrato', et: 'Firma del contrato', tipo: 'fecha' },
    ] },
    { k: 'criterios', t: 'Criterios de evaluación', ic: 'ri-scales-3-line', campos: [
      { ruta: 'criterios_evaluacion.metodo', et: 'Método', tipo: 'sel', mapa: METODOS_EVALUACION },
      { ruta: 'criterios_evaluacion.puntos_legal', et: 'Puntos legal', tipo: 'num' },
      { ruta: 'criterios_evaluacion.puntos_tecnico', et: 'Puntos técnico', tipo: 'num' },
      { ruta: 'criterios_evaluacion.puntos_economico', et: 'Puntos económico', tipo: 'num' },
      { ruta: 'criterios_evaluacion.subcriterios', et: 'Subcriterios (uno por renglón: criterio | peso)', tipo: 'subcriterios', ancho: 2 },
    ] },
    { k: 'desechamiento', t: 'Causas de desechamiento', ic: 'ri-close-circle-line', campos: [
      { ruta: 'causas_desechamiento', et: 'Una causa por renglón', tipo: 'lista', ancho: 2 },
    ] },
    { k: 'notas', t: 'Notas importantes', ic: 'ri-sticky-note-line', campos: [
      { ruta: 'notas_importantes', et: 'Una nota por renglón', tipo: 'lista', ancho: 2 },
    ] },
  ];
  /** Valor de un campo de Bases para mostrarlo en un input. */
  function valorCampo(lic, c) {
    const v = c.col ? lic[c.col] : b(lic.bases, c.ruta);
    if (v === undefined || v === null) return '';
    if (c.tipo === 'fh') return aLocalMx(v);
    if (c.tipo === 'fecha') return String(v).slice(0, 10);
    if (c.tipo === 'lista') return (Array.isArray(v) ? v : [v]).join('\n');
    if (c.tipo === 'subcriterios') return (Array.isArray(v) ? v : []).map((x) => `${x.criterio || ''} | ${x.peso ?? ''}`).join('\n');
    return String(v);
  }
  /** Convierte lo capturado al valor que se guarda (columna o bases). */
  function leerCampo(c, crudo) {
    const s = String(crudo || '').trim();
    if (c.tipo === 'num' || c.tipo === 'int') { if (!s) return null; const n = Number(s.replace(/[$,\s%]/g, '')); return Number.isFinite(n) ? (c.tipo === 'int' ? Math.round(n) : n) : null; }
    if (c.tipo === 'fh') return aIsoMx(s);
    if (c.tipo === 'fecha') return s ? s.slice(0, 10) : null;
    if (c.tipo === 'lista') return lineas(s);
    if (c.tipo === 'subcriterios') return lineas(s).map((x) => { const [cr, pe] = x.split('|'); return { criterio: String(cr || '').trim(), peso: Number(String(pe || '').replace(/[%\s]/g, '')) || 0 }; }).filter((x) => x.criterio);
    return s || null;
  }
  function inputCampo(c, id, v) {
    if (c.tipo === 'area' || c.tipo === 'lista' || c.tipo === 'subcriterios') return `<textarea id="${id}" class="inp" rows="${c.tipo === 'area' ? 3 : 5}">${S(v)}</textarea>`;
    if (c.tipo === 'sel') return `<select id="${id}" class="inp">${opciones(c.mapa, v, 'Sin dato')}</select>`;
    const t = { fh: 'datetime-local', fecha: 'date', num: 'number', int: 'number' }[c.tipo] || 'text';
    return `<input id="${id}" type="${t}" class="inp" ${c.tipo === 'num' ? 'step="0.01"' : ''} ${c.tipo === 'int' ? 'step="1" min="0"' : ''} value="${S(v)}">`;
  }
  function pintarBases(el, ctx) {
    const l = ctx.lic;
    const pag = (c) => { const p = c.ruta && l.bases && l.bases.paginas ? l.bases.paginas[c.ruta] : null; return p ? ` <span class="text-ink-subtle">(pág. ${S(p)})</span>` : ''; };
    el.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-2 mb-3"><p class="text-sm text-ink-muted">Captura por secciones lo que piden las bases. Cada sección se guarda por separado.</p>
<button type="button" class="btn btn-s" onclick="Licitaciones.importarBases()"><i class="ri-upload-2-line" aria-hidden="true"></i> Importar bases</button></div>
<div class="space-y-3">${SECCIONES_BASES.map((s) => `<details class="g rounded-xl" ${s.k === 'objeto' ? 'open' : ''}><summary class="p-4 cursor-pointer font-bold text-sm"><i class="${s.ic}" aria-hidden="true"></i> ${S(s.t)}</summary>
<form class="px-4 pb-4" onsubmit="event.preventDefault();Licitaciones.guardarSeccion('${s.k}')"><div class="grid sm:grid-cols-2 gap-3">
${s.campos.map((c, i) => campo(`lcB-${s.k}-${i}`, S(c.et) + pag(c), inputCampo(c, `lcB-${s.k}-${i}`, valorCampo(l, c)), c.ancho === 2 ? 'sm:col-span-2' : '')).join('')}
</div><div class="flex justify-end mt-3"><button type="submit" class="btn btn-p"><i class="ri-save-line" aria-hidden="true"></i> Guardar ${S(s.t.toLowerCase())}</button></div></form></details>`).join('')}</div>`;
  }
  async function guardarSeccion(k) {
    const s = SECCIONES_BASES.find((x) => x.k === k); if (!s || !F) return;
    const datos = { id: F.lic.id }; const bases = JSON.parse(JSON.stringify(F.lic.bases || {}));
    if (!bases.formato) bases.formato = 'licitacion-bases/v1';
    s.campos.forEach((c, i) => {
      const v = leerCampo(c, val(`lcB-${k}-${i}`));
      if (c.col) datos[c.col] = v; else setRuta(bases, c.ruta, v);
    });
    datos.bases = bases;
    try {
      const r = await rpc('guardar_licitacion', { p_datos: datos });
      Object.assign(F.lic, r.licitacion); actualizarEnLista(r.licitacion);
      Toast.success(`${s.t}: guardado`);
    } catch (e) { Toast.error(errTxt(e, 'No se guardó la sección')); }
  }

  // Pestañas que completan las historias siguientes ---------------------------------------------------------------------------
  // Archivos de la convocante (US-815) ------------------------------------------------------------------------------------
  const BUCKET = 'licitaciones';
  const MAX_BYTES = 50 * 1024 * 1024;
  const MIME_EXT = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dwg: 'image/vnd.dwg', zip: 'application/zip',
  };
  /** Tipo MIME que admite el bucket para un archivo (por extensión; .dwg siempre image/vnd.dwg) o null. */
  function mimeDe(nombre, tipo) {
    const ext = String(nombre || '').toLowerCase().split('.').pop();
    if (ext === 'dwg') return 'image/vnd.dwg';
    if (MIME_EXT[ext]) return MIME_EXT[ext];
    return Object.values(MIME_EXT).includes(tipo) ? tipo : null;
  }
  /** Nombre de archivo apto para la ruta del bucket: sin acentos ni espacios, máx. 100 caracteres, conserva la extensión. */
  function nombreSeguro(n) {
    const s = String(n || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[_.]+/, '');
    if (s.length <= 100) return s || 'archivo';
    const i = s.lastIndexOf('.'); const ext = i > 0 && s.length - i <= 6 ? s.slice(i) : '';
    return s.slice(0, 100 - ext.length) + ext;
  }
  /** Ruta en el bucket: empresa/<id>/licitaciones/<lic>/<categoria>/<marca>_<nombre>. */
  function rutaArchivo(emp, lic, categoria, nombre, marca) {
    return `empresa/${emp}/licitaciones/${lic}/${categoria}/${marca || Date.now()}_${nombreSeguro(nombre)}`;
  }
  function fmtBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1048576) return (v / 1024).toFixed(0) + ' KB';
    return (v / 1048576).toFixed(1) + ' MB';
  }
  /** Agrupa archivos por categoría en el orden del catálogo. */
  function agruparPorCategoria(archivos) {
    const g = {};
    for (const a of archivos || []) (g[a.categoria] = g[a.categoria] || []).push(a);
    return Object.keys(CATEGORIAS_ARCHIVO).filter((k) => g[k]).map((k) => ({ k, t: CATEGORIAS_ARCHIVO[k], archivos: g[k] }));
  }
  /** SHA-256 en hexadecimal de un ArrayBuffer (Web Crypto; también en Node 20). */
  async function sha256Hex(buf) {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  async function urlFirmada(path, descargarComo) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 600, descargarComo ? { download: descargarComo } : undefined);
    if (error) throw error;
    return data.signedUrl;
  }
  function pintarArchivos(el, ctx) {
    const grupos = agruparPorCategoria(ctx.archivos);
    const total = (ctx.archivos || []).reduce((s, a) => s + (Number(a.tamano) || 0), 0);
    el.innerHTML = `<form class="g rounded-xl p-4 mb-4" onsubmit="event.preventDefault();Licitaciones.subirArchivos()" aria-labelledby="lcSubT">
<h2 id="lcSubT" class="font-bold text-sm mb-1"><i class="ri-upload-cloud-2-line" aria-hidden="true"></i> Subir archivos de la convocante</h2>
<p class="text-xs text-ink-muted mb-3">Guárdalos tal como los publica la dependencia: PDF, imágenes, Word, Excel, DWG o ZIP, hasta 50 MB cada uno. Si un archivo ya está en esta licitación, se avisa y no se sube dos veces.</p>
<div class="grid sm:grid-cols-3 gap-3 items-end">
${campo('lcArchCat', 'Categoría', `<select id="lcArchCat" class="inp">${opciones(CATEGORIAS_ARCHIVO, 'bases')}</select>`)}
${campo('lcArchFiles', 'Archivos', '<input id="lcArchFiles" type="file" multiple class="inp" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.dwg,.zip">', 'sm:col-span-2')}
</div><div id="lcArchProg" class="text-sm mt-2" role="status" aria-live="polite"></div>
<div class="flex justify-end mt-3"><button type="submit" class="btn btn-p"><i class="ri-upload-2-line" aria-hidden="true"></i> Subir archivos</button></div></form>
${grupos.length ? `<div class="flex flex-wrap items-center justify-between gap-2 mb-2"><p class="text-sm text-ink-muted">${ctx.archivos.length} archivo${ctx.archivos.length === 1 ? '' : 's'} · ${fmtBytes(total)}</p>
<button type="button" class="btn btn-s" onclick="Licitaciones.descargarTodo()"><i class="ri-folder-zip-line" aria-hidden="true"></i> Descargar todo</button></div>
${grupos.map((g) => `<section class="mb-4" aria-labelledby="lcArchG-${g.k}"><h3 id="lcArchG-${g.k}" class="font-semibold text-sm mb-2">${S(g.t)} <span class="tab-n">${g.archivos.length}</span></h3>
<div class="table-wrap g rounded-xl"><table class="table-modern lc-tbl w-full text-sm"><thead><tr><th scope="col">Archivo</th><th scope="col">Tamaño</th><th scope="col">Subido</th><th scope="col" class="text-right">Acciones</th></tr></thead><tbody>
${g.archivos.map((a) => `<tr><td data-et="Archivo"><span class="break-all">${S(a.nombre)}</span></td><td data-et="Tamaño"><span>${fmtBytes(a.tamano)}</span></td><td data-et="Subido"><span>${S(fmtFecha(a.created_at))}</span></td>
<td data-et="" class="text-right whitespace-nowrap"><button type="button" class="btn-icon" onclick="Licitaciones.verArchivo(${+a.id})" aria-label="Ver ${S(a.nombre)}" title="Ver"><i class="ri-eye-line" aria-hidden="true"></i></button><button type="button" class="btn-icon" onclick="Licitaciones.descargarArchivo(${+a.id})" aria-label="Descargar ${S(a.nombre)}" title="Descargar"><i class="ri-download-2-line" aria-hidden="true"></i></button><button type="button" class="btn-icon" onclick="Licitaciones.borrarArchivo(${+a.id})" aria-label="Borrar ${S(a.nombre)}" title="Borrar"><i class="ri-delete-bin-line" aria-hidden="true"></i></button></td></tr>`).join('')}
</tbody></table></div></section>`).join('')}` : EmptyState({ icon: 'ri-folder-3-line', title: 'Todavía no hay archivos', body: 'Sube las bases, los anexos, las actas de junta y los planos que publicó la convocante.' })}`;
  }
  async function subirArchivos(listaArchivos, categoria) {
    if (!F) return;
    const input = document.getElementById('lcArchFiles');
    const files = [...(listaArchivos || (input && input.files) || [])];
    const cat = categoria || val('lcArchCat') || 'otro';
    if (!files.length) { Toast.warning('Elige al menos un archivo.'); return; }
    const prog = document.getElementById('lcArchProg');
    const emp = currentUser.empresa_id; const lic = F.lic.id;
    let ok = 0; const avisos = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (prog) prog.textContent = `Subiendo ${i + 1} de ${files.length}: ${f.name}`;
      if (f.size > MAX_BYTES) { avisos.push(`«${f.name}» pesa ${fmtBytes(f.size)}: comprímelo o divídelo (máximo 50 MB).`); continue; }
      const mime = mimeDe(f.name, f.type);
      if (!mime) { avisos.push(`«${f.name}»: tipo no admitido. Conviértelo a PDF.`); continue; }
      try {
        const hash = await sha256Hex(await f.arrayBuffer());
        const dup = F.archivos.find((a) => a.hash_sha256 === hash);
        if (dup) { avisos.push(`«${f.name}» ya está en esta licitación como «${dup.nombre}» (${etiqueta(CATEGORIAS_ARCHIVO, dup.categoria)}).`); continue; }
        const path = rutaArchivo(emp, lic, cat, f.name, Date.now() + i);
        const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: mime, upsert: false });
        if (up.error) throw up.error;
        const { data, error } = await sb.from('licitacion_archivos').insert({ licitacion_id: lic, categoria: cat, nombre: f.name, archivo_path: path, tamano: f.size, hash_sha256: hash, mime })
          .select('id,licitacion_id,categoria,nombre,archivo_path,tamano,hash_sha256,mime,created_at').single();
        if (error) { await sb.storage.from(BUCKET).remove([path]); throw error; }
        F.archivos.unshift(data); ok++;
      } catch (e) { avisos.push(`«${f.name}»: ${errTxt(e)}`); }
    }
    if (ok) Toast.success(`${ok} archivo${ok === 1 ? '' : 's'} guardado${ok === 1 ? '' : 's'}`);
    avisos.forEach((m) => Toast.warning(m, 8000));
    if (st.tab === 'archivos') repintarFicha();
    return { subidos: ok, avisos };
  }
  const archivoPorId = (id) => (F && F.archivos.find((a) => a.id === id)) || null;
  async function verArchivo(id) {
    const a = archivoPorId(id); if (!a) return;
    const w = window.open('', '_blank');
    try { const u = await urlFirmada(a.archivo_path); if (w) { w.opener = null; w.location.href = u; } else window.location.assign(u); }
    catch (e) { if (w) w.close(); Toast.error(errTxt(e, 'No se pudo abrir el archivo')); }
  }
  async function descargarArchivo(id) {
    const a = archivoPorId(id); if (!a) return;
    try { const u = await urlFirmada(a.archivo_path, a.nombre); const x = document.createElement('a'); x.href = u; x.rel = 'noopener'; document.body.appendChild(x); x.click(); x.remove(); }
    catch (e) { Toast.error(errTxt(e, 'No se pudo descargar')); }
  }
  async function borrarArchivo(id) {
    const a = archivoPorId(id); if (!a) return;
    const okc = await Dialog.confirm({ title: 'Borrar archivo', body: `Se borrará «${a.nombre}» de esta licitación. Esta acción no se puede deshacer.`, confirmText: 'Borrar archivo', tone: 'danger' });
    if (!okc) return;
    try {
      const { error } = await sb.from('licitacion_archivos').delete().eq('id', id);
      if (error) throw error;
      await sb.storage.from(BUCKET).remove([a.archivo_path]);
      F.archivos = F.archivos.filter((x) => x.id !== id);
      Toast.success('Archivo borrado');
      repintarFicha();
    } catch (e) { Toast.error(errTxt(e, 'No se borró el archivo')); }
  }
  /** Descarga un archivo del bucket como Blob. */
  async function blobDe(path) {
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error) throw error;
    return data;
  }
  function guardarBlob(blob, nombre) {
    const u = URL.createObjectURL(blob); const x = document.createElement('a');
    x.href = u; x.download = nombre; document.body.appendChild(x); x.click(); x.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  }
  /** Nombre único dentro de una carpeta del ZIP (agrega « (2)» si se repite). */
  function nombreUnico(usados, n) {
    let x = n; let i = 2;
    while (usados.has(x.toLowerCase())) { const p = n.lastIndexOf('.'); x = p > 0 ? `${n.slice(0, p)} (${i})${n.slice(p)}` : `${n} (${i})`; i++; }
    usados.add(x.toLowerCase()); return x;
  }
  async function descargarTodo() {
    if (!F || !F.archivos.length) return;
    if (typeof JSZip === 'undefined') { Toast.error('No se cargó el compresor ZIP; recarga la página.'); return; }
    const zip = new JSZip(); const usados = {};
    Toast.info(`Preparando ${F.archivos.length} archivo${F.archivos.length === 1 ? '' : 's'}…`);
    try {
      for (const a of F.archivos) {
        const carpeta = nombreSeguro(etiqueta(CATEGORIAS_ARCHIVO, a.categoria));
        usados[carpeta] = usados[carpeta] || new Set();
        zip.folder(carpeta).file(nombreUnico(usados[carpeta], a.nombre), await blobDe(a.archivo_path));
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      guardarBlob(blob, `${nombreSeguro(F.lic.codigo)}_archivos_convocante.zip`);
    } catch (e) { Toast.error(errTxt(e, 'No se pudo armar el ZIP')); }
  }
  // Requisitos por sobre (US-816) -------------------------------------------------------------------------------------------
  /** Categorías de empresa_documentos (CHECK de 081) con su etiqueta. */
  const CATEGORIAS_EXPEDIENTE = {
    opinion_sat: 'Opinión de cumplimiento SAT', opinion_imss: 'Opinión de cumplimiento IMSS', opinion_infonavit: 'Opinión de cumplimiento INFONAVIT',
    identificacion: 'Identificación oficial', acta_constitutiva: 'Acta constitutiva', poder: 'Poder notarial',
    constancia_fiscal: 'Constancia de situación fiscal', comprobante_domicilio: 'Comprobante de domicilio',
    estados_financieros: 'Estados financieros', declaracion_anual: 'Declaración anual', cmic: 'Registro CMIC',
    colegio: 'Colegio de profesionistas', poliza_rc: 'Póliza de responsabilidad civil', curriculum: 'Currículum',
    padron_contratistas: 'Padrón de contratistas', otro: 'Otro',
  };
  const TONO_ESTADO = { pendiente: '', en_revision: 'warn', listo: 'accent', firmado: 'accent', escaneado: 'accent', foliado: 'accent', validado: 'ok' };
  function chipEstado(e) {
    const t = TONO_ESTADO[e];
    const estilo = t ? `background:var(--${t}-soft);color:var(--${t})` : 'background:var(--surface-2);color:var(--ink-muted)';
    return `<span class="chip" style="${estilo}">${S(etiqueta(ESTADOS_REQUISITO, e))}</span>`;
  }
  /** Requisitos de un sobre en su orden. */
  function delSobre(reqs, sobre) {
    return (reqs || []).filter((r) => r.sobre === sobre).sort((a, b) => (a.orden - b.orden) || (a.id - b.id));
  }
  /** Ids del sobre en el orden nuevo tras mover uno (dir -1 sube, +1 baja); null si no se puede mover. */
  function moverEnLista(ids, id, dir) {
    const i = ids.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return null;
    const out = ids.slice(); [out[i], out[j]] = [out[j], out[i]];
    return out;
  }
  /** Extra que pintan las historias siguientes en la fila (documento ligado, vencimiento): se reemplaza en US-818. */
  let extraRequisito = () => '';
  function pintarRequisitos(el, ctx) {
    const sob = st.sobre;
    const av = avancePorSobre(ctx.reqs);
    const lista = delSobre(ctx.reqs, sob);
    const segs = Object.entries(SOBRES).map(([k, t]) => `<button type="button" role="tab" aria-selected="${k === sob}" class="seg-btn ${k === sob ? 'active' : ''}" onclick="Licitaciones.verSobre('${k}')">${S(t)} <span class="tab-n">${av[k].hechos}/${av[k].total}</span></button>`).join('');
    const filas = lista.map((r, i) => {
      const firma = r.requiere_firma ? '<span class="chip chip-ind"><i class="ri-quill-pen-line" aria-hidden="true"></i> Firma</span>' : '';
      const arch = r.archivo_path
        ? `<button type="button" class="btn-icon" onclick="Licitaciones.verArchivoRequisito(${+r.id})" aria-label="Ver archivo final de ${S(r.anexo_id)}" title="Ver archivo final"><i class="ri-file-check-line" aria-hidden="true"></i></button>`
        : '';
      return `<tr id="lcReq-${+r.id}" ${venceReq(r, ctx) ? 'class="lc-fila-vence"' : ''}><td data-et="Orden" class="whitespace-nowrap"><span><button type="button" class="btn-icon" onclick="Licitaciones.moverRequisito(${+r.id},-1)" aria-label="Subir ${S(r.anexo_id)}" ${i === 0 ? 'disabled' : ''}><i class="ri-arrow-up-s-line" aria-hidden="true"></i></button><button type="button" class="btn-icon" onclick="Licitaciones.moverRequisito(${+r.id},1)" aria-label="Bajar ${S(r.anexo_id)}" ${i === lista.length - 1 ? 'disabled' : ''}><i class="ri-arrow-down-s-line" aria-hidden="true"></i></button></span></td>
<td data-et="Anexo" class="font-mono text-xs"><span>${S(r.anexo_id)}</span></td>
<td data-et="Descripción"><span>${S(r.descripcion || '')}<span class="block text-xs text-ink-muted">${S(etiqueta(ORIGENES, r.origen))}${r.responsable ? ' · ' + S(r.responsable) : ''} ${firma}</span>${extraRequisito(r, ctx)}</span></td>
<td data-et="Estado"><span><button type="button" class="lc-estado" onclick="Licitaciones.estadoRequisito(${+r.id})" aria-label="Cambiar estado de ${S(r.anexo_id)}: ${S(etiqueta(ESTADOS_REQUISITO, r.estado))}">${chipEstado(r.estado)} <i class="ri-arrow-down-s-line" aria-hidden="true"></i></button></span></td>
<td data-et="" class="text-right whitespace-nowrap">${arch}<button type="button" class="btn-icon" onclick="Licitaciones.adjuntarRequisito(${+r.id})" aria-label="${r.archivo_path ? 'Reemplazar' : 'Adjuntar'} archivo final de ${S(r.anexo_id)}" title="${r.archivo_path ? 'Reemplazar' : 'Adjuntar'} archivo final"><i class="ri-attachment-2" aria-hidden="true"></i></button><button type="button" class="btn-icon" onclick="Licitaciones.editarRequisito(${+r.id})" aria-label="Editar ${S(r.anexo_id)}" title="Editar"><i class="ri-edit-line" aria-hidden="true"></i></button><button type="button" class="btn-icon" onclick="Licitaciones.borrarRequisito(${+r.id})" aria-label="Borrar ${S(r.anexo_id)}" title="Borrar"><i class="ri-delete-bin-line" aria-hidden="true"></i></button></td></tr>`;
    }).join('');
    el.innerHTML = `<div class="flex flex-wrap gap-2 mb-3" id="lcReqAcciones">${accionesRequisitos(ctx).join('')}</div>
<div class="seg mb-3" role="tablist" aria-label="Sobre">${segs}</div>
${lista.length ? `<div class="table-wrap g rounded-xl"><table class="table-modern lc-tbl w-full text-sm"><caption class="sr-only">Requisitos del sobre ${S(SOBRES[sob].toLowerCase())}</caption><thead><tr><th scope="col" class="w-24">Orden</th><th scope="col">Anexo</th><th scope="col">Descripción</th><th scope="col">Estado</th><th scope="col" class="text-right">Acciones</th></tr></thead><tbody>${filas}</tbody></table></div>`
    : EmptyState({ icon: 'ri-checkbox-multiple-line', title: `Sin requisitos en el sobre ${SOBRES[sob].toLowerCase()}`, body: 'Agrega los anexos que pide la convocante para este sobre, o genéralos desde el perfil de la convocante.', action: { label: 'Agregar requisito', icon: 'ri-add-line', onClick: 'Licitaciones.editarRequisito()' } })}
<input type="file" id="lcReqFile" class="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.dwg,.zip" onchange="Licitaciones.subirArchivoRequisito(this.files[0])">`;
  }
  /** Botones de la barra de requisitos; las historias siguientes agregan los suyos con accionesRequisitos.extra. */
  function accionesRequisitos(ctx) {
    const out = [`<button type="button" class="btn btn-p" onclick="Licitaciones.editarRequisito()"><i class="ri-add-line" aria-hidden="true"></i> Agregar requisito</button>`];
    for (const f of accionesRequisitos.extra) { const h = f(ctx); if (h) out.push(h); }
    return out;
  }
  accionesRequisitos.extra = [];
  function verSobre(k) { st.sobre = k; repintarFicha(); }
  const reqPorId = (id) => (F && F.reqs.find((r) => r.id === id)) || null;
  function reemplazarReq(row) {
    const i = F.reqs.findIndex((r) => r.id === row.id);
    if (i >= 0) F.reqs[i] = Object.assign(F.reqs[i], row); else F.reqs.push(row);
  }
  async function editarRequisito(id) {
    const r = id ? reqPorId(id) || {} : { sobre: st.sobre, origen: 'se_genera' };
    modal(id ? `Editar requisito ${r.anexo_id}` : 'Agregar requisito', `<form id="lcFormReq" onsubmit="event.preventDefault();Licitaciones.guardarRequisito(${id ? +id : 'null'})" class="space-y-3">
<div class="grid sm:grid-cols-2 gap-3">
${campo('lcRqAnexo', 'Anexo *', `<input id="lcRqAnexo" class="inp font-mono" required maxlength="40" value="${S(r.anexo_id || '')}" placeholder="Ej. AT-02, L-3, 8.4">`)}
${campo('lcRqSobre', 'Sobre', `<select id="lcRqSobre" class="inp">${opciones(SOBRES, r.sobre)}</select>`)}
${campo('lcRqDesc', 'Descripción', `<textarea id="lcRqDesc" class="inp" rows="2" maxlength="500">${S(r.descripcion || '')}</textarea>`, 'sm:col-span-2')}
${campo('lcRqOrigen', 'Origen', `<select id="lcRqOrigen" class="inp" onchange="document.getElementById('lcRqCatBox').hidden=this.value!=='expediente'">${opciones(ORIGENES, r.origen)}</select>`)}
${campo('lcRqResp', 'Responsable', `<input id="lcRqResp" class="inp" maxlength="120" value="${S(r.responsable || '')}" placeholder="Quién lo prepara">`)}
<div id="lcRqCatBox" class="sm:col-span-2" ${r.origen === 'expediente' ? '' : 'hidden'}>${campo('lcRqCat', 'Categoría del expediente', `<select id="lcRqCat" class="inp">${opciones(CATEGORIAS_EXPEDIENTE, r.categoria_expediente, 'Sin categoría')}</select><p class="field-hint">Sirve para ligar el documento vigente de la empresa.</p>`)}<div id="lcRqDocBox"></div></div>
<label class="flex items-center gap-2 text-sm sm:col-span-2" style="min-height:var(--tap)"><input id="lcRqFirma" type="checkbox" ${r.requiere_firma ? 'checked' : ''}> Requiere firma del representante</label>
${campo('lcRqNotas', 'Notas', `<textarea id="lcRqNotas" class="inp" rows="2">${S(r.notas || '')}</textarea>`, 'sm:col-span-2')}
</div><div class="flex justify-end gap-2 pt-2"><button type="button" class="btn btn-s" onclick="Licitaciones.cerrarModal()">Cancelar</button>
<button type="submit" class="btn btn-p"><i class="ri-save-line" aria-hidden="true"></i> ${id ? 'Guardar requisito' : 'Agregar requisito'}</button></div></form>`);
    if (typeof editarRequisito.alAbrir === 'function') editarRequisito.alAbrir(r);
  }
  async function guardarRequisito(id) {
    const f = document.getElementById('lcFormReq');
    if (f && !f.reportValidity()) return;
    const origen = val('lcRqOrigen');
    const datos = {
      anexo_id: val('lcRqAnexo'), sobre: val('lcRqSobre'), descripcion: val('lcRqDesc'), origen,
      responsable: val('lcRqResp'), requiere_firma: !!(document.getElementById('lcRqFirma') || {}).checked, notas: val('lcRqNotas'),
      categoria_expediente: origen === 'expediente' ? val('lcRqCat') || null : null,
    };
    const doc = document.getElementById('lcRqDoc');
    if (doc) datos.empresa_documento_id = origen === 'expediente' ? doc.value || null : null;
    if (id) datos.id = id; else datos.licitacion_id = F.lic.id;
    try {
      const r = await rpc('guardar_requisito', { p_datos: datos });
      reemplazarReq(r.requisito); st.sobre = r.requisito.sobre;
      cerrarModal(); Toast.success(id ? 'Requisito guardado' : 'Requisito agregado'); repintarFicha();
    } catch (e) { Toast.error(errTxt(e, 'No se guardó el requisito')); }
  }
  async function borrarRequisito(id) {
    const r = reqPorId(id); if (!r) return;
    const okc = await Dialog.confirm({ title: 'Borrar requisito', body: `Se borrará el requisito ${r.anexo_id} con su historial${r.archivo_path ? ' y su archivo final' : ''}. Esta acción no se puede deshacer.`, confirmText: 'Borrar requisito', tone: 'danger' });
    if (!okc) return;
    try {
      const { error } = await sb.from('licitacion_requisitos').delete().eq('id', id);
      if (error) throw error;
      if (r.archivo_path) await sb.storage.from(BUCKET).remove([r.archivo_path]);
      F.reqs = F.reqs.filter((x) => x.id !== id);
      Toast.success('Requisito borrado'); repintarFicha();
    } catch (e) { Toast.error(errTxt(e, 'No se borró el requisito')); }
  }
  async function moverRequisito(id, dir) {
    const r = reqPorId(id); if (!r) return;
    const ids = delSobre(F.reqs, r.sobre).map((x) => x.id);
    const nuevo = moverEnLista(ids, id, dir); if (!nuevo) return;
    nuevo.forEach((x, i) => { const q = reqPorId(x); if (q) q.orden = i + 1; });
    repintarFicha();
    const b2 = document.querySelector(`#lcReq-${id} button[aria-label^="${dir < 0 ? 'Subir' : 'Bajar'}"]`);
    if (b2 && !b2.disabled) b2.focus();
    try { await rpc('ordenar_requisitos', { p_licitacion_id: F.lic.id, p_ids: nuevo }); }
    catch (e) { Toast.error(errTxt(e, 'No se guardó el orden')); }
  }
  async function estadoRequisito(id) {
    const r = reqPorId(id); if (!r) return;
    const bloqueo = typeof estadoRequisito.bloqueo === 'function' ? estadoRequisito.bloqueo(r) : '';
    modal(`Estado de ${r.anexo_id}`, `<form id="lcFormEst" onsubmit="event.preventDefault();Licitaciones.guardarEstado(${+id})">
<fieldset><legend class="text-sm mb-2">${S(r.descripcion || '')}</legend>
<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 lc-est">${Object.entries(ESTADOS_REQUISITO).map(([k, t]) => {
      const des = bloqueo && ESTADOS_HECHOS.includes(k);
      return `<label class="seg-btn rounded-md border ${k === r.estado ? 'active' : ''}" style="border-color:var(--line)${des ? ';opacity:.55' : ''}"><input type="radio" name="lcEst" value="${k}" class="sr-only" ${k === r.estado ? 'checked' : ''} ${des ? 'disabled' : ''} onchange="document.querySelectorAll('#lcFormEst .seg-btn').forEach(x=>x.classList.toggle('active',x.contains(this)))">${S(t)}</label>`;
    }).join('')}</div></fieldset>
${bloqueo ? `<p class="lc-vence text-sm mt-3" role="alert"><i class="ri-error-warning-line" aria-hidden="true"></i> ${bloqueo}</p>` : ''}
${campo('lcEstNota', 'Nota (opcional)', '<textarea id="lcEstNota" class="inp" rows="2" maxlength="500" placeholder="Ej. Falta la firma del representante"></textarea>', 'mt-3')}
<div class="flex justify-end gap-2 pt-3"><button type="button" class="btn btn-s" onclick="Licitaciones.cerrarModal()">Cancelar</button><button type="submit" class="btn btn-p"><i class="ri-check-line" aria-hidden="true"></i> Guardar estado</button></div></form>
<h3 class="font-semibold text-sm mt-4 mb-2">Historial</h3><ol id="lcEstHist" class="text-sm space-y-2" aria-busy="true"><li class="text-ink-muted">Cargando…</li></ol>`);
    try {
      const { data, error } = await sb.from('licitacion_requisito_historial').select('estado_anterior,estado_nuevo,nota,created_at,usuario_id').eq('requisito_id', id).order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      const usuarios = (D.u || []).reduce((o, u) => { o[u.id] = u.nombre; return o; }, {});
      const ol = document.getElementById('lcEstHist'); if (!ol) return;
      ol.removeAttribute('aria-busy');
      ol.innerHTML = (data || []).map((h) => `<li class="border-b pb-2" style="border-color:var(--line)"><span class="text-xs text-ink-muted">${S(fmtFechaHora(h.created_at))}${usuarios[h.usuario_id] ? ' · ' + S(usuarios[h.usuario_id]) : ''}</span><br>${h.estado_anterior ? S(etiqueta(ESTADOS_REQUISITO, h.estado_anterior)) + ' → ' : 'Alta: '}<b>${S(etiqueta(ESTADOS_REQUISITO, h.estado_nuevo))}</b>${h.nota ? `<br><span class="text-ink-muted">${S(h.nota)}</span>` : ''}</li>`).join('') || '<li class="text-ink-muted">Sin cambios todavía.</li>';
    } catch (e) { const ol = document.getElementById('lcEstHist'); if (ol) ol.innerHTML = `<li class="text-danger">${S(errTxt(e, 'No se pudo leer el historial'))}</li>`; }
  }
  async function guardarEstado(id) {
    const sel = document.querySelector('#lcFormEst input[name=lcEst]:checked');
    if (!sel) return;
    const r = reqPorId(id);
    if (r && sel.value === r.estado && !val('lcEstNota')) { cerrarModal(); return; }
    try {
      const x = await rpc('cambiar_estado_requisito', { p_id: id, p_estado: sel.value, p_nota: val('lcEstNota') || null });
      if (r) r.estado = x.estado;
      cerrarModal(); Toast.success(`${r ? r.anexo_id + ': ' : ''}${etiqueta(ESTADOS_REQUISITO, x.estado)}`); repintarFicha();
      const b2 = document.querySelector(`#lcReq-${id} .lc-estado`); if (b2) b2.focus();
    } catch (e) { Toast.error(errTxt(e, 'No se cambió el estado')); }
  }
  // Perfiles de convocante (US-817) ------------------------------------------------------------------------------------------
  accionesRequisitos.extra.push(() => `<button type="button" class="btn btn-s" onclick="Licitaciones.generarDelPerfil()"><i class="ri-magic-line" aria-hidden="true"></i> Generar requisitos del perfil</button>`);
  accionesRequisitos.extra.push((ctx) => (ctx.reqs.length ? `<button type="button" class="btn btn-s" onclick="Licitaciones.guardarComoPerfil()"><i class="ri-bookmark-line" aria-hidden="true"></i> Guardar como perfil</button>` : ''));
  /** Cuántos requisitos de un perfil faltan en la licitación (comparación sin mayúsculas, como el RPC). */
  function faltantesDelPerfil(perfil, reqs) {
    const ya = new Set((reqs || []).map((r) => String(r.anexo_id).trim().toLowerCase()));
    return ((perfil && perfil.requisitos_json) || []).filter((x) => !ya.has(String(x.anexo_id).trim().toLowerCase()));
  }
  async function generarDelPerfil() {
    let ps = [];
    try { ps = (await cargarPerfiles()).filter((p) => p.activo || p.id === F.lic.perfil_id); } catch (e) { Toast.error(errTxt(e, 'No se pudieron leer los perfiles')); return; }
    if (!ps.length) { Toast.warning('No hay perfiles de convocante. Un administrador puede crearlos en Configuración.'); return; }
    const sel = F.lic.perfil_id || ps[0].id;
    const resumenDe = (id) => { const p = ps.find((x) => x.id === +id); if (!p) return ''; const f = faltantesDelPerfil(p, F.reqs).length; return `${(p.requisitos_json || []).length} requisitos en el perfil; ${f} se agregarían y ${(p.requisitos_json || []).length - f} ya están en esta licitación.`; };
    modal('Generar requisitos del perfil', `<form id="lcFormGen" onsubmit="event.preventDefault();Licitaciones.confirmarGenerar()" class="space-y-3">
${campo('lcGenPerfil', 'Perfil de convocante', `<select id="lcGenPerfil" class="inp" onchange="document.getElementById('lcGenRes').textContent=Licitaciones._resumenPerfil(this.value)">${ps.map((p) => `<option value="${+p.id}" ${p.id === sel ? 'selected' : ''}>${S(p.nombre)}${p.es_fabrica ? ' (de fábrica)' : ''}</option>`).join('')}</select>`)}
<p id="lcGenRes" class="text-sm" role="status">${S(resumenDe(sel))}</p>
<p class="text-xs text-ink-muted">Sólo se agregan los anexos que faltan: lo que ya capturaste o editaste no se toca. Puedes repetirlo sin duplicar nada.</p>
<div class="flex justify-end gap-2 pt-2"><button type="button" class="btn btn-s" onclick="Licitaciones.cerrarModal()">Cancelar</button><button type="submit" class="btn btn-p"><i class="ri-magic-line" aria-hidden="true"></i> Generar requisitos</button></div></form>`);
    generarDelPerfil._resumen = resumenDe;
  }
  async function confirmarGenerar() {
    const pid = +val('lcGenPerfil');
    try {
      const r = await rpc('generar_requisitos_perfil', { p_licitacion_id: F.lic.id, p_perfil_id: pid });
      cerrarModal();
      F = await cargarFicha(F.lic.id); actualizarEnLista(F.lic);
      Toast.success(r.insertados ? `Se agregaron ${r.insertados} requisito${r.insertados === 1 ? '' : 's'}${r.ya_estaban ? `; ${r.ya_estaban} ya estaban` : ''}` : 'No faltaba ningún requisito del perfil');
      repintarFicha();
    } catch (e) { Toast.error(errTxt(e, 'No se generaron los requisitos')); }
  }
  function guardarComoPerfil() {
    modal('Guardar como perfil', `<form id="lcFormGp" onsubmit="event.preventDefault();Licitaciones.confirmarGuardarPerfil()" class="space-y-3">
<p class="text-sm text-ink-muted">Guarda los ${F.reqs.length} requisitos de esta licitación (anexo, sobre, descripción, origen, firma y categoría) para usarlos en el próximo concurso de esta convocante.</p>
${campo('lcGpNombre', 'Nombre del perfil *', `<input id="lcGpNombre" class="inp" required maxlength="120" value="${S(F.lic.convocante || '')}">`)}
${campo('lcGpDesc', 'Descripción', `<textarea id="lcGpDesc" class="inp" rows="2" maxlength="500">${S(`Tomado de ${F.lic.codigo}`)}</textarea>`)}
<label class="flex items-center gap-2 text-sm" style="min-height:var(--tap)"><input id="lcGpReemp" type="checkbox"> Si ya existe un perfil con ese nombre, reemplazar su lista</label>
<div class="flex justify-end gap-2 pt-2"><button type="button" class="btn btn-s" onclick="Licitaciones.cerrarModal()">Cancelar</button><button type="submit" class="btn btn-p"><i class="ri-bookmark-line" aria-hidden="true"></i> Guardar perfil</button></div></form>`);
  }
  async function confirmarGuardarPerfil() {
    const f = document.getElementById('lcFormGp'); if (f && !f.reportValidity()) return;
    try {
      const r = await rpc('guardar_perfil_desde_licitacion', { p_licitacion_id: F.lic.id, p_nombre: val('lcGpNombre'), p_descripcion: val('lcGpDesc') || null, p_reemplazar: !!document.getElementById('lcGpReemp').checked });
      perfiles = null; cerrarModal();
      Toast.success(`${r.reemplazado ? 'Perfil actualizado' : 'Perfil guardado'} con ${r.requisitos} requisitos`);
    } catch (e) { Toast.error(errTxt(e, 'No se guardó el perfil')); }
  }

  // Ligar un requisito al expediente (US-818) ----------------------------------------------------------------------------
  const ESTADOS_DOC_USABLES = ['vigente', 'por_vencer', 'sin_vencimiento'];
  /** Documentos que se pueden ligar a una categoría: vigentes, por vencer o sin vencimiento (nunca reemplazados). */
  function docsUsables(docs, categoria) {
    return (docs || []).filter((d) => d.categoria === categoria && ESTADOS_DOC_USABLES.includes(d.estado))
      .sort((a, b) => String(b.fecha_vencimiento || '9999').localeCompare(String(a.fecha_vencimiento || '9999')) || (b.id - a.id));
  }
  /** Fecha civil contra la que se mide el vencimiento: la presentación (México) o, sin ella, hoy. */
  const fechaCorte = (lic, hoy) => fechaMx(lic && lic.presentacion) || hoy || hoyMx();
  /** true si el documento vence antes de la presentación de la licitación (la misma regla que licit_requisito_vence). */
  function venceAntes(doc, lic, hoy) { return !!(doc && doc.fecha_vencimiento && String(doc.fecha_vencimiento).slice(0, 10) < fechaCorte(lic, hoy)); }
  function docDe(r, ctx) { return (r && r.empresa_documento_id && (ctx.docs || []).find((d) => d.id === r.empresa_documento_id)) || null; }
  function venceReq(r, ctx) { return venceAntes(docDe(r, ctx), ctx.lic); }
  extraRequisito = (r, ctx) => {
    if (r.origen !== 'expediente') return '';
    const d = docDe(r, ctx);
    if (!r.empresa_documento_id) return `<span class="block text-xs text-warn"><i class="ri-link-unlink" aria-hidden="true"></i> Sin documento del expediente${r.categoria_expediente ? ' · ' + S(etiqueta(CATEGORIAS_EXPEDIENTE, r.categoria_expediente)) : ''}</span>`;
    if (!d) return '<span class="block text-xs text-ink-muted"><i class="ri-links-line" aria-hidden="true"></i> Documento ligado del expediente</span>';
    const venc = d.fecha_vencimiento ? ` · vence el ${S(fmtFecha(d.fecha_vencimiento))}` : '';
    if (venceAntes(d, ctx.lic)) return `<span class="block text-xs lc-vence"><i class="ri-error-warning-line" aria-hidden="true"></i> ${S(d.nombre)}: vence el ${S(fmtFecha(d.fecha_vencimiento))}, antes de la presentación. Renuévalo en el Expediente.</span>`;
    return `<span class="block text-xs text-ok"><i class="ri-links-line" aria-hidden="true"></i> ${S(d.nombre)}${venc}${d.estado === 'reemplazado' ? ' (versión anterior)' : ''}</span>`;
  };
  estadoRequisito.bloqueo = (r) => {
    if (!venceReq(r, F)) return '';
    const d = docDe(r, F);
    return `El documento ligado «${S(d.nombre)}» vence el ${S(fmtFecha(d.fecha_vencimiento))}, antes de la presentación: no puede pasar a «Listo» hasta que lo renueves en el Expediente.`;
  };
  editarRequisito.alAbrir = (r) => {
    const pintar = () => {
      const box = document.getElementById('lcRqDocBox'); if (!box) return;
      const cat = val('lcRqCat');
      if (F.docsError) { box.innerHTML = '<p class="field-hint">No se pudo leer el Expediente; podrás ligar el documento después.</p>'; return; }
      if (!cat) { box.innerHTML = ''; return; }
      const ds = docsUsables(F.docs, cat);
      const actual = docDe(r, F);
      const opts = ds.slice(); if (actual && !opts.some((x) => x.id === actual.id)) opts.unshift(actual);
      box.innerHTML = campo('lcRqDoc', 'Documento del expediente', `<select id="lcRqDoc" class="inp"><option value="">Sin documento</option>${opts.map((d) => `<option value="${+d.id}" ${actual && actual.id === d.id ? 'selected' : ''}>${S(d.nombre)}${d.fecha_vencimiento ? ' · vence ' + S(fmtFecha(d.fecha_vencimiento)) : ''}${venceAntes(d, F.lic) ? ' (vence antes de la presentación)' : ''}</option>`).join('')}</select>${ds.length ? '' : '<p class="field-hint">No hay documentos vigentes de esta categoría en el Expediente.</p>'}`, 'mt-3');
    };
    const sel = document.getElementById('lcRqCat'); if (sel) sel.addEventListener('change', pintar);
    pintar();
  };
  accionesRequisitos.extra.push((ctx) => (ctx.reqs.some((r) => r.origen === 'expediente') ? `<button type="button" class="btn btn-s" onclick="Licitaciones.llenarDesdeExpediente()"><i class="ri-links-line" aria-hidden="true"></i> Llenar desde el expediente</button>` : ''));
  async function llenarDesdeExpediente() {
    try {
      const r = await rpc('llenar_desde_expediente', { p_licitacion_id: F.lic.id });
      F = await cargarFicha(F.lic.id);
      const faltan = (r.sin_documento || []).map((c) => etiqueta(CATEGORIAS_EXPEDIENTE, c));
      if (r.ligados) Toast.success(`Se ligaron ${r.ligados} requisito${r.ligados === 1 ? '' : 's'} al expediente`);
      else Toast.info('No había requisitos nuevos que ligar.');
      if (faltan.length) Toast.warning(`Sin documento vigente en el Expediente: ${faltan.join(', ')}.`, 9000);
      repintarFicha();
    } catch (e) { Toast.error(errTxt(e, 'No se pudo llenar desde el expediente')); }
  }

  // Paquete de entrega (US-820) ----------------------------------------------------------------------------------------
  const ESTADOS_FIRMADOS = ['firmado', 'escaneado', 'foliado', 'validado'];
  const PATRON_DEFECTO = '{NN}_{anexo}_{descripcion}.pdf';
  /** Nombre de un archivo del paquete con el naming_pattern del perfil. La extensión real reemplaza a la del patrón. */
  function nombrePaquete(patron, d, ext) {
    const nn = String(d.nn).padStart(2, '0');
    const desc = String(d.descripcion || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).replace(/_+$/, '');
    let n = String(patron || PATRON_DEFECTO).replace(/\.[A-Za-z0-9]{2,5}$/, '')
      .replace(/\{NN\}/g, nn).replace(/\{orden\}/g, nn)
      .replace(/\{XX\}/g, String(d.anexo || '').replace(/[^A-Za-z0-9]+/g, ''))
      .replace(/\{anexo\}/g, String(d.anexo || '').trim())
      .replace(/\{sobre\}/g, etiqueta(SOBRES, d.sobre))
      .replace(/\{descripcion\}/g, desc);
    n = nombreSeguro(n).replace(/[_.]+$/, '') || `${nn}_anexo`;
    const e = String(ext || 'pdf').replace(/^\./, '').toLowerCase();
    return `${n}.${e}`;
  }
  /** Carpeta de cada sobre: la del perfil (sobres_json[].carpeta) o «1_Legal», «2_Tecnico», «3_Economico». */
  function carpetaSobre(sobre, perfil) {
    const s = ((perfil && perfil.sobres_json) || []).find((x) => x && x.clave === sobre);
    if (s && s.carpeta) return nombreSeguro(s.carpeta);
    const i = Object.keys(SOBRES).indexOf(sobre) + 1;
    return nombreSeguro(`${i}_${SOBRES[sobre]}`);
  }
  /** Plan del paquete (función pura): archivos en orden por sobre y reporte de faltantes, vencidos y sin firma. */
  function planPaquete(lic, reqs, docs, perfil) {
    const items = []; const faltantes = []; const vencidos = []; const sinFirma = [];
    const ctx = { lic, docs: docs || [] };
    for (const sobre of Object.keys(SOBRES)) {
      delSobre(reqs, sobre).forEach((r, i) => {
        const d = docDe(r, ctx);
        const path = r.archivo_path || (d && d.archivo_path) || null;
        const origenArchivo = r.archivo_path ? 'requisito' : (d && d.archivo_path ? 'expediente' : null);
        if (!path) faltantes.push(r);
        if (venceAntes(d, lic)) vencidos.push(r);
        if (r.requiere_firma && !ESTADOS_FIRMADOS.includes(r.estado)) sinFirma.push(r);
        if (!path) return;
        const ext = String(path).split('.').pop();
        items.push({ sobre, carpeta: carpetaSobre(sobre, perfil), nombre: nombrePaquete(perfil && perfil.naming_pattern, { nn: i + 1, anexo: r.anexo_id, sobre, descripcion: r.descripcion }, ext), path, origen: origenArchivo, r });
      });
    }
    return { items, faltantes, vencidos, sinFirma };
  }
  const csvCelda = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  /** manifest.csv (UTF-8 con BOM para Excel): sobre, anexo, descripción, archivo, SHA-256, origen y estado. */
  function manifestCsv(filas) {
    const enc = ['sobre', 'anexo', 'descripcion', 'archivo', 'sha256', 'origen', 'estado'];
    return '﻿' + [enc.join(','), ...filas.map((f) => [etiqueta(SOBRES, f.sobre), f.anexo, f.descripcion, f.archivo, f.sha256, f.origen, f.estado].map(csvCelda).join(','))].join('\r\n') + '\r\n';
  }
  accionesRequisitos.extra.push((ctx) => (ctx.reqs.length ? `<button type="button" class="btn btn-s" onclick="Licitaciones.armarPaquete()"><i class="ri-folder-zip-line" aria-hidden="true"></i> Armar paquete</button>` : ''));
  async function perfilDeLic() {
    if (!F.lic.perfil_id) return null;
    try { return (await cargarPerfiles()).find((p) => p.id === F.lic.perfil_id) || null; } catch (e) { return null; }
  }
  async function armarPaquete() {
    const perfil = await perfilDeLic();
    const plan = planPaquete(F.lic, F.reqs, F.docs, perfil);
    const lista = (arr) => `<ul class="text-sm list-disc pl-5">${arr.slice(0, 12).map((r) => `<li><span class="font-mono text-xs">${S(r.anexo_id)}</span> ${S(r.descripcion || '')}</li>`).join('')}${arr.length > 12 ? `<li>y ${arr.length - 12} más</li>` : ''}</ul>`;
    const bloque = (t, arr, tono) => (arr.length ? `<section class="mb-3"><h3 class="font-semibold text-sm ${tono}">${S(t)} (${arr.length})</h3>${lista(arr)}</section>` : '');
    const hay = plan.faltantes.length || plan.vencidos.length || plan.sinFirma.length;
    modal('Armar paquete de entrega', `<div class="space-y-3">
<p class="text-sm">${plan.items.length} archivo${plan.items.length === 1 ? '' : 's'} en carpetas por sobre, en el orden de los requisitos, nombrados con el patrón <span class="font-mono text-xs">${S((perfil && perfil.naming_pattern) || PATRON_DEFECTO)}</span>, más <span class="font-mono text-xs">manifest.csv</span> con anexo, archivo y SHA-256.</p>
${hay ? `<div role="alert">${bloque('Faltan (sin archivo final ni documento del expediente)', plan.faltantes, 'text-danger')}${bloque('Documento vencido antes de la presentación', plan.vencidos, 'text-danger')}${bloque('Requieren firma y aún no están firmados', plan.sinFirma, 'text-warn')}</div>` : '<p class="text-sm text-ok"><i class="ri-checkbox-circle-line" aria-hidden="true"></i> Todos los requisitos tienen archivo, ninguno vence y los que llevan firma están firmados.</p>'}
<p class="text-xs text-ink-muted">El foliado sigue siendo local: abre el ZIP en LicitaGen para foliar cada sobre.</p>
<div class="flex justify-end gap-2"><button type="button" class="btn btn-s" onclick="Licitaciones.cerrarModal()">Cancelar</button><button type="button" class="btn btn-p" id="lcPaqOk" onclick="Licitaciones.generarPaquete()" ${plan.items.length ? '' : 'disabled'}><i class="ri-folder-zip-line" aria-hidden="true"></i> ${hay ? 'Generar paquete de todos modos' : 'Generar paquete'}</button></div></div>`);
  }
  async function generarPaquete() {
    if (typeof JSZip === 'undefined') { Toast.error('No se cargó el compresor ZIP; recarga la página.'); return; }
    const btn = document.getElementById('lcPaqOk'); if (btn) { btn.disabled = true; btn.textContent = 'Generando…'; }
    const perfil = await perfilDeLic();
    const plan = planPaquete(F.lic, F.reqs, F.docs, perfil);
    const zip = new JSZip(); const filas = []; const usados = {};
    try {
      for (const it of plan.items) {
        const blob = await blobDe(it.path);
        const hash = await sha256Hex(await blob.arrayBuffer());
        usados[it.carpeta] = usados[it.carpeta] || new Set();
        const nombre = nombreUnico(usados[it.carpeta], it.nombre);
        zip.folder(it.carpeta).file(nombre, blob);
        filas.push({ sobre: it.sobre, anexo: it.r.anexo_id, descripcion: it.r.descripcion, archivo: `${it.carpeta}/${nombre}`, sha256: hash, origen: it.origen, estado: etiqueta(ESTADOS_REQUISITO, it.r.estado) });
      }
      for (const r of plan.faltantes) filas.push({ sobre: r.sobre, anexo: r.anexo_id, descripcion: r.descripcion, archivo: '', sha256: '', origen: 'FALTA', estado: etiqueta(ESTADOS_REQUISITO, r.estado) });
      zip.file('manifest.csv', manifestCsv(filas));
      zip.file('LEEME.txt', `Paquete de entrega de ${F.lic.codigo}: ${F.lic.nombre}\r\nGenerado el ${fmtFechaHora(new Date().toISOString())} desde Control de Obra.\r\n\r\nUna carpeta por sobre con los archivos en el orden de los requisitos. manifest.csv trae el anexo, el archivo y su SHA-256.\r\nEl foliado se hace en LicitaGen (local): abre esta carpeta y folia cada sobre.\r\n${plan.faltantes.length ? `\r\nFaltan ${plan.faltantes.length} requisitos sin archivo (marcados FALTA en el manifiesto).\r\n` : ''}`);
      const blob = await zip.generateAsync({ type: 'blob' });
      guardarBlob(blob, `${nombreSeguro(F.lic.codigo)}_paquete.zip`);
      cerrarModal(); Toast.success(`Paquete generado: ${plan.items.length} archivos`);
    } catch (e) { if (btn) { btn.disabled = false; btn.textContent = 'Generar paquete'; } Toast.error(errTxt(e, 'No se pudo armar el paquete')); }
  }

  // Editor de perfiles en Configuración (nivel 100) ----------------------------------------------------------------------
  let cfgEl = null;
  async function perfilesConfig(el) {
    if (!el) return; cfgEl = el;
    el.innerHTML = `<h3 class="font-bold text-sm mb-1"><i class="ri-government-line n" aria-hidden="true"></i> Perfiles de convocante</h3><p class="text-xs text-ink-subtle mb-3">La lista típica de anexos por sobre de cada dependencia; cada licitación la copia y la ajusta.</p><div id="cfgPerfLista" aria-busy="true">${Skeleton.table(2, 3)}</div>`;
    try {
      const ps = await cargarPerfiles(true);
      const l = document.getElementById('cfgPerfLista'); if (!l) return;
      l.removeAttribute('aria-busy');
      l.innerHTML = `<ul class="divide-y" style="border-color:var(--line)">${ps.map((p) => `<li class="py-2 flex flex-wrap items-center justify-between gap-2"><div class="min-w-0"><p class="font-medium text-sm">${S(p.nombre)} ${p.es_fabrica ? '<span class="chip chip-ind">De fábrica</span>' : ''}${p.activo ? '' : ' <span class="chip chip-ind">Inactivo</span>'}</p><p class="text-xs text-ink-muted">${(p.requisitos_json || []).length} requisitos${p.naming_pattern ? ' · nombres: ' + S(p.naming_pattern) : ''}</p></div>
<div class="flex gap-1">${p.es_fabrica
        ? `<button type="button" class="btn btn-s text-xs" onclick="Licitaciones.editarPerfil(${+p.id})"><i class="ri-eye-line" aria-hidden="true"></i> Ver</button><button type="button" class="btn btn-s text-xs" onclick="Licitaciones.duplicarPerfil(${+p.id})"><i class="ri-file-copy-line" aria-hidden="true"></i> Duplicar</button>`
        : `<button type="button" class="btn btn-s text-xs" onclick="Licitaciones.editarPerfil(${+p.id})"><i class="ri-edit-line" aria-hidden="true"></i> Editar</button><button type="button" class="btn-icon" onclick="Licitaciones.borrarPerfil(${+p.id})" aria-label="Borrar perfil ${S(p.nombre)}"><i class="ri-delete-bin-line" aria-hidden="true"></i></button>`}</div></li>`).join('')}</ul>
<button type="button" class="btn btn-s text-xs mt-2" onclick="Licitaciones.editarPerfil()"><i class="ri-add-line" aria-hidden="true"></i> Nuevo perfil</button>`;
    } catch (e) { const l = document.getElementById('cfgPerfLista'); if (l) l.innerHTML = `<p class="text-sm text-danger">${S(errTxt(e, 'No se pudieron leer los perfiles'))}</p>`; }
  }
  function filaPerfil(x, i, lectura) {
    const dis = lectura ? 'disabled' : '';
    return `<tr data-fila="${i}"><td data-et="Anexo"><input class="inp font-mono" data-k="anexo_id" value="${S(x.anexo_id || '')}" aria-label="Anexo" ${dis}></td>
<td data-et="Sobre"><select class="inp" data-k="sobre" aria-label="Sobre" ${dis}>${opciones(SOBRES, x.sobre || 'legal')}</select></td>
<td data-et="Descripción"><input class="inp" data-k="descripcion" value="${S(x.descripcion || '')}" aria-label="Descripción" ${dis}></td>
<td data-et="Origen"><select class="inp" data-k="origen" aria-label="Origen" ${dis}>${opciones(ORIGENES, x.origen || 'se_genera')}</select></td>
<td data-et="Categoría"><select class="inp" data-k="categoria_expediente" aria-label="Categoría del expediente" ${dis}>${opciones(CATEGORIAS_EXPEDIENTE, x.categoria_expediente || '', 'Ninguna')}</select></td>
<td data-et="Firma"><input type="checkbox" data-k="requiere_firma" aria-label="Requiere firma" ${x.requiere_firma ? 'checked' : ''} ${dis}></td>
<td data-et="">${lectura ? '' : `<button type="button" class="btn-icon" onclick="this.closest('tr').remove()" aria-label="Quitar renglón"><i class="ri-close-line" aria-hidden="true"></i></button>`}</td></tr>`;
  }
  async function editarPerfil(id) {
    const ps = await cargarPerfiles();
    const p = id ? ps.find((x) => x.id === id) : { nombre: '', requisitos_json: [], activo: true };
    if (!p) return;
    const lectura = !!p.es_fabrica;
    modal(lectura ? `Perfil de fábrica: ${p.nombre}` : id ? `Editar perfil ${p.nombre}` : 'Nuevo perfil de convocante', `<form id="lcFormPf" onsubmit="event.preventDefault();Licitaciones.guardarPerfil(${id ? +id : 'null'})" class="space-y-3">
<div class="grid sm:grid-cols-2 gap-3">
${campo('lcPfNombre', 'Nombre *', `<input id="lcPfNombre" class="inp" required maxlength="120" value="${S(p.nombre || '')}" ${lectura ? 'disabled' : ''}>`)}
${campo('lcPfPat', 'Nombre de los archivos del paquete', `<input id="lcPfPat" class="inp font-mono" maxlength="120" value="${S(p.naming_pattern || '')}" placeholder="{NN}_{anexo}_{descripcion}.pdf" ${lectura ? 'disabled' : ''}><p class="field-hint">{NN} posición en el sobre · {anexo} · {XX} anexo sin signos · {sobre} · {descripcion}</p>`)}
${campo('lcPfDesc', 'Descripción', `<textarea id="lcPfDesc" class="inp" rows="2" ${lectura ? 'disabled' : ''}>${S(p.descripcion || '')}</textarea>`, 'sm:col-span-2')}
</div>${lectura ? '' : `<label class="flex items-center gap-2 text-sm" style="min-height:var(--tap)"><input id="lcPfActivo" type="checkbox" ${p.activo !== false ? 'checked' : ''}> Activo (se ofrece al dar de alta una licitación)</label>`}
<div class="table-wrap g rounded-xl" style="max-height:50vh;overflow:auto" tabindex="0" role="region" aria-label="Requisitos del perfil"><table class="table-modern lc-tbl w-full text-sm"><caption class="sr-only">Requisitos del perfil</caption><thead><tr><th scope="col">Anexo</th><th scope="col">Sobre</th><th scope="col">Descripción</th><th scope="col">Origen</th><th scope="col">Categoría</th><th scope="col">Firma</th><th scope="col"><span class="sr-only">Quitar</span></th></tr></thead>
<tbody id="lcPfFilas">${(p.requisitos_json || []).map((x, i) => filaPerfil(x, i, lectura)).join('')}</tbody></table></div>
<div class="flex flex-wrap justify-between gap-2 pt-2">${lectura ? `<button type="button" class="btn btn-s" onclick="Licitaciones.duplicarPerfil(${+p.id})"><i class="ri-file-copy-line" aria-hidden="true"></i> Duplicar para editar</button>` : `<button type="button" class="btn btn-s" onclick="Licitaciones.agregarFilaPerfil()"><i class="ri-add-line" aria-hidden="true"></i> Agregar renglón</button>`}
<div class="flex gap-2"><button type="button" class="btn btn-s" onclick="Licitaciones.cerrarModal()">${lectura ? 'Cerrar' : 'Cancelar'}</button>${lectura ? '' : '<button type="submit" class="btn btn-p"><i class="ri-save-line" aria-hidden="true"></i> Guardar perfil</button>'}</div></div></form>`, 'max-w-5xl');
  }
  function agregarFilaPerfil() {
    const tb = document.getElementById('lcPfFilas'); if (!tb) return;
    tb.insertAdjacentHTML('beforeend', filaPerfil({ sobre: 'legal', origen: 'se_genera' }, tb.children.length, false));
    const ult = tb.lastElementChild && tb.lastElementChild.querySelector('input'); if (ult) ult.focus();
  }
  /** Lee los renglones del editor de perfiles (los vacíos se ignoran). */
  function leerFilasPerfil() {
    return [...document.querySelectorAll('#lcPfFilas tr')].map((tr) => {
      const o = {};
      tr.querySelectorAll('[data-k]').forEach((x) => { o[x.dataset.k] = x.type === 'checkbox' ? x.checked : String(x.value || '').trim(); });
      if (!o.categoria_expediente) o.categoria_expediente = null;
      return o;
    }).filter((o) => o.anexo_id);
  }
  async function guardarPerfil(id) {
    const f = document.getElementById('lcFormPf'); if (f && !f.reportValidity()) return;
    const datos = { nombre: val('lcPfNombre'), descripcion: val('lcPfDesc'), naming_pattern: val('lcPfPat'), activo: !!(document.getElementById('lcPfActivo') || {}).checked, requisitos_json: leerFilasPerfil() };
    if (id) datos.id = id;
    try {
      await rpc('guardar_perfil_convocante', { p_datos: datos });
      perfiles = null; cerrarModal(); Toast.success('Perfil guardado'); perfilesConfig(cfgEl);
    } catch (e) { Toast.error(errTxt(e, 'No se guardó el perfil')); }
  }
  async function duplicarPerfil(id) {
    const p = (await cargarPerfiles()).find((x) => x.id === id); if (!p) return;
    try {
      const r = await rpc('guardar_perfil_convocante', { p_datos: { nombre: `${p.nombre} (copia)`, descripcion: p.descripcion, naming_pattern: p.naming_pattern, sobres_json: p.sobres_json || [], requisitos_json: p.requisitos_json || [], activo: true } });
      perfiles = null; Toast.success('Perfil duplicado: ya puedes editarlo');
      await perfilesConfig(cfgEl); editarPerfil(r.id);
    } catch (e) { Toast.error(errTxt(e, 'No se duplicó el perfil')); }
  }
  async function borrarPerfil(id) {
    const p = (await cargarPerfiles()).find((x) => x.id === id); if (!p) return;
    const okc = await Dialog.confirm({ title: 'Borrar perfil', body: `Se borrará el perfil «${p.nombre}». Las licitaciones que lo usaban conservan sus requisitos.`, confirmText: 'Borrar perfil', tone: 'danger' });
    if (!okc) return;
    try { await rpc('borrar_perfil_convocante', { p_id: id }); perfiles = null; Toast.success('Perfil borrado'); perfilesConfig(cfgEl); }
    catch (e) { Toast.error(errTxt(e, 'No se borró el perfil')); }
  }

  let reqAdjuntando = null;
  function adjuntarRequisito(id) { reqAdjuntando = id; const i = document.getElementById('lcReqFile'); if (i) { i.value = ''; i.click(); } }
  async function subirArchivoRequisito(file, id) {
    const rid = id || reqAdjuntando; const r = reqPorId(rid);
    if (!file || !r) return;
    if (file.size > MAX_BYTES) { Toast.error(`«${file.name}» pesa ${fmtBytes(file.size)}: comprímelo o divídelo (máximo 50 MB).`); return; }
    const mime = mimeDe(file.name, file.type);
    if (!mime) { Toast.error(`«${file.name}»: tipo no admitido. Conviértelo a PDF.`); return; }
    const path = rutaArchivo(currentUser.empresa_id, F.lic.id, 'requisitos', `${r.anexo_id}_${file.name}`);
    try {
      const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
      if (up.error) throw up.error;
      let x;
      try { x = await rpc('guardar_requisito', { p_datos: { id: rid, archivo_path: path } }); }
      catch (e) { await sb.storage.from(BUCKET).remove([path]); throw e; }
      if (r.archivo_path && r.archivo_path !== path) await sb.storage.from(BUCKET).remove([r.archivo_path]);
      reemplazarReq(x.requisito);
      Toast.success(`${r.anexo_id}: archivo final guardado`); repintarFicha();
    } catch (e) { Toast.error(errTxt(e, 'No se guardó el archivo')); }
  }
  async function verArchivoRequisito(id) {
    const r = reqPorId(id); if (!r || !r.archivo_path) return;
    const w = window.open('', '_blank');
    try { const u = await urlFirmada(r.archivo_path); if (w) { w.opener = null; w.location.href = u; } else window.location.assign(u); }
    catch (e) { if (w) w.close(); Toast.error(errTxt(e, 'No se pudo abrir el archivo')); }
  }
  /** Precios (US-829 y US-833): vive en js/licitacion-precios.js (diferido 'lcp'); se pide al abrir la pestaña. */
  function pintarPrecios(el, ctx) {
    el.innerHTML = `<div aria-busy="true">${Skeleton.table(5, 5)}</div>`;
    conModuloArchivo('lcp').then((m) => {
      if ($('lcPanel') !== el) return;
      if (m) m.pintar(el, ctx); else el.innerHTML = EmptyState({ icon: 'ri-wifi-off-line', title: 'No se pudo cargar la lista de precios', body: 'Revisa tu conexión e intenta de nuevo.', action: { label: 'Reintentar', icon: 'ri-refresh-line', onClick: "Licitaciones.tabFicha('precios')" } });
    });
  }
  // Cierre y «Convertir en obra» (US-821) ------------------------------------------------------------------------------
  const ESTATUS_CERRADOS = ['ganada', 'perdida', 'desierta', 'cancelada', 'no_participamos'];
  /** Fecha de término: la de las bases o inicio + plazo − 1 (días naturales). Función pura. */
  function finDeObra(lic) {
    const t = lic && lic.bases && lic.bases.fechas && lic.bases.fechas.termino_obra;
    if (t) return String(t).slice(0, 10);
    if (!lic || !lic.inicio_obra || !lic.plazo_dias) return '';
    const d = new Date(String(lic.inicio_obra).slice(0, 10) + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + Number(lic.plazo_dias) - 1);
    return d.toISOString().slice(0, 10);
  }
  /** Datos que «Convertir en obra» le pasa a WizardObra (columnas de obras). Montos de licitación: sin IVA. Pura. */
  function prefillObra(lic) {
    return {
      nombre_obra: lic.nombre, codigo_obra: lic.codigo, cliente: lic.convocante || '', ubicacion: lic.ubicacion || '',
      fecha_inicio: lic.inicio_obra ? String(lic.inicio_obra).slice(0, 10) : '', fecha_fin_estimada: finDeObra(lic),
      descripcion: (lic.bases && lic.bases.concurso && lic.bases.concurso.objeto) || `Obra ganada en la licitación ${lic.codigo}`,
      tipo_proyecto: 'Obra', monto: lic.monto_propuesto != null ? Number(lic.monto_propuesto) : (lic.monto_ganador != null ? Number(lic.monto_ganador) : 0), ivaMode: 'sin',
    };
  }
  /** Archivo del catálogo propuesto: el más reciente de la categoría «catalogo» en Excel o CSV. Pura. */
  function catalogoPropuesto(archivos) {
    return (archivos || []).filter((a) => a.categoria === 'catalogo' && /\.(xlsx|xls|csv)$/i.test(a.nombre || ''))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  }
  function pintarCierre(el, ctx) {
    const l = ctx.lic;
    const cerr = ESTATUS_CERRADOS.includes(l.estatus);
    const obra = l.obra_id ? (D.o || []).find((o) => o.id === l.obra_id) : null;
    const cat = catalogoPropuesto(ctx.archivos);
    el.innerHTML = `<div class="grid lg:grid-cols-3 gap-4">
<form id="lcFormCierre" class="g rounded-xl p-4 lg:col-span-2 space-y-3" onsubmit="event.preventDefault();Licitaciones.guardarCierre()" aria-labelledby="lcCiT">
<h2 id="lcCiT" class="font-bold text-sm"><i class="ri-flag-2-line" aria-hidden="true"></i> Resultado del concurso</h2>
<div class="grid sm:grid-cols-2 gap-3">
${campo('lcCiRes', 'Resultado', `<select id="lcCiRes" class="inp">${opciones(ESTATUS, l.estatus)}</select>`)}
${campo('lcCiFallo', 'Fecha del fallo', `<input id="lcCiFallo" type="datetime-local" class="inp" value="${S(aLocalMx(l.fallo))}">`)}
${campo('lcCiProp', 'Nuestra propuesta (sin IVA)', `<input id="lcCiProp" type="number" step="0.01" min="0" class="inp" value="${l.monto_propuesto ?? ''}">`)}
${campo('lcCiMonto', 'Monto ganador (sin IVA)', `<input id="lcCiMonto" type="number" step="0.01" min="0" class="inp" value="${l.monto_ganador ?? ''}">`)}
${campo('lcCiGan', 'Ganador', `<input id="lcCiGan" class="inp" maxlength="200" value="${S(l.ganador || '')}" placeholder="Razón social de quien ganó">`, 'sm:col-span-2')}
${campo('lcCiLec', 'Lecciones aprendidas', `<textarea id="lcCiLec" class="inp" rows="4" placeholder="Qué funcionó, qué faltó, en qué precio nos ganaron">${S(l.lecciones || '')}</textarea>`, 'sm:col-span-2')}
</div><div class="flex justify-end"><button type="submit" class="btn btn-p"><i class="ri-save-line" aria-hidden="true"></i> Guardar cierre</button></div></form>
<div class="space-y-4">
${l.estatus === 'ganada' ? `<section class="g rounded-xl p-4" aria-labelledby="lcCiObra"><h2 id="lcCiObra" class="font-bold text-sm mb-2"><i class="ri-building-2-line" aria-hidden="true"></i> Obra</h2>
${l.obra_id ? `<p class="text-sm mb-3">Esta licitación ya es la obra ${obra ? `<b>${S(obra.codigo_obra || '')} ${S(obra.nombre_obra || '')}</b>` : `#${+l.obra_id}`}. Sus archivos se ven en Documentos de la obra.</p><button type="button" class="btn btn-s" onclick="Licitaciones.verObra()"><i class="ri-external-link-line" aria-hidden="true"></i> Abrir la obra</button>`
    : `<p class="text-sm mb-3">Crea la obra con el asistente: nombre, cliente (convocante), monto, fechas${cat ? ' y el catálogo propuesto' : ''} ya vienen llenos.</p>${cat ? `<p class="text-xs text-ink-muted mb-3">Catálogo: ${S(cat.nombre)}</p>` : '<p class="text-xs text-ink-muted mb-3">Sube el catálogo propuesto (Excel) en Archivos, categoría «Catálogo», para que entre al asistente.</p>'}<button type="button" class="btn btn-p" onclick="Licitaciones.convertirEnObra()"><i class="ri-building-2-line" aria-hidden="true"></i> Convertir en obra</button>`}</section>` : ''}
${cerr ? `<section class="g rounded-xl p-4" aria-labelledby="lcCiBp"><h2 id="lcCiBp" class="font-bold text-sm mb-2"><i class="ri-database-2-line" aria-hidden="true"></i> Banco de precios</h2>
<p class="text-sm mb-3">Gane o pierda, los precios de esta propuesta sirven para la siguiente. Manda al banco los insumos del proyecto de OPUS${l.opus_proyecto ? ` (${S(l.opus_proyecto)})` : ''} ligados a esta licitación.</p>
<button type="button" class="btn btn-s" onclick="Licitaciones.irAlBanco()"><i class="ri-arrow-right-line" aria-hidden="true"></i> Mandar la propuesta al banco de precios</button></section>` : ''}
</div></div>`;
  }
  async function guardarCierre() {
    const num = (id) => { const v = val(id); return v === '' ? null : Number(v); };
    const antes = F.lic.estatus;
    const datos = { id: F.lic.id, estatus: val('lcCiRes'), fallo: aIsoMx(val('lcCiFallo')), monto_propuesto: num('lcCiProp'), monto_ganador: num('lcCiMonto'), ganador: val('lcCiGan'), lecciones: val('lcCiLec') };
    try {
      const r = await rpc('guardar_licitacion', { p_datos: datos });
      Object.assign(F.lic, r.licitacion); actualizarEnLista(r.licitacion);
      Toast.success('Cierre guardado');
      repintarFicha();
      if (ESTATUS_CERRADOS.includes(r.licitacion.estatus) && !ESTATUS_CERRADOS.includes(antes)) {
        const ir = await Dialog.confirm({ title: 'Mandar la propuesta al banco de precios', body: `La licitación quedó como «${etiqueta(ESTATUS, r.licitacion.estatus)}». ¿Quieres llevar los precios de esta propuesta al Banco de precios para reutilizarlos?`, confirmText: 'Ir al banco de precios', cancelText: 'Después' });
        if (ir) irAlBanco();
      }
    } catch (e) { Toast.error(errTxt(e, 'No se guardó el cierre')); }
  }
  /** Banco de precios (épica D): la importación de la propuesta (US-825) vive en el módulo bp; aquí sólo se enlaza. */
  function irAlBanco() {
    try { sessionStorage.setItem('bp_desde_licitacion', JSON.stringify({ id: F.lic.id, codigo: F.lic.codigo, opus_proyecto: F.lic.opus_proyecto || null })); } catch (e) { /* sin almacenamiento */ }
    cerrarModal();
    if (typeof irAModulo === 'function') irAModulo('bp');
  }
  function verObra() { if (F && F.lic.obra_id && typeof abrirFichaObra === 'function') abrirFichaObra(F.lic.obra_id); }
  async function convertirEnObra() {
    if (!F || F.lic.estatus !== 'ganada') { Toast.warning('Primero guarda el resultado «Ganada».'); return; }
    if (typeof WizardObra === 'undefined') { Toast.error('No se cargó el asistente de obras; recarga la página.'); return; }
    const lic = F.lic;
    let catalogo = null;
    const cat = catalogoPropuesto(F.archivos);
    if (cat) { try { const blob = await blobDe(cat.archivo_path); catalogo = new File([blob], cat.nombre, { type: blob.type }); } catch (e) { Toast.warning('No se pudo leer el catálogo propuesto; podrás cargarlo en el asistente.'); } }
    await WizardObra.open({
      prefill: prefillObra(lic), catalogo,
      alCrearObra: async (obraId) => {
        const r = await rpc('guardar_licitacion', { p_datos: { id: lic.id, obra_id: obraId } });
        Object.assign(lic, r.licitacion); actualizarEnLista(r.licitacion);
        Toast.success(`Licitación ${lic.codigo} ligada a la obra`);
        if (F && F.lic.id === lic.id && M === 'lc') repintarFicha();
      },
    });
  }

  // Archivos de la convocante desde Documentos de la obra (US-821): enlace, no copia ---------------------------------------
  const archivosObra = {};
  async function pintarArchivosDeObra(el, obraId) {
    if (!el || !obraId) return;
    try {
      const { data: ls, error } = await sb.from('licitaciones').select('id,codigo,nombre').eq('obra_id', obraId);
      if (error) throw error;
      if (!ls || !ls.length) { el.innerHTML = ''; return; }
      const { data: as, error: e2 } = await sb.from('licitacion_archivos').select('id,licitacion_id,categoria,nombre,archivo_path,tamano,created_at').in('licitacion_id', ls.map((l) => l.id)).order('categoria').order('created_at');
      if (e2) throw e2;
      (as || []).forEach((a) => { archivosObra[a.id] = a; });
      el.innerHTML = ls.map((l) => {
        const mios = (as || []).filter((a) => a.licitacion_id === l.id);
        return `<section class="g rounded-xl p-4 mb-4" aria-labelledby="docLic-${+l.id}"><div class="flex flex-wrap items-center justify-between gap-2 mb-2"><h3 id="docLic-${+l.id}" class="font-bold text-sm"><i class="ri-auction-line" aria-hidden="true"></i> Archivos de la convocante · ${S(l.codigo)}</h3>
<button type="button" class="btn btn-s text-xs" onclick="Licitaciones.abrir(${+l.id},'archivos')"><i class="ri-external-link-line" aria-hidden="true"></i> Abrir la licitación</button></div>
<p class="text-xs text-ink-muted mb-2">Vienen de la licitación (no son copias): bases, anexos, actas y planos tal como los publicó la dependencia.</p>
${mios.length ? `<ul class="text-sm divide-y" style="border-color:var(--line)">${mios.map((a) => `<li class="py-2 flex items-center justify-between gap-2"><span class="min-w-0 break-all">${S(a.nombre)} <span class="text-xs text-ink-muted">· ${S(etiqueta(CATEGORIAS_ARCHIVO, a.categoria))} · ${fmtBytes(a.tamano)}</span></span><button type="button" class="btn-icon" onclick="Licitaciones.verArchivoObra(${+a.id})" aria-label="Ver ${S(a.nombre)}"><i class="ri-eye-line" aria-hidden="true"></i></button></li>`).join('')}</ul>` : '<p class="text-sm text-ink-muted">La licitación no tiene archivos.</p>'}</section>`;
      }).join('');
    } catch (e) { el.innerHTML = ''; }
  }
  async function verArchivoObra(id) {
    const a = archivosObra[id]; if (!a) return;
    const w = window.open('', '_blank');
    try { const u = await urlFirmada(a.archivo_path); if (w) { w.opener = null; w.location.href = u; } else window.location.assign(u); }
    catch (e) { if (w) w.close(); Toast.error(errTxt(e, 'No se pudo abrir el archivo')); }
  }
  // Importar bases desde un archivo licitacion-bases/v1 preparado con Claude Code (US-819) ---------------------------------
  /** Esquema versionado: copia exacta de docs/licitaciones/licitacion-bases.schema.json (la prueba lo compara). */
  const ESQUEMA_BASES = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://app.supernovarquitectos.com/schemas/licitacion-bases/v1.json", "title": "licitacion-bases/v1", "description": "Bases de una licitación leídas de la convocatoria (PDF) por Claude Code en la PC del usuario, para importarlas en Control de Obra › Licitaciones › Bases › Importar bases. Toma los campos de licitagen/schemas/bases.schema.json y agrega requisitos[] por sobre, causas de desechamiento y la página de origen de cada dato. Fechas: 'YYYY-MM-DD' o 'YYYY-MM-DDTHH:MM' en hora de México; si el texto no permite fecha exacta, null y el texto en notas_importantes.", "type": "object", "additionalProperties": false, "required": ["formato", "concurso"], "properties": {"formato": {"const": "licitacion-bases/v1"}, "fuente": {"type": "object", "additionalProperties": false, "properties": {"archivo": {"type": ["string", "null"]}, "generado_por": {"type": ["string", "null"]}, "fecha": {"type": ["string", "null"]}}}, "concurso": {"type": "object", "additionalProperties": false, "required": ["numero", "convocante", "objeto"], "properties": {"numero": {"type": ["string", "null"], "maxLength": 120}, "nombre": {"type": ["string", "null"], "maxLength": 300}, "modalidad": {"type": ["string", "null"]}, "convocante": {"type": ["string", "null"], "maxLength": 200}, "objeto": {"type": ["string", "null"]}, "ubicacion": {"type": ["string", "null"]}, "plaza": {"type": ["string", "null"], "enum": ["cuauhtemoc", "chihuahua", "juarez", "parral", "casas_grandes", "otra", null]}, "fuente_recursos": {"type": ["string", "null"]}}}, "fechas": {"type": "object", "additionalProperties": false, "properties": {"publicacion": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}"}, "visita_obra": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}"}, "junta_aclaraciones": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}"}, "presentacion_propuestas": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}"}, "fallo": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}"}, "firma_contrato": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}"}, "inicio_obra": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}"}, "termino_obra": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}"}, "plazo_dias": {"type": ["integer", "null"], "minimum": 0}, "tipo_dias": {"type": ["string", "null"], "enum": ["naturales", "habiles", null]}}}, "economicos": {"type": "object", "additionalProperties": false, "properties": {"anticipo_pct": {"type": ["number", "null"], "minimum": 0, "maximum": 100}, "financiamiento_pct": {"type": ["number", "null"]}, "forma_pago": {"type": ["string", "null"]}, "moneda": {"type": ["string", "null"]}, "presupuesto_referencial": {"type": ["number", "null"], "minimum": 0}, "ajuste_costos": {"type": ["string", "null"]}, "garantias": {"type": "object", "additionalProperties": false, "properties": {"seriedad_propuesta": {"type": ["string", "null"]}, "anticipo": {"type": ["string", "null"]}, "cumplimiento": {"type": ["string", "null"]}, "vicios_ocultos": {"type": ["string", "null"]}}}}}, "requisitos_empresa": {"type": "array", "items": {"type": "object", "additionalProperties": false, "required": ["clave", "descripcion"], "properties": {"clave": {"type": "string"}, "descripcion": {"type": "string"}, "obligatorio": {"type": ["boolean", "null"]}, "minimo": {"type": ["string", "null"]}}}}, "partidas": {"type": "array", "items": {"type": "object", "additionalProperties": false, "required": ["clave", "descripcion"], "properties": {"clave": {"type": "string"}, "descripcion": {"type": "string"}, "unidad": {"type": ["string", "null"]}, "cantidad": {"type": ["number", "null"]}, "monto_estimado": {"type": ["number", "null"]}}}}, "documentos_requeridos": {"description": "Compatibilidad con LicitaGen: si no viene requisitos[], se toman de aquí (sobre tecnica/economica).", "type": "array", "items": {"type": "object", "additionalProperties": false, "required": ["sobre", "anexo_id", "descripcion"], "properties": {"sobre": {"type": "string", "enum": ["legal", "tecnica", "economica"]}, "anexo_id": {"type": "string"}, "descripcion": {"type": "string"}, "requiere_firma": {"type": ["boolean", "null"]}, "formato": {"type": ["string", "null"]}, "obligatorio": {"type": ["boolean", "null"]}, "fuente": {"type": ["string", "null"]}}}}, "anexos_convocante": {"type": "array", "items": {"type": "object", "additionalProperties": false, "required": ["anexo_id", "nombre"], "properties": {"anexo_id": {"type": "string"}, "nombre": {"type": "string"}, "tipo": {"type": ["string", "null"]}, "paginas": {"type": ["string", "null"]}, "archivo_referencia": {"type": ["string", "null"]}}}}, "notas_importantes": {"type": "array", "items": {"type": "string"}}, "causas_desechamiento": {"type": "array", "items": {"type": "string"}}, "criterios_evaluacion": {"type": "object", "additionalProperties": false, "properties": {"metodo": {"type": ["string", "null"], "enum": ["puntos_y_porcentajes", "binario", "precio_mas_bajo", "otro", null]}, "puntos_legal": {"type": ["number", "null"]}, "puntos_tecnico": {"type": ["number", "null"]}, "puntos_economico": {"type": ["number", "null"]}, "subcriterios": {"type": "array", "items": {"type": "object", "additionalProperties": false, "required": ["criterio", "peso"], "properties": {"criterio": {"type": "string"}, "peso": {"type": "number"}, "descripcion": {"type": ["string", "null"]}}}}}}, "requisitos": {"type": "array", "items": {"type": "object", "additionalProperties": false, "required": ["anexo_id", "sobre", "descripcion"], "properties": {"anexo_id": {"type": "string", "minLength": 1, "maxLength": 40}, "sobre": {"type": "string", "enum": ["legal", "tecnico", "economico"]}, "descripcion": {"type": "string", "maxLength": 500}, "origen": {"type": ["string", "null"], "enum": ["expediente", "se_genera", "opus", "dependencia", null]}, "requiere_firma": {"type": ["boolean", "null"]}, "categoria_expediente": {"type": ["string", "null"], "enum": ["opinion_sat", "opinion_imss", "opinion_infonavit", "identificacion", "acta_constitutiva", "poder", "constancia_fiscal", "comprobante_domicilio", "estados_financieros", "cmic", "colegio", "poliza_rc", "curriculum", "otro", "padron_contratistas", "declaracion_anual", null]}, "pagina": {"type": ["integer", "null"], "minimum": 1}}}}, "paginas": {"description": "Página del PDF de donde salió cada dato, por ruta: {\"concurso.objeto\": 3, \"fechas.presentacion_propuestas\": 5}.", "type": "object", "additionalProperties": {"type": "integer", "minimum": 1}}}};
  const b_ = (o, ruta) => ruta.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
  const NOMBRE_TIPO = { string: 'texto', integer: 'número entero', number: 'número', boolean: 'sí o no (true / false)', object: 'objeto', array: 'lista', null: 'vacío (null)' };
  function esTipo(v, t) {
    if (t === 'null') return v === null;
    if (t === 'array') return Array.isArray(v);
    if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
    if (t === 'integer') return Number.isInteger(v);
    if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
    return typeof v === t;
  }
  /** Validador mínimo de JSON Schema (type, const, enum, required, properties, additionalProperties, items, minimum,
   *  maximum, minLength, maxLength, pattern) con mensajes en español y la ruta del dato. */
  function validarEsquema(v, sch, ruta, errs) {
    const r = ruta || 'archivo';
    if (Object.prototype.hasOwnProperty.call(sch, 'const')) { if (v !== sch.const) errs.push(`${r}: debe ser «${sch.const}».`); return; }
    if (sch.type) {
      const tipos = [].concat(sch.type);
      if (!tipos.some((t) => esTipo(v, t))) { errs.push(`${r}: debe ser ${tipos.map((t) => NOMBRE_TIPO[t] || t).join(' o ')}.`); return; }
    }
    if (sch.enum && !sch.enum.includes(v)) { errs.push(`${r}: el valor «${v}» no se admite; usa uno de estos: ${sch.enum.filter((x) => x !== null).join(', ')}.`); return; }
    if (v === null) return;
    if (typeof v === 'string') {
      if (sch.minLength && v.length < sch.minLength) errs.push(`${r}: no puede ir vacío.`);
      if (sch.maxLength && v.length > sch.maxLength) errs.push(`${r}: admite hasta ${sch.maxLength} caracteres.`);
      if (sch.pattern && !new RegExp(sch.pattern).test(v)) errs.push(`${r}: la fecha debe escribirse AAAA-MM-DD o AAAA-MM-DDTHH:MM (se recibió «${v}»).`);
    }
    if (typeof v === 'number') {
      if (sch.minimum !== undefined && v < sch.minimum) errs.push(`${r}: debe ser mayor o igual a ${sch.minimum}.`);
      if (sch.maximum !== undefined && v > sch.maximum) errs.push(`${r}: debe ser menor o igual a ${sch.maximum}.`);
    }
    if (Array.isArray(v) && sch.items) v.forEach((x, i) => validarEsquema(x, sch.items, `${r}[${i + 1}]`, errs));
    if (esTipo(v, 'object')) {
      for (const k of sch.required || []) if (!(k in v)) errs.push(`${r}: falta el campo «${k}».`);
      const props = sch.properties || {};
      for (const [k, x] of Object.entries(v)) {
        const sub = ruta ? `${ruta}.${k}` : k;
        if (props[k]) validarEsquema(x, props[k], sub, errs);
        else if (sch.additionalProperties === false) errs.push(`${sub}: campo desconocido (revisa que el nombre esté bien escrito).`);
        else if (sch.additionalProperties && typeof sch.additionalProperties === 'object') validarEsquema(x, sch.additionalProperties, sub, errs);
      }
    }
  }
  /** Valida un archivo licitacion-bases/v1 (texto u objeto). Devuelve {ok, errores[], datos}. Función pura. */
  function validarBases(entrada) {
    let datos = entrada;
    if (typeof entrada === 'string') {
      try { datos = JSON.parse(entrada.replace(/^﻿/, '')); } catch (e) { return { ok: false, errores: [`El archivo no es JSON válido: ${e.message}`], datos: null }; }
    }
    const errores = [];
    if (!esTipo(datos, 'object')) return { ok: false, errores: ['El archivo debe contener un objeto JSON con las bases.'], datos: null };
    if (datos.formato !== 'licitacion-bases/v1') errores.push(`formato: debe ser «licitacion-bases/v1»${datos.formato ? ` (se recibió «${datos.formato}»)` : ''}. Pide a Claude Code que siga el esquema de docs/licitaciones/licitacion-bases.schema.json.`);
    validarEsquema(datos, ESQUEMA_BASES, '', errores);
    const vistos = new Set();
    (Array.isArray(datos.requisitos) ? datos.requisitos : []).forEach((q, i) => {
      const k = String((q && q.anexo_id) || '').trim().toLowerCase();
      if (k && vistos.has(k)) errores.push(`requisitos[${i + 1}]: el anexo «${q.anexo_id}» está repetido.`);
      vistos.add(k);
    });
    const unicos = [...new Set(errores)];
    return { ok: unicos.length === 0, errores: unicos.slice(0, 60), datos };
  }
  /** Modalidad de las bases (texto libre: «LP», «Invitación…», «AD») → catálogo de la BD; null si no se reconoce. */
  function modalidadDe(t) {
    const s = String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (!s) return null;
    if (/invitaci|\bi3p\b|\bir\b|\bio\b|tres personas/.test(s)) return 'invitacion';
    if (/adjudicaci|\bad\b/.test(s)) return 'adjudicacion_directa';
    if (/privad/.test(s)) return 'privada';
    if (/licitaci|\blp[a-z]?\b|\blo\b|public/.test(s)) return 'licitacion_publica';
    return null;
  }
  /** Requisitos del archivo: requisitos[] o, si no viene, documentos_requeridos de LicitaGen (tecnica → tecnico). */
  function requisitosDeBases(b) {
    if (Array.isArray(b.requisitos) && b.requisitos.length) {
      return b.requisitos.map((q) => ({ anexo_id: String(q.anexo_id).trim(), sobre: q.sobre, descripcion: q.descripcion || '', origen: q.origen || 'se_genera', requiere_firma: !!q.requiere_firma, categoria_expediente: q.categoria_expediente || null, pagina: q.pagina || null }));
    }
    const SOB = { legal: 'legal', tecnica: 'tecnico', economica: 'economico' };
    return (b.documentos_requeridos || []).map((q) => ({ anexo_id: String(q.anexo_id).trim(), sobre: SOB[q.sobre] || 'legal', descripcion: q.descripcion || '', origen: 'se_genera', requiere_firma: !!q.requiere_firma, categoria_expediente: null, pagina: null }));
  }
  /** Campos que importa la revisión: origen en el archivo → columna de licitaciones (col) o ruta en bases (ruta). */
  const MAPA_BASES = [
    { de: 'concurso.numero', et: 'Código o número de concurso', col: 'codigo', tipo: 'txt' },
    { de: 'concurso.nombre', et: 'Nombre de la obra', col: 'nombre', tipo: 'txt' },
    { de: 'concurso.convocante', et: 'Convocante', col: 'convocante', tipo: 'txt' },
    { de: 'concurso.modalidad', et: 'Modalidad', col: 'modalidad', tipo: 'modalidad' },
    { de: 'concurso.ubicacion', et: 'Ubicación', col: 'ubicacion', tipo: 'txt' },
    { de: 'concurso.plaza', et: 'Plaza', col: 'plaza', tipo: 'plaza' },
    { de: 'concurso.objeto', et: 'Objeto', ruta: 'concurso.objeto', tipo: 'txt' },
    { de: 'concurso.fuente_recursos', et: 'Fuente de los recursos', ruta: 'concurso.fuente_recursos', tipo: 'txt' },
    { de: 'fechas.publicacion', et: 'Publicación', ruta: 'fechas.publicacion', tipo: 'fecha' },
    { de: 'fechas.visita_obra', et: 'Visita de obra', col: 'visita', tipo: 'fh' },
    { de: 'fechas.junta_aclaraciones', et: 'Junta de aclaraciones', col: 'junta_aclaraciones', tipo: 'fh' },
    { de: 'fechas.presentacion_propuestas', et: 'Presentación y apertura', col: 'presentacion', tipo: 'fh' },
    { de: 'fechas.fallo', et: 'Fallo', col: 'fallo', tipo: 'fh' },
    { de: 'fechas.firma_contrato', et: 'Firma del contrato', ruta: 'fechas.firma_contrato', tipo: 'fecha' },
    { de: 'fechas.inicio_obra', et: 'Inicio de obra', col: 'inicio_obra', tipo: 'fecha' },
    { de: 'fechas.termino_obra', et: 'Término de obra', ruta: 'fechas.termino_obra', tipo: 'fecha' },
    { de: 'fechas.plazo_dias', et: 'Plazo (días)', col: 'plazo_dias', tipo: 'num' },
    { de: 'fechas.tipo_dias', et: 'Tipo de días', ruta: 'fechas.tipo_dias', tipo: 'txt' },
    { de: 'economicos.anticipo_pct', et: 'Anticipo (%)', col: 'anticipo_pct', tipo: 'num' },
    { de: 'economicos.presupuesto_referencial', et: 'Presupuesto base', col: 'presupuesto_base', tipo: 'dinero' },
    { de: 'economicos.financiamiento_pct', et: 'Financiamiento (%)', ruta: 'economicos.financiamiento_pct', tipo: 'num' },
    { de: 'economicos.forma_pago', et: 'Forma de pago', ruta: 'economicos.forma_pago', tipo: 'txt' },
    { de: 'economicos.moneda', et: 'Moneda', ruta: 'economicos.moneda', tipo: 'txt' },
    { de: 'economicos.ajuste_costos', et: 'Ajuste de costos', ruta: 'economicos.ajuste_costos', tipo: 'txt' },
    { de: 'economicos.garantias.seriedad_propuesta', et: 'Garantía de seriedad', ruta: 'economicos.garantias.seriedad_propuesta', tipo: 'txt' },
    { de: 'economicos.garantias.anticipo', et: 'Garantía de anticipo', ruta: 'economicos.garantias.anticipo', tipo: 'txt' },
    { de: 'economicos.garantias.cumplimiento', et: 'Garantía de cumplimiento', ruta: 'economicos.garantias.cumplimiento', tipo: 'txt' },
    { de: 'economicos.garantias.vicios_ocultos', et: 'Garantía de vicios ocultos', ruta: 'economicos.garantias.vicios_ocultos', tipo: 'txt' },
    { de: 'criterios_evaluacion.metodo', et: 'Método de evaluación', ruta: 'criterios_evaluacion.metodo', tipo: 'metodo' },
    { de: 'criterios_evaluacion.puntos_legal', et: 'Puntos legal', ruta: 'criterios_evaluacion.puntos_legal', tipo: 'num' },
    { de: 'criterios_evaluacion.puntos_tecnico', et: 'Puntos técnico', ruta: 'criterios_evaluacion.puntos_tecnico', tipo: 'num' },
    { de: 'criterios_evaluacion.puntos_economico', et: 'Puntos económico', ruta: 'criterios_evaluacion.puntos_economico', tipo: 'num' },
    { de: 'criterios_evaluacion.subcriterios', et: 'Subcriterios de evaluación', ruta: 'criterios_evaluacion.subcriterios', tipo: 'lista' },
    { de: 'causas_desechamiento', et: 'Causas de desechamiento', ruta: 'causas_desechamiento', tipo: 'lista' },
    { de: 'notas_importantes', et: 'Notas importantes', ruta: 'notas_importantes', tipo: 'lista' },
    { de: 'requisitos_empresa', et: 'Requisitos de la empresa (capital, experiencia…)', ruta: 'requisitos_empresa', tipo: 'lista' },
    { de: 'partidas', et: 'Partidas', ruta: 'partidas', tipo: 'lista' },
    { de: 'anexos_convocante', et: 'Anexos que entrega la convocante', ruta: 'anexos_convocante', tipo: 'lista' },
  ];
  /** Texto para la pantalla de revisión. */
  function mostrarValor(v, tipo) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '';
    if (tipo === 'fh') return fmtFechaHora(v);
    if (tipo === 'fecha') return fmtFecha(v);
    if (tipo === 'dinero') return typeof fmt === 'function' ? fmt(v) : String(v);
    if (tipo === 'modalidad') return etiqueta(MODALIDADES, v);
    if (tipo === 'plaza') return etiqueta(PLAZAS, v);
    if (tipo === 'metodo') return etiqueta(METODOS_EVALUACION, v);
    if (tipo === 'lista') return `${v.length} ${v.length === 1 ? 'renglón' : 'renglones'}: ${v.slice(0, 3).map((x) => (typeof x === 'string' ? x : x.criterio || x.descripcion || x.nombre || x.clave || '')).join(' · ')}${v.length > 3 ? '…' : ''}`;
    return String(v);
  }
  const igual = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  /**
   * Propuesta de cambios de un archivo ya validado contra la licitación actual. Función pura.
   * {campos: [{de, et, col|ruta, actual, propuesto, mostrarActual, mostrarPropuesto, pagina, igual, aplicar}],
   *  requisitosNuevos, requisitosExistentes, avisos}
   */
  function propuestaDeBases(b, lic, reqsActuales) {
    const l = lic || {}; const bases = l.bases || {}; const avisos = [];
    const campos = [];
    for (const m of MAPA_BASES) {
      let p = b_(b, m.de);
      if (p === undefined || p === null || p === '' || (Array.isArray(p) && !p.length)) continue;
      if (m.tipo === 'modalidad') { const k = modalidadDe(p); if (!k) { avisos.push(`La modalidad «${p}» no se reconoce; se guarda sólo como texto en las bases.`); continue; } p = k; }
      if (m.tipo === 'fh') { const iso = aIsoMx(p); if (!iso) { avisos.push(`${m.et}: «${p}» no es una fecha válida.`); continue; } p = iso; }
      if (m.tipo === 'fecha') p = String(p).slice(0, 10);
      const actual = m.col ? l[m.col] : b_(bases, m.ruta);
      const comparaActual = m.tipo === 'fh' && actual ? new Date(actual).getTime() : actual;
      const comparaProp = m.tipo === 'fh' ? new Date(p).getTime() : p;
      const eq = m.tipo === 'num' || m.tipo === 'dinero' ? (actual !== null && actual !== undefined && Number(actual) === Number(p)) : igual(comparaActual, comparaProp);
      campos.push({ de: m.de, et: m.et, col: m.col || null, ruta: m.ruta || null, tipo: m.tipo, actual: actual === undefined ? null : actual, propuesto: p,
        mostrarActual: mostrarValor(actual, m.tipo), mostrarPropuesto: mostrarValor(p, m.tipo),
        pagina: (b.paginas && (b.paginas[m.de] || null)) || null, igual: eq,
        // El código identifica la licitación: si ya tiene uno, cambiarlo es opt-in
        aplicar: !eq && !(m.col === 'codigo' && actual) });
    }
    const ya = new Set((reqsActuales || []).map((r) => String(r.anexo_id).trim().toLowerCase()));
    const reqs = requisitosDeBases(b);
    return {
      campos,
      requisitosNuevos: reqs.filter((q) => !ya.has(q.anexo_id.toLowerCase())),
      requisitosExistentes: reqs.filter((q) => ya.has(q.anexo_id.toLowerCase())),
      avisos,
    };
  }
  /** Datos para guardar_licitacion con los campos elegidos (bases se combina, nunca se reemplaza entera). Función pura. */
  function datosDeRevision(lic, propuesta, b) {
    const datos = { id: lic.id };
    const bases = JSON.parse(JSON.stringify(lic.bases || {}));
    bases.formato = 'licitacion-bases/v1';
    const pags = Object.assign({}, bases.paginas || {});
    for (const c of propuesta.campos) {
      if (!c.aplicar) continue;
      if (c.col) datos[c.col] = c.propuesto; else setRuta(bases, c.ruta, c.propuesto);
      if (c.pagina) pags[c.ruta || c.de] = c.pagina;
    }
    if (b && b.concurso && b.concurso.modalidad) setRuta(bases, 'concurso.modalidad_texto', b.concurso.modalidad);
    if (Object.keys(pags).length) bases.paginas = pags;
    if (b && b.fuente) bases.fuente = b.fuente;
    datos.bases = bases;
    return datos;
  }
  let revision = null;
  function importarBases() {
    if (!F) return;
    modal('Importar bases', `<div class="space-y-3"><p class="text-sm">Elige el archivo <b>licitacion-bases/v1</b> (.json) que preparó Claude Code al leer las bases en tu computadora. Antes de guardar verás cada dato junto al que ya tienes; nada se guarda hasta que pulses «Aplicar».</p>
${campo('lcImpFile', 'Archivo de bases (.json)', '<input id="lcImpFile" type="file" accept=".json,application/json" class="inp" onchange="Licitaciones.leerArchivoBases(this.files[0])">')}
<div id="lcImpErr" role="alert"></div>
<p class="text-xs text-ink-muted">La captura manual de las pestañas Bases y Requisitos sigue disponible; importar sólo te ahorra teclear.</p>
<div class="flex justify-end"><button type="button" class="btn btn-s" onclick="Licitaciones.cerrarModal()">Cancelar</button></div></div>`);
  }
  async function leerArchivoBases(file) {
    if (!file) return;
    const box = document.getElementById('lcImpErr');
    if (file.size > 5 * 1048576) { if (box) box.innerHTML = '<p class="text-sm text-danger">El archivo pesa más de 5 MB: no parece un archivo de bases.</p>'; return; }
    revisarBases(await file.text(), file.name);
  }
  /** Pantalla de revisión campo por campo. Recibe texto u objeto licitacion-bases/v1 (la futura lectura con llave de
   *  Anthropic producirá este mismo formato y llamará aquí). */
  function revisarBases(entrada, nombreArchivo) {
    const v = validarBases(entrada);
    if (!v.ok) {
      const box = document.getElementById('lcImpErr');
      const html = `<div class="g rounded-xl p-3" style="background:var(--danger-soft)"><p class="text-sm font-semibold text-danger mb-1">El archivo no se puede importar (${v.errores.length} problema${v.errores.length === 1 ? '' : 's'}):</p><ul class="text-sm list-disc pl-5 space-y-1">${v.errores.map((e) => `<li>${S(e)}</li>`).join('')}</ul></div>`;
      if (box) box.innerHTML = html; else { importarBases(); const b2 = document.getElementById('lcImpErr'); if (b2) b2.innerHTML = html; }
      return v;
    }
    const prop = propuestaDeBases(v.datos, F.lic, F.reqs);
    revision = { datos: v.datos, prop, archivo: nombreArchivo || '' };
    const filas = prop.campos.map((c, i) => `<tr><td data-et=""><input type="checkbox" id="lcRv-${i}" ${c.aplicar ? 'checked' : ''} ${c.igual ? 'disabled' : ''} aria-label="Aplicar ${S(c.et)}"></td><td data-et="Campo"><label for="lcRv-${i}">${S(c.et)}</label></td><td data-et="Actual"><span class="text-ink-muted">${S(c.mostrarActual) || '—'}</span></td><td data-et="Propuesto"><span>${S(c.mostrarPropuesto)}${c.igual ? ' <span class="chip chip-ind">Igual</span>' : ''}</span></td><td data-et="Página"><span>${c.pagina ? S(c.pagina) : '—'}</span></td></tr>`).join('');
    const rn = prop.requisitosNuevos;
    modal('Revisar bases antes de aplicar', `<div class="space-y-3">
<p class="text-sm">${nombreArchivo ? `Archivo <b>${S(nombreArchivo)}</b>. ` : ''}Marca lo que quieras traer. Lo que no marques se queda como está.</p>
${prop.avisos.length ? `<ul class="text-sm text-warn list-disc pl-5">${prop.avisos.map((a) => `<li>${S(a)}</li>`).join('')}</ul>` : ''}
<div class="table-wrap g rounded-xl" style="max-height:45vh;overflow:auto" tabindex="0" role="region" aria-label="Datos propuestos"><table class="table-modern lc-tbl w-full text-sm"><caption class="sr-only">Valor actual contra valor propuesto</caption><thead><tr><th scope="col"><span class="sr-only">Aplicar</span></th><th scope="col">Campo</th><th scope="col">Actual</th><th scope="col">Propuesto</th><th scope="col">Página</th></tr></thead><tbody>${filas || '<tr><td colspan="5" class="text-center py-4 text-ink-muted">El archivo no trae datos generales.</td></tr>'}</tbody></table></div>
<fieldset class="g rounded-xl p-3"><legend class="text-sm font-semibold px-1">Requisitos por sobre</legend>
${rn.length ? `<label class="flex items-center gap-2 text-sm" style="min-height:var(--tap)"><input type="checkbox" id="lcRvReqs" checked> Agregar ${rn.length} requisito${rn.length === 1 ? '' : 's'} nuevo${rn.length === 1 ? '' : 's'} (${Object.keys(SOBRES).map((s) => `${SOBRES[s].toLowerCase()} ${rn.filter((q) => q.sobre === s).length}`).join(', ')})</label>
<p class="text-xs text-ink-muted">${S(rn.slice(0, 8).map((q) => q.anexo_id).join(', '))}${rn.length > 8 ? '…' : ''}</p>` : '<p class="text-sm text-ink-muted">No hay requisitos nuevos en el archivo.</p>'}
${prop.requisitosExistentes.length ? `<p class="text-xs text-ink-muted mt-1">${prop.requisitosExistentes.length} anexo${prop.requisitosExistentes.length === 1 ? '' : 's'} ya está${prop.requisitosExistentes.length === 1 ? '' : 'n'} en la licitación y no se toca${prop.requisitosExistentes.length === 1 ? '' : 'n'}.</p>` : ''}</fieldset>
<div class="flex justify-end gap-2"><button type="button" class="btn btn-s" onclick="Licitaciones.cerrarModal()">Cancelar</button><button type="button" class="btn btn-p" onclick="Licitaciones.aplicarBases()"><i class="ri-check-double-line" aria-hidden="true"></i> Aplicar</button></div></div>`, 'max-w-5xl');
    return v;
  }
  async function aplicarBases() {
    if (!revision || !F) return;
    revision.prop.campos.forEach((c, i) => { const x = document.getElementById(`lcRv-${i}`); c.aplicar = !!(x && x.checked && !c.igual); });
    const conReqs = !!(document.getElementById('lcRvReqs') || {}).checked;
    const datos = datosDeRevision(F.lic, revision.prop, revision.datos);
    try {
      const r = await rpc('guardar_licitacion', { p_datos: datos });
      let ins = 0;
      if (conReqs && revision.prop.requisitosNuevos.length) {
        const x = await rpc('importar_requisitos', { p_licitacion_id: F.lic.id, p_requisitos: revision.prop.requisitosNuevos.map(({ pagina, ...q }) => q) });
        ins = x.insertados;
      }
      actualizarEnLista(r.licitacion);
      F = await cargarFicha(F.lic.id);
      const n = revision.prop.campos.filter((c) => c.aplicar).length;
      revision = null; cerrarModal();
      Toast.success(`Bases importadas: ${n} dato${n === 1 ? '' : 's'}${ins ? ` y ${ins} requisito${ins === 1 ? '' : 's'}` : ''}`);
      repintarFicha();
    } catch (e) { Toast.error(errTxt(e, 'No se aplicaron las bases')); }
  }

  return {
    render, cargar, recargar, nueva, editarDatos, guardarDatos, abrir, volver, tabFicha, tabLista, filtro, cerrarModal,
    guardarSeccion, importarBases, cargarCalendario, cargarPerfiles, registrarPestana,
    subirArchivos, verArchivo, descargarArchivo, borrarArchivo, descargarTodo,
    verSobre, editarRequisito, guardarRequisito, borrarRequisito, moverRequisito, estadoRequisito, guardarEstado,
    adjuntarRequisito, subirArchivoRequisito, verArchivoRequisito,
    generarDelPerfil, confirmarGenerar, guardarComoPerfil, confirmarGuardarPerfil, _resumenPerfil: (id) => (generarDelPerfil._resumen ? generarDelPerfil._resumen(id) : ''),
    perfilesConfig, editarPerfil, agregarFilaPerfil, guardarPerfil, duplicarPerfil, borrarPerfil, llenarDesdeExpediente,
    leerArchivoBases, revisarBases, aplicarBases,
    armarPaquete, generarPaquete,
    guardarCierre, convertirEnObra, irAlBanco, verObra, pintarArchivosDeObra, verArchivoObra,
    get estado() { return st; }, get ficha() { return F; },
    // puras
    hoyMx, fechaMx, diasHasta, proximaFechaClave, resumen, etiqueta, anioDe, filtrar, aniosDe, aLocalMx, aIsoMx,
    avancePorSobre, eventosDeLicitacion, leerCampo, valorCampo, setRuta, errTxt,
    mimeDe, nombreSeguro, rutaArchivo, fmtBytes, agruparPorCategoria, sha256Hex, nombreUnico,
    delSobre, moverEnLista, CATEGORIAS_EXPEDIENTE, faltantesDelPerfil, docsUsables, venceAntes,
    validarBases, propuestaDeBases, datosDeRevision, modalidadDe, requisitosDeBases, ESQUEMA_BASES, MAPA_BASES,
    nombrePaquete, carpetaSobre, planPaquete, manifestCsv,
    finDeObra, prefillObra, catalogoPropuesto, ESTATUS_CERRADOS,
    ESTATUS, MODALIDADES, PLAZAS, SOBRES, ORIGENES, ESTADOS_REQUISITO, ESTADOS_HECHOS, CATEGORIAS_ARCHIVO, FECHAS_CLAVE,
    COLUMNAS, SECCIONES_BASES, LISTA_PESTANAS, FICHA_PESTANAS, METODOS_EVALUACION,
  };
})();
if (typeof module !== 'undefined') module.exports = Licitaciones;
