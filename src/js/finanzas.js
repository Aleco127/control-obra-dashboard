/**
 * Finanzas (fase 2: US-113, US-121, US-122, US-123, US-127).
 * Una sola fuente para: flujo de efectivo, cuentas por pagar, resultado por obra, estado de resultados,
 * prorrateo de indirectos y base del reparto de utilidades. Funciones puras sobre un objeto `data`
 * con la misma forma que `D` (o, por defecto, la `D` global) para poder probarlas con node --test.
 *
 * Convenciones:
 *  - gastos.monto_neto = total (con IVA cuando lo hay); gastos.monto_pagado = lo pagado hasta hoy.
 *  - Sale dinero de la empresa: pagos a proveedores, gastos pagados sin pago explícito (no pagados por un socio),
 *    nómina pagada y retiros/utilidades pagadas a socios. Un gasto pagado por un socio NO sale de la caja de la
 *    empresa: es una aportación (deuda con el socio).
 *  - Entra dinero: cobros (pagos_recibidos) y aportaciones de socios en efectivo (movimientos sin gasto ligado).
 */
const Finanzas = (() => {
  const num = (v) => parseFloat(v) || 0;
  const r2 = (v) => Math.round(v * 100) / 100;
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const hoy = () => (typeof hoyISO === 'function' ? hoyISO() : iso(new Date()));
  const dataDefault = () => (typeof D !== 'undefined' ? D : {});
  const f10 = (f) => String(f || '').slice(0, 10);
  const enRango = (f, desde, hasta) => { f = f10(f); return !!f && (!desde || f >= desde) && (!hasta || f <= hasta); };
  const sumaDias = (fecha, n) => { const d = new Date(fecha + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };

  /** rango('mes'|'trim'|'anio'|'todo'|{desde,hasta}) → {desde, hasta, label} */
  function rango(periodo, ref) {
    const h = ref || hoy();
    const y = +h.slice(0, 4), m = +h.slice(5, 7);
    const pad = (n) => String(n).padStart(2, '0');
    const fin = (yy, mm) => iso(new Date(yy, mm, 0));
    if (periodo && typeof periodo === 'object') return { desde: periodo.desde || null, hasta: periodo.hasta || null, label: `${periodo.desde || '…'} a ${periodo.hasta || '…'}` };
    if (periodo === 'trim') { const q = Math.floor((m - 1) / 3); const m0 = q * 3 + 1; return { desde: `${y}-${pad(m0)}-01`, hasta: fin(y, m0 + 2), label: `${q + 1}° trimestre ${y}` }; }
    if (periodo === 'anio') return { desde: `${y}-01-01`, hasta: `${y}-12-31`, label: String(y) };
    if (periodo === 'todo') return { desde: null, hasta: null, label: 'Todo' };
    if (/^\d{4}-\d{2}$/.test(periodo || '')) { const yy = +periodo.slice(0, 4), mm = +periodo.slice(5, 7); return { desde: `${periodo}-01`, hasta: fin(yy, mm), label: new Date(yy, mm - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }) }; }
    return { desde: `${y}-${pad(m)}-01`, hasta: fin(y, m), label: new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }) };
  }

  function naturalezaDe(categoria, data) {
    const catg = (data || dataDefault()).catg || [];
    const n = String(categoria || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const c = catg.find(x => String(x.nombre || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim() === n);
    if (c) return c.naturaleza || 'directo';
    if (/personal/.test(n)) return 'personal';
    if (/multa|recargo/.test(n)) return 'no_deducible';
    if (/oficina|servicio|telefon|internet|publicidad|software|honorario|papeler|contab/.test(n)) return 'indirecto';
    return 'directo';
  }
  const destinoDe = (g) => g.destino || (g.obra_id ? 'obra' : 'indirecto');
  const gastoValido = (g) => g && g.estatus_pago !== 'Rechazado' && g.estatus_pago !== 'Cancelado';

  /** Cuentas por pagar derivadas de los gastos: saldo > 0, no rechazados, no de socios. */
  function cuentasPorPagar({ obraIds, data } = {}) {
    const d = data || dataDefault(); const h = hoy(); const en7 = sumaDias(h, 7);
    const provs = new Map((d.pv || []).map(p => [p.id, p]));
    return (d.g || []).filter(g => gastoValido(g) && destinoDe(g) !== 'socio' && !g.pagado_por_socio_id && (num(g.monto_neto) - num(g.monto_pagado)) > 0.005 && (!obraIds || obraIds.includes(g.obra_id)))
      .map(g => {
        const p = provs.get(g.proveedor_id);
        const vence = g.fecha_vencimiento || sumaDias(f10(g.fecha_solicitud) || h, p && p.dias_credito != null ? num(p.dias_credito) || 30 : 30);
        const saldo = r2(num(g.monto_neto) - num(g.monto_pagado));
        return { gasto: g, saldo, vence, bucket: vence < h ? 'vencida' : vence <= en7 ? 'semana' : 'por_vencer', proveedor: p || null, aprobado: !!g.aprobado_at };
      }).sort((a, b) => a.vence.localeCompare(b.vence));
  }

  function agingPagar(rows) {
    const out = { vencida: { n: 0, monto: 0 }, semana: { n: 0, monto: 0 }, por_vencer: { n: 0, monto: 0 }, total: 0 };
    rows.forEach(r => { out[r.bucket].n++; out[r.bucket].monto = r2(out[r.bucket].monto + r.saldo); out.total = r2(out.total + r.saldo); });
    return out;
  }

  /** Flujo de efectivo real en un rango. obraIds limita a obras (entonces se excluyen indirectos, nómina y socios). */
  function calcularFlujo({ desde, hasta, obraIds, data } = {}) {
    const d = data || dataDefault(); const h = hoy();
    const obraOk = (id) => !obraIds || obraIds.includes(id);
    const cobros = (d.prc || []).filter(p => obraOk(p.obra_id) && enRango(p.fecha_pago, desde, hasta));
    const cobrado = r2(cobros.reduce((s, p) => s + num(p.monto), 0));
    const pagos = (d.ppv || []).filter(p => obraOk(p.obra_id) && enRango(p.fecha_pago, desde, hasta));
    const pagosProv = r2(pagos.reduce((s, p) => s + num(p.monto), 0));
    const conPago = new Set((d.ppv || []).map(p => p.gasto_id).filter(Boolean));
    const gastosPag = (d.g || []).filter(g => gastoValido(g) && obraOk(g.obra_id) && num(g.monto_pagado) > 0 && !conPago.has(g.id) && !g.pagado_por_socio_id && enRango(g.fecha_solicitud, desde, hasta));
    const gastosPagados = r2(gastosPag.reduce((s, g) => s + Math.min(num(g.monto_pagado), num(g.monto_neto)), 0));
    const porSocios = r2((d.g || []).filter(g => gastoValido(g) && obraOk(g.obra_id) && g.pagado_por_socio_id && enRango(g.fecha_solicitud, desde, hasta)).reduce((s, g) => s + num(g.monto_neto), 0));
    const nomina = obraIds ? 0 : r2((d.nom || []).filter(n => /pagad/i.test(String(n.estatus || '')) && enRango(n.fecha_pago || n.periodo_fin, desde, hasta)).reduce((s, n) => s + num(n.total_pagar || n.nomina_total), 0));
    const retiros = obraIds ? 0 : r2((d.msoc || []).filter(m => ['retiro', 'utilidad_pagada'].includes(m.tipo) && enRango(m.fecha, desde, hasta)).reduce((s, m) => s + num(m.monto), 0));
    const aportaciones = obraIds ? 0 : r2((d.msoc || []).filter(m => m.tipo === 'aportacion' && !m.gasto_id && enRango(m.fecha, desde, hasta)).reduce((s, m) => s + num(m.monto), 0));
    const pagado = r2(pagosProv + gastosPagados + nomina + retiros);
    const cxc = (d.cxc || []).filter(c => obraOk(c.obra_id) && num(c.monto_pendiente) > 0.005);
    const porCobrar = r2(cxc.reduce((s, c) => s + num(c.monto_pendiente), 0));
    const vencidoCobrar = r2(cxc.filter(c => c.fecha_vencimiento && f10(c.fecha_vencimiento) < h).reduce((s, c) => s + num(c.monto_pendiente), 0));
    const cxp = cuentasPorPagar({ obraIds, data: d });
    const porPagar = r2(cxp.reduce((s, x) => s + x.saldo, 0));
    const vencidoPagar = r2(cxp.filter(x => x.bucket === 'vencida').reduce((s, x) => s + x.saldo, 0));
    const en30 = sumaDias(h, 30);
    const cxc30 = r2(cxc.filter(c => !c.fecha_vencimiento || f10(c.fecha_vencimiento) <= en30).reduce((s, c) => s + num(c.monto_pendiente), 0));
    const cxp30 = r2(cxp.filter(x => x.vence <= en30).reduce((s, x) => s + x.saldo, 0));
    return { desde, hasta, cobrado, pagado, pagosProv, gastosPagados, nomina, retiros, aportaciones, porSocios, neto: r2(cobrado + aportaciones - pagado), porCobrar, vencidoCobrar, porPagar, vencidoPagar, proximos30: { cobrar: cxc30, pagar: cxp30, neto: r2(cxc30 - cxp30) }, nCobros: cobros.length, nPagos: pagos.length + gastosPag.length };
  }

  /** Serie por semana (lunes a domingo) de cobrado vs pagado para la gráfica de flujo. */
  function serieSemanal({ desde, hasta, obraIds, data } = {}) {
    const d = data || dataDefault();
    const h = hoy(); desde = desde || sumaDias(h, -84); hasta = hasta || h;
    const start = new Date(desde + 'T12:00:00'); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const weeks = []; let cur = iso(start);
    while (cur <= hasta) { const fin = sumaDias(cur, 6); weeks.push({ ws: cur, we: fin, label: cur.slice(5).replace('-', '/'), cobrado: 0, pagado: 0 }); cur = sumaDias(cur, 7); }
    const idx = (f) => weeks.findIndex(w => f10(f) >= w.ws && f10(f) <= w.we);
    const obraOk = (id) => !obraIds || obraIds.includes(id);
    (d.prc || []).forEach(p => { if (!obraOk(p.obra_id)) return; const i = idx(p.fecha_pago); if (i >= 0) weeks[i].cobrado += num(p.monto); });
    const conPago = new Set((d.ppv || []).map(p => p.gasto_id).filter(Boolean));
    (d.ppv || []).forEach(p => { if (!obraOk(p.obra_id)) return; const i = idx(p.fecha_pago); if (i >= 0) weeks[i].pagado += num(p.monto); });
    (d.g || []).forEach(g => { if (!gastoValido(g) || !obraOk(g.obra_id) || conPago.has(g.id) || g.pagado_por_socio_id || !(num(g.monto_pagado) > 0)) return; const i = idx(g.fecha_solicitud); if (i >= 0) weeks[i].pagado += Math.min(num(g.monto_pagado), num(g.monto_neto)); });
    if (!obraIds) {
      (d.nom || []).forEach(n => { if (!/pagad/i.test(String(n.estatus || ''))) return; const i = idx(n.fecha_pago || n.periodo_fin); if (i >= 0) weeks[i].pagado += num(n.total_pagar || n.nomina_total); });
      (d.msoc || []).forEach(m => { if (!['retiro', 'utilidad_pagada'].includes(m.tipo)) return; const i = idx(m.fecha); if (i >= 0) weeks[i].pagado += num(m.monto); });
    }
    weeks.forEach(w => { w.cobrado = r2(w.cobrado); w.pagado = r2(w.pagado); });
    return weeks;
  }

  /** Resultado por obra a una fecha: contrato, cobrado, costos, indirectos, utilidad y margen. */
  function resultadoObra(obraId, { hasta, data } = {}) {
    const d = data || dataDefault();
    const obra = (d.o || []).find(o => o.id == obraId); if (!obra) return null;
    const h = hasta || hoy();
    const contrato = num(obra.subtotal) || (num(obra.presupuesto_total) / (1 + (num(obra.porcentaje_iva) || 16) / 100));
    const cobros = (d.prc || []).filter(p => p.obra_id == obraId && f10(p.fecha_pago) <= h);
    const cobrado = r2(cobros.reduce((s, p) => s + num(p.monto), 0));
    const cxc = (d.cxc || []).filter(c => c.obra_id == obraId);
    const porCobrar = r2(cxc.reduce((s, c) => s + num(c.monto_pendiente), 0));
    const vencido = r2(cxc.filter(c => num(c.monto_pendiente) > 0.005 && c.fecha_vencimiento && f10(c.fecha_vencimiento) < h).reduce((s, c) => s + num(c.monto_pendiente), 0));
    const gastos = (d.g || []).filter(g => gastoValido(g) && destinoDe(g) === 'obra' && g.obra_id == obraId && f10(g.fecha_solicitud) <= h);
    const porCategoria = {}; let directo = 0, noDeducible = 0;
    gastos.forEach(g => { const nat = naturalezaDe(g.categoria, d); const k = g.categoria || 'Sin categoría'; porCategoria[k] = r2((porCategoria[k] || 0) + num(g.monto_neto)); if (nat === 'no_deducible') noDeducible += num(g.monto_neto); directo += num(g.monto_neto); });
    directo = r2(directo);
    const manoObraNomina = r2((d.nomd || []).filter(x => x.obra_id == obraId).reduce((s, x) => s + num(x.monto), 0));
    const indirectos = r2((d.gad || []).filter(x => x.obra_id == obraId).reduce((s, x) => s + num(x.monto_asignado), 0));
    const costoTotal = r2(directo + manoObraNomina + indirectos);
    let avance = num(obra.avance_porcentaje), avanceFuente = avance > 0 ? 'obra' : 'ninguna';
    try { if (typeof curvaSData === 'function' && !data) { const c = curvaSData(obraId); if (c && !c.sinPrograma && c.realHoy != null && num(c.realHoy) > 0) { avance = num(c.realHoy); avanceFuente = 'programa'; } } } catch (e) { }
    if (avanceFuente === 'ninguna' && contrato > 0 && cobrado > 0) { avance = Math.min(100, cobrado / contrato * 100); avanceFuente = 'cobranza'; }
    if (/complet|terminad|finaliz/i.test(String(obra.estatus || ''))) { avance = 100; avanceFuente = 'cerrada'; }
    avance = r2(Math.max(0, Math.min(100, avance)));
    const ingresoDevengado = r2(contrato * avance / 100);
    const cot = (d.cot || []).find(c => c.obra_id == obraId);
    let margenCotizado = 15;
    try { const dg = cot && (cot.desglose || cot.desglose_json || (typeof cot.notas_json === 'string' ? JSON.parse(cot.notas_json) : null)); if (dg && dg.pctUtilidad != null) margenCotizado = num(dg.pctUtilidad); } catch (e) { }
    const pagadoEmpresa = r2(gastos.filter(g => !g.pagado_por_socio_id).reduce((s, g) => s + Math.min(num(g.monto_pagado), num(g.monto_neto)), 0) + manoObraNomina);
    const utilidadCaja = r2(cobrado - costoTotal);
    const utilidadDevengada = r2(ingresoDevengado - costoTotal);
    const utilidadProyectada = r2(contrato - costoTotal);
    const margenDevengado = ingresoDevengado > 0 ? r2(utilidadDevengada / ingresoDevengado * 100) : null;
    const margenProyectado = contrato > 0 ? r2(utilidadProyectada / contrato * 100) : null;
    const consumo = contrato > 0 ? r2(costoTotal / contrato * 100) : null;
    let semaforo = 'ok', causa = '';
    const mRef = margenDevengado != null ? margenDevengado : margenProyectado;
    if (mRef == null) { semaforo = 'na'; causa = 'Sin contrato o sin avance registrado.'; }
    else if (mRef < 0) { semaforo = 'danger'; causa = `Costo al ${consumo} % del contrato con ${avance} % de avance.`; }
    else if (mRef < margenCotizado - 2) { semaforo = 'warn'; causa = `Margen ${mRef} % contra ${margenCotizado} % cotizado.`; }
    else causa = `Margen ${mRef} % (cotizado ${margenCotizado} %).`;
    if (avanceFuente === 'cobranza') causa += ' Avance estimado por lo cobrado: registra el avance real en Programa.';
    if (semaforo !== 'danger' && vencido > 0) causa += ` Cobranza vencida: ${vencido.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}.`;
    return { obra, contrato: r2(contrato), cobrado, porCobrar, vencido, avance, avanceFuente, ingresoDevengado, directo, porCategoria, manoObraNomina, indirectos, costoTotal, noDeducible: r2(noDeducible), pagadoEmpresa, caja: r2(cobrado - pagadoEmpresa), utilidadCaja, utilidadDevengada, utilidadProyectada, margenDevengado, margenProyectado, margenCotizado, consumo, semaforo, causa, nGastos: gastos.length };
  }

  /** Estado de resultados del periodo: por obra + indirectos + retiros. base: 'caja' (cobrado) o 'devengado' (contrato × avance del periodo). */
  function estadoResultados({ desde, hasta, base = 'caja', obraIds, data } = {}) {
    const d = data || dataDefault();
    const obras = (d.o || []).filter(o => o.estatus !== 'Archivada' && (!obraIds || obraIds.includes(o.id)));
    const filas = obras.map(o => {
      const cobros = (d.prc || []).filter(p => p.obra_id === o.id && enRango(p.fecha_pago, desde, hasta));
      const gastos = (d.g || []).filter(g => gastoValido(g) && destinoDe(g) === 'obra' && g.obra_id === o.id && enRango(g.fecha_solicitud, desde, hasta));
      const nomina = (d.nomd || []).filter(x => x.obra_id === o.id && enRango(x.fecha, desde, hasta));
      const ind = (d.gad || []).filter(x => x.obra_id === o.id).filter(x => { const g = (d.g || []).find(y => y.id === x.gasto_id); return g && enRango(g.fecha_solicitud, desde, hasta); });
      const contrato = num(o.subtotal) || num(o.presupuesto_total) / 1.16;
      let ingreso = r2(cobros.reduce((s, p) => s + num(p.monto), 0));
      if (base === 'devengado') { const r = resultadoObra(o.id, { data: d, hasta }); ingreso = r ? r.ingresoDevengado : ingreso; }
      const directo = r2(gastos.reduce((s, g) => s + num(g.monto_neto), 0) + nomina.reduce((s, x) => s + num(x.monto), 0));
      const indirectos = r2(ind.reduce((s, x) => s + num(x.monto_asignado), 0));
      return { obra: o, contrato: r2(contrato), ingreso, directo, indirectos, utilidad: r2(ingreso - directo - indirectos), n: gastos.length + cobros.length };
    }).filter(f => f.ingreso || f.directo || f.indirectos);
    const indTot = (d.g || []).filter(g => gastoValido(g) && destinoDe(g) === 'indirecto' && enRango(g.fecha_solicitud, desde, hasta));
    const indirectosTotal = r2(indTot.reduce((s, g) => s + num(g.monto_neto), 0));
    const indirectosAsignados = r2(filas.reduce((s, f) => s + f.indirectos, 0));
    const personales = r2((d.g || []).filter(g => gastoValido(g) && destinoDe(g) === 'socio' && enRango(g.fecha_solicitud, desde, hasta)).reduce((s, g) => s + num(g.monto_neto), 0));
    const retiros = r2((d.msoc || []).filter(m => ['retiro', 'utilidad_pagada'].includes(m.tipo) && enRango(m.fecha, desde, hasta)).reduce((s, m) => s + num(m.monto), 0));
    const nominaNoAsignada = r2((d.nom || []).filter(n => enRango(n.fecha_pago || n.periodo_fin, desde, hasta)).reduce((s, n) => s + num(n.total_pagar || n.nomina_total), 0) - (d.nomd || []).filter(x => enRango(x.fecha, desde, hasta)).reduce((s, x) => s + num(x.monto), 0));
    const ingresos = r2(filas.reduce((s, f) => s + f.ingreso, 0));
    const directos = r2(filas.reduce((s, f) => s + f.directo, 0));
    const utilidadBruta = r2(ingresos - directos);
    const utilidadNeta = r2(utilidadBruta - indirectosTotal - Math.max(0, nominaNoAsignada));
    return { desde, hasta, base, filas: filas.sort((a, b) => a.utilidad - b.utilidad), ingresos, directos, utilidadBruta, indirectosTotal, indirectosAsignados, indirectosSinAsignar: r2(indirectosTotal - indirectosAsignados), nominaNoAsignada: r2(Math.max(0, nominaNoAsignada)), utilidadNeta, margenNeto: ingresos > 0 ? r2(utilidadNeta / ingresos * 100) : null, personales, retiros, disponible: r2(utilidadNeta - personales - retiros) };
  }

  /**
   * Prorrateo de indirectos. regla: {tipo:'iguales'|'contrato'|'directo'|'fijo', fijos:{[obraId]:pct}}
   * Devuelve [{gasto_id, obra_id, porcentaje, monto_asignado}] para los gastos indirectos del rango (sin tocar los "fijados").
   */
  function prorratear({ desde, hasta, regla, data, gastos } = {}) {
    const d = data || dataDefault();
    regla = regla || { tipo: 'iguales' };
    const activas = (d.o || []).filter(o => ['Activa', 'En Proceso', 'En proceso'].includes(o.estatus));
    const lista = gastos || (d.g || []).filter(g => gastoValido(g) && destinoDe(g) === 'indirecto' && enRango(g.fecha_solicitud, desde, hasta));
    const out = [];
    lista.forEach(g => {
      const f = f10(g.fecha_solicitud);
      let obras = activas.filter(o => (!o.fecha_inicio || f10(o.fecha_inicio) <= f) && (!o.fecha_fin_estimada || f10(o.fecha_fin_estimada) >= sumaDias(f, -30)));
      if (!obras.length) obras = activas;
      if (!obras.length) return;
      let pesos;
      if (regla.tipo === 'fijo' && regla.fijos) { pesos = obras.map(o => num(regla.fijos[o.id])); if (!pesos.some(p => p > 0)) pesos = obras.map(() => 1); }
      else if (regla.tipo === 'contrato') pesos = obras.map(o => num(o.subtotal) || num(o.presupuesto_total) || 1);
      else if (regla.tipo === 'directo') { const m = f.slice(0, 7); pesos = obras.map(o => (d.g || []).filter(x => gastoValido(x) && destinoDe(x) === 'obra' && x.obra_id === o.id && f10(x.fecha_solicitud).slice(0, 7) === m).reduce((s, x) => s + num(x.monto_neto), 0) || 0); if (!pesos.some(p => p > 0)) pesos = obras.map(() => 1); }
      else pesos = obras.map(() => 1);
      const tot = pesos.reduce((s, p) => s + p, 0);
      let acumPct = 0, acumMonto = 0;
      obras.forEach((o, i) => {
        const last = i === obras.length - 1;
        const pct = last ? r2(100 - acumPct) : r2(pesos[i] / tot * 100);
        const monto = last ? r2(num(g.monto_neto) - acumMonto) : r2(num(g.monto_neto) * pct / 100);
        acumPct = r2(acumPct + pct); acumMonto = r2(acumMonto + monto);
        if (pct > 0) out.push({ gasto_id: g.id, obra_id: o.id, porcentaje: pct, monto_asignado: monto });
      });
    });
    return out;
  }

  /** Base del reparto: utilidad disponible del periodo (o de una obra) menos reservas, por socio con retiros a cuenta. */
  function baseReparto({ desde, hasta, obraId, reservas = { impuestos: 30, capital: 10 }, base = 'caja', data } = {}) {
    const d = data || dataDefault();
    let utilidad;
    if (obraId) { const r = resultadoObra(obraId, { data: d, hasta }); utilidad = r ? r.utilidadCaja : 0; }
    else { const er = estadoResultados({ desde, hasta, base, data: d }); utilidad = er.utilidadNeta; }
    const resImp = r2(Math.max(0, utilidad) * num(reservas.impuestos) / 100);
    const resCap = r2(Math.max(0, utilidad) * num(reservas.capital) / 100);
    const distribuible = r2(utilidad - resImp - resCap);
    const socios = (d.soc || []).filter(s => s.activo !== false);
    const pctTot = socios.reduce((s, x) => s + num(x.porcentaje), 0);
    const filas = socios.map(s => {
      const pct = pctTot > 0 ? num(s.porcentaje) : (socios.length ? 100 / socios.length : 0);
      const movs = (d.msoc || []).filter(m => m.socio_id === s.id && enRango(m.fecha, desde, hasta));
      const aCuenta = r2(movs.filter(m => ['retiro', 'gasto_personal', 'utilidad_pagada'].includes(m.tipo)).reduce((x, m) => x + num(m.monto), 0));
      const aportado = r2(movs.filter(m => m.tipo === 'aportacion').reduce((x, m) => x + num(m.monto), 0));
      const asignado = r2(distribuible * pct / 100);
      return { socio: s, porcentaje: r2(pct), asignado, aCuenta, aportado, aPagar: r2(asignado - aCuenta + aportado) };
    });
    return { utilidad: r2(utilidad), reservas: { impuestos: resImp, capital: resCap, pctImpuestos: num(reservas.impuestos), pctCapital: num(reservas.capital) }, distribuible, filas, pctTotal: r2(pctTot), sinPorcentajes: pctTot <= 0 };
  }

  return { rango, enRango, naturalezaDe, cuentasPorPagar, agingPagar, calcularFlujo, serieSemanal, resultadoObra, estadoResultados, prorratear, baseReparto, num, r2, sumaDias };
})();
if (typeof module !== 'undefined') module.exports = Finanzas;
