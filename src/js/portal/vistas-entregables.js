/**
 * Entregables (US-701A): documentos y fotos agrupados por la entrega del programa a la que pertenecen.
 */
(function () {
  'use strict';
  const E = window.PortalEstado, V = (window.PortalVistas = window.PortalVistas || {});
  const { fecha, chipHito, nombreAct, bloqueEntrega } = window.PortalUI;

  function vistaEntregables() {
    return `<div class="card"><h2>Entregables de tu obra</h2>${(E.ctx.gruposEnt.length || E.ctx.sueltos)
      ? `${E.ctx.gruposEnt.map(a => bloqueEntrega('ent-' + a.id, chipHito(a) + nombreAct(a), fecha(a.inicio), E.ctx.porHito[a.id], a)).join('')}${E.ctx.sueltos ? bloqueEntrega('ent-otros', 'Otros documentos', '', E.ctx.sueltos, null) : ''}`
      : '<div class="vacio-caja"><strong>Todavía no hay entregables</strong>Aquí vas a encontrar tus planos, contratos y reportes en cuanto se publiquen.</div>'}</div>`;
  }

  V.entregables = vistaEntregables;
})();
