/**
 * Expediente de la empresa (PRD licitaciones · US-806 esqueleto). Módulo de la barra `ex`, sólo nivel >= 80.
 *
 * Carga perezosa (D4): NO entra a load_all_data_seguro. Al abrirse, `cargar()` lee en paralelo (RLS: empresa de la
 * sesión y nivel >= 80) y deja en `D.exp` (propiedad NO enumerable de D: no se guarda en localStorage):
 *   { expediente: fila de public.empresa_expediente | null,
 *     documentos: public.empresa_documentos_estado (estado y días restantes calculados en el servidor),
 *     personal:   public.personal_tecnico, obras: public.obras_ejecutadas, maquinaria: public.maquinaria }
 * En el build sale como módulo diferido (js/expediente.<hash>.js en __LAZY['ex']).
 *
 * Depende de (navegador): sb, D, M, S, $, Skeleton, EmptyState, humanizeError, Toast.
 * Las funciones puras (categorías, estado de un documento, faltantes) se exportan con module.exports.
 */
const Expediente = (() => {
  'use strict';

  // ---- Catálogos ------------------------------------------------------------------------------------------------------
  /** Las 14 categorías de LicitaGen + padrón y declaración anual. vence: días sugeridos de vigencia (US-808). */
  const CATEGORIAS = [
    { k: 'opinion_sat', t: 'Opinión de cumplimiento SAT', vence: 30, ic: 'ri-government-line' },
    { k: 'opinion_imss', t: 'Opinión de cumplimiento IMSS', vence: 30, ic: 'ri-hospital-line' },
    { k: 'opinion_infonavit', t: 'Opinión de cumplimiento INFONAVIT', vence: 30, ic: 'ri-home-4-line' },
    { k: 'constancia_fiscal', t: 'Constancia de situación fiscal', vence: null, ic: 'ri-file-text-line' },
    { k: 'acta_constitutiva', t: 'Acta constitutiva', vence: null, ic: 'ri-book-3-line' },
    { k: 'poder', t: 'Poder del representante', vence: null, ic: 'ri-quill-pen-line' },
    { k: 'identificacion', t: 'Identificación del representante', vence: null, ic: 'ri-profile-line' },
    { k: 'comprobante_domicilio', t: 'Comprobante de domicilio', vence: 90, ic: 'ri-map-pin-line' },
    { k: 'estados_financieros', t: 'Estados financieros', vence: null, ic: 'ri-line-chart-line' },
    { k: 'declaracion_anual', t: 'Declaración anual', vence: null, ic: 'ri-calendar-check-line' },
    { k: 'padron_contratistas', t: 'Padrón de contratistas', vence: null, ic: 'ri-file-shield-2-line' },
    { k: 'cmic', t: 'Registro CMIC', vence: null, ic: 'ri-building-4-line' },
    { k: 'colegio', t: 'Registro en colegio', vence: null, ic: 'ri-graduation-cap-line' },
    { k: 'poliza_rc', t: 'Póliza de responsabilidad civil', vence: null, ic: 'ri-shield-check-line' },
    { k: 'curriculum', t: 'Currículum de la empresa', vence: null, ic: 'ri-file-user-line' },
    { k: 'otro', t: 'Otro', vence: null, ic: 'ri-file-line' },
  ];
  const ESTADOS = { vigente: 'Vigente', por_vencer: 'Por vencer', vencido: 'Vencido', reemplazado: 'Reemplazado', sin_vencimiento: 'Sin vencimiento' };
  /** Días antes del vencimiento a partir de los cuales un documento está «por vencer» (igual que la vista). */
  const DIAS_POR_VENCER = 30;

  // ---- Funciones puras ------------------------------------------------------------------------------------------------
  function hoyMx(d) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
  }
  const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  /**
   * Estado de un documento con la misma regla que public.empresa_documentos_estado (para recalcular en el cliente
   * sin volver a pedir datos): reemplazado si otra versión lo cita; si no, por fecha de vencimiento contra hoy.
   */
  function estadoDocumento(doc, hoy, reemplazado) {
    if (!doc) return null;
    if (reemplazado || doc.reemplazado_por_id) return { estado: 'reemplazado', dias: doc.fecha_vencimiento ? Math.round((utc(String(doc.fecha_vencimiento)) - utc(hoy || hoyMx())) / 86400000) : null };
    if (!doc.fecha_vencimiento) return { estado: 'sin_vencimiento', dias: null };
    const dias = Math.round((utc(String(doc.fecha_vencimiento)) - utc(hoy || hoyMx())) / 86400000);
    return { estado: dias < 0 ? 'vencido' : dias <= DIAS_POR_VENCER ? 'por_vencer' : 'vigente', dias };
  }
  /** Fecha de vencimiento sugerida para una categoría a partir de la emisión (null si la categoría no vence sola). */
  function vencimientoSugerido(categoria, emision) {
    const c = CATEGORIAS.find((x) => x.k === categoria);
    if (!c || !c.vence || !emision) return null;
    const d = new Date(utc(String(emision)) + c.vence * 86400000);
    return d.toISOString().slice(0, 10);
  }
  /** Categorías sin ningún documento usable (vigente, por vencer o sin vencimiento). «otro» nunca falta. */
  function faltantes(documentos) {
    const usables = new Set((documentos || []).filter((d) => ['vigente', 'por_vencer', 'sin_vencimiento'].includes(d.estado)).map((d) => d.categoria));
    return CATEGORIAS.filter((c) => c.k !== 'otro' && !usables.has(c.k)).map((c) => c.k);
  }
  /** Conteo por estado sin los reemplazados (son historial). */
  function resumen(documentos) {
    const r = { vigente: 0, por_vencer: 0, vencido: 0, sin_vencimiento: 0, total: 0 };
    for (const d of documentos || []) { if (d.estado === 'reemplazado') continue; r.total++; if (r[d.estado] !== undefined) r[d.estado]++; }
    return r;
  }
  const categoria = (k) => CATEGORIAS.find((c) => c.k === k) || { k, t: k, vence: null, ic: 'ri-file-line' };

  // ---- Datos (navegador) --------------------------------------------------------------------------------------------
  let enVuelo = null;
  let pintadas = 0;
  function guardarEnD(clave, valor) {
    Object.defineProperty(D, clave, { value: valor, writable: true, configurable: true, enumerable: false });
  }
  async function cargar(force) {
    if (!force && D.exp && Array.isArray(D.exp.documentos)) return D.exp;
    if (enVuelo && !force) return enVuelo;
    enVuelo = (async () => {
      const [ex, docs, per, obras, maq] = await Promise.all([
        sb.from('empresa_expediente').select('*').maybeSingle(),
        sb.from('empresa_documentos_estado').select('*').order('categoria').order('fecha_vencimiento', { ascending: false, nullsFirst: false }),
        sb.from('personal_tecnico').select('*').order('nombre'),
        sb.from('obras_ejecutadas').select('*').order('fecha_fin', { ascending: false, nullsFirst: false }),
        sb.from('maquinaria').select('*').order('descripcion'),
      ]);
      const err = [ex, docs, per, obras, maq].find((r) => r.error);
      if (err) throw err.error;
      guardarEnD('exp', { expediente: ex.data || null, documentos: docs.data || [], personal: per.data || [], obras: obras.data || [], maquinaria: maq.data || [] });
      return D.exp;
    })();
    try { return await enVuelo; } finally { enVuelo = null; }
  }

  // ---- Interfaz -------------------------------------------------------------------------------------------------------
  function cabecera() {
    return `<div class="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4"><div>
<h1 class="text-xl font-bold"><i class="ri-briefcase-4-line" aria-hidden="true"></i> Expediente de la empresa</h1>
<p class="text-sm text-ink-muted mt-1">Lo que se reutiliza en cada concurso: documentos con su vigencia, personal técnico, obras ejecutadas y maquinaria.</p></div></div>`;
  }
  function chipEstado(e, dias) {
    const tono = { vigente: 'ok', por_vencer: 'warn', vencido: 'danger' }[e];
    const estilo = tono ? `background:var(--${tono}-soft);color:var(--${tono})` : 'background:var(--surface-2);color:var(--ink-muted)';
    const extra = dias === null || dias === undefined || e === 'reemplazado' ? '' : dias < 0 ? ` · hace ${-dias} d` : ` · ${dias} d`;
    return `<span class="chip" style="${estilo}">${S(ESTADOS[e] || e)}${extra}</span>`;
  }
  function contenido(exp) {
    const docs = exp.documentos.filter((d) => d.estado !== 'reemplazado');
    const r = resumen(exp.documentos);
    const falta = faltantes(exp.documentos);
    const kpi = (t, v) => `<div class="kpi"><p class="kpi-v">${v}</p><p class="kpi-l">${t}</p></div>`;
    const filas = docs.map((d) => `<tr><td>${S(categoria(d.categoria).t)}</td><td>${S(d.nombre)}</td><td>${S(d.fecha_vencimiento || '—')}</td><td>${chipEstado(d.estado, d.dias_restantes)}</td></tr>`).join('');
    return `<div class="kpi-strip">${kpi('Vigentes', r.vigente + r.sin_vencimiento)}${kpi('Por vencer', r.por_vencer)}${kpi('Vencidos', r.vencido)}${kpi('Categorías faltantes', falta.length)}</div>
${docs.length ? `<div class="table-wrap g rounded-xl mb-4" tabindex="0" role="region" aria-label="Documentos de la empresa"><table class="table-modern w-full text-sm"><thead><tr><th scope="col">Categoría</th><th scope="col">Documento</th><th scope="col">Vence</th><th scope="col">Estado</th></tr></thead><tbody>${filas}</tbody></table></div>` : ''}
<p class="text-sm text-ink-muted">Personal técnico: ${exp.personal.length} · Obras ejecutadas: ${exp.obras.length} · Maquinaria: ${exp.maquinaria.length}</p>`;
  }
  const vacioTotal = (exp) => !exp.expediente && !exp.documentos.length && !exp.personal.length && !exp.obras.length && !exp.maquinaria.length;
  function vacio() {
    return EmptyState({
      icon: 'ri-briefcase-4-line', title: 'Tu expediente está vacío',
      body: 'Sube una sola vez la opinión del SAT, el acta, los poderes y los currículums con su vencimiento, y reutilízalos en cada concurso.',
      action: { label: 'Subir documento', icon: 'ri-upload-2-line', onClick: 'Expediente.nuevoDocumento()' },
    });
  }
  function errorHtml(e) {
    return EmptyState({
      icon: 'ri-error-warning-line', title: 'No se pudo cargar el expediente',
      body: humanizeError(e), action: { label: 'Reintentar', icon: 'ri-refresh-line', onClick: 'Expediente.recargar()' },
    });
  }
  async function render(c, force) {
    const turno = ++pintadas;
    c.innerHTML = cabecera() + `<div id="exCuerpo" aria-busy="true" aria-live="polite">${Skeleton.table(4, 4)}</div>`;
    const cuerpo = () => (turno === pintadas && M === 'ex' ? $('exCuerpo') : null);
    try {
      const exp = await cargar(force);
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      el.innerHTML = vacioTotal(exp) ? vacio() : contenido(exp);
    } catch (e) {
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      el.innerHTML = errorHtml(e);
    }
  }
  function recargar() { const c = $('c'); if (c) render(c, true); }
  /** Alta de documento (US-808). En el esqueleto sólo avisa. */
  function nuevoDocumento() { Toast.info('La subida de documentos al expediente se habilita en la siguiente entrega de este módulo.'); }

  return {
    render, cargar, recargar, nuevoDocumento,
    // puras
    hoyMx, estadoDocumento, vencimientoSugerido, faltantes, resumen, categoria,
    CATEGORIAS, ESTADOS, DIAS_POR_VENCER,
  };
})();
if (typeof module !== 'undefined') module.exports = Expediente;
