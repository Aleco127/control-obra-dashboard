/**
 * Fotos (US-701A): la galería completa, primero un bloque por concepto del programa y al final las sueltas.
 */
(function () {
  'use strict';
  const E = window.PortalEstado, V = (window.PortalVistas = window.PortalVistas || {});
  const { chipHito, nombreAct, miniatura } = window.PortalUI;

  function vistaFotos() {
    if (!E.ctx.fotos.length) return `<div class="card"><h2>Fotos de la obra</h2><div class="vacio-caja"><strong>Todavía no hay fotos</strong>Aquí vas a ver las fotos que tu constructor publique conforme avance la obra.</div></div>`;
    // La galería completa: primero un bloque por concepto del programa y al final las sueltas
    const cuenta = n => n + (n === 1 ? ' foto' : ' fotos');
    const porConcepto = E.ctx.gruposFoto.map(a => {
      const fs = E.ctx.porHito[a.id].fotos, av = Math.round(Number(a.avance || 0));
      return `<section class="grupo" id="fot-${a.id}">
        <div class="grupo-cab"><div><strong>${chipHito(a)}${nombreAct(a)}</strong><div class="meta">${cuenta(fs.length)} · ${av}% de avance</div></div>${av >= 100 ? '<span class="chip c-ok">Terminado</span>' : ''}</div>
        <div class="fotos">${fs.map(miniatura).join('')}</div></section>`;
    }).join('');
    const sueltas = E.ctx.fotosSueltas.length
      ? (E.ctx.hayFotosEnGrupos
        ? `<section class="grupo" id="fot-otras"><div class="grupo-cab"><div><strong>Otras fotos de la obra</strong><div class="meta">${cuenta(E.ctx.fotosSueltas.length)}</div></div></div><div class="fotos">${E.ctx.fotosSueltas.map(miniatura).join('')}</div></section>`
        : `<div class="fotos">${E.ctx.fotosSueltas.map(miniatura).join('')}</div>`)
      : '';
    return `<div class="card"><h2>Fotos de tu obra</h2>${porConcepto}${sueltas}</div>`;
  }

  V.fotos = vistaFotos;
})();
