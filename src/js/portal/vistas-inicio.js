/**
 * Inicio (PRD portal v2, US-753): el cliente sabe en 10 segundos cómo va su obra, cuándo se entrega y qué sigue.
 * Cifras, un solo aviso de pago, cómo va (real contra programado), ejecutado y pagado, cambios al contrato
 * resumidos, último día del diario, últimas fotos y último entregable.
 */
(function () {
  'use strict';
  const E = window.PortalEstado, V = (window.PortalVistas = window.PortalVistas || {});
  const { esc, fmt, fecha, nombreAct, miniatura, filaDoc, barrasAvance, chipEstado } = window.PortalUI;

  function kpisHtml() {
    const c = E.ctx;
    return `<div class="kpis">
      <div class="kpi"><b>${c.avance}%</b><span>Avance real</span></div>
      <div class="kpi"><b>${fmt(c.contrato)}</b><span>${c.resCambios.n ? 'Contrato vigente' : 'Contrato'}</span></div>
      <div class="kpi"><b>${fmt(c.cobrado)}</b><span>Pagado a la fecha</span></div>
      <div class="kpi"><b>${fmt(c.saldo)}</b><span>Saldo por pagar</span></div>
    </div>`;
  }

  // Un solo aviso de pago: si vence pronto o ya venció, el banner absorbe la tarjeta de «Siguiente pago»
  function avisoPagoHtml() {
    const p = E.ctx.proximo;
    if (!p) return '';
    const dias = Number(E.novedades().proximo_pago_dias);
    const vencido = p.vence && p.vence < E.ctx.hoy;
    const falta = Number(p.monto) - Number(p.cobrado || 0);
    let titulo = 'Siguiente pago';
    if (vencido) titulo = 'Tienes un pago vencido';
    else if (Number.isFinite(dias) && dias === 0) titulo = 'Tu siguiente pago vence hoy';
    else if (Number.isFinite(dias) && dias > 0 && dias <= 7) titulo = 'Siguiente pago: vence en ' + dias + (dias === 1 ? ' día' : ' días');
    return `<div class="card aviso-pago"><h2>${titulo}</h2>
      <p class="linea-pago"><strong>${esc(window.PortalCalc.conceptoCorto(p.concepto))}</strong> · ${fmt(falta)}${p.vence ? ' · vence ' + fecha(p.vence) : ''} ${vencido ? '<span class="chip c-bad">vencido</span>' : ''}</p>
      <p class="acciones"><button class="btn s" onclick="irASeccion('pagos')">Ver cómo pagar</button></p></div>`;
  }

  function comoVaHtml() {
    const c = E.ctx;
    const ent = c.entrega;
    const entregaTxt = !ent.fecha ? 'Fecha de entrega por definir'
      : ent.vencida ? 'Fecha de entrega por confirmar (la vigente era el ' + fecha(ent.fecha) + ')'
      : (ent.reprogramada ? 'Entrega reprogramada: ' : 'Entrega vigente: ') + fecha(ent.fecha);
    const hechas = c.tareas.filter(a => c.estado[a.id] === 'terminada').length;
    const detalles = [];
    if (c.tareas.length) detalles.push(`${hechas} de ${c.tareas.length} ${c.tareas.length === 1 ? 'actividad terminada' : 'actividades terminadas'}`);
    if (c.atrasadas.length) detalles.push(`<span class="txt-warn">${c.atrasadas.length} ${c.atrasadas.length === 1 ? 'atrasada' : 'atrasadas'}</span>`);
    if (c.enCurso.length) detalles.push(`${c.enCurso.length} en curso`);
    const sig = c.sigHito ? `<p class="meta-linea">Siguiente hito: <strong>${nombreAct(c.sigHito)}</strong>${c.sigHito.fin ? ', ' + fecha(c.sigHito.fin) : ''}</p>` : '';
    return `<div class="card"><h2>Cómo va tu obra <span class="chip c-info">${esc(c.o.estatus || '')}</span></h2>
      ${barrasAvance(c)}
      <p class="frase ${c.desviacion > 0 ? 'txt-warn' : c.desviacion < 0 ? 'txt-ok' : ''}">${esc(c.frase)}</p>
      <p class="meta-linea">${entregaTxt}${detalles.length ? ' · ' + detalles.join(' · ') : ''}</p>
      ${sig}
      <p class="acciones"><button class="btn s" onclick="irASeccion('avance')">Ver el programa</button>${c.actualizado ? `<span class="actualizado">Actualizado el ${fecha(c.actualizado)}</span>` : ''}</p></div>`;
  }

  function ultimoDiaHtml() {
    const b = E.ctx.diario[0];
    if (!b) return '';
    const fotos = b.fotos.slice(0, 3);
    return `<div class="card"><h2>Último día en obra <span class="meta">${fecha(b.fecha)}</span></h2>
      ${b.clima ? `<p class="meta-linea">${esc(b.clima)}${b.temperatura ? ' · ' + esc(b.temperatura) : ''}</p>` : ''}
      <p class="texto">${esc(b.resumen || '')}</p>
      ${fotos.length ? `<div class="fotos">${fotos.map(miniatura).join('')}</div>` : ''}
      <p class="acciones"><button class="btn s" onclick="irASeccion('diario')">Ver el diario</button></p></div>`;
  }

  function vistaInicio() {
    const c = E.ctx;
    const ultimas = c.fotos.slice(0, 3);
    const ultimoDoc = c.docs[0];
    return kpisHtml() + avisoPagoHtml() + comoVaHtml()
      + V.tarjetaEjecutadoPagado()
      + V.tarjetaCambios(false)
      + ultimoDiaHtml()
      + (ultimas.length ? `<div class="card"><h2>Últimas fotos</h2><div class="fotos">${ultimas.map(miniatura).join('')}</div><p class="acciones"><button class="btn s" onclick="irASeccion('fotos')">Ver todas</button></p></div>` : '')
      + (ultimoDoc ? `<div class="card"><h2>Último entregable</h2>${filaDoc(ultimoDoc)}<p class="acciones"><button class="btn s" onclick="irASeccion('entregables')">Ver entregables</button></p></div>` : '');
  }

  V.inicio = vistaInicio;
})();
