/**
 * PortalUI (US-701A): utilidades de pintado y piezas que comparten varias vistas (chips, miniaturas, filas de
 * documento, bloques de entrega, menús de la cabecera móvil). Todo dato que entra a innerHTML pasa por esc().
 */
(function () {
  'use strict';
  const E = window.PortalEstado;

  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
  const fecha = (d) => d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  async function copiar(t, btn) { try { await navigator.clipboard.writeText(t); btn.textContent = 'Copiado'; setTimeout(() => btn.textContent = 'Copiar', 1500); } catch (e) { } }
  function estadoChip(e) { e = String(e || ''); if (/cobrad|pagad|aprobad|completad|termin/i.test(e)) return `<span class="chip c-ok">${esc(e)}</span>`; if (/parcial|proceso|pendiente/i.test(e)) return `<span class="chip c-warn">${esc(e)}</span>`; if (/vencid|cancel|rechaz/i.test(e)) return `<span class="chip c-bad">${esc(e)}</span>`; return `<span class="chip c-info">${esc(e || '-')}</span>`; }

  function pantallaError(titulo, texto) { $('#app').innerHTML = `<div class="card" style="margin-top:6vh"><h2>${esc(titulo)}</h2><p class="vacio">${esc(texto)}</p></div>`; }
  // Aviso en línea dentro de la sección (sustituye los alert() del portal)
  function aviso(msg) {
    const el = $('#vistaAviso');
    if (!el) return;
    el.innerHTML = msg ? `<div class="err">${esc(msg)}</div>` : '';
    if (msg) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------- Entregables agrupados por hito ---------- */
  // El hito se marca con una etiqueta de texto: el emoji de bandera no está en todas las fuentes y sale como recuadro.
  // Los nombres del programa vienen con prefijos («HITO · …», «OPCIONAL · …», «ENTREGA · …»); se sacan del texto
  // y se pintan como etiqueta para que el renglón se lea como una frase.
  const PREFIJO_ACT = /^(HITO|ENTREGA|OPCIONAL)\s*[·:–—-]\s*/i;
  const ETIQUETA_ACT = { HITO: 'Hito', ENTREGA: 'Entrega', OPCIONAL: 'Opcional' };
  function partesAct(a) {
    const nombre = String((a && a.nombre) || '');
    const m = nombre.match(PREFIJO_ACT);
    const et = m ? m[1].toUpperCase() : ((a && a.hito) ? 'HITO' : '');
    return { et, nombre: m ? nombre.slice(m[0].length) : nombre };
  }
  function chipHito(a) {
    const et = partesAct(a).et;
    if (!et) return '';
    return `<span class="chip ${et === 'OPCIONAL' ? 'opc' : 'hito'}">${ETIQUETA_ACT[et]}</span>`;
  }
  function nombreAct(a) { return esc(partesAct(a).nombre); }
  function etiquetaVer(g) {
    const d = g.docs.length, f = g.fotos.length;
    if (d && f) return 'Ver la entrega';
    if (d) return d === 1 ? 'Ver el entregable' : 'Ver los entregables';
    return f === 1 ? 'Ver la foto' : 'Ver las fotos';
  }
  function etiquetaNuevo(x) { return E.esNuevo(x) ? '<span class="chip c-ok nuevo">Nuevo</span>' : ''; }
  function miniatura(f) {
    return `<a class="mini${E.esNuevo(f) ? ' es-nueva' : ''}" href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(f.titulo || f.descripcion || '')} ${fecha(f.fecha)}"><img src="${esc(f.thumb || f.url)}" alt="${esc(f.titulo || 'Foto de obra')}" loading="lazy">${E.esNuevo(f) ? '<span class="chip c-ok nuevo">Nuevo</span>' : ''}</a>`;
  }
  function filaDoc(x) {
    return `<div class="doc"><div class="doc-nombre">${esc(x.nombre)} ${etiquetaNuevo(x)}</div><div class="doc-accion">${(x.tiene_archivo || x.url) ? `<button class="btn s xs" onclick="verDocumento(${x.id},this)">Abrir</button>` : '<span class="vacio">Sin archivo</span>'}</div><div class="doc-meta"><div class="meta">${esc(x.categoria || '')}${x.fecha ? ' · ' + fecha(x.fecha) : ''}${(x.version && Number(x.version) > 1) ? ' · versión ' + esc(x.version) : ''}${x.descripcion ? ' · ' + esc(x.descripcion) : ''}</div></div></div>`;
  }
  function bloqueEntrega(id, titulo, fch, g, a) {
    const hoy = new Date().toISOString().slice(0, 10);
    const nd = g.docs.length, nf = g.fotos.length;
    const cuenta = [nd ? nd + (nd === 1 ? ' documento' : ' documentos') : '', nf ? nf + (nf === 1 ? ' foto' : ' fotos') : ''].filter(Boolean).join(' · ');
    const estado = a ? (Number(a.avance || 0) >= 100 ? '<span class="chip c-ok">Entregado</span>'
      : (a.fin && String(a.fin) < hoy ? '<span class="chip c-warn">En proceso</span>' : '<span class="chip c-info">Programado</span>')) : '';
    return `<section class="grupo" id="${id}">
    <div class="grupo-cab"><div><strong>${titulo}</strong>${(fch || cuenta) ? `<div class="meta">${[fch, cuenta].filter(Boolean).join(' · ')}</div>` : ''}</div>${estado}</div>
    ${g.docs.map(filaDoc).join('')}
    ${nf ? `<div class="fotos">${g.fotos.map(miniatura).join('')}</div>` : ''}
  </section>`;
  }

  /* ---------- Avance real contra programado (PRD portal v2, D4) ---------- */
  // Dos barras: «Real» (lo hecho, ponderado por costo) y «Programado a hoy» (lo que el programa decía que debía estar).
  function barrasAvance(c) {
    const real = Math.min(100, Math.max(0, Math.round(Number(c.real || 0) * 10) / 10));
    const plan = Math.min(100, Math.max(0, Math.round(Number(c.planeado || 0) * 10) / 10));
    const fila = (et, v, cls) => `<div class="avance-cab"><span>${et}</span><b>${Math.round(v)}%</b></div><div class="bar${cls}" aria-hidden="true"><i style="width:${v}%"></i></div>`;
    return `<div class="barras">${fila('Avance real', real, '')}${c.hayPrograma ? fila('Programado a hoy', plan, ' plan') : ''}</div>`;
  }
  const CHIP_ESTADO = { terminada: 'c-ok', atrasada: 'c-bad', en_curso: 'c-warn', proxima: 'c-info', cumplido: 'c-ok', pendiente: 'c-info' };
  function chipEstado(est) {
    const C = window.PortalCalc;
    if (!est || !C || !C.ESTADOS[est]) return '';
    return `<span class="chip ${CHIP_ESTADO[est] || 'c-info'} est">${C.ESTADOS[est]}</span>`;
  }

  /* ---------- Menús de la cabecera móvil (US-619) ---------- */
  function cerrarMenuPortal() {
    const m = $('#menuPortal');
    if (m) { m.hidden = true; m.innerHTML = ''; }
    ['btnCuenta', 'chipObra'].forEach(id => { const b = document.getElementById(id); if (b) b.setAttribute('aria-expanded', 'false'); });
  }
  function abrirMenuPortal(html, disparador, rol) {
    const m = $('#menuPortal');
    if (!m) return;
    const abierto = !m.hidden && m.dataset.de === disparador;
    cerrarMenuPortal();
    if (abierto) return;                       // segundo toque: cerrar
    m.dataset.de = disparador;
    m.setAttribute('role', rol || 'menu');
    m.innerHTML = html;
    m.hidden = false;
    const b = document.getElementById(disparador);
    if (b) b.setAttribute('aria-expanded', 'true');
    const primero = m.querySelector('button,select,a');
    if (primero) primero.focus();
  }
  function menuCuenta() {
    const items = [];
    if (E.ctx.wa) items.push(`<a class="menu-item" href="${E.ctx.wa}" target="_blank" rel="noopener" onclick="cerrarMenuPortal()">Escribir por WhatsApp</a>`);
    items.push(`<button type="button" class="menu-item" onclick="cerrarMenuPortal();irASeccion('contacto')">Contacto</button>`);
    if (E.sesion) {
      items.push(`<button type="button" class="menu-item" onclick="cerrarMenuPortal();pantallaPassword(false)">Cambiar contraseña</button>`);
      items.push(`<button type="button" class="menu-item peligro" onclick="cerrarMenuPortal();salir()">Salir</button>`);
    }
    abrirMenuPortal(items.join(''), 'btnCuenta', 'menu');
  }
  function menuObras() {
    const items = E.obras.map(x => `<button type="button" class="menu-item${x.id === E.obraActual ? ' activo' : ''}" ${x.id === E.obraActual ? 'aria-current="true"' : ''} onclick="cerrarMenuPortal();abrirObra(${x.id})">${esc(x.nombre)}</button>`).join('');
    abrirMenuPortal(items, 'chipObra', 'listbox');
  }
  document.addEventListener('click', (ev) => {
    const m = $('#menuPortal');
    if (!m || m.hidden) return;
    if (m.contains(ev.target)) return;
    if (ev.target.closest && ev.target.closest('#btnCuenta,#chipObra')) return;
    cerrarMenuPortal();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cerrarMenuPortal(); });

  window.PortalUI = { $, esc, fmt, fecha, estadoChip, pantallaError, aviso, chipHito, nombreAct, etiquetaVer, etiquetaNuevo, miniatura, filaDoc, bloqueEntrega, cerrarMenuPortal, barrasAvance, chipEstado };
  // Los onclick del HTML pintado llaman a estas funciones por nombre
  Object.assign(window, { copiar, cerrarMenuPortal, menuCuenta, menuObras });
})();
