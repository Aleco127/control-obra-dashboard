/**
 * PortalEstado (US-701A, PRD portal v2 US-752): lo que el portal sabe de la visita (entrada, cuenta, obra abierta) y
 * todo lo que se deriva del payload. El payload de portal_datos se pide UNA vez por obra y se guarda aquí; cambiar
 * de sección no vuelve a la red. Las reglas numéricas (contrato vigente, programado a la fecha, estados, grupos)
 * viven en PortalCalc (calculos.js) y aquí sólo se aplican.
 */
(function () {
  'use strict';
  const C = window.PortalCalc;
  const SECCIONES = ['inicio', 'avance', 'diario', 'pagos', 'entregables', 'fotos', 'contacto'];
  const SEC_TITULO = { inicio: 'Inicio', avance: 'Avance', diario: 'Diario', pagos: 'Pagos', entregables: 'Entregables', fotos: 'Fotos', contacto: 'Contacto' };

  const E = {
    SECCIONES, SEC_TITULO,
    token: new URLSearchParams(location.search).get('t') || '',   // enlace privado de la obra (sólo lectura)
    sesion: localStorage.getItem('portal_sesion') || '',          // sesión de cuenta
    usuario: null, obras: [], obraActual: null,
    datos: null,      // respuesta de portal_datos de la obra abierta
    ctx: null,        // todo lo derivado (totales, agrupaciones) calculado una sola vez
    seccion: 'inicio',
    // Secciones cuyo aviso ya se vio en esta sesión (el servidor ya movió ultimo_visto_at al pedir los datos)
    novedadesVistas: new Set(),
  };

  E.seccionDeHash = function () {
    const h = String(location.hash || '').replace(/^#/, '').split('?')[0];
    return SECCIONES.includes(h) ? h : 'inicio';
  };

  // La constructora no se nombra como responsable en cada renglón: sólo se muestra cuando es otro (Cliente, municipio…)
  function responsableAjeno(nombre, empresa) {
    const r = String(nombre || '').trim();
    if (!r) return '';
    const e = String(empresa || '').trim().toLowerCase();
    if (e && r.toLowerCase().includes(e.split(' ')[0])) return '';
    return r;
  }

  // Prepara todo lo que las vistas necesitan (se recalcula sólo al cambiar de obra)
  E.prepararCtx = function (d) {
    const o = d.obra, e = d.empresa;
    const plan = d.plan_pagos || [], pagos = d.pagos || [], acts = d.actividades || [];
    const fotos = d.fotos || [], ests = d.estimaciones || [], cfdis = d.cfdis || [], docs = d.documentos || [];
    const cambios = d.cambios || [], bitacora = d.bitacora || [];
    const hoy = C.hoyISO();
    const cobrado = pagos.reduce((a, p) => a + Number(p.monto || 0), 0);
    // Contrato vigente = original + extras − deductivas (D2). El servidor ya lo manda; si no viniera se calcula igual.
    const contratoOriginal = Number(o.contrato_original != null ? o.contrato_original : o.contrato || 0);
    const resCambios = C.resumenCambios(cambios);
    const contrato = o.contrato != null && o.contrato_original != null ? Number(o.contrato) : C.contratoVigente(contratoOriginal, cambios);
    const saldo = Math.max(0, contrato - cobrado);
    const planTotal = plan.reduce((a, x) => a + Number(x.monto || 0), 0);
    const planDesfasado = plan.length > 0 && Math.abs(planTotal - contrato) > 1;
    const proximo = plan.find(x => !/cobrad/i.test(x.estatus || '') && Number(x.monto) - Number(x.cobrado || 0) > 0.5);
    // Entregables agrupados por el hito del programa al que pertenecen; la llave 0 es lo que no tiene entrega asignada.
    const porHito = {};
    const cubo = k => (porHito[k] = porHito[k] || { docs: [], fotos: [] });
    docs.forEach(x => cubo(x.actividad_id || 0).docs.push(x));
    fotos.forEach(f => { if (f.actividad_id) cubo(f.actividad_id).fotos.push(f); });
    const gruposHito = acts.filter(a => porHito[a.id]);
    // Entregables = lo que tiene documentos (más las entregas del programa aunque sólo traigan fotos).
    // Las fotos de un concepto cualquiera se agrupan aparte, en la galería.
    const gruposEnt = gruposHito.filter(a => porHito[a.id].docs.length || a.hito);
    const gruposFoto = gruposHito.filter(a => porHito[a.id].fotos.length);
    // Carpetas (6-nov-2026): los documentos se ordenan por carpeta; los que no tienen van al final en «Otros documentos».
    const actPorId = {};
    acts.forEach(a => { actPorId[a.id] = a; });
    const porCarpeta = {};
    docs.forEach(x => { const k = String(x.carpeta || '').trim(); (porCarpeta[k] = porCarpeta[k] || []).push(x); });
    const carpetas = docs.some(x => x.carpeta) ? Object.keys(porCarpeta).filter(Boolean).sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).map(k => ({ nombre: k, docs: porCarpeta[k] })) : [];
    if (carpetas.length && porCarpeta['']) carpetas.push({ nombre: 'Otros documentos', docs: porCarpeta[''] });
    // Avance real ponderado (peso = costo, migración 065). Si el avance de la obra se fijó a mano, manda ese.
    const tareas = acts.filter(a => !a.hito), pesoTot = tareas.reduce((s, a) => s + Number(a.peso || 0), 0);
    let real = pesoTot > 0 ? C.realPonderado(acts) : Number(o.avance || 0);
    if (o.avance_manual || Math.abs(real - Number(o.avance || 0)) > 1) real = Number(o.avance || 0);
    const ejecutado = Math.round(contrato * real) / 100;
    // Programado a la fecha y desviación (D4)
    const hayPrograma = pesoTot > 0;
    const planeado = hayPrograma ? C.planeadoALaFecha(acts, hoy) : 0;
    const desviacion = hayPrograma ? C.desviacionDias(acts, real, hoy) : 0;
    const entrega = C.entregaVigente(o, cambios, hoy, real);
    const frase = C.fraseAvance({ real, hayPrograma, dias: desviacion });
    // Grupos por partida (sin hitos: van en su propia lista) y estado por actividad (D5)
    const hitos = acts.filter(a => a.hito);
    const grupos = C.agruparPorPartida(tareas, hoy);
    const estado = {};
    acts.forEach(a => { estado[a.id] = C.estadoActividad(a, hoy); });
    const atrasadas = tareas.filter(a => estado[a.id] === 'atrasada');
    const enCurso = tareas.filter(a => estado[a.id] === 'en_curso');
    const estaSemana = tareas.filter(a => C.enSemana(a, hoy) && estado[a.id] !== 'terminada');
    const sigHito = hitos.find(a => estado[a.id] === 'pendiente');
    // Diario: fotos del día = fotos visibles con la misma fecha que la entrada
    const fotosPorFecha = {};
    fotos.forEach(f => { const k = String(f.fecha || '').slice(0, 10); (fotosPorFecha[k] = fotosPorFecha[k] || []).push(f); });
    const diario = bitacora.map(b => Object.assign({}, b, { fotos: fotosPorFecha[String(b.fecha || '').slice(0, 10)] || [] }));
    // «Actualizado el …»: la fecha más reciente que dejó huella en la obra
    const fechas = [].concat(fotos.map(f => f.creada), docs.map(x => x.creado), pagos.map(p => p.fecha), bitacora.map(b => b.actualizada || b.creada), cambios.map(c => c.fecha_aprobacion || c.fecha), acts.map(a => a.fin_real)).filter(Boolean).map(String);
    const actualizado = fechas.length ? fechas.sort().pop().slice(0, 10) : null;
    const dp = e.datos_pago || {};
    const wa = e.telefono ? ('https://wa.me/' + String(e.telefono).replace(/\D/g, '').replace(/^(\d{10})$/, '52$1') + '?text=' + encodeURIComponent('Hola, tengo una duda sobre la obra ' + o.nombre)) : '';
    return {
      o, e, plan, pagos, acts, fotos, ests, cfdis, docs, cambios, bitacora, cobrado, contrato, contratoOriginal, resCambios,
      extras: resCambios.extras, deductivas: resCambios.deductivas, saldo, ejecutado, hoy, proximo, planTotal, planDesfasado,
      porHito, gruposHito, gruposEnt, gruposFoto, carpetas, actPorId, sueltos: porHito[0], fotosSueltas: fotos.filter(f => !f.actividad_id),
      hayFotosEnGrupos: gruposFoto.length > 0, dp, wa,
      avance: Math.round(real), real, planeado, desviacion, hayPrograma, entrega, frase,
      hitos, grupos, estado, atrasadas, enCurso, estaSemana, sigHito, tareas, diario, actualizado,
      responsable: (a) => responsableAjeno(a && a.responsable, e.nombre),
    };
  };

  E.novedades = function () { return (E.datos && E.datos.novedades) || {}; };
  // Con enlace de token el servidor manda las novedades en cero (no hay visita anterior que comparar), pero el pago
  // vencido no depende de la visita: sale del plan de pagos, así que se cuenta aquí (US-622).
  E.pagosVencidos = function () {
    const n = Number(E.novedades().pagos_vencidos);
    if (n > 0) return n;
    if (!E.ctx) return 0;
    return E.ctx.plan.filter(x => x.vence && x.vence < E.ctx.hoy && Number(x.monto) - Number(x.cobrado || 0) > 0.5).length;
  };
  // ¿Este elemento llegó después de la última visita? (created_at del payload contra ultimo_visto_at)
  E.esNuevo = function (x) {
    const visto = E.novedades().ultimo_visto_at;
    const cuando = x && (x.actualizada || x.creada || x.creado || x.created_at);
    if (!visto || !cuando) return false;
    return String(cuando) > String(visto);
  };

  window.PortalEstado = E;
})();
