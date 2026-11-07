/**
 * Diario (PRD portal v2, US-757; calendario 7-nov-2026): las entradas de bitácora que la constructora PUBLICÓ.
 *  - Calendario mensual (lunes a domingo): cada día marca si hubo entrada en el diario, si tenía actividades
 *    programadas y si cae un hito. Al tocar un día se abre su panel.
 *  - Panel del día: la entrada (o entradas) de ese día con clima, resumen, avance y fotos, más lo que el programa
 *    tenía previsto para esa fecha, con salto a la actividad en «Avance».
 *  - Lista completa por semana (en el celular sólo las dos más recientes abiertas).
 * Nunca llegan personal, materiales, maquinaria, incidentes ni observaciones: el servidor no los manda (migración 068).
 * La rejilla del mes se calcula en PortalCalc.calendarioMes (probado en Node).
 */
(function () {
  'use strict';
  const E = window.PortalEstado, V = (window.PortalVistas = window.PortalVistas || {}), C = window.PortalCalc;
  const { esc, fecha, miniatura, etiquetaNuevo, chipHito, nombreAct, chipEstado } = window.PortalUI;
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const DIAS_CORTO = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  let calMes = null;   // {anio, mes} del mes que se muestra
  let calDia = null;   // 'AAAA-MM-DD' seleccionado

  function diaSemana(iso) { return DIAS[new Date(iso + 'T12:00:00').getDay()]; }
  function entradaHtml(b, sinFecha) {
    return `<article class="dia${E.esNuevo(b) ? ' es-nueva' : ''}">
      <div class="dia-cab"><div>${sinFecha ? '' : `<strong>${diaSemana(String(b.fecha).slice(0, 10))} ${fecha(b.fecha)}</strong>`}${etiquetaNuevo(b)}</div>
        ${b.clima ? `<span class="meta">${esc(b.clima)}${b.temperatura ? ' · ' + esc(b.temperatura) : ''}</span>` : ''}</div>
      ${b.resumen ? `<p class="texto">${esc(b.resumen)}</p>` : ''}
      ${b.avance ? `<p class="texto avance-txt"><span class="et">Avance</span>${esc(b.avance)}</p>` : ''}
      ${b.fotos.length ? `<div class="fotos">${b.fotos.map(miniatura).join('')}</div>` : ''}
    </article>`;
  }

  /* ---------- Calendario ---------- */
  function diaInicial() {
    // El último día con entrada publicada; si no hay diario, hoy
    const lista = E.ctx.diario;
    return lista.length ? String(lista[0].fecha).slice(0, 10) : E.ctx.hoy;
  }
  function calHtml() {
    const c = E.ctx, m = C.calendarioMes(calMes.anio, calMes.mes, { diario: c.diario, acts: c.acts, hoy: c.hoy });
    const etiqueta = (d) => {
      const partes = [d.dia + ' de ' + m.nombreMes];
      if (d.entradas.length) partes.push(d.entradas.length === 1 ? 'entrada en el diario' : d.entradas.length + ' entradas en el diario');
      if (d.tareas.length) partes.push(d.tareas.length + (d.tareas.length === 1 ? ' actividad programada' : ' actividades programadas'));
      if (d.hitos.length) partes.push(d.hitos.length === 1 ? 'hito' : d.hitos.length + ' hitos');
      return partes.join(', ');
    };
    const celdas = m.semanas.map(s => s.map(d => `<button type="button" class="cal-d${d.enMes ? '' : ' fuera'}${d.hoy ? ' hoy' : ''}${d.fecha === calDia ? ' sel' : ''}${d.futuro ? ' futuro' : ''}"
        onclick="diarioDia('${d.fecha}')" aria-pressed="${d.fecha === calDia}" aria-label="${esc(etiqueta(d))}" title="${esc(etiqueta(d))}">
        <span class="cal-n">${d.dia}</span>
        <span class="cal-marcas" aria-hidden="true">${d.entradas.length ? '<i class="m-diario"></i>' : ''}${d.tareas.length ? '<i class="m-act"></i>' : ''}${d.hitos.length ? '<i class="m-hito"></i>' : ''}</span>
      </button>`).join('')).join('');
    return `<div class="cal-cab"><strong>${esc(m.titulo)}</strong>
        <div class="cal-nav"><button type="button" class="cal-btn" onclick="diarioMes(-1)" aria-label="Mes anterior">‹</button><button type="button" class="cal-btn cal-hoy" onclick="diarioDia('${c.hoy}')">Hoy</button><button type="button" class="cal-btn" onclick="diarioMes(1)" aria-label="Mes siguiente">›</button></div></div>
      <div class="cal-sem" aria-hidden="true">${DIAS_CORTO.map(d => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid" role="group" aria-label="Días de ${esc(m.titulo)}">${celdas}</div>
      <div class="g-leyenda cal-ley"><span><i class="m-diario"></i>Día con entrada</span><span><i class="m-act"></i>Trabajo programado</span><span><i class="m-hito"></i>Hito</span></div>`;
  }
  function filaProgramada(a) {
    const c = E.ctx, est = c.estado[a.id], av = Math.min(100, Math.round(Number(a.avance || 0)));
    const sub = [a.partida ? esc(a.partida) : '', a.hito ? fecha(a.fin_real || a.fin || a.inicio) : `${fecha(a.inicio)}${a.fin && a.fin !== a.inicio ? ' a ' + fecha(a.fin) : ''}`].filter(Boolean).join(' · ');
    return `<div class="act est-${est}"><div><div class="act-nombre">${chipHito(a)}${nombreAct(a)}</div><div class="act-meta">${sub}</div>
        <button type="button" class="btn s xs ver" onclick="irA('act-${a.id}','avance')">Ver en el programa</button></div>
      <div class="act-der">${chipEstado(est)}${a.hito ? '' : `<div class="bar${est === 'atrasada' ? ' atr' : ''}" aria-hidden="true"><i style="width:${av}%"></i></div><div class="act-pct">${av}%</div>`}</div></div>`;
  }
  function diaHtml() {
    const c = E.ctx, f = calDia;
    const entradas = c.diario.filter(b => String(b.fecha).slice(0, 10) === f);
    const prog = C.actividadesDelDia(c.acts, f);
    const futuro = f > c.hoy;
    let cuerpo = entradas.map(b => entradaHtml(b, true)).join('');
    if (!cuerpo) {
      const ant = c.diario.find(b => String(b.fecha).slice(0, 10) < f);
      cuerpo = `<div class="vacio-caja">${futuro ? '<strong>Este día todavía no llega</strong>Aquí vas a leer qué se hizo cuando la obra llegue a esa fecha.' : '<strong>Sin entrada en el diario este día</strong>' + (ant ? `La entrada anterior es del ${diaSemana(String(ant.fecha).slice(0, 10))} ${fecha(ant.fecha)}.` : 'Todavía no hay entradas anteriores.')}
        ${ant ? `<button type="button" class="btn s xs" onclick="diarioDia('${String(ant.fecha).slice(0, 10)}')">Ir a la entrada anterior</button>` : ''}</div>`;
    }
    const programado = c.hayPrograma || c.acts.length
      ? `<div class="dia-prog"><h3>Programado para este día</h3>${(prog.hitos.length || prog.tareas.length) ? prog.hitos.concat(prog.tareas).map(filaProgramada).join('') : '<p class="vacio">Nada programado para este día.</p>'}</div>`
      : '';
    return `<div class="dia-nav"><button type="button" class="cal-btn" onclick="diarioDia('${C.sumarDias(f, -1)}')" aria-label="Día anterior">‹</button>
        <strong class="dia-titulo">${diaSemana(f)} ${fecha(f)}${f === c.hoy ? ' <span class="chip c-bad">Hoy</span>' : ''}</strong>
        <button type="button" class="cal-btn" onclick="diarioDia('${C.sumarDias(f, 1)}')" aria-label="Día siguiente">›</button></div>
      ${cuerpo}${programado}`;
  }
  function diarioDia(f) {
    calDia = f;
    const m = C.mesDe(f);
    if (m.anio !== calMes.anio || m.mes !== calMes.mes) calMes = m;
    const cal = document.getElementById('diarioCal'), dia = document.getElementById('diarioDia');
    if (cal) cal.innerHTML = calHtml();
    if (dia) dia.innerHTML = diaHtml();
    window.portalEvento('diario_dia', { fecha: f, obra_id: E.obraActual });
  }
  function diarioMes(dir) {
    let { anio, mes } = calMes; mes += dir;
    if (mes < 1) { mes = 12; anio--; } if (mes > 12) { mes = 1; anio++; }
    calMes = { anio, mes };
    const cal = document.getElementById('diarioCal'); if (cal) cal.innerHTML = calHtml();
  }

  /* ---------- Lista completa por semana ---------- */
  function listaHtml(lista) {
    // Agrupar por semana (lunes a domingo) en orden descendente. En el celular sólo las dos semanas más recientes
    // vienen abiertas; las anteriores se despliegan con un toque. En escritorio (≥900) hay espacio y todas van abiertas.
    const semanas = new Map();
    lista.forEach(b => { const s = C.semanaDe(String(b.fecha).slice(0, 10)); if (!semanas.has(s.inicio)) semanas.set(s.inicio, { s, items: [] }); semanas.get(s.inicio).items.push(b); });
    return [...semanas.values()].sort((a, b) => (a.s.inicio < b.s.inicio ? 1 : -1)).map((w, i) => {
      const nuevas = w.items.filter(E.esNuevo).length;
      const abierta = window.innerWidth >= 900 || i < 2 || nuevas > 0;
      const titulo = `<h3>Semana del ${fecha(w.s.inicio)}<span class="meta"> · ${w.items.length} ${w.items.length === 1 ? 'día' : 'días'}${nuevas ? ` · ${nuevas} ${nuevas === 1 ? 'nuevo' : 'nuevos'}` : ''}</span></h3>`;
      return `<details class="semana"${abierta ? ' open' : ''}><summary>${titulo}</summary><div class="dias">${w.items.map(b => entradaHtml(b)).join('')}</div></details>`;
    }).join('');
  }

  function vistaDiario() {
    const lista = E.ctx.diario;
    if (!lista.length && !E.ctx.acts.length) return `<div class="card"><h2>Diario de obra</h2><div class="vacio-caja"><strong>Tu constructor todavía no publica el diario de obra</strong>Aquí vas a leer qué se hizo cada día, con fotos, conforme lo publique.</div></div>`;
    calDia = diaInicial(); calMes = C.mesDe(calDia);
    const n = lista.length;
    return `<div class="rejilla">
      <div class="card md-6 lg-5 xl-4"><h2>Calendario de la obra <span class="meta">${n} ${n === 1 ? 'día publicado' : 'días publicados'}</span></h2><div class="cal" id="diarioCal">${calHtml()}</div></div>
      <div class="card md-6 lg-7 xl-8"><h2>Ese día en la obra</h2><div id="diarioDia">${diaHtml()}</div></div>
      ${n ? `<div class="card"><h2>Diario completo <span class="meta">${n} ${n === 1 ? 'día' : 'días'}</span></h2>${listaHtml(lista)}</div>` : ''}
    </div>`;
  }

  V.diario = vistaDiario;
  Object.assign(window, { diarioDia, diarioMes });   // onclick del calendario y del panel del día
})();
