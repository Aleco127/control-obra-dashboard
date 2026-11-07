/**
 * Diario (PRD portal v2, US-757): las entradas de bitácora que la constructora PUBLICÓ, agrupadas por semana, con
 * clima, resumen escrito para el cliente, avance descrito y las fotos de ese día. Nunca llegan personal, materiales,
 * maquinaria, incidentes ni observaciones: el servidor no los manda (migración 068).
 */
(function () {
  'use strict';
  const E = window.PortalEstado, V = (window.PortalVistas = window.PortalVistas || {}), C = window.PortalCalc;
  const { esc, fecha, miniatura, etiquetaNuevo } = window.PortalUI;
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  function diaSemana(iso) { return DIAS[new Date(iso + 'T12:00:00').getDay()]; }
  function entradaHtml(b) {
    return `<article class="dia${E.esNuevo(b) ? ' es-nueva' : ''}">
      <div class="dia-cab"><div><strong>${diaSemana(String(b.fecha).slice(0, 10))} ${fecha(b.fecha)}</strong>${etiquetaNuevo(b)}</div>
        ${b.clima ? `<span class="meta">${esc(b.clima)}${b.temperatura ? ' · ' + esc(b.temperatura) : ''}</span>` : ''}</div>
      ${b.resumen ? `<p class="texto">${esc(b.resumen)}</p>` : ''}
      ${b.avance ? `<p class="texto avance-txt"><span class="et">Avance</span>${esc(b.avance)}</p>` : ''}
      ${b.fotos.length ? `<div class="fotos">${b.fotos.map(miniatura).join('')}</div>` : ''}
    </article>`;
  }
  function vistaDiario() {
    const lista = E.ctx.diario;
    if (!lista.length) return `<div class="card"><h2>Diario de obra</h2><div class="vacio-caja"><strong>Tu constructor todavía no publica el diario de obra</strong>Aquí vas a leer qué se hizo cada día, con fotos, conforme lo publique.</div></div>`;
    // Agrupar por semana (lunes a domingo) en orden descendente
    const semanas = new Map();
    lista.forEach(b => { const s = C.semanaDe(String(b.fecha).slice(0, 10)); if (!semanas.has(s.inicio)) semanas.set(s.inicio, { s, items: [] }); semanas.get(s.inicio).items.push(b); });
    const bloques = [...semanas.values()].sort((a, b) => (a.s.inicio < b.s.inicio ? 1 : -1)).map(w =>
      `<section class="semana"><h3>Semana del ${fecha(w.s.inicio)}<span class="meta"> · ${w.items.length} ${w.items.length === 1 ? 'día' : 'días'}</span></h3><div class="dias">${w.items.map(entradaHtml).join('')}</div></section>`).join('');
    return `<div class="card"><h2>Diario de obra <span class="meta">${lista.length} ${lista.length === 1 ? 'día publicado' : 'días publicados'}</span></h2>${bloques}</div>`;
  }

  V.diario = vistaDiario;
})();
