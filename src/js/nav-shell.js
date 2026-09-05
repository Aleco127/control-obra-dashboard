/**
 * NavShell (US-603): pinta la barra lateral y la barra inferior a partir de un modelo.
 * Un solo componente para la constructora (index.html) y el cliente (portal.html).
 *
 * No lee D, currentUser, M ni el DOM global: el anfitrión arma el modelo y decide qué hacer con el HTML.
 * Funciona sin S, Toast ni Telemetry (guardas typeof) y carga en Node (module.exports) para probarse con node --test.
 *
 * Modelo:
 *   {
 *     modo: 'constructora' | 'cliente',
 *     marca: { nombre, sub, logo },                      // logo: URL http(s), data:image o ruta relativa
 *     contexto: { etiqueta, titulo, tituloCorto, sub, avance, semaforo, vacio, onClick, accion, onAccion },   // obra activa (opcional)
 *     grupos: [{ k, t, ic, items: [{ k, t, ic, badge, badgeAria, candado, candadoTexto, secundario }], abierto, suelto, plano, separador, candado }],
 *     fijados: ['g', 'o'],                               // claves de «Mi trabajo»
 *     fijadosTitulo, onEditarFijados,
 *     onFijar: (k, item) => "navFijar('g')",             // US-608: con esto cada ítem lleva una estrella (fijar/quitar)
 *     activo: 'g',
 *     colapsado: false,
 *     acciones: [{ k, t, ic, onClick, atajo, tono }],    // pie de la barra
 *     inferior: { items: ['b','f','g','w'], plus: { t, onClick }, mas: { t, onClick } },   // barra inferior móvil
 *     onItem: (k, item) => "M='g';R()",                  // string o función que devuelve el onclick de cada ítem
 *     onGrupo: (k, grupo) => "...",                      // opcional: por defecto NavShell.alternarGrupo(this)
 *     prefijo: 'nvs'                                     // prefijo de ids (aria-controls)
 *   }
 *
 *   NavShell.render(modelo)            → { aside, bottom }  (strings HTML)
 *   NavShell.hoja(modelo)              → string HTML de la hoja móvil (fondo + .nvs-sheet, US-613)
 *   NavShell.visibles(grupos, regla)   → grupos filtrados con regla(item, grupo) === true; quita grupos vacíos
 *   NavShell.conFijados(grupos, fijados) → ítems fijados en orden, sin repetidos ni desconocidos
 *   NavShell.marcarActivo(root, clave) → sobre un Element cambia sólo .active / aria-current; sobre un string devuelve el HTML nuevo
 *   NavShell.alternarGrupo(el, abierto?) / NavShell.alternarMas(btn) → abre o cierra sin repintar; emite 'nvs:grupo'
 *
 * Reglas: todo texto se escapa; un solo aria-current="page" por barra (la primera aparición gana, es decir el fijado);
 * los ítems secundarios van detrás de «Más» y sólo se muestran si el activo es uno de ellos.
 * Un módulo fijado que también sale en su grupo no se pinta activo dos veces (US-608): manda la copia de «Mi trabajo»
 * (marcada con data-fijado) y la del grupo se queda sin .active; la estrella rellena indica que ya está fijado.
 */
