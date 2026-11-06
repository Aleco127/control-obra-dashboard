/**
 * Pagos (PRD portal v2, US-755 y US-756): siguiente pago con datos para transferir, ejecutado contra pagado,
 * cambios al contrato (extras y deductivas → contrato vigente), plan de pagos, pagos realizados y facturas.
 * Las tarjetas de siguiente pago, ejecutado y cambios también las usan Inicio y Avance.
 */
(function () {
  'use strict';
  const E = window.PortalEstado, V = (window.PortalVistas = window.PortalVistas || {}), C = window.PortalCalc;
  const { esc, fmt, fecha, estadoChip } = window.PortalUI;

  // Lo que vale la obra ya hecha contra lo que el cliente lleva pagado (nunca los costos de la constructora)
  function tarjetaEjecutadoPagado() {
    const c = E.ctx;
    if (!(c.contrato > 0)) return '';
    const pct = v => Math.max(0, Math.min(100, Math.round(v / c.contrato * 1000) / 10));
    const dif = Math.round((c.cobrado - c.ejecutado) * 100) / 100;
    const nota = Math.abs(dif) < c.contrato * 0.01 ? 'Lo pagado va a la par de lo ejecutado.'
      : dif > 0 ? `Llevas pagados ${fmt(dif)} por delante de lo ejecutado; es normal con el anticipo.`
      : `La obra lleva ejecutados ${fmt(-dif)} más de lo que se ha pagado.`;
    const fila = (et, v, cls) => `<div class="avance-cab"><span>${et}</span><b>${fmt(v)} <span class="pct-de">${pct(v)}% del contrato</span></b></div><div class="bar${cls}" aria-hidden="true"><i style="width:${pct(v)}%"></i></div>`;
    return `<div class="card"><h2>Ejecutado y pagado</h2><div class="barras">
      ${fila('Ejecutado', c.ejecutado, '')}${fila('Pagado', c.cobrado, ' pag')}</div>
      <p class="nota">Ejecutado es el valor de lo ya construido según el avance de cada concepto${c.resCambios.n ? ', sobre el contrato vigente' : ''}. ${nota}</p></div>`;
  }

  // Cambios al contrato: resumen (Inicio) o resumen + lista (Pagos y Avance)
  function tarjetaCambios(completa) {
    const c = E.ctx, r = c.resCambios;
    if (!r.n) return '';
    const signo = (tipo, monto) => tipo === 'Deductiva' ? '−' + fmt(monto) : tipo === 'Adicional' ? '+' + fmt(monto) : (monto ? fmt(monto) : '');
    const resumen = `<dl class="contrato">
      <div><dt>Contrato original</dt><dd>${fmt(c.contratoOriginal)}</dd></div>
      ${r.extras ? `<div class="mas"><dt>Extras aprobados</dt><dd>+${fmt(r.extras)}</dd></div>` : ''}
      ${r.deductivas ? `<div class="menos"><dt>Deductivas</dt><dd>−${fmt(r.deductivas)}</dd></div>` : ''}
      <div class="total"><dt>Contrato vigente</dt><dd>${fmt(c.contrato)}</dd></div></dl>`;
    const lista = completa ? `<div class="cambios">${c.cambios.map(x => `<div class="cambio t-${(x.tipo || '').replace(/\s+/g, '-').toLowerCase()}">
        <div class="cambio-cab"><span class="chip ${x.tipo === 'Deductiva' ? 'c-warn' : x.tipo === 'Adicional' ? 'c-ok' : 'c-info'}">${esc(C.TIPO_CAMBIO[x.tipo] || x.tipo || 'Cambio')}</span><span class="meta">${esc(x.numero || '')}${x.fecha ? ' · ' + fecha(x.fecha) : ''}</span><b class="monto">${signo(x.tipo, x.monto)}</b></div>
        <div class="cambio-desc">${esc(x.descripcion || '')}</div>
        ${(Number(x.dias) > 0 || x.nueva_fecha_fin) ? `<div class="meta">${Number(x.dias) > 0 ? '+' + x.dias + (Number(x.dias) === 1 ? ' día' : ' días') : ''}${x.nueva_fecha_fin ? (Number(x.dias) > 0 ? ' → ' : '') + 'entrega ' + fecha(x.nueva_fecha_fin) : ''}</div>` : ''}
      </div>`).join('')}</div>` : '';
    const pie = completa ? '' : `<p class="acciones"><button class="btn s" onclick="irASeccion('pagos')">Ver los cambios</button></p>`;
    return `<div class="card"><h2>Cambios al contrato <span class="meta">${r.n} ${r.n === 1 ? 'cambio aprobado' : 'cambios aprobados'}</span></h2>${resumen}${lista}${pie}</div>`;
  }
  function avisoPlanHtml() {
    const c = E.ctx;
    if (!c.planDesfasado) return '';
    return `<div class="nota-aviso">El plan de pagos todavía no refleja todos los cambios al contrato (suma ${fmt(c.planTotal)} y el contrato vigente es ${fmt(c.contrato)}). Tu constructor lo actualizará.</div>`;
  }

  function tarjetaSiguientePago(resumida) {
    const p = E.ctx.proximo;
    if (!p) return '';
    const falta = Number(p.monto) - Number(p.cobrado || 0);
    const vencido = p.vence && p.vence < E.ctx.hoy;
    const cab = `<h2>Siguiente pago</h2><p class="linea-pago"><strong title="${esc(p.concepto)}">${esc(C.conceptoCorto(p.concepto))}</strong> · ${fmt(falta)}${p.vence ? ' · vence ' + fecha(p.vence) : ''} ${vencido ? '<span class="chip c-bad">vencido</span>' : ''}</p>`;
    if (resumida) return `<div class="card aviso-pago">${cab}<p class="acciones"><button class="btn s" onclick="irASeccion('pagos')">Ver pagos</button></p></div>`;
    const datosPago = cuentasHtml()
      + (E.ctx.dp.referencia ? `<p class="nota">Referencia: ${esc(E.ctx.dp.referencia)}</p>` : '')
      + (E.ctx.dp.instrucciones ? `<p class="nota">${esc(E.ctx.dp.instrucciones)}</p>` : '');
    const avisar = E.ctx.wa ? `<p class="acciones"><a class="btn s" href="${E.ctx.wa}" target="_blank" rel="noopener" onclick="avisoPagoClic()">Avisar que ya pagué por WhatsApp</a></p>` : '';
    return `<div class="card aviso-pago">${cab}${datosPago}${avisar}</div>`;
  }
  // Datos para transferir. `dp.cuentas` permite varias (p. ej. una con factura y otra sin); si no viene,
  // se usan los campos planos de siempre (banco/titular/clabe/cuenta).
  function cuentasDePago() {
    const lista = Array.isArray(E.ctx.dp.cuentas) ? E.ctx.dp.cuentas.filter(c => c && (c.clabe || c.cuenta)) : [];
    if (lista.length) return lista;
    if (E.ctx.dp.clabe || E.ctx.dp.cuenta) return [{ banco: E.ctx.dp.banco, titular: E.ctx.dp.titular, clabe: E.ctx.dp.clabe, cuenta: E.ctx.dp.cuenta }];
    return [];
  }
  function agrupaClabe(v) { return String(v || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim(); }
  function filaCopiable(et, v) {
    const plano = String(v || '').replace(/\s+/g, '');
    return `<dt>${et}</dt><dd><span class="clabe">${esc(agrupaClabe(v))}</span> <button class="copy" onclick="copiar('${esc(plano)}',this)">Copiar</button></dd>`;
  }
  function cuentasHtml() {
    const lista = cuentasDePago();
    if (!lista.length) return '<p class="vacio">Pide a tu constructor los datos para transferir.</p>';
    return lista.map(c => `<div class="cuenta">
      <div class="cuenta-cab">${c.etiqueta ? `<span class="chip c-info">${esc(c.etiqueta)}</span>` : ''}<span class="banco">${esc(c.banco || '')}</span></div>
      <dl><dt>Beneficiario</dt><dd>${esc(c.titular || E.ctx.e.nombre)}</dd>
      ${c.clabe ? filaCopiable('CLABE', c.clabe) : ''}
      ${c.cuenta ? filaCopiable('Cuenta', c.cuenta) : ''}</dl></div>`).join('');
  }

  function vistaPagos() {
    const c = E.ctx;
    const conceptoCuenta = {};
    c.plan.forEach(x => { conceptoCuenta[x.id] = String(x.concepto || ''); });
    const filaPlan = x => `<tr><td class="titulo"><span title="${esc(x.concepto)}">${esc(C.conceptoCorto(x.concepto))}</span>${C.conceptoCorto(x.concepto) !== String(x.concepto || '').trim() ? `<div class="meta">${esc(x.concepto)}</div>` : ''}</td><td class="n" data-et="Monto">${fmt(x.monto)}</td><td class="n" data-et="Pagado">${fmt(x.cobrado)}</td><td data-et="Vence">${fecha(x.vence)}</td><td data-et="Estado">${estadoChip(x.estatus)}</td></tr>`;
    const filaPago = p => {
      const concepto = String(p.concepto || '').trim();
      const mismo = p.cuenta_id && conceptoCuenta[p.cuenta_id] && conceptoCuenta[p.cuenta_id].trim() === concepto;
      const titulo = p.numero ? esc(p.numero) : esc(C.conceptoCorto(concepto) || 'Pago');
      return `<tr><td class="titulo">${titulo}${(!mismo && concepto && p.numero) ? `<div class="meta">${esc(C.conceptoCorto(concepto))}</div>` : ''}</td><td data-et="Fecha">${fecha(p.fecha)}</td><td data-et="Forma">${esc(p.metodo || '')}</td><td class="n" data-et="Monto">${fmt(p.monto)}</td></tr>`;
    };
    return tarjetaSiguientePago(false)
      + tarjetaEjecutadoPagado()
      + tarjetaCambios(true)
      + `<div class="card"><h2>Plan de pagos</h2>${avisoPlanHtml()}${c.plan.length ? `<div class="tbl tbl-cards"><table><thead><tr><th>Concepto</th><th class="n">Monto</th><th class="n">Pagado</th><th>Vence</th><th>Estado</th></tr></thead><tbody>${c.plan.map(filaPlan).join('')}</tbody></table></div>` : '<div class="vacio-caja"><strong>Todavía no hay un plan de pagos</strong>Cuando tu constructor lo registre vas a ver aquí cada exhibición con su fecha.</div>'}</div>`
      + `<div class="card"><h2>Pagos realizados <span class="meta">${c.pagos.length ? fmt(c.cobrado) + ' en total' : ''}</span></h2>${c.pagos.length ? `<div class="tbl tbl-cards"><table><thead><tr><th>Pago</th><th>Fecha</th><th>Forma</th><th class="n">Monto</th></tr></thead><tbody>${c.pagos.map(filaPago).join('')}</tbody></table></div>` : '<div class="vacio-caja">Aquí van a aparecer tus pagos conforme se registren.</div>'}</div>`
      + (c.cfdis.length ? `<div class="card"><h2>Facturas</h2><div class="tbl tbl-cards"><table><thead><tr><th>Folio</th><th>Fecha</th><th class="n">Total</th><th></th></tr></thead><tbody>${c.cfdis.map(x => `<tr><td class="titulo"><span class="et-movil">Factura </span>${esc((x.serie || '') + (x.folio || ''))}<div class="meta">${esc(x.uuid || '')}</div></td><td data-et="Fecha">${fecha(x.fecha)}</td><td class="n" data-et="Total">${fmt(x.total)}</td><td>${x.tiene_archivo ? `<button class="copy" onclick="archivo(${x.id},'pdf')">PDF</button> <button class="copy" onclick="archivo(${x.id},'xml')">XML</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>` : '');
  }

  function avisoPagoClic() { window.portalEvento('aviso_pago_clic', { obra_id: E.obraActual }); }

  Object.assign(V, { pagos: vistaPagos, tarjetaEjecutadoPagado, tarjetaSiguientePago, tarjetaCambios });
  Object.assign(window, { avisoPagoClic });   // onclick del botón de WhatsApp
})();
