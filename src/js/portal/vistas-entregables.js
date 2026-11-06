/**
 * Entregables (US-701A, carpetas 6-nov-2026): documentos del cliente ordenados por carpeta. Cada documento lleva
 * la entrega del programa a la que pertenece como dato secundario. Si ningún documento tiene carpeta, se conserva
 * la agrupación por entrega del programa.
 */
(function () {
  'use strict';
  const E = window.PortalEstado, V = (window.PortalVistas = window.PortalVistas || {});
  const { esc, fecha, chipHito, nombreAct, bloqueEntrega, etiquetaNuevo } = window.PortalUI;

  // «00 Trámites y gestión» → «Trámites y gestión»: el prefijo numérico sólo sirve para ordenar
  function nombreCarpeta(c) { return String(c || '').replace(/^\s*\d+\s*[-.·_)]?\s*/, '').trim() || c; }

  function filaDocCarpeta(x) {
    const a = E.ctx.actPorId[x.actividad_id];
    const partes = [x.categoria ? esc(x.categoria) : '', x.fecha ? fecha(x.fecha) : '', (x.version && Number(x.version) > 1) ? 'versión ' + esc(x.version) : ''].filter(Boolean);
    return `<div class="doc"><div><div>${esc(x.nombre)} ${etiquetaNuevo(x)}</div>
      <div class="meta">${partes.join(' · ')}${x.descripcion ? ' · ' + esc(x.descripcion) : ''}</div>
      ${a ? `<div class="meta doc-entrega">${chipHito(a)} ${nombreAct(a)}</div>` : ''}</div>
      <div>${(x.tiene_archivo || x.url) ? `<button class="btn s xs" onclick="verDocumento(${x.id},this)">Abrir</button>` : '<span class="vacio">Sin archivo</span>'}</div></div>`;
  }
  function carpetaHtml(c, i) {
    const n = c.docs.length, nuevos = c.docs.filter(E.esNuevo).length;
    return `<details class="partida carpeta" ${i < 3 || nuevos ? 'open' : ''}>
      <summary><span class="partida-nombre">${esc(nombreCarpeta(c.nombre))}</span>
        <span class="partida-meta">${n} ${n === 1 ? 'documento' : 'documentos'}${nuevos ? ' · ' + nuevos + (nuevos === 1 ? ' nuevo' : ' nuevos') : ''}</span></summary>
      <div class="partida-lista">${c.docs.map(filaDocCarpeta).join('')}</div></details>`;
  }

  function vistaEntregables() {
    const c = E.ctx;
    let cuerpo;
    if (c.carpetas.length) {
      cuerpo = c.carpetas.map(carpetaHtml).join('');
    } else if (c.gruposEnt.length || c.sueltos) {
      cuerpo = `${c.gruposEnt.map(a => bloqueEntrega('ent-' + a.id, chipHito(a) + nombreAct(a), fecha(a.inicio), c.porHito[a.id], a)).join('')}${c.sueltos ? bloqueEntrega('ent-otros', 'Otros documentos', '', c.sueltos, null) : ''}`;
    } else {
      cuerpo = '<div class="vacio-caja"><strong>Todavía no hay entregables</strong>Aquí vas a encontrar tus planos, contratos y reportes en cuanto se publiquen.</div>';
    }
    const n = c.docs.length;
    return `<div class="card"><h2>Entregables de tu obra ${n ? `<span class="meta">${n} ${n === 1 ? 'documento' : 'documentos'}</span>` : ''}</h2>${cuerpo}</div>`;
  }

  V.entregables = vistaEntregables;
})();
