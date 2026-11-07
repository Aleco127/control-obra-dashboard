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
  let ganttTodas = false; // Gantt: sólo partidas (plegado) o con todas las actividades

  /* ---------- Gantt (6-nov-2026): calendario de la obra por partida, con barras de avance real, hitos y línea de hoy ---------- */
  function ganttBarra(g, inicio, fin, est, av, titulo) {
    const p = g.pos(inicio, fin);
    return `<span class="g-barra est-${est}" style="left:${p.left}%;width:${Math.max(p.width, 0.35)}%" title="${esc(titulo)}"><i style="width:${Math.min(100, Math.max(0, av))}%"></i></span>`;
  }
  function ganttFilaAct(g, a) {
    const c = E.ctx, est = c.estado[a.id], av = Math.round(Number(a.avance || 0));
    const fechas = `${fecha(a.inicio)}${a.fin && a.fin !== a.inicio ? ' a ' + fecha(a.fin) : ''}`;
    return `<div class="g-fila g-act est-${est}"><div class="g-nombre" title="${esc(fechas)}">${nombreAct(a)}</div><div class="g-pista">${ganttBarra(g, a.inicio, a.fin || a.inicio, est, av, `${fechas} · ${av}%`)}</div></div>`;
  }
  function ganttFilaPartida(g, gr, i) {
    const est = gr.atrasadas ? 'atrasada' : (gr.total && gr.terminadas === gr.total) ? 'terminada' : gr.enCurso ? 'en_curso' : 'proxima';
    const pct = Math.round(gr.real);
    return `<div class="g-fila g-partida est-${est}"><button type="button" class="g-nombre g-btn" onclick="ganttPartida(this)" aria-expanded="${ganttTodas}" aria-controls="gh-${i}">${esc(gr.partida)}</button>
      <div class="g-pista">${ganttBarra(g, gr.inicio, gr.fin, est, pct, `${esc(gr.partida)} · ${fecha(gr.inicio)} a ${fecha(gr.fin)} · ${pct}%`)}</div></div>
      <div class="g-hijas" id="gh-${i}"${ganttTodas ? '' : ' hidden'}>${gr.acts.map(a => ganttFilaAct(g, a)).join('')}</div>`;
  }
  function ganttHtml() {
    const c = E.ctx, g = C.ganttModelo(c.acts, c.hoy);
    if (!g || !c.grupos.length) return '';
    const hitos = c.hitos.map(a => { const f = a.fin_real || a.fin || a.inicio, p = g.pos(f, f); return `<span class="g-hito est-${c.estado[a.id]}" style="left:${p.left}%" title="${nombreAct(a)} · ${fecha(f)}"></span>`; }).join('');
    const meses = g.meses.map(m => `<span style="width:${m.pct}%">${m.et}</span>`).join('');
    const hoyStyle = g.hoyPct != null ? `--hoy:${g.hoyPct}%` : '--hoy:-100%';
    return `<div class="gantt">
      <div class="gantt-cab"><span class="meta-linea">Calendario de la obra</span>
        <button type="button" class="pill${ganttTodas ? ' activa' : ''}" onclick="ganttTodasLas()" aria-pressed="${ganttTodas}">${ganttTodas ? 'Sólo partidas' : 'Ver actividades'}</button></div>
      <div class="gantt-scroll" id="ganttScroll"><div class="gantt-tabla" style="--dias:${g.dias};${hoyStyle}">
        <div class="g-fila g-meses"><div class="g-nombre"></div><div class="g-pista">${meses}${g.hoyPct != null ? `<span class="g-hoy-et" style="left:${g.hoyPct}%">Hoy</span>` : ''}</div></div>
        ${c.grupos.map((gr, i) => ganttFilaPartida(g, gr, i)).join('')}
        ${c.hitos.length ? `<div class="g-fila g-hitos"><div class="g-nombre">Hitos</div><div class="g-pista">${hitos}</div></div>` : ''}
      </div></div>
      <div class="g-leyenda"><span><i class="est-proxima"></i>Próxima</span><span><i class="est-en_curso"></i>En curso</span><span><i class="est-terminada"></i>Terminada</span><span><i class="est-atrasada"></i>Atrasada</span><span><i class="g-hito-ej"></i>Hito</span></div>
    </div>`;
  }
  function ganttScrollHoy() {
    const s = document.getElementById('ganttScroll'); if (!s) return;
    const t = s.querySelector('.gantt-tabla'), nombre = s.querySelector('.g-nombre');
    const pct = parseFloat((t && t.style.getPropertyValue('--hoy')) || '');
    if (!t || !(pct >= 0)) return;
    const pista = t.scrollWidth - (nombre ? nombre.offsetWidth : 0);
    s.scrollLeft = Math.max(0, pista * pct / 100 - (s.clientWidth - (nombre ? nombre.offsetWidth : 0)) * 0.35);
  }
  function ganttPartida(btn) {
    const h = document.getElementById(btn.getAttribute('aria-controls')); if (!h) return;
    h.hidden = !h.hidden; btn.setAttribute('aria-expanded', String(!h.hidden));
  }
  function ganttTodasLas() {
    ganttTodas = !ganttTodas;
    const caja = document.getElementById('avanceGantt'); if (!caja) return;
    const s = document.getElementById('ganttScroll'), x = s ? s.scrollLeft : 0;
    caja.innerHTML = ganttHtml();
    const s2 = document.getElementById('ganttScroll'); if (s2) s2.scrollLeft = x;
    window.portalEvento('avance_gantt', { todas: ganttTodas, obra_id: E.obraActual });
  }

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
    return `<div class="act est-${est}" id="act-${a.id}">
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
      <div class="partida-lista">${lista.map(a => `<div class="act est-${E.ctx.estado[a.id]}" id="act-${a.id}"><div><div class="act-nombre">${chipHito(a)}${nombreAct(a)}</div><div class="act-meta">${fecha(a.fin_real || a.fin || a.inicio)}</div></div><div class="act-der">${chipEstado(E.ctx.estado[a.id])}</div></div>`).join('')}</div></details>`;
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
    requestAnimationFrame(ganttScrollHoy); // la vista se pinta con innerHTML; el scroll a «hoy» va después
    const programa = c.hayPrograma || c.acts.length
      ? `${barrasAvance(c)}<p class="frase ${c.desviacion > 0 ? 'txt-warn' : c.desviacion < 0 ? 'txt-ok' : ''}">${esc(c.frase)}</p>
         <p class="meta-linea">${c.entrega.fecha ? (c.entrega.vencida ? 'Fecha de entrega por confirmar' : (c.entrega.reprogramada ? 'Entrega reprogramada: ' : 'Entrega vigente: ') + fecha(c.entrega.fecha)) : ''}</p>
         <div id="avanceGantt">${ganttHtml()}</div>
         <div id="avanceFiltros">${filtrosHtml()}</div><div id="avanceLista">${listaHtml()}</div>`
      : '<div class="vacio-caja"><strong>El programa todavía no está publicado</strong>En cuanto tu constructor lo comparta vas a ver aquí cada etapa con sus fechas.</div>';
    return '<div class="rejilla">' + `<div class="card"><h2>Programa de obra <span class="chip c-info">${esc(c.o.estatus || '')}</span></h2>${programa}</div>`
      + (c.ests.length ? `<div class="card md-6"><h2>Estimaciones</h2><div class="tbl tbl-cards"><table><thead><tr><th>Nº</th><th>Periodo</th><th class="n">Avance</th><th class="n">Total</th><th>Estado</th></tr></thead><tbody>${c.ests.map(x => `<tr><td class="titulo"><span class="et-movil">Estimación </span>${esc(x.numero)}</td><td data-et="Periodo">${fecha(x.periodo_inicio)}${x.periodo_fin ? ' a ' + fecha(x.periodo_fin) : ''}</td><td class="n" data-et="Avance">${x.avance != null ? Math.round(Number(x.avance)) + '%' : ''}</td><td class="n" data-et="Total">${fmt(x.total)}</td><td data-et="Estado">${estadoChip(x.estatus)}</td></tr>`).join('')}</tbody></table></div></div>` : '')
      + V.tarjetaCambios(true, 'md-6')
      + '</div>';
  }

  V.avance = vistaAvance;
  Object.assign(window, { avanceFiltro, ganttPartida, ganttTodasLas });
})();