const NavShell = (() => {
  const escInterno = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const esc = (v) => (typeof S === 'function' ? S(v) : escInterno(v));
  const CLAVE_OK = /^[a-z][a-z0-9_-]{0,31}$/i;
  const clave = (k) => (CLAVE_OK.test(String(k ?? '')) ? String(k) : esc(k));
  const ICONO_RI = /^ri-[a-z0-9-]+$/;
  const SEMAFORO_TXT = { ok: 'Al día', warn: 'Con atención', danger: 'Con retraso' };

  // Íconos del portal del cliente inlineados como SVG (el portal no carga Remix Icon). Trazos de 24x24, currentColor.
  const ICONOS_CLIENTE = {
    inicio: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
    avance: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5A8.5 8.5 0 0 1 20.5 12"/><path d="M12 12V7.5"/></svg>',
    pagos: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/><path d="M7 14h3"/></svg>',
    entregables: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
    fotos: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/></svg>',
    contacto: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
    cuenta: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>',
    mas: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  };
  const ESTRELLA_ON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.7l5.4-.8z"/></svg>';
  const ESTRELLA_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.7l5.4-.8z"/></svg>';
  const CHEVRON = '<svg class="nvs-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const CANDADO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const LOGO_DEFECTO = '<svg viewBox="0 0 100 100" width="36" height="36" aria-hidden="true"><rect width="100" height="100" rx="16" fill="currentColor" opacity=".12"/><rect x="20" y="35" width="25" height="45" rx="2" fill="currentColor"/><rect x="55" y="20" width="25" height="60" rx="2" fill="currentColor"/></svg>';

  function icono(ic, modo) {
    const s = String(ic ?? '');
    if (ICONOS_CLIENTE[s]) return `<span class="nvs-ic">${ICONOS_CLIENTE[s]}</span>`;
    if (ICONO_RI.test(s)) return `<i class="${s} nvs-ic" aria-hidden="true"></i>`;
    if (modo === 'cliente') return `<span class="nvs-ic">${ICONOS_CLIENTE.mas}</span>`;
    return '<i class="ri-apps-line nvs-ic" aria-hidden="true"></i>';
  }

  function logoHtml(logo) {
    const u = String(logo ?? '').trim();
    const permitido = /^(https?:\/\/|data:image\/|\.?\/?[\w./-]+$)/i.test(u) && !/^javascript:/i.test(u);
    // Si la URL del logo no carga (bucket privado, archivo borrado) el navegador deja una imagen rota
    // dentro de la marca: se cambia por el logo genérico en cuanto falla.
    if (u && permitido) return `<img class="nvs-logo-img" src="${esc(u)}" alt="" onerror="this.outerHTML=NavShell.LOGO_DEFECTO">`;
    return LOGO_DEFECTO;
  }

  /**
   * onclick de un ítem: string con {k} y {origen}, o función (k, item, origen) → string.
   * Sin onItem, el anfitrión delega por [data-k]. `origen` (US-615) dice desde qué superficie se tocó:
   * fijado | grupo | flyout | bottom | hoja.
   */
  function handler(on, k, obj, origen) {
    if (typeof on === 'function') { const r = on(k, obj, origen); return r ? ` onclick="${esc(r)}"` : ''; }
    if (typeof on === 'string' && on) return ` onclick="${esc(on.split('{k}').join(k).split('{origen}').join(origen || 'grupo'))}"`;
    return '';
  }

  function badgeHtml(badge) {
    if (badge === true) return '<span class="nvs-badge nvs-dot" aria-hidden="true"></span>';
    if (badge === null || badge === undefined || badge === false || badge === 0 || badge === '') return '';
    return `<span class="nvs-badge" aria-hidden="true">${esc(badge)}</span>`;
  }
  function badgeTexto(badge) {
    if (badge === true) return ' (novedades)';
    if (typeof badge === 'number' && badge > 0) return ` (${badge} ${badge === 1 ? 'pendiente' : 'pendientes'})`;
    if (typeof badge === 'string' && badge) return ` (${badge})`;
    return '';
  }

  /** Grupos filtrados por regla(item, grupo) === true; los grupos sin ítems desaparecen. No muta la entrada. */
  function visibles(grupos, regla) {
    const lista = Array.isArray(grupos) ? grupos : [];
    if (typeof regla !== 'function') return lista.map((g) => ({ ...g, items: [...(g.items || [])] }));
    const out = [];
    for (const g of lista) {
      const items = (g.items || []).filter((it) => { try { return regla(it, g) === true; } catch (_) { return false; } });
      if (items.length) out.push({ ...g, items });
    }
    return out;
  }

  /** Ítems fijados en el orden pedido, sin repetidos ni claves que no existan en los grupos. */
  function conFijados(grupos, fijados) {
    const mapa = new Map();
    for (const g of grupos || []) for (const it of g.items || []) if (!mapa.has(it.k)) mapa.set(it.k, { ...it, grupo: g.k });
    const vistos = new Set(), out = [];
    for (const k of fijados || []) { if (mapa.has(k) && !vistos.has(k)) { vistos.add(k); out.push(mapa.get(k)); } }
    return out;
  }

  /**
   * Fábrica del botón de un ítem, compartida por la barra (render) y la hoja móvil (hoja).
   * `estado` lleva el contador de aria-current de esa barra: cada superficie empieza con el suyo.
   */
  function fabricaItem(m, modo, activo, col, fijSet, tituloFij, estado) {
    let currentPuesto = false;
    const marca = { get puesto() { return currentPuesto; }, set puesto(v) { currentPuesto = v; } };
    if (estado) estado.marca = marca;

    // opts: {fijado} la copia de «Mi trabajo», {bottom} la barra inferior (sin estrella y sin regla de duplicado)
    const item = (it, extra, opts) => {
      const o = opts || {};
      const k = clave(it.k);
      const t = esc(it.t || it.k);
      const fijado = fijSet.has(String(it.k));
      // La copia del grupo de un módulo fijado no se pinta activa: manda la de «Mi trabajo»
      const duplicado = fijado && !o.fijado && !o.bottom;
      const esActivo = !!activo && String(it.k) === activo && !duplicado;
      const cur = esActivo && !currentPuesto ? ' aria-current="page"' : '';
      if (cur) currentPuesto = true;
      const lock = it.candado ? ' nvs-locked' : '';
      // US-610: el candado explica en el aria-label y en el title de qué plan se trata (candadoTexto lo pone el anfitrión)
      const avisoLock = it.candado ? (it.candadoTexto || 'No incluido en tu plan') : '';
      // badgeAria (US-620) permite decir «, 1 vencido» donde el badge visual es sólo un punto
      const aria = t + (it.badgeAria ? ', ' + esc(it.badgeAria) : badgeTexto(it.badge)) + (avisoLock ? ' (' + esc(avisoLock) + ')' : '');
      const title = col ? ` title="${aria}"` : (avisoLock ? ` title="${esc(avisoLock)}"` : '');
      const origen = o.origen || (o.fijado ? 'fijado' : o.bottom ? 'bottom' : col ? 'flyout' : 'grupo');
      const btn = `<button type="button" class="nvs-item${extra ? ' ' + extra : ''}${esActivo ? ' active' : ''}${lock}"${cur} data-k="${k}"${o.fijado ? ' data-fijado="1"' : ''}${it.candado ? ' data-candado="1"' : ''} data-origen="${origen}" aria-label="${aria}"${title}${handler(m.onItem, k, it, origen)}>${icono(it.ic, modo)}<span class="nvs-tx">${t}</span>${it.candado ? `<span class="nvs-lock" aria-hidden="true">${CANDADO}</span>` : ''}${badgeHtml(it.badge)}</button>`;
      if (!m.onFijar || o.bottom) return btn;
      const etiq = `${fijado ? 'Quitar' : 'Fijar'} ${t} ${fijado ? 'de' : 'en'} ${tituloFij}`;
      const estrella = `<button type="button" class="nvs-fijar" data-fijar="${k}" aria-pressed="${fijado ? 'true' : 'false'}" aria-label="${etiq}" title="${etiq}"${handler(m.onFijar, k, it)}>${fijado ? ESTRELLA_ON : ESTRELLA_OFF}</button>`;
      return `<div class="nvs-fila">${btn}${estrella}</div>`;
    };
    return item;
  }

  function render(modelo) {
    const m = modelo || {};
    const modo = m.modo === 'cliente' ? 'cliente' : 'constructora';
    const pre = CLAVE_OK.test(String(m.prefijo || '')) ? m.prefijo : 'nvs';
    const grupos = Array.isArray(m.grupos) ? m.grupos : [];
    const activo = m.activo == null ? '' : String(m.activo);
    const col = !!m.colapsado;
    const fijSet = new Set((Array.isArray(m.fijados) ? m.fijados : []).map((k) => String(k)));
    const tituloFij = esc(m.fijadosTitulo || 'Mi trabajo');
    let item = fabricaItem(m, modo, activo, col, fijSet, tituloFij);

    // Marca
    const marca = m.marca || {};
    const marcaHtml = `<div class="nvs-marca"><span class="nvs-logo">${logoHtml(marca.logo)}</span><span class="nvs-marca-tx"><span class="nvs-marca-nombre">${esc(marca.nombre || 'Control de Obra')}</span>${marca.sub ? `<span class="nvs-marca-sub">${esc(marca.sub)}</span>` : ''}</span></div>`;

    // Contexto (obra activa)
    let ctxHtml = '';
    if (m.contexto && typeof m.contexto === 'object') {
      const c = m.contexto;
      const av = Number.isFinite(Number(c.avance)) ? Math.max(0, Math.min(100, Math.round(Number(c.avance)))) : null;
      const sem = ['ok', 'warn', 'danger'].includes(c.semaforo) ? c.semaforo : '';
      const cuerpo = c.titulo
        ? `<span class="nvs-ctx-titulo">${esc(c.titulo)}</span>${av !== null || sem ? `<span class="nvs-ctx-estado">${sem ? `<span class="nvs-sem nvs-sem-${sem}" role="img" aria-label="${esc(c.semaforoTexto || SEMAFORO_TXT[sem])}"></span>` : ''}${av !== null ? `<span class="nvs-ctx-avance">${av} %</span>` : ''}</span>` : ''}${c.sub ? `<span class="nvs-ctx-sub">${esc(c.sub)}</span>` : ''}${av !== null ? `<span class="nvs-ctx-bar" aria-hidden="true"><span style="width:${av}%"></span></span>` : ''}`
        : `<span class="nvs-ctx-sub">${esc(c.vacio || 'Sin obra activa')}</span>`;
      const accion = c.onAccion ? `<button type="button" class="nvs-ctx-accion" data-accion="ctx-accion" onclick="${esc(c.onAccion)}">${esc(c.accion || 'Cambiar')}</button>` : '';
      // Colapsada la tarjeta se reduce al semáforo: el title dice de qué obra se trata
      const tCol = col ? ` title="${esc(c.tituloCorto ? (c.etiqueta || 'Obra activa') + ': ' + c.tituloCorto : (c.titulo || c.vacio || 'Sin obra activa'))}"` : '';
      const main = c.titulo && c.onClick
        ? `<button type="button" class="nvs-ctx-btn" data-accion="ctx" onclick="${esc(c.onClick)}" aria-label="${esc(c.ariaLabel || ('Abrir ' + c.titulo))}"${tCol}>${cuerpo}</button>`
        : `<div class="nvs-ctx-btn"${tCol}>${cuerpo}</div>`;
      ctxHtml = `<div class="nvs-ctx"><div class="nvs-ctx-cab"><span class="nvs-eyebrow">${esc(c.etiqueta || 'Obra activa')}</span>${accion}</div>${main}</div>`;
    }

    // Fijados («Mi trabajo»)
    const fij = conFijados(grupos, m.fijados);
    let fijHtml = '';
    if (fij.length) {
      const titulo = esc(m.fijadosTitulo || 'Mi trabajo');
      const editar = m.onEditarFijados ? `<button type="button" class="nvs-editar" data-accion="editar-fijados" onclick="${esc(m.onEditarFijados)}" aria-label="Editar ${titulo}" title="Editar ${titulo}"><i class="ri-pencil-line" aria-hidden="true"></i></button>` : '';
      fijHtml = `<div class="nvs-fijados" role="group" aria-label="${titulo}"><div class="nvs-cab"><span class="nvs-eyebrow">${titulo}</span>${editar}</div>${fij.map((it) => item(it, 'nvs-fijado', { fijado: true })).join('')}</div>`;
    }

    // Grupos
    const gruposHtml = grupos.map((g) => {
      const items = g.items || [];
      if (!items.length) return '';
      const gk = clave(g.k || items[0].k);
      const suelto = g.suelto === true || (items.length === 1 && !g.t);
      if (suelto) return item(items[0], 'nvs-suelto');
      if (g.plano === true) return `<div class="nvs-grupo nvs-plano${g.separador ? ' nvs-sep' : ''}" data-grupo="${gk}" role="group" aria-label="${esc(g.t || gk)}">${items.map((it) => item(it, '')).join('')}</div>`;
      const primarios = items.filter((it) => !it.secundario), secundarios = items.filter((it) => it.secundario);
      const activoEnSec = secundarios.some((it) => String(it.k) === activo);
      const abierto = g.abierto !== false;
      const lockGrupo = g.candado === true || (items.length > 0 && items.every((it) => it.candado));
      const id = `${pre}-g-${gk}`;
      const onG = g.onGrupo || m.onGrupo;
      const onGrupo = onG ? handler(onG, gk, g) : ` onclick="NavShell.alternarGrupo(this)"`;
      const cab = `<button type="button" class="nvs-grupo-h" aria-expanded="${abierto ? 'true' : 'false'}" aria-controls="${id}"${col ? ` title="${esc(g.t || gk)}"` : ''}${onGrupo}>${icono(g.ic, modo)}<span class="nvs-tx">${esc(g.t || gk)}</span>${lockGrupo ? `<span class="nvs-lock" aria-hidden="true">${CANDADO}</span>` : ''}<span class="nvs-grupo-punto" aria-hidden="true"></span>${CHEVRON}</button>`;
      const mas = secundarios.length
        ? `<button type="button" class="nvs-mas" data-mas="${gk}" aria-expanded="${activoEnSec ? 'true' : 'false'}" aria-controls="${id}-sec" onclick="NavShell.alternarMas(this)"><span class="nvs-tx">${esc(g.masTexto || 'Más')}</span>${CHEVRON}</button><div class="nvs-sec" id="${id}-sec"${activoEnSec ? '' : ' hidden'}>${secundarios.map((it) => item(it, 'nvs-secundario')).join('')}</div>`
        : '';
      const tieneActivo = items.some((it) => String(it.k) === activo);
      // Colapsado: los ítems viven en un flyout (.nvs-fly) que el CSS muestra al pasar el cursor o enfocar; no lleva hidden.
      const cont = `<div class="nvs-grupo-items${col ? ' nvs-fly' : ''}" id="${id}"${!abierto && !col ? ' hidden' : ''}>${primarios.map((it) => item(it, '')).join('')}${mas}</div>`;
      return `<section class="nvs-grupo${g.separador ? ' nvs-sep' : ''}${tieneActivo ? ' nvs-grupo-activo' : ''}${lockGrupo ? ' nvs-grupo-locked' : ''}" data-grupo="${gk}">${cab}${cont}</section>`;
    }).join('');

    // Pie
    const acciones = Array.isArray(m.acciones) ? m.acciones : [];
    const pieHtml = acciones.length
      ? `<div class="nvs-pie">${acciones.map((a) => {
        const k = clave(a.k || 'accion');
        const t = esc(a.t || a.k);
        // `campo: true` la pinta como un campo de búsqueda falso (US-615); sigue siendo un botón
        return `<button type="button" class="nvs-accion${a.campo ? ' nvs-campo' : ''}${a.tono ? ' nvs-' + clave(a.tono) : ''}" data-accion="${k}" aria-label="${t}${a.atajo ? ' (' + esc(a.atajo) + ')' : ''}"${col ? ` title="${t}"` : ''}${a.onClick ? ` onclick="${esc(a.onClick)}"` : ''}>${icono(a.ic, modo)}<span class="nvs-tx">${t}</span>${a.atajo ? `<kbd class="nvs-kbd" aria-hidden="true">${esc(a.atajo)}</kbd>` : ''}</button>`;
      }).join('')}</div>`
      : '';

    const aside = `<div class="nvs nvs-${modo}${col ? ' nvs-col' : ''}" data-modo="${modo}">${marcaHtml}${ctxHtml}${fijHtml}<div class="nvs-grupos">${gruposHtml}</div>${pieHtml}</div>`;

    // Barra inferior (móvil): fábrica nueva para que tenga su propio aria-current
    item = fabricaItem(m, modo, activo, false, fijSet, tituloFij);
    const todos = new Map();
    for (const g of grupos) for (const it of g.items || []) if (!todos.has(it.k)) todos.set(it.k, it);
    const inf = m.inferior && typeof m.inferior === 'object' ? m.inferior : {};
    let claves = Array.isArray(inf.items) ? inf.items : (fij.length ? fij.map((it) => it.k) : [...todos.keys()]);
    const maxItems = inf.plus || inf.mas ? 4 : 5;
    claves = [...new Set(claves)].filter((k) => todos.has(k)).slice(0, maxItems);
    const bItems = claves.map((k) => item(todos.get(k), 'nvs-bottom-item', { bottom: true }));
    const plus = inf.plus ? `<button type="button" class="nvs-bottom-plus" data-accion="plus" aria-label="${esc(inf.plus.t || 'Captura rápida')}" aria-haspopup="dialog"${inf.plus.onClick ? ` onclick="${esc(inf.plus.onClick)}"` : ''}><span><i class="ri-add-line" aria-hidden="true"></i></span></button>` : '';
    const mas = inf.mas ? `<button type="button" class="nvs-item nvs-bottom-item nvs-bottom-mas" data-accion="mas" aria-label="${esc(inf.mas.t || 'Más módulos')}" aria-haspopup="dialog"${inf.mas.onClick ? ` onclick="${esc(inf.mas.onClick)}"` : ''}>${icono(inf.mas.ic || (modo === 'cliente' ? 'mas' : 'ri-menu-2-line'), modo)}<span class="nvs-tx">${esc(inf.mas.t || 'Más')}</span></button>` : '';
    const bottom = `<div class="nvs-bottom nvs-${modo}" data-modo="${modo}">${plus ? bItems.slice(0, 2).join('') + plus + bItems.slice(2).join('') : bItems.join('')}${mas}</div>`;

    return { aside, bottom };
  }

  /**
   * Hoja de módulos para el móvil (US-613): «Mi trabajo» y los grupos en rejilla de 3 columnas.
   * Devuelve el HTML completo (fondo + hoja); el anfitrión lo monta, lo abre y atrapa el foco.
   * Los ítems son los mismos botones que la barra, sin estrella (la hoja no fija) y sin flyout.
   */
  function hoja(modelo) {
    const m = modelo || {};
    const modo = m.modo === 'cliente' ? 'cliente' : 'constructora';
    const grupos = Array.isArray(m.grupos) ? m.grupos : [];
    const activo = m.activo == null ? '' : String(m.activo);
    const fijSet = new Set((Array.isArray(m.fijados) ? m.fijados : []).map((k) => String(k)));
    const tituloFij = esc(m.fijadosTitulo || 'Mi trabajo');
    const sinEstrella = Object.assign({}, m, { onFijar: null });
    const item = fabricaItem(sinEstrella, modo, activo, false, fijSet, tituloFij);
    const titulo = esc(m.hojaTitulo || 'Módulos');
    const rejilla = (items, opts) => `<div class="nvs-sheet-grid">${items.map((it) => item(it, opts && opts.fijado ? 'nvs-fijado' : '', Object.assign({ origen: 'hoja' }, opts))).join('')}</div>`;

    const fij = conFijados(grupos, m.fijados);
    // La copia de «Mi trabajo» manda igual que en la barra: lleva aria-current y la del grupo queda limpia
    let cuerpo = fij.length ? `<section class="nvs-sheet-grupo"><span class="nvs-eyebrow">${tituloFij}</span>${rejilla(fij, { fijado: true })}</section>` : '';
    cuerpo += grupos.map((g) => {
      const items = g.items || [];
      if (!items.length) return '';
      const gk = clave(g.k || items[0].k);
      const primarios = items.filter((it) => !it.secundario), secundarios = items.filter((it) => it.secundario);
      const id = `nvs-sheet-${gk}`;
      const activoEnSec = secundarios.some((it) => String(it.k) === activo);
      const mas = secundarios.length
        ? `<button type="button" class="nvs-mas" data-mas="${gk}" aria-expanded="${activoEnSec ? 'true' : 'false'}" aria-controls="${id}-sec" onclick="NavShell.alternarMas(this)"><span class="nvs-tx">${esc(g.masTexto || 'Más')}</span>${CHEVRON}</button><div class="nvs-sec" id="${id}-sec"${activoEnSec ? '' : ' hidden'}>${rejilla(secundarios)}</div>`
        : '';
      return `<section class="nvs-sheet-grupo" data-grupo="${gk}"><span class="nvs-eyebrow">${esc(g.t || gk)}</span>${primarios.length ? rejilla(primarios) : ''}${mas}</section>`;
    }).join('');

    const cerrar = esc(m.hojaCerrar || 'Cerrar');
    return `<div class="nvs-sheet-backdrop" data-accion="sheet-fondo"></div>`
      + `<div class="nvs-sheet nvs-${modo}" role="dialog" aria-modal="true" aria-label="${titulo}">`
      + `<span class="nvs-sheet-handle" aria-hidden="true"></span>`
      + `<div class="nvs-sheet-cab"><h2 class="nvs-sheet-titulo">${titulo}</h2><button type="button" class="nvs-sheet-cerrar" data-accion="sheet-cerrar" aria-label="${cerrar}">&times;</button></div>`
      + `<div class="nvs-sheet-cuerpo">${cuerpo}</div></div>`;
  }

  // ---- Operaciones sobre lo ya pintado (sin repintar) ----

  /**
   * Sobre un Element: marca .active y un solo aria-current="page" en los [data-k]; sobre un string devuelve el HTML nuevo.
   * Si el módulo está fijado (existe una copia con data-fijado), la copia del grupo no se marca (US-608).
   */
  function marcarActivo(root, k) {
    const key = k == null ? '' : String(k);
    if (typeof root === 'string') return marcarActivoHtml(root, key);
    if (!root || typeof root.querySelectorAll !== 'function') return root;
    let puesto = false;
    const nodos = Array.prototype.slice.call(root.querySelectorAll('[data-k]'));
    // Si el módulo está fijado, sólo la copia de «Mi trabajo» (data-fijado) se pinta activa
    const hayFijado = !!key && nodos.some((el) => el.getAttribute('data-k') === key && el.getAttribute('data-fijado') != null);
    for (const el of nodos) {
      const coincide = el.getAttribute('data-k') === key;
      const dup = coincide && hayFijado && el.getAttribute('data-fijado') == null && !(el.classList && el.classList.contains('nvs-bottom-item'));
      const es = coincide && !dup;
      if (es) el.classList.add('active'); else el.classList.remove('active');
      if (es && !puesto) { el.setAttribute('aria-current', 'page'); puesto = true; } else el.removeAttribute('aria-current');
    }
    for (const g of root.querySelectorAll('.nvs-grupo')) {
      const tiene = !!g.querySelector(`[data-k="${key.replace(/["\\]/g, '')}"]`);
      if (tiene) g.classList.add('nvs-grupo-activo'); else g.classList.remove('nvs-grupo-activo');
    }
    return root;
  }

  function marcarActivoHtml(html, key) {
    let puesto = false;
    const re = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hayFijado = !!key && new RegExp(`<button\\b[^>]*\\bdata-k="${re}"[^>]*\\bdata-fijado=`).test(html);
    let out = html.replace(/<button\b[^>]*\bdata-k="([^"]*)"[^>]*>/g, (tag, k) => {
      let t = tag.replace(/\s+aria-current="[^"]*"/g, '');
      const dup = k === key && hayFijado && !/\bdata-fijado=/.test(tag) && !/\bnvs-bottom-item\b/.test(tag);
      const es = k === key && !dup;
      t = t.replace(/\bclass="([^"]*)"/, (m, cls) => {
        const set = cls.split(/\s+/).filter((c) => c && c !== 'active');
        if (es) set.push('active');
        return `class="${set.join(' ')}"`;
      });
      if (es && !puesto) { t = t.replace(/\sdata-k=/, ' aria-current="page" data-k='); puesto = true; }
      return t;
    });
    out = out.replace(/<section\b[^>]*\bclass="nvs-grupo[^"]*"[^>]*>[\s\S]*?<\/section>/g, (sec) => {
      const tiene = new RegExp(`\\bdata-k="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(sec);
      return sec.replace(/^<section\b[^>]*\bclass="([^"]*)"/, (m, cls) => {
        const set = cls.split(/\s+/).filter((c) => c && c !== 'nvs-grupo-activo');
        if (tiene) set.push('nvs-grupo-activo');
        return m.replace(cls, set.join(' '));
      });
    });
    return out;
  }

  /**
   * Abre o cierra un grupo (recibe la cabecera o la sección). Emite 'nvs:grupo' {k, abierto} en el .nvs para que el
   * anfitrión guarde la preferencia. Con la barra colapsada sólo fija o suelta el flyout (.nvs-abierto) y no emite nada:
   * ahí «abierto» no es una preferencia del usuario, es un menú momentáneo.
   */
  function alternarGrupo(el, abierto) {
    if (!el || typeof el.closest !== 'function') return null;
    const sec = el.classList && el.classList.contains('nvs-grupo') ? el : el.closest('.nvs-grupo');
    if (!sec) return null;
    const cab = sec.querySelector('.nvs-grupo-h'), cont = sec.querySelector('.nvs-grupo-items');
    if (!cab || !cont) return null;
    const nuevo = typeof abierto === 'boolean' ? abierto : cab.getAttribute('aria-expanded') !== 'true';
    cab.setAttribute('aria-expanded', nuevo ? 'true' : 'false');
    const col = !!sec.closest('.nvs-col');
    if (nuevo || col) cont.removeAttribute('hidden'); else cont.setAttribute('hidden', '');
    // Colapsada, la cabecera fija o suelta el flyout (US-611) y no toca la preferencia de grupos abiertos
    if (col) {
      if (cont.classList) cont.classList.toggle('nvs-abierto', nuevo);
      if (sec.classList) sec.classList.remove('nvs-fly-cerrado');
      return nuevo;
    }
    const root = sec.closest('.nvs') || sec;
    if (typeof CustomEvent === 'function' && typeof root.dispatchEvent === 'function') root.dispatchEvent(new CustomEvent('nvs:grupo', { bubbles: true, detail: { k: sec.getAttribute('data-grupo'), abierto: nuevo } }));
    return nuevo;
  }

  /** Muestra u oculta los ítems secundarios («Más») de un grupo. */
  function alternarMas(btn) {
    if (!btn || typeof btn.getAttribute !== 'function') return null;
    const id = btn.getAttribute('aria-controls');
    const cont = (btn.parentNode && typeof btn.parentNode.querySelector === 'function' && btn.parentNode.querySelector('.nvs-sec')) || (id && typeof document !== 'undefined' ? document.getElementById(id) : null);
    if (!cont) return null;
    const nuevo = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', nuevo ? 'true' : 'false');
    if (nuevo) cont.removeAttribute('hidden'); else cont.setAttribute('hidden', '');
    return nuevo;
  }

  return { render, hoja, visibles, conFijados, marcarActivo, alternarGrupo, alternarMas, esc, ICONOS_CLIENTE, LOGO_DEFECTO };
})();
if (typeof module !== 'undefined') module.exports = NavShell;
