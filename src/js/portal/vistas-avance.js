/**
 * Avance (PRD portal v2, US-754): programa de obra por partidas con estado de cada actividad, real contra
 * programado a la fecha, filtros (Todo · Esta semana · Atrasadas · Terminadas), hitos, estimaciones y los cambios
 * al contrato. El filtro se aplica sin volver a la red: repinta sólo la lista.
 */
(function () {
  'use strict';
  const E = window.PortalEstado, V = (window.PortalVistas = window.PortalVistas || {}), C = window.PortalCalc;
  const { esc, fmt, fecha, estadoChip, chipHito, nombreAct, etiquetaVer, barrasAvance, chipEstado } = window.PortalUI;
  let filtro = 'todo';

  function pasaFiltro(a) {
    const est = E.ctx.estado[a.id];
    if (filtro === 'semana') return E.ctx.estaSemana.includes(a);
    if (filtro === 'atrasadas') return est === 'atrasada';
    if (filtro === 'terminadas') return est === 'terminada';
    return true;
  }
  function filaAct(a) {
    const c = E.ctx, est = c.estado[a.id], av = Math.min(100, Math.round(Number(a.avance || 0)));
    const resp = c.responsable(a);
    const fechas = a.fin_real && est === 'terminada'
      ? `terminó el ${fecha(a.fin_real)}`
      : `${fecha(a.inicio)}${a.fin && a.fin !== a.inicio ? ' a ' + fecha(a.fin) : ''}`;
    const g = c.porHito[a.id];
    const ver = g ? ((g.docs.length || a.hito) ? `<button class="btn s xs ver" onclick="irA('ent-${a.id}')">${etiquetaVer(g)}</button>` : `<button class="btn s xs ver" onclick="irA('fot-${a.id}','fotos')">${etiquetaVer(g)}</button>`) : '';
    return `<div class="act est-${est}">
      <div><div class="act-nombre">${chipHito(a)}${nombreAct(a)}</div>
        <div class="act-meta">${fechas}${resp ? ' · ' + esc(resp) : ''}</div>${ver}</div>
      <div class="act-der">${chipEstado(est)}<div class="bar${est === 'atrasada' ? ' atr' : ''}" aria-hidden="true"><i style="width:${av}%"></i></div><div class="act-pct">${av}%</div></div>
    </div>`;
  }
  function grupoHtml(g) {
    const lista = g.acts.filter(pasaFiltro);
    if (!lista.length) return '';
    const abierto = window.innerWidth >= 900 || g.atrasadas > 0 || g.enCurso > 0 || filtro !== 'todo';
    const pct = Math.round(g.real);
    return `<details class="partida" ${abierto ? 'open' : ''}>
      <summary><span class="partida-nombre">${esc(g.partida)}</span>
        <span class="partida-meta">${g.terminadas} de ${g.total} ${g.total === 1 ? 'terminada' : 'terminadas'}${g.atrasadas ? ` · <span class="txt-warn">${g.atrasadas} ${g.atrasadas === 1 ? 'atrasada' : 'atrasadas'}</span>` : ''}</span>
        <span class="partida-pct">${pct}%</span><span class="bar mini-bar" aria-hidden="true"><i style="width:${pct}%"></i></span></summary>
      <div class="partida-lista">${lista.map(filaAct).join('')}</div></details>`;
  }
  function hitosHtml() {
    const lista = E.ctx.hitos.filter(pasaFiltro);
    if (!lista.length) return '';
    return `<details class="partida hitos" open><summary><span class="partida-nombre">Hitos y entregas</span><span class="partida-meta">${E.ctx.hitos.filter(a => E.ctx.estado[a.id] === 'cumplido').length} de ${E.ctx.hitos.length} cumplidos</span></summary>
      <div class="partida-lista">${lista.map(a => `<div class="act est-${E.ctx.estado[a.id]}"><div><div class="act-nombre">${chipHito(a)}${nombreAct(a)}</div><div class="act-meta">${fecha(a.fin_real || a.fin || a.inicio)}</div></div><div class="act-der">${chipEstado(E.ctx.estado[a.id])}</div></div>`).join('')}</div></details>`;
  }
  function filtrosHtml() {
    const c = E.ctx;
    const op = (k, t, n) => `<button type="button" class="pill${filtro === k ? ' activa' : ''}" onclick="avanceFiltro('${k}')" aria-pressed="${filtro === k}">${t}${n != null ? ` <span class="num">${n}</span>` : ''}</button>`;
    return `<div class="pills" role="group" aria-label="Filtrar actividades">${op('todo', 'Todo', c.tareas.length)}${op('semana', 'Esta semana', c.estaSemana.length)}${c.atrasadas.length ? op('atrasadas', 'Atrasadas', c.atrasadas.length) : ''}${op('terminadas', 'Terminadas', c.tareas.filter(a => c.estado[a.id] === 'terminada').length)}</div>`;
  }
  function listaHtml() {
    const c = E.ctx;
    const grupos = c.grupos.map(grupoHtml).join('') + hitosHtml();
    return grupos || '<div class="vacio-caja">Nada que mostrar con este filtro.</div>';
  }
  function avanceFiltro(k) {
    filtro = k;
    const l = document.getElementById('avanceLista'); if (l) l.innerHTML = listaHtml();
    const f = document.getElementById('avanceFiltros'); if (f) f.innerHTML = filtrosHtml();
    window.portalEvento('avance_filtro', { filtro: k, obra_id: E.obraActual });
  }

  function vistaAvance() {
    const c = E.ctx;
    filtro = 'todo';
    const programa = c.hayPrograma || c.acts.length
      ? `${barrasAvance(c)}<p class="frase ${c.desviacion > 0 ? 'txt-warn' : c.desviacion < 0 ? 'txt-ok' : ''}">${esc(c.frase)}</p>
         <p class="meta-linea">${c.entrega.fecha ? (c.entrega.vencida ? 'Fecha de entrega por confirmar' : (c.entrega.reprogramada ? 'Entrega reprogramada: ' : 'Entrega vigente: ') + fecha(c.entrega.fecha)) : ''}</p>
         <div id="avanceFiltros">${filtrosHtml()}</div><div id="avanceLista">${listaHtml()}</div>`
      : '<div class="vacio-caja"><strong>El programa todavía no está publicado</strong>En cuanto tu constructor lo comparta vas a ver aquí cada etapa con sus fechas.</div>';
    return `<div class="card"><h2>Programa de obra <span class="chip c-info">${esc(c.o.estatus || '')}</span></h2>${programa}</div>`
      + (c.ests.length ? `<div class="card"><h2>Estimaciones</h2><div class="tbl tbl-cards"><table><thead><tr><th>Nº</th><th>Periodo</th><th class="n">Avance</th><th class="n">Total</th><th>Estado</th></tr></thead><tbody>${c.ests.map(x => `<tr><td class="titulo"><span class="et-movil">Estimación </span>${esc(x.numero)}</td><td data-et="Periodo">${fecha(x.periodo_inicio)}${x.periodo_fin ? ' a ' + fecha(x.periodo_fin) : ''}</td><td class="n" data-et="Avance">${x.avance != null ? Math.round(Number(x.avance)) + '%' : ''}</td><td class="n" data-et="Total">${fmt(x.total)}</td><td data-et="Estado">${estadoChip(x.estatus)}</td></tr>`).join('')}</tbody></table></div></div>` : '')
      + V.tarjetaCambios(true);
  }

  V.avance = vistaAvance;
  Object.assign(window, { avanceFiltro });
})();
