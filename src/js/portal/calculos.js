/**
 * PortalCalc (PRD portal v2, US-752): las reglas puras del portal del cliente, sin DOM ni red.
 *  - D2 contrato vigente = original + extras − deductivas (deductivas en valor absoluto).
 *  - D3 entrega vigente = nueva_fecha_fin más tardía de los cambios o la fecha fin de la obra; «vencida» si ya pasó
 *       y la obra no está al 100 %.
 *  - D4 programado a la fecha = Σ peso × fracción de días transcurridos de cada actividad (sin hitos); desviación en
 *       días = cuántos días antes (atraso) o después (adelanto) el programado iguala al real de hoy.
 *  - D5 estado de cada actividad: terminada, atrasada, en_curso, proxima (hitos: cumplido / pendiente).
 * Se carga antes de estado.js; en Node se prueba con scripts/qa/portal-calculos.test.mjs.
 * Las fechas son cadenas 'AAAA-MM-DD' y se comparan como texto; «hoy» siempre llega como parámetro.
 */
(function (root) {
  'use strict';
  const DIA = 86400000;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const utc = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  function hoyISO(d) {
    const x = d || new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }
  function sumarDias(fecha, n) { return iso(utc(fecha) + n * DIA); }
  function diasEntre(a, b) { return Math.round((utc(b) - utc(a)) / DIA); }
  const esFecha = (v) => /^\d{4}-\d{2}-\d{2}/.test(String(v || ''));

  const tareas = (acts) => (acts || []).filter((a) => a && !a.hito);
  const pesoTotal = (acts) => tareas(acts).reduce((s, a) => s + num(a.peso), 0);

  // Fracción programada de una actividad al día «hoy»: 0 antes de empezar, 1 al terminar, lineal entre ambas
  // (la duración cuenta los dos extremos, como duracion_dias en la base).
  function fraccionPlaneada(a, hoy) {
    if (!a || !esFecha(a.inicio)) return 0;
    const inicio = String(a.inicio).slice(0, 10), fin = esFecha(a.fin) ? String(a.fin).slice(0, 10) : inicio;
    if (hoy < inicio) return 0;
    if (hoy >= fin) return 1;
    const dur = diasEntre(inicio, fin) + 1, transc = diasEntre(inicio, hoy) + 1;
    return Math.min(1, Math.max(0, transc / dur));
  }
  // Programado a la fecha, en porcentaje con un decimal. Sin pesos (obra sin programa) → 0.
  function planeadoALaFecha(acts, hoy) {
    const t = tareas(acts), tot = pesoTotal(t);
    if (!(tot > 0)) return 0;
    return Math.round(t.reduce((s, a) => s + num(a.peso) * fraccionPlaneada(a, hoy), 0) / tot * 1000) / 10;
  }
  // Real ponderado, misma regla que pgAvanceReal() en la app: Σ peso × min(100, avance) / Σ peso.
  function realPonderado(acts) {
    const t = tareas(acts), tot = pesoTotal(t);
    if (!(tot > 0)) return 0;
    return Math.round(t.reduce((s, a) => s + num(a.peso) * Math.min(100, Math.max(0, num(a.avance))), 0) / tot * 10) / 10;
  }
  // Desviación en días: positivo = atraso (el programado alcanzó el real hace N días), negativo = adelanto
  // (el programado alcanzará el real dentro de N días), 0 = al día. Tope de 730 días.
  function desviacionDias(acts, real, hoy) {
    const t = tareas(acts);
    if (!(pesoTotal(t) > 0)) return 0;
    const r = Math.min(100, Math.max(0, num(real)));
    const planHoy = planeadoALaFecha(t, hoy);
    if (Math.abs(r - planHoy) < 0.05) return 0;
    if (r > planHoy) {
      if (r >= 100) return 0;
      for (let d = 1; d <= 730; d++) if (planeadoALaFecha(t, sumarDias(hoy, d)) >= r) return -d;
      return -730;
    }
    for (let d = 1; d <= 730; d++) if (planeadoALaFecha(t, sumarDias(hoy, -d)) <= r) return d;
    return 730;
  }

  const ESTADOS = { terminada: 'Terminada', atrasada: 'Atrasada', en_curso: 'En curso', proxima: 'Próxima', cumplido: 'Cumplido', pendiente: 'Pendiente' };
  function estadoActividad(a, hoy) {
    const av = num(a && a.avance);
    if (a && a.hito) return av >= 100 ? 'cumplido' : 'pendiente';
    if (av >= 100) return 'terminada';
    if (a && esFecha(a.fin) && String(a.fin).slice(0, 10) < hoy) return 'atrasada';
    if (av > 0 || (a && esFecha(a.inicio) && String(a.inicio).slice(0, 10) <= hoy)) return 'en_curso';
    return 'proxima';
  }
  // Semana en curso (lunes a domingo) que contiene a «hoy»
  function semanaDe(hoy) {
    const dow = (new Date(utc(hoy)).getUTCDay() + 6) % 7;   // 0 = lunes
    const lun = sumarDias(hoy, -dow);
    return { inicio: lun, fin: sumarDias(lun, 6) };
  }
  function enSemana(a, hoy) {
    if (!a || !esFecha(a.inicio)) return false;
    const s = semanaDe(hoy), ini = String(a.inicio).slice(0, 10), fin = esFecha(a.fin) ? String(a.fin).slice(0, 10) : ini;
    return ini <= s.fin && fin >= s.inicio;
  }

  // Grupos por partida en orden de primera fecha de inicio; «Sin partida» siempre al final.
  function agruparPorPartida(acts, hoy) {
    const mapa = new Map();
    (acts || []).forEach((a) => {
      const k = (a && a.partida && String(a.partida).trim()) || '';
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(a);
    });
    const grupos = [];
    mapa.forEach((lista, k) => {
      const t = tareas(lista), tot = pesoTotal(t);
      const estados = lista.map((a) => estadoActividad(a, hoy));
      grupos.push({
        partida: k || 'Sin partida', sinPartida: !k, acts: lista, peso: tot,
        real: tot > 0 ? Math.round(t.reduce((s, a) => s + num(a.peso) * Math.min(100, Math.max(0, num(a.avance))), 0) / tot * 10) / 10
          : (lista.length ? Math.round(lista.reduce((s, a) => s + Math.min(100, num(a.avance)), 0) / lista.length) : 0),
        total: t.length, terminadas: estados.filter((e) => e === 'terminada').length,
        atrasadas: estados.filter((e) => e === 'atrasada').length, enCurso: estados.filter((e) => e === 'en_curso').length,
        inicio: lista.reduce((m, a) => (esFecha(a.inicio) && (!m || a.inicio < m)) ? String(a.inicio).slice(0, 10) : m, ''),
        fin: lista.reduce((m, a) => { const f = esFecha(a.fin) ? String(a.fin).slice(0, 10) : (esFecha(a.inicio) ? String(a.inicio).slice(0, 10) : ''); return (f && (!m || f > m)) ? f : m; }, ''),
      });
    });
    const total = pesoTotal(acts);
    grupos.forEach((g) => { g.pesoPct = total > 0 ? Math.round(g.peso / total * 1000) / 10 : 0; });
    return grupos.sort((x, y) => (x.sinPartida - y.sinPartida) || (x.inicio < y.inicio ? -1 : x.inicio > y.inicio ? 1 : 0));
  }

  // Gantt del portal (6-nov-2026): rango del programa redondeado a meses completos (incluye «hoy»), columnas de
  // meses y posición de cada barra en % del ancho. Sin fechas → null (no se pinta).
  const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const finDeMes = (f) => { const [y, m] = String(f).slice(0, 7).split('-').map(Number); return iso(Date.UTC(y, m, 0)); };
  function ganttModelo(acts, hoy) {
    const lista = (acts || []).filter((a) => a && esFecha(a.inicio));
    if (!lista.length) return null;
    let min = '', max = '';
    lista.forEach((a) => {
      const i = String(a.inicio).slice(0, 10), f = esFecha(a.fin) && String(a.fin).slice(0, 10) > i ? String(a.fin).slice(0, 10) : i;
      if (!min || i < min) min = i;
      if (!max || f > max) max = f;
    });
    if (esFecha(hoy)) { if (hoy < min) min = hoy; if (hoy > max) max = hoy; }
    const ini = min.slice(0, 8) + '01', fin = finDeMes(max), dias = diasEntre(ini, fin) + 1;
    const meses = [];
    for (let c = ini; c <= fin; c = sumarDias(finDeMes(c), 1)) {
      const d = diasEntre(c, finDeMes(c)) + 1;
      meses.push({ et: MESES_CORTO[Number(c.slice(5, 7)) - 1] + ' ' + c.slice(0, 4), dias: d, pct: d / dias * 100 });
    }
    const pos = (i, f) => {
      const a = esFecha(i) ? String(i).slice(0, 10) : ini, b = esFecha(f) && String(f).slice(0, 10) > a ? String(f).slice(0, 10) : a;
      return { left: Math.round(diasEntre(ini, a) / dias * 10000) / 100, width: Math.round((diasEntre(a, b) + 1) / dias * 10000) / 100 };
    };
    const hoyPct = esFecha(hoy) && hoy >= ini && hoy <= fin ? Math.round((diasEntre(ini, hoy) + 0.5) / dias * 10000) / 100 : null;
    return { ini, fin, dias, meses, hoyPct, pos };
  }

  // Cambios al contrato (obra_modificaciones vigentes). «monto» ya llega en valor absoluto desde el servidor,
  // pero se vuelve a tomar abs() por si alguien pasa la fila cruda.
  const TIPO_CAMBIO = { Adicional: 'Extra', Deductiva: 'Deductiva', 'Cambio de Alcance': 'Alcance', 'Cambio de Especificaciones': 'Especificaciones', 'Extension de Tiempo': 'Tiempo', 'Extensión de Tiempo': 'Tiempo' };
  function resumenCambios(cambios) {
    const lista = cambios || [];
    const extras = lista.filter((c) => c.tipo === 'Adicional').reduce((s, c) => s + Math.abs(num(c.monto)), 0);
    const deductivas = lista.filter((c) => c.tipo === 'Deductiva').reduce((s, c) => s + Math.abs(num(c.monto)), 0);
    const dias = lista.reduce((s, c) => s + num(c.dias), 0);
    const entrega = lista.reduce((m, c) => (esFecha(c.nueva_fecha_fin) && (!m || c.nueva_fecha_fin > m)) ? String(c.nueva_fecha_fin).slice(0, 10) : m, '');
    return { n: lista.length, extras: Math.round(extras * 100) / 100, deductivas: Math.round(deductivas * 100) / 100, neto: Math.round((extras - deductivas) * 100) / 100, dias, entrega: entrega || null };
  }
  function contratoVigente(original, cambios) {
    const r = resumenCambios(cambios);
    return Math.round((num(original) + r.extras - r.deductivas) * 100) / 100;
  }
  function entregaVigente(obra, cambios, hoy, avance) {
    const o = obra || {};
    const r = resumenCambios(cambios);
    const fecha = (esFecha(o.fecha_entrega_vigente) && String(o.fecha_entrega_vigente).slice(0, 10)) || r.entrega || (esFecha(o.fecha_fin) && String(o.fecha_fin).slice(0, 10)) || null;
    const terminada = num(avance) >= 100 || /termin|entregad|cerrad/i.test(String(o.estatus || ''));
    return { fecha, vencida: !!(fecha && fecha < hoy && !terminada), reprogramada: !!(r.entrega && esFecha(o.fecha_fin) && r.entrega !== String(o.fecha_fin).slice(0, 10)) };
  }

  // Concepto corto para plan de pagos y pagos: corta en « — », « (» o «:» y limita el largo.
  function conceptoCorto(texto, max) {
    const t = String(texto || '').trim(), lim = max || 64;
    if (!t) return '';
    const corte = t.search(/\s[—–-]\s|\s\(|:\s/);
    let c = corte > 8 ? t.slice(0, corte) : t;
    c = c.trim();
    if (c.length > lim) c = c.slice(0, lim - 1).trim() + '…';
    return c;
  }

  const plural = (n, s, p) => n + ' ' + (n === 1 ? s : p);
  // Frase de D4 para Inicio y Avance
  function fraseAvance(x) {
    const real = num(x && x.real), hayPrograma = !!(x && x.hayPrograma);
    if (real >= 100) return 'La obra está terminada.';
    if (!hayPrograma) return 'Tu constructor aún no comparte el programa de trabajo.';
    const dias = num(x.dias);
    if (dias > 0) return 'Vas ' + plural(dias, 'día', 'días') + ' atrasado respecto al programa.';
    if (dias < 0) return 'Vas ' + plural(-dias, 'día', 'días') + ' adelantado respecto al programa.';
    return 'Vas al día con el programa.';
  }

  /* ---------- Calendario del diario (7-nov-2026) ---------- */
  const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function mesDe(fecha) { const f = esFecha(fecha) ? String(fecha).slice(0, 10) : hoyISO(); return { anio: Number(f.slice(0, 4)), mes: Number(f.slice(5, 7)) }; }
  // Lo que el programa tenía para un día: tareas cuyo rango cubre la fecha y hitos que caen ese día (fin real si ya se cumplió)
  function actividadesDelDia(acts, fecha) {
    const f = String(fecha).slice(0, 10), tareasDia = [], hitos = [];
    (acts || []).forEach((a) => {
      if (!a || !esFecha(a.inicio)) return;
      if (a.hito) { const h = String(a.fin_real || a.fin || a.inicio).slice(0, 10); if (h === f) hitos.push(a); return; }
      const ini = String(a.inicio).slice(0, 10), fin = esFecha(a.fin) && String(a.fin).slice(0, 10) > ini ? String(a.fin).slice(0, 10) : ini;
      if (ini <= f && f <= fin) tareasDia.push(a);
    });
    return { tareas: tareasDia, hitos };
  }
  // Rejilla del mes (semanas de lunes a domingo, con los días de relleno de los meses vecinos) con lo que pasó y lo
  // programado en cada día. mes va de 1 a 12. x = { diario, acts, hoy }.
  function calendarioMes(anio, mes, x) {
    const ini = anio + '-' + String(mes).padStart(2, '0') + '-01', fin = finDeMes(ini);
    const desde = sumarDias(ini, -((new Date(utc(ini)).getUTCDay() + 6) % 7));
    const nSemanas = Math.ceil((diasEntre(desde, fin) + 1) / 7);
    const diarioPor = {};
    ((x && x.diario) || []).forEach((b) => { const k = String(b.fecha || '').slice(0, 10); (diarioPor[k] = diarioPor[k] || []).push(b); });
    const hoy = (x && x.hoy) || hoyISO();
    const semanas = [];
    for (let s = 0; s < nSemanas; s++) {
      const fila = [];
      for (let d = 0; d < 7; d++) {
        const f = sumarDias(desde, s * 7 + d), p = actividadesDelDia(x && x.acts, f);
        fila.push({ fecha: f, dia: Number(f.slice(8, 10)), enMes: f >= ini && f <= fin, hoy: f === hoy, futuro: f > hoy, entradas: diarioPor[f] || [], tareas: p.tareas, hitos: p.hitos });
      }
      semanas.push(fila);
    }
    return { anio, mes, ini, fin, nombreMes: MESES_LARGO[mes - 1], titulo: MESES_LARGO[mes - 1] + ' ' + anio, semanas };
  }

  const PortalCalc = { hoyISO, sumarDias, diasEntre, mesDe, actividadesDelDia, calendarioMes, fraccionPlaneada, planeadoALaFecha, realPonderado, desviacionDias, estadoActividad, ESTADOS, semanaDe, enSemana, agruparPorPartida, ganttModelo, resumenCambios, contratoVigente, entregaVigente, conceptoCorto, fraseAvance, TIPO_CAMBIO };
  root.PortalCalc = PortalCalc;
  if (typeof module !== 'undefined') module.exports = PortalCalc;
})(typeof window !== 'undefined' ? window : globalThis);
