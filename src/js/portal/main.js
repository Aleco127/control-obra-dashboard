/**
 * Arranque y marco del portal (US-701A): decide la entrada (enlace privado o sesión de cuenta), abre la obra,
 * pinta el marco con NavShell y despacha las seis secciones por hash. Se carga al final: usa PortalAPI,
 * PortalEstado, PortalUI y PortalVistas.
 */
(function () {
  'use strict';
  const E = window.PortalEstado, API = window.PortalAPI, V = window.PortalVistas;
  const { $, esc, fecha, pantallaError, aviso, cerrarMenuPortal } = window.PortalUI;
  const { SECCIONES, SEC_TITULO } = E;

  /* ---------- Entrada: enlace privado o sesión con contraseña ---------- */
  async function arranca() {
    if (E.token) {
      if (!/^[a-f0-9]{48}$/.test(E.token)) return pantallaError('Enlace no válido', 'Pide a tu constructor un enlace nuevo.');
      const d = await API.rpc('portal_obra', { p_token: E.token });
      if (!d || d.error) return pantallaError('Este enlace ya no está activo', 'Pide a tu constructor un enlace nuevo.');
      return pintarObra(d);
    }
    if (E.sesion) {
      const s = await API.rpc('portal_sesion', { p_token: E.sesion });
      if (s && s.ok) {
        E.usuario = s.usuario; E.obras = s.obras || [];
        if (E.usuario.debe_cambiar) return V.pantallaPassword(true);
        return abrirObra(E.obras.length ? E.obras[0].id : null);
      }
      localStorage.removeItem('portal_sesion'); E.sesion = '';
    }
    V.pantallaLogin();
  }
  function volver() { abrirObra(E.obraActual || (E.obras.length ? E.obras[0].id : null)); }
  async function salir() { await API.rpc('portal_logout', { p_token: E.sesion }); localStorage.removeItem('portal_sesion'); E.sesion = ''; location.href = location.pathname; }

  async function abrirObra(id) {
    if (!id) return pantallaError('Todavía no tienes una obra asignada', 'Escríbele a tu constructor para que te dé acceso.');
    E.novedadesVistas.clear(); // cada carga trae novedades nuevas y mueve la marca: el aviso se vuelve a mostrar
    E.obraActual = Number(id);
    $('#app').innerHTML = '<p class="sub">Cargando…</p>';
    const d = await API.rpc('portal_datos', { p_token: E.sesion, p_obra_id: E.obraActual });
    if (!d || d.error) {
      if (d && d.error === 'sesion_invalida') { localStorage.removeItem('portal_sesion'); E.sesion = ''; return V.pantallaLogin('Tu sesión expiró. Entra otra vez.'); }
      return pantallaError('No pudimos abrir la obra', 'Inténtalo de nuevo en un momento.');
    }
    pintarObra(d);
  }
  function cambiarObra(sel) { abrirObra(Number(sel.value)); }

  // Telemetría del portal (portal_evento, migración 057): nunca debe romper la vista
  async function portalEvento(evento, meta) {
    try { await API.rpc('portal_evento', { p_token: E.sesion || E.token, p_evento: evento, p_meta: meta || {} }); } catch (e) { }
  }

  /* ---------- Rutas: 6 secciones por hash (US-617) ---------- */
  function irASeccion(s, empujar) {
    const nueva = SECCIONES.includes(s) ? s : 'inicio';
    if (empujar !== false && E.seccionDeHash() !== nueva) { location.hash = '#' + nueva; return; }  // el hashchange repinta
    E.seccion = nueva;
    pintarSeccion();
  }
  function irA(id, sec) {
    // US-617: los entregables (y las fotos por concepto) viven en su propia sección;
    // primero se cambia de vista y luego se hace scroll
    const dest = SECCIONES.includes(sec) ? sec : 'entregables';
    if (E.seccion !== dest) { E.seccion = dest; if (location.hash !== '#' + dest) history.replaceState(null, '', '#' + dest); pintarSeccion(); }
    setTimeout(() => {
      const el = document.getElementById(id); if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('destacado'); setTimeout(() => el.classList.remove('destacado'), 1800);
    }, 40);
  }
  window.addEventListener('hashchange', () => {
    if (!E.ctx) return;                  // todavía no hay obra abierta: lo resuelve abrirObra
    const s = E.seccionDeHash();
    if (s === E.seccion) return;
    E.seccion = s;
    pintarSeccion();
  });

  /* ---------- Marco y despacho ---------- */
  function pintarObra(d) {
    E.datos = d;
    E.ctx = E.prepararCtx(d);
    E.seccion = E.seccionDeHash();
    const e = E.ctx.e, o = E.ctx.o, sesion = E.sesion, usuario = E.usuario;
    $('#pie').innerHTML = (sesion ? 'Tu acceso es personal; no compartas tu contraseña.' : 'Este enlace es privado; compártelo sólo con quien deba ver el avance de la obra.') + '<br>Control de Obra' + (e.nombre ? ' · ' + esc(e.nombre) : '');
    $('#app').innerHTML = `
  <header class="solo-movil">
    ${(e.logo_iso_url || e.logo_url) ? `<img src="${esc(e.logo_iso_url || e.logo_url)}" alt="" onerror="this.remove()">` : ''}
    <div class="emp">${esc(e.nombre)}<small>${(sesion && usuario) ? esc(usuario.nombre) : 'Avance de tu obra'}</small></div>
    ${(sesion && E.obras.length > 1) ? `<button type="button" class="chip-obra" id="chipObra" aria-haspopup="listbox" aria-expanded="false" onclick="menuObras()">Obra <span aria-hidden="true">▾</span></button>` : ''}
    <button type="button" class="btn-cuenta" id="btnCuenta" aria-haspopup="menu" aria-expanded="false" aria-label="Tu cuenta" onclick="menuCuenta()">${esc(((sesion && usuario) ? usuario.nombre : 'Menú').split(' ')[0])} <span aria-hidden="true">▾</span></button>
  </header>
  <div id="menuPortal" class="menu-portal solo-movil" hidden></div>
  <h1>${esc(o.nombre)}</h1>
  <p class="sub">${esc(o.cliente || '')}${o.ubicacion ? ' · ' + esc(o.ubicacion) : ''}${o.fecha_inicio ? ' · inicio ' + fecha(o.fecha_inicio) : ''}${E.ctx.entrega.fecha ? (E.ctx.entrega.vencida ? ' · entrega por confirmar' : ' · entrega ' + fecha(E.ctx.entrega.fecha)) : ''}</p>
  <nav class="secciones" id="navSecciones" aria-label="Secciones"></nav>
  <div id="vistaAviso"></div>
  <div id="vista"></div>`;
    pintarSeccion();
  }
  function pintarSeccion() {
    const cont = $('#vista');
    if (!cont || !E.ctx) return;
    const seccion = E.seccion;
    if (seccion === 'fotos' || seccion === 'entregables' || seccion === 'diario') E.novedadesVistas.add(seccion);
    const fn = V[seccion] || V.inicio;
    cont.innerHTML = fn();
    aviso('');
    cerrarMenuPortal();
    document.title = `${SEC_TITULO[seccion]} · ${E.ctx.o.nombre}`;
    pintarNavSecciones();
    window.scrollTo({ top: 0, behavior: 'auto' });
    portalEvento('seccion', { seccion: seccion, obra_id: E.obraActual });
  }

  // Barra del cliente con NavShell (US-618 escritorio, US-619 móvil). El menú de píldoras queda como respaldo
  // si el componente no cargó (el portal no debe quedarse sin navegación por un archivo que falte).
  const SEC_ICONO = { inicio: 'inicio', avance: 'avance', diario: 'diario', pagos: 'pagos', entregables: 'entregables', fotos: 'fotos', contacto: 'contacto' };
  function avisoDeSeccion(s) {
    const n = E.novedades();
    if (E.novedadesVistas.has(s)) return {};
    if (s === 'pagos') {
      const v = E.pagosVencidos();
      if (v > 0) return { badge: true, badgeAria: v + (v === 1 ? ' pago vencido' : ' pagos vencidos') };
      return {};
    }
    if (s === 'entregables' && Number(n.documentos) > 0) { const d = Number(n.documentos); return { badge: d, badgeAria: d + (d === 1 ? ' documento nuevo' : ' documentos nuevos') }; }
    if (s === 'fotos' && Number(n.fotos) > 0) { const f = Number(n.fotos); return { badge: f, badgeAria: f + (f === 1 ? ' foto nueva' : ' fotos nuevas') }; }
    if (s === 'diario' && Number(n.diario) > 0) { const d = Number(n.diario); return { badge: d, badgeAria: d + (d === 1 ? ' día nuevo en el diario' : ' días nuevos en el diario') }; }
    return {};
  }
  function navModeloCliente() {
    const e = E.ctx.e;
    const grupos = [{ k: 'secciones', t: 'Tu obra', suelto: false, plano: true, items: SECCIONES.map(s => Object.assign({ k: s, t: SEC_TITULO[s], ic: SEC_ICONO[s] }, avisoDeSeccion(s))) }];
    const acciones = [];
    if (E.sesion) {
      acciones.push({ k: 'password', t: 'Cambiar contraseña', ic: 'cuenta', onClick: 'pantallaPassword(false)' });
      acciones.push({ k: 'salir', t: 'Salir', ic: 'mas', onClick: 'salir()', tono: 'danger' });
    }
    return {
      modo: 'cliente', prefijo: 'pc',
      marca: { nombre: e.nombre || 'Tu obra', sub: (E.sesion && E.usuario) ? E.usuario.nombre : 'Avance de tu obra', logo: e.logo_iso_url || e.logo_url || '' },
      grupos, activo: E.seccion, acciones,
      onItem: "irASeccion('{k}')",
      inferior: { items: ['inicio', 'avance', 'diario', 'pagos', 'fotos'] },
    };
  }
  function pintarNavSecciones() {
    const pill = $('#navSecciones');
    const aside = $('#navCliente'), bottom = $('#navClienteBottom');
    if (typeof NavShell === 'undefined' || !E.ctx) {
      if (pill) pill.innerHTML = SECCIONES.map(s => `<button type="button" class="sec-btn${s === E.seccion ? ' activa' : ''}"${s === E.seccion ? ' aria-current="page"' : ''} onclick="irASeccion('${s}')">${SEC_TITULO[s]}</button>`).join('');
      return;
    }
    const m = navModeloCliente();
    const r = NavShell.render(m);
    if (aside) aside.innerHTML = r.aside;
    if (bottom) bottom.innerHTML = r.bottom;
    // Con la barra pintada, las píldoras sobran (se quedan sólo si NavShell no cargó)
    if (pill) pill.innerHTML = '';
    // Selector de obra: sólo con sesión de cuenta y más de una obra
    if (aside && E.sesion && E.obras.length > 1) {
      const sel = `<div class="pc-obras"><label for="selObraNav">Obra</label><select id="selObraNav" onchange="cambiarObra(this)">${E.obras.map(x => `<option value="${x.id}" ${x.id === E.obraActual ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></div>`;
      const marca = aside.querySelector('.nvs-marca');
      if (marca) marca.insertAdjacentHTML('afterend', sel);
    }
  }

  /* ---------- Archivos con liga firmada ---------- */
  async function archivo(id, tipo) {
    const j = await API.pedirArchivo({ token: E.token, sesion: E.sesion, cfdi_id: id, tipo });
    if (!j || !j.url) { aviso((j && j.error) || 'No se pudo abrir el archivo. Inténtalo de nuevo o escríbele a tu constructor.'); return; }
    window.open(j.url, '_blank', 'noopener');
  }
  async function verDocumento(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Abriendo…'; }
    const j = await API.pedirArchivo({ token: E.token, sesion: E.sesion, documento_id: id });
    if (btn) { btn.disabled = false; btn.textContent = 'Abrir'; }
    if (!j || !j.url) { aviso((j && j.error) || 'No se pudo abrir el documento. Inténtalo de nuevo o escríbele a tu constructor.'); return; }
    window.open(j.url, '_blank', 'noopener');
  }

  // Los onclick del HTML pintado (y los de NavShell) llaman a estas funciones por nombre
  Object.assign(window, { abrirObra, cambiarObra, volver, salir, irASeccion, irA, archivo, verDocumento, portalEvento });
  arranca();
})();
