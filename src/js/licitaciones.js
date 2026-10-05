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
    const tono = { ganada: 'ok', presentada: 'info', en_preparacion: 'warn', perdida: 'danger' }[s];
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
    return { lic: l.data, reqs: r.data || [], archivos: a.data || [] };
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
  function pintarArchivos(el) { el.innerHTML = EmptyState({ icon: 'ri-folder-3-line', title: 'Archivos de la convocante', body: 'Aquí guardarás las bases, anexos, actas y planos tal como los publica la dependencia.' }); }
  function pintarRequisitos(el) { el.innerHTML = EmptyState({ icon: 'ri-checkbox-multiple-line', title: 'Requisitos por sobre', body: 'Aquí capturarás la lista de anexos de cada sobre con su estado.' }); }
  function pintarPrecios(el) {
    el.innerHTML = EmptyState({
      icon: 'ri-price-tag-3-line', title: 'La lista de precios llega con el Banco de precios',
      body: 'Aquí verás los insumos de esta licitación con su precio de referencia para cargarlos a OPUS. Mientras tanto, consulta los precios históricos en el Banco de precios.',
      action: { label: 'Abrir el Banco de precios', icon: 'ri-database-2-line', onClick: "irAModulo('bp')" },
    });
  }
  function pintarCierre(el) { el.innerHTML = EmptyState({ icon: 'ri-flag-2-line', title: 'Cierre', body: 'Aquí registrarás el resultado del fallo.' }); }
  function importarBases() { Toast.info('La importación de bases llega en la siguiente entrega de este módulo.'); }

  return {
    render, cargar, recargar, nueva, editarDatos, guardarDatos, abrir, volver, tabFicha, tabLista, filtro, cerrarModal,
    guardarSeccion, importarBases, cargarCalendario, cargarPerfiles, registrarPestana,
    get estado() { return st; }, get ficha() { return F; },
    // puras
    hoyMx, fechaMx, diasHasta, proximaFechaClave, resumen, etiqueta, anioDe, filtrar, aniosDe, aLocalMx, aIsoMx,
    avancePorSobre, eventosDeLicitacion, leerCampo, valorCampo, setRuta, errTxt,
    ESTATUS, MODALIDADES, PLAZAS, SOBRES, ORIGENES, ESTADOS_REQUISITO, ESTADOS_HECHOS, CATEGORIAS_ARCHIVO, FECHAS_CLAVE,
    COLUMNAS, SECCIONES_BASES, LISTA_PESTANAS, FICHA_PESTANAS, METODOS_EVALUACION,
  };
})();
if (typeof module !== 'undefined') module.exports = Licitaciones;
