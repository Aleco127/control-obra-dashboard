/**
 * Expediente de la empresa (PRD licitaciones · épica B). Módulo de la barra `ex`, sólo nivel >= 80.
 *
 * Carga perezosa (D4): NO entra a load_all_data_seguro. Al abrirse, `cargar()` lee en paralelo (RLS: empresa de la
 * sesión y nivel >= 80) y deja en `D.exp` (propiedad NO enumerable de D: no se guarda en localStorage):
 *   { empresa:    fila de public.empresas (sólo lectura aquí: se edita en Configuración),
 *     expediente: fila de public.empresa_expediente | null,
 *     documentos: public.empresa_documentos_estado (estado y días restantes calculados en el servidor),
 *     personal:   public.personal_tecnico, obras: public.obras_ejecutadas, maquinaria: public.maquinaria }
 * En el build sale como módulo diferido (js/expediente.<hash>.js en __LAZY['ex']).
 *
 * Pestañas: Documentos (US-808) · Datos (US-807) · Personal (US-810) · Obras (US-811) · Maquinaria (US-812) ·
 * Portales (US-847).
 *
 * Depende de (navegador): sb, D, M, S, $, Skeleton, EmptyState, humanizeError, Toast, currentUser.
 * Las funciones puras se exportan con module.exports (pruebas en scripts/qa/expediente*.test.mjs).
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
  const TABS = [
    { k: 'documentos', t: 'Documentos', ic: 'ri-file-list-3-line' },
    { k: 'datos', t: 'Datos', ic: 'ri-building-line' },
  ];

  /** Campos editables de empresa_expediente (US-807). tipo: texto | area | fecha | monto. */
  const CAMPOS_DATOS = [
    { g: 'Representante legal', k: 'representante_cargo', t: 'Cargo del representante', tipo: 'texto', ph: 'Administrador único' },
    { g: 'Representante legal', k: 'representante_rfc', t: 'RFC del representante', tipo: 'texto', ph: 'XAXX010101000', max: 13 },
    { g: 'Constitución y poderes', k: 'escritura_constitutiva', t: 'Escritura constitutiva', tipo: 'area', ph: 'Número, notario, lugar y datos de inscripción' },
    { g: 'Constitución y poderes', k: 'escritura_fecha', t: 'Fecha de la escritura', tipo: 'fecha' },
    { g: 'Constitución y poderes', k: 'poder_notarial', t: 'Poder notarial del representante', tipo: 'area', ph: 'Número de escritura, notario y fecha' },
    { g: 'Capacidad financiera', k: 'capital_contable', t: 'Capital contable', tipo: 'monto' },
    { g: 'Capacidad financiera', k: 'capital_contable_fecha', t: 'Fecha del estado financiero', tipo: 'fecha' },
    { g: 'Registros', k: 'infonavit_registro', t: 'Registro INFONAVIT', tipo: 'texto' },
    { g: 'Registros', k: 'cmic_registro', t: 'Registro CMIC', tipo: 'texto' },
    { g: 'Registros', k: 'padron_contratistas', t: 'Padrón de contratistas', tipo: 'texto', ph: 'Número de registro' },
    { g: 'Registros', k: 'padron_contratistas_vigencia', t: 'Vigencia del padrón', tipo: 'fecha' },
    { g: 'Seguros y fianzas', k: 'poliza_rc_numero', t: 'Póliza de responsabilidad civil', tipo: 'texto', ph: 'Número de póliza' },
    { g: 'Seguros y fianzas', k: 'poliza_rc_aseguradora', t: 'Aseguradora', tipo: 'texto' },
    { g: 'Seguros y fianzas', k: 'poliza_rc_monto', t: 'Suma asegurada', tipo: 'monto' },
    { g: 'Seguros y fianzas', k: 'poliza_rc_vigencia', t: 'Vigencia de la póliza', tipo: 'fecha' },
    { g: 'Seguros y fianzas', k: 'afianzadora', t: 'Afianzadora', tipo: 'texto' },
    { g: 'Notas', k: 'notas', t: 'Notas', tipo: 'area' },
  ];

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

  /**
   * Del formulario de Datos al objeto que recibe guardar_empresa_expediente: sólo las llaves de CAMPOS_DATOS,
   * texto recortado ('' → null), RFC en mayúsculas, montos como número (acepta «$1,250,000.50»), fechas AAAA-MM-DD.
   * Lanza Error con un mensaje en español si un monto o una fecha no son válidos.
   */
  function datosParaGuardar(valores) {
    const out = {};
    for (const c of CAMPOS_DATOS) {
      if (!valores || !(c.k in valores)) continue;
      let v = valores[c.k] == null ? '' : String(valores[c.k]).trim();
      if (v === '') { out[c.k] = null; continue; }
      if (c.tipo === 'monto') {
        const n = Number(v.replace(/[$,\s]/g, ''));
        if (!Number.isFinite(n) || n < 0) throw new Error(`${c.t}: escribe un importe válido (sólo números).`);
        out[c.k] = Math.round(n * 100) / 100;
      } else if (c.tipo === 'fecha') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(utc(v))) throw new Error(`${c.t}: la fecha no es válida.`);
        out[c.k] = v;
      } else {
        if (c.k === 'representante_rfc') {
          v = v.toUpperCase().replace(/\s+/g, '');
          if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(v)) throw new Error('RFC del representante: revisa el formato (13 caracteres para persona física).');
        }
        out[c.k] = v;
      }
    }
    return out;
  }
  // -- Archivos (bucket privado `licitaciones`, ruta empresa/<id>/expediente/<carpeta>/<ts>_<nombre>) --
  /** Tipos que admite el bucket (085). El navegador da '' u octet-stream para .dwg: se manda el tipo por extensión. */
  const TIPOS_ARCHIVO = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dwg: 'image/vnd.dwg', zip: 'application/zip',
  };
  const ACCEPT = Object.keys(TIPOS_ARCHIVO).map((x) => '.' + x).join(',');
  const MAX_BYTES = 50 * 1024 * 1024;
  /** contentType a mandar al bucket, por extensión (manda sobre file.type); null si el tipo no se admite. */
  function tipoArchivo(nombre) {
    const ext = String(nombre || '').toLowerCase().split('.').pop();
    return TIPOS_ARCHIVO[ext] || null;
  }
  /** Valida tamaño y tipo. Devuelve null si está bien o el mensaje de error en español. */
  function validarArchivo(f) {
    if (!f) return 'Elige un archivo.';
    if (!tipoArchivo(f.name)) return `«${f.name}» no es de un tipo admitido (PDF, imagen, Word, Excel, DWG o ZIP).`;
    if (f.size > MAX_BYTES) return `«${f.name}» pesa ${(f.size / 1048576).toFixed(1)} MB y el máximo es 50 MB. Comprímelo o divídelo.`;
    if (f.size === 0) return `«${f.name}» está vacío.`;
    return null;
  }
  /** Nombre de archivo sin acentos ni caracteres raros (Storage no admite algunos), conservando la extensión. */
  function nombreSeguro(nombre) {
    const s = String(nombre || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[_.]+/, '');
    return (s || 'archivo').slice(-120);
  }
  /** Ruta del objeto en el bucket. carpeta = categoría del documento, o personal/obras/maquinaria. */
  function rutaArchivo(empresaId, carpeta, nombre, ts) {
    return `empresa/${empresaId}/expediente/${carpeta}/${ts || Date.now()}_${nombreSeguro(nombre)}`;
  }
  /** SHA-256 en hexadecimal (Web Crypto: navegador y Node 18+). */
  async function sha256Hex(buffer) {
    const h = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  /** Último segmento de una ruta sin el prefijo de tiempo: lo que ve el usuario. */
  function nombreDeRuta(path) {
    return String(path || '').split('/').pop().replace(/^\d{10,}_/, '');
  }

  // -- Documentos (US-808) --
  /** Documentos vigentes (no reemplazados) agrupados en el orden de CATEGORIAS; dentro, el que vence antes primero. */
  function agruparPorCategoria(documentos) {
    const vivos = (documentos || []).filter((d) => d.estado !== 'reemplazado');
    return CATEGORIAS.map((c) => ({
      cat: c,
      docs: vivos.filter((d) => d.categoria === c.k).sort((a, b) => String(a.fecha_vencimiento || '9999').localeCompare(String(b.fecha_vencimiento || '9999')) || b.id - a.id),
    })).filter((g) => g.docs.length);
  }
  /** Versiones de un documento de la más nueva a la más vieja (sigue reemplaza_id hacia atrás desde la vigente). */
  function cadenaVersiones(documentos, id) {
    const porId = new Map((documentos || []).map((d) => [d.id, d]));
    const porReemplaza = new Map((documentos || []).filter((d) => d.reemplaza_id).map((d) => [d.reemplaza_id, d]));
    let actual = porId.get(id); if (!actual) return [];
    while (porReemplaza.has(actual.id)) actual = porReemplaza.get(actual.id);   // subir a la versión más nueva
    const out = []; const vistos = new Set();
    while (actual && !vistos.has(actual.id)) { out.push(actual); vistos.add(actual.id); actual = actual.reemplaza_id ? porId.get(actual.reemplaza_id) : null; }
    return out;
  }
  /** Valida el formulario de un documento. Devuelve null o el mensaje de error. */
  function validarDocumento(v, conArchivo) {
    if (!v.categoria || !CATEGORIAS.some((c) => c.k === v.categoria)) return 'Elige la categoría.';
    if (!String(v.nombre || '').trim()) return 'Escribe el nombre del documento.';
    if (v.fecha_emision && v.fecha_vencimiento && v.fecha_vencimiento < v.fecha_emision) return 'El vencimiento no puede ser anterior a la emisión.';
    if (conArchivo) return validarArchivo(v.archivo);
    return null;
  }

  /** Domicilio en una línea a partir de la fila de empresas. */
  function domicilio(e) {
    if (!e) return '';
    const cp = e.codigo_postal ? 'C.P. ' + e.codigo_postal : '';
    return [e.direccion, e.ciudad, e.estado, cp].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
  }

  // ---- Datos (navegador) --------------------------------------------------------------------------------------------
  let enVuelo = null;
  let pintadas = 0;
  let tab = 'documentos';
  try { const t = localStorage.getItem('ex_tab'); if (t && TABS.some((x) => x.k === t)) tab = t; } catch (e) { /* sin almacenamiento */ }

  function guardarEnD(clave, valor) {
    Object.defineProperty(D, clave, { value: valor, writable: true, configurable: true, enumerable: false });
  }
  async function cargar(force) {
    if (!force && D.exp && Array.isArray(D.exp.documentos)) return D.exp;
    if (enVuelo && !force) return enVuelo;
    enVuelo = (async () => {
      const empId = (typeof currentUser !== 'undefined' && currentUser && currentUser.empresa_id) || null;
      const [emp, ex, docs, per, obras, maq] = await Promise.all([
        empId ? sb.from('empresas').select('id,nombre,razon_social,rfc,direccion,ciudad,estado,codigo_postal,representante_legal,registro_patronal').eq('id', empId).maybeSingle() : Promise.resolve({ data: null }),
        sb.from('empresa_expediente').select('*').maybeSingle(),
        sb.from('empresa_documentos_estado').select('*').order('categoria').order('fecha_vencimiento', { ascending: false, nullsFirst: false }),
        sb.from('personal_tecnico').select('*').order('nombre'),
        sb.from('obras_ejecutadas').select('*').order('fecha_fin', { ascending: false, nullsFirst: false }),
        sb.from('maquinaria').select('*').order('descripcion'),
      ]);
      const err = [emp, ex, docs, per, obras, maq].find((r) => r.error);
      if (err) throw err.error;
      guardarEnD('exp', { empresa: emp.data || null, expediente: ex.data || null, documentos: docs.data || [], personal: per.data || [], obras: obras.data || [], maquinaria: maq.data || [] });
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
  function conteoTab(exp, k) {
    if (k === 'documentos') return resumen(exp.documentos).total;
    return null;
  }
  function tabsHtml(exp) {
    return `<div class="tabs mb-4" role="tablist" aria-label="Secciones del expediente">${TABS.map((t) => {
      const n = conteoTab(exp, t.k);
      return `<button type="button" role="tab" id="exTab-${t.k}" aria-selected="${tab === t.k}" aria-controls="exPanel" class="tab ${tab === t.k ? 'active' : ''}" onclick="Expediente.setTab('${t.k}')"><i class="${t.ic}" aria-hidden="true"></i> ${t.t}${n === null ? '' : ` <span class="tab-n">${n}</span>`}</button>`;
    }).join('')}</div>`;
  }

  // -- Utilidades de interfaz: modales y archivos --
  const fechaCorta = (f) => (f ? new Date(String(f).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
  const empresaId = () => (typeof currentUser !== 'undefined' && currentUser && currentUser.empresa_id) || (D.exp && D.exp.empresa && D.exp.empresa.id) || null;
  /** Crea (o reemplaza) un modal inyectado en el body y lo abre. html = cuerpo completo (con su <form>). */
  function abrirModal(id, titulo, html, ancho) {
    let el = $(id);
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'modal'; document.body.appendChild(el); }
    el.innerHTML = `<div class="modal-content g rounded-2xl p-5 w-full ${ancho || 'max-w-lg'} mx-4 max-h-[92vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="${id}T">
<div class="flex items-center justify-between gap-2 mb-4"><h2 id="${id}T" class="text-lg font-bold">${titulo}</h2>
<button type="button" class="btn-icon" onclick="closeMdl('${id}')" aria-label="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></div>${html}</div>`;
    openMdl(id);
    setTimeout(() => { const f = el.querySelector('input:not([type=hidden]):not([disabled]),select,textarea'); if (f) f.focus(); }, 60);
    return el;
  }
  const lbl = (id, t, req) => `<label class="text-xs text-ink-muted mb-1 block" for="${id}">${t}${req ? ' <span aria-hidden="true">*</span>' : ''}</label>`;
  /** Sube un archivo al bucket y devuelve {path, tamano, mime, hash}. */
  async function subirArchivo(file, carpeta) {
    const err = validarArchivo(file); if (err) throw new Error(err);
    const emp = empresaId(); if (!emp) throw new Error('No se encontró la empresa de tu sesión.');
    const buf = await file.arrayBuffer();
    const hash = await sha256Hex(buf);
    const mime = tipoArchivo(file.name);
    const path = rutaArchivo(emp, carpeta, file.name);
    const { error } = await sb.storage.from('licitaciones').upload(path, new Blob([buf], { type: mime }), { contentType: mime, upsert: false });
    if (error) throw error;
    return { path, tamano: file.size, mime, hash };
  }
  async function borrarObjetos(paths) {
    const p = (paths || []).filter(Boolean); if (!p.length) return;
    try { await sb.storage.from('licitaciones').remove(p); } catch (e) { /* el objeto huérfano no bloquea la operación */ }
  }
  /** Abre (ver) o descarga un archivo del bucket con una URL firmada de 5 minutos. */
  async function abrirArchivo(path, descargar) {
    if (!path) return;
    try {
      const { data, error } = await sb.storage.from('licitaciones').createSignedUrl(path, 300, descargar ? { download: nombreDeRuta(path) } : undefined);
      if (error) throw error;
      if (descargar) { const a = document.createElement('a'); a.href = data.signedUrl; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }
      else window.open(data.signedUrl, '_blank', 'noopener');
    } catch (e) { Toast.error(humanizeError(e, 'No se pudo abrir el archivo')); }
  }
  /** Botones ver / descargar de una ruta (para tablas y listas). */
  function botonesArchivo(path, etiqueta) {
    if (!path) return '';
    const p = S(JSON.stringify(path));
    return `<button type="button" class="btn-icon" onclick="Expediente.abrirArchivo(${p})" aria-label="Ver ${S(etiqueta)}" title="Ver"><i class="ri-eye-line" aria-hidden="true"></i></button><button type="button" class="btn-icon" onclick="Expediente.abrirArchivo(${p},true)" aria-label="Descargar ${S(etiqueta)}" title="Descargar"><i class="ri-download-2-line" aria-hidden="true"></i></button>`;
  }

  // -- Documentos (US-808) --
  function filaDocumento(d, exp) {
    const versiones = cadenaVersiones(exp.documentos, d.id).length;
    const fechas = [d.fecha_emision ? 'Emitido ' + fechaCorta(d.fecha_emision) : '', d.fecha_vencimiento ? 'Vence ' + fechaCorta(d.fecha_vencimiento) : 'Sin vencimiento'].filter(Boolean).join(' · ');
    return `<li class="ex-doc flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
<div class="flex-1 min-w-[12rem]"><p class="font-medium break-words">${S(d.nombre)}</p><p class="text-xs text-ink-muted">${S(fechas)}${d.archivo_path ? ' · ' + S(nombreDeRuta(d.archivo_path)) : ''}</p></div>
${d.estado === 'sin_vencimiento' ? '' : chipEstado(d.estado, d.dias_restantes)}
<div class="flex items-center">${botonesArchivo(d.archivo_path, d.nombre)}
<button type="button" class="btn-icon" onclick="Expediente.renovarDocumento(${d.id})" aria-label="Renovar ${S(d.nombre)}" title="Renovar (subir la versión nueva)"><i class="ri-refresh-line" aria-hidden="true"></i></button>
${versiones > 1 ? `<button type="button" class="btn-icon" onclick="Expediente.historialDocumento(${d.id})" aria-label="Historial de ${S(d.nombre)} (${versiones} versiones)" title="Historial"><i class="ri-history-line" aria-hidden="true"></i></button>` : ''}
<button type="button" class="btn-icon" onclick="Expediente.editarDocumento(${d.id})" aria-label="Editar ${S(d.nombre)}" title="Editar"><i class="ri-pencil-line" aria-hidden="true"></i></button>
<button type="button" class="btn-icon" onclick="Expediente.eliminarDocumento(${d.id})" aria-label="Eliminar ${S(d.nombre)}" title="Eliminar"><i class="ri-delete-bin-line" aria-hidden="true"></i></button></div></li>`;
  }
  function panelDocumentos(exp) {
    const r = resumen(exp.documentos);
    const falta = faltantes(exp.documentos);
    const grupos = agruparPorCategoria(exp.documentos);
    const kpi = (t, v) => `<div class="kpi"><p class="kpi-v">${v}</p><p class="kpi-l">${t}</p></div>`;
    const barra = `<div class="flex flex-wrap items-center justify-between gap-2 mb-3"><p class="text-sm text-ink-muted">Sube cada documento una vez con su vencimiento; las licitaciones lo toman de aquí.</p>
<button type="button" class="btn btn-p" onclick="Expediente.nuevoDocumento()"><i class="ri-upload-2-line" aria-hidden="true"></i> Subir documento</button></div>`;
    const pendientes = falta.length ? `<section class="g rounded-xl p-4 mb-4" aria-labelledby="exPend"><h2 id="exPend" class="font-bold text-sm mb-1"><i class="ri-error-warning-line text-warn" aria-hidden="true"></i> Pendientes: ${falta.length} categoría${falta.length === 1 ? '' : 's'} sin documento vigente</h2>
<p class="text-xs text-ink-muted mb-2">Un concurso suele pedirlas en el sobre legal. Las vencidas también cuentan como pendientes.</p>
<ul class="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4">${falta.map((k) => { const c = categoria(k); return `<li><button type="button" class="w-full min-h-[44px] flex items-center gap-2 text-left text-sm text-accent hover:underline" onclick="Expediente.nuevoDocumento('${k}')"><i class="${c.ic}" aria-hidden="true"></i><span>Subir ${S(c.t)}</span></button></li>`; }).join('')}</ul></section>` : '';
    if (!grupos.length) return (vacioTotal(exp) ? vacio() : barra) + pendientes;
    return `<div class="kpi-strip">${kpi('Vigentes', r.vigente + r.sin_vencimiento)}${kpi('Por vencer', r.por_vencer)}${kpi('Vencidos', r.vencido)}${kpi('Categorías pendientes', falta.length)}</div>${barra}${pendientes}
${grupos.map((g) => `<section class="g rounded-xl px-4 py-2 mb-3" aria-labelledby="exCat-${g.cat.k}"><h2 id="exCat-${g.cat.k}" class="font-bold text-sm pt-2"><i class="${g.cat.ic}" aria-hidden="true"></i> ${S(g.cat.t)} <span class="text-ink-muted font-normal">${g.docs.length}</span></h2>
<ul class="divide-y divide-slate-100">${g.docs.map((d) => filaDocumento(d, exp)).join('')}</ul></section>`).join('')}`;
  }
  /** Modal mdlExpDoc. modo: nuevo | renovar | editar. */
  function modalDocumento(modo, base, catInicial) {
    const b = base || {};
    const cat = modo === 'nuevo' ? (catInicial || '') : b.categoria;
    const titulo = modo === 'renovar' ? 'Renovar documento' : modo === 'editar' ? 'Editar documento' : 'Subir documento';
    const conArchivo = modo !== 'editar';
    const sugerencia = (k) => { const c = CATEGORIAS.find((x) => x.k === k); return c && c.vence ? `Vence a los ${c.vence} días de emitido (se sugiere solo; puedes cambiarlo).` : 'Esta categoría no vence sola: deja el vencimiento vacío si no aplica.'; };
    const html = `<form id="exDocForm" onsubmit="Expediente.guardarDocumento(event)" novalidate class="space-y-3">
<input type="hidden" id="exDocModo" value="${modo}"><input type="hidden" id="exDocBase" value="${b.id || ''}">
${modo === 'renovar' ? `<p class="text-sm text-ink-muted">La versión actual («${S(b.nombre)}», ${b.fecha_vencimiento ? 'vence ' + S(fechaCorta(b.fecha_vencimiento)) : 'sin vencimiento'}) quedará como reemplazada y seguirá en el historial.</p>` : ''}
<div>${lbl('exDocCat', 'Categoría', true)}<select id="exDocCat" class="inp" required ${modo === 'nuevo' ? '' : 'disabled'} onchange="Expediente.sugerirVencimiento(true)">
<option value="">Elige una categoría</option>${CATEGORIAS.map((c) => `<option value="${c.k}" ${c.k === cat ? 'selected' : ''}>${S(c.t)}</option>`).join('')}</select>
<p id="exDocSug" class="text-xs text-ink-muted mt-1">${cat ? S(sugerencia(cat)) : ''}</p></div>
<div>${lbl('exDocNombre', 'Nombre', true)}<input type="text" id="exDocNombre" class="inp" required maxlength="200" value="${S(modo === 'nuevo' ? '' : b.nombre || '')}" placeholder="Ej.: Opinión SAT positiva octubre 2026"></div>
<div class="grid grid-cols-2 gap-3"><div>${lbl('exDocEmi', 'Emisión')}<input type="date" id="exDocEmi" class="inp" value="${modo === 'editar' ? S(b.fecha_emision || '') : modo === 'renovar' ? S(hoyMx()) : ''}" onchange="Expediente.sugerirVencimiento(false)"></div>
<div>${lbl('exDocVence', 'Vencimiento')}<input type="date" id="exDocVence" class="inp" value="${modo === 'editar' ? S(b.fecha_vencimiento || '') : modo === 'renovar' ? S(vencimientoSugerido(b.categoria, hoyMx()) || '') : ''}" data-auto="${modo === 'editar' ? '' : '1'}" oninput="this.dataset.auto=''"></div></div>
${conArchivo ? `<div>${lbl('exDocArchivo', 'Archivo', true)}<input type="file" id="exDocArchivo" class="inp" accept="${ACCEPT}" required>
<p class="text-xs text-ink-muted mt-1">PDF, imagen, Word, Excel o ZIP de hasta 50 MB. Se guarda con su huella SHA-256.</p></div>` : `<p class="text-xs text-ink-muted">Para cambiar el archivo usa «Renovar»: la versión anterior queda en el historial.</p>`}
<div>${lbl('exDocNotas', 'Notas')}<textarea id="exDocNotas" class="inp" rows="2">${S(modo === 'editar' ? b.notas || '' : '')}</textarea></div>
<div class="flex flex-wrap justify-end gap-2 pt-2"><button type="button" class="btn btn-s" onclick="closeMdl('mdlExpDoc')">Cancelar</button>
<button type="submit" class="btn btn-p" id="exDocGuardar"><i class="ri-save-line" aria-hidden="true"></i> ${modo === 'renovar' ? 'Subir versión nueva' : modo === 'editar' ? 'Guardar cambios' : 'Subir documento'}</button></div></form>`;
    abrirModal('mdlExpDoc', titulo, html);
    if (modo === 'nuevo' && cat) sugerirVencimiento(false);
  }
  /** Sugiere el vencimiento según la categoría y la emisión, sin pisar lo que el usuario escribió a mano. */
  function sugerirVencimiento(cambioCategoria) {
    const cat = $('exDocCat') && $('exDocCat').value; const emi = $('exDocEmi'); const ven = $('exDocVence');
    if (!cat || !ven) return;
    if (emi && !emi.value && cambioCategoria !== null) emi.value = hoyMx();
    const c = CATEGORIAS.find((x) => x.k === cat);
    const sug = $('exDocSug');
    if (sug) sug.textContent = c && c.vence ? `Vence a los ${c.vence} días de emitido (se sugiere solo; puedes cambiarlo).` : 'Esta categoría no vence sola: deja el vencimiento vacío si no aplica.';
    if (ven.dataset.auto === '1' || !ven.value) {
      const v = vencimientoSugerido(cat, emi && emi.value);
      if (v || ven.dataset.auto === '1') { ven.value = v || ''; ven.dataset.auto = '1'; }
    }
  }
  function nuevoDocumento(cat) { modalDocumento('nuevo', null, cat); }
  function docPorId(id) { return D.exp && D.exp.documentos.find((d) => d.id === id); }
  function renovarDocumento(id) { const d = docPorId(id); if (d) modalDocumento('renovar', d); }
  function editarDocumento(id) { const d = docPorId(id); if (d) modalDocumento('editar', d); }
  async function recargarDocumentos() {
    const { data, error } = await sb.from('empresa_documentos_estado').select('*').order('categoria').order('fecha_vencimiento', { ascending: false, nullsFirst: false });
    if (error) throw error;
    if (D.exp) D.exp.documentos = data || [];
    avisarCambio();
  }
  async function guardarDocumento(ev) {
    if (ev) ev.preventDefault();
    const modo = $('exDocModo').value; const baseId = +$('exDocBase').value || null;
    const base = baseId ? docPorId(baseId) : null;
    const f = $('exDocArchivo') && $('exDocArchivo').files[0];
    const v = { categoria: base ? base.categoria : $('exDocCat').value, nombre: $('exDocNombre').value.trim(), fecha_emision: $('exDocEmi').value || null, fecha_vencimiento: $('exDocVence').value || null, notas: $('exDocNotas').value.trim() || null, archivo: f };
    const err = validarDocumento(v, modo !== 'editar'); if (err) { Toast.error(err); return; }
    const btn = $('exDocGuardar'); btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    let subido = null;
    try {
      if (modo === 'editar') {
        const { error } = await sb.from('empresa_documentos').update({ nombre: v.nombre, fecha_emision: v.fecha_emision, fecha_vencimiento: v.fecha_vencimiento, notas: v.notas }).eq('id', baseId);
        if (error) throw error;
      } else {
        subido = await subirArchivo(f, v.categoria);
        const fila = { categoria: v.categoria, nombre: v.nombre, archivo_path: subido.path, tamano: subido.tamano, mime: subido.mime, hash_sha256: subido.hash, fecha_emision: v.fecha_emision, fecha_vencimiento: v.fecha_vencimiento, notas: v.notas, reemplaza_id: modo === 'renovar' ? baseId : null };
        const { error } = await sb.from('empresa_documentos').insert(fila);
        if (error) throw error;
        const igual = (D.exp.documentos || []).find((d) => d.hash_sha256 === subido.hash && d.id !== baseId);
        if (igual) Toast.warning(`Este archivo es idéntico a «${igual.nombre}», que ya estaba en el expediente.`);
      }
      await recargarDocumentos();
      closeMdl('mdlExpDoc');
      Toast.success(modo === 'renovar' ? 'Documento renovado; la versión anterior quedó en el historial' : modo === 'editar' ? 'Documento actualizado' : 'Documento subido al expediente');
      pintarPanel();
    } catch (e) {
      if (subido) await borrarObjetos([subido.path]);
      Toast.error(e && e.message && !e.code && !e.statusCode ? e.message : humanizeError(e, 'No se guardó el documento'));
    } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
  function historialDocumento(id) {
    const vers = cadenaVersiones(D.exp.documentos, id);
    if (!vers.length) return;
    const html = `<p class="text-sm text-ink-muted mb-3">${S(categoria(vers[0].categoria).t)} · ${vers.length} versiones, de la más nueva a la más vieja.</p>
<ol class="divide-y divide-slate-100">${vers.map((d, i) => `<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"><div class="flex-1 min-w-[10rem]"><p class="font-medium break-words">${i === 0 ? '' : '<span class="sr-only">Versión anterior: </span>'}${S(d.nombre)}</p>
<p class="text-xs text-ink-muted">Subido ${S(fechaCorta(d.created_at ? hoyMx(new Date(d.created_at)) : ''))}${d.fecha_vencimiento ? ' · vence ' + S(fechaCorta(d.fecha_vencimiento)) : ''}${d.hash_sha256 ? ' · SHA-256 ' + S(d.hash_sha256.slice(0, 12)) + '…' : ''}</p></div>
${chipEstado(d.estado, d.dias_restantes)}<div class="flex items-center">${botonesArchivo(d.archivo_path, d.nombre)}</div></li>`).join('')}</ol>
<div class="flex justify-end pt-3"><button type="button" class="btn btn-s" onclick="closeMdl('mdlExpHist')">Cerrar</button></div>`;
    abrirModal('mdlExpHist', 'Historial del documento', html);
  }
  async function eliminarDocumento(id) {
    const d = docPorId(id); if (!d) return;
    const ok = await Dialog.confirm({ title: 'Eliminar documento', body: `Se borrará «${d.nombre}» y su archivo. Las licitaciones que lo usaban se quedarán sin documento ligado.`, confirmText: 'Eliminar documento', tone: 'danger' });
    if (!ok) return;
    try {
      const { error } = await sb.from('empresa_documentos').delete().eq('id', id);
      if (error) throw error;
      await borrarObjetos([d.archivo_path]);
      await recargarDocumentos();
      Toast.success('Documento eliminado');
      pintarPanel();
    } catch (e) { Toast.error(humanizeError(e, 'No se eliminó el documento')); }
  }
  /** Aviso a la app de que cambió el expediente (contador de la barra y tarjeta de Inicio, US-809). */
  function avisarCambio() {
    if (typeof expAvisosCargar === 'function') expAvisosCargar();
  }

  // -- Datos legales (US-807) --
  function campoHtml(c, valor) {
    const id = 'exD-' + c.k;
    const v = valor == null ? '' : String(valor);
    const lab = `<label class="text-xs text-ink-muted mb-1 block" for="${id}">${S(c.t)}</label>`;
    if (c.tipo === 'area') return `<div class="sm:col-span-2">${lab}<textarea id="${id}" class="inp" rows="2" data-k="${c.k}" placeholder="${S(c.ph || '')}">${S(v)}</textarea></div>`;
    if (c.tipo === 'fecha') return `<div>${lab}<input type="date" id="${id}" class="inp" data-k="${c.k}" value="${S(v.slice(0, 10))}"></div>`;
    if (c.tipo === 'monto') return `<div>${lab}<input type="text" inputmode="decimal" id="${id}" class="inp" data-k="${c.k}" value="${S(v)}" placeholder="0.00"></div>`;
    return `<div>${lab}<input type="text" id="${id}" class="inp" data-k="${c.k}" value="${S(v)}" placeholder="${S(c.ph || '')}"${c.max ? ` maxlength="${c.max}"` : ''}></div>`;
  }
  function soloLectura(t, v) {
    return `<div><dt class="text-xs text-ink-muted">${S(t)}</dt><dd class="text-sm font-medium break-words">${v ? S(v) : '<span class="text-ink-subtle">Sin capturar</span>'}</dd></div>`;
  }
  function panelDatos(exp) {
    const e = exp.empresa || {};
    const x = exp.expediente || {};
    const grupos = [];
    for (const c of CAMPOS_DATOS) { let g = grupos.find((y) => y.g === c.g); if (!g) { g = { g: c.g, campos: [] }; grupos.push(g); } g.campos.push(c); }
    const actualizado = x.updated_at ? new Date(x.updated_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    return `<section class="g rounded-xl p-4 mb-4" aria-labelledby="exDatosEmp">
<div class="flex flex-wrap items-center justify-between gap-2 mb-3"><h2 id="exDatosEmp" class="font-bold text-sm"><i class="ri-building-line" aria-hidden="true"></i> Datos de la empresa</h2>
<button type="button" class="text-xs text-accent hover:underline" onclick="openEmpresaModal()">Editar en Configuración <i class="ri-arrow-right-s-line" aria-hidden="true"></i></button></div>
<dl class="grid sm:grid-cols-2 gap-3">${soloLectura('Razón social', e.razon_social || e.nombre)}${soloLectura('RFC', e.rfc)}${soloLectura('Domicilio fiscal', domicilio(e))}${soloLectura('Representante legal', e.representante_legal)}${soloLectura('Registro patronal IMSS', e.registro_patronal)}</dl>
<p class="text-xs text-ink-muted mt-3">Estos datos vienen de Configuración y se usan también en recibos y facturas. El registro patronal se captura en Contabilidad › Configuración del CFDI.</p></section>
<form id="exDatosForm" class="g rounded-xl p-4" onsubmit="Expediente.guardarDatos(event)" novalidate>
<h2 class="font-bold text-sm mb-3"><i class="ri-scales-3-line" aria-hidden="true"></i> Datos legales para concursos</h2>
${grupos.map((g) => `<fieldset class="mb-4"><legend class="text-xs font-semibold text-ink-muted uppercase mb-2">${S(g.g)}</legend><div class="grid sm:grid-cols-2 gap-3">${g.campos.map((c) => campoHtml(c, x[c.k])).join('')}</div></fieldset>`).join('')}
<div class="flex flex-wrap items-center gap-3"><button type="submit" class="btn btn-p" id="exDatosGuardar"><i class="ri-save-line" aria-hidden="true"></i> Guardar datos legales</button>
<span id="exDatosEstado" class="text-xs text-ink-muted" role="status">${actualizado ? 'Última actualización: ' + S(actualizado) : ''}</span></div></form>`;
  }
  async function guardarDatos(ev) {
    if (ev) ev.preventDefault();
    const form = $('exDatosForm'); if (!form) return;
    const valores = {};
    form.querySelectorAll('[data-k]').forEach((el) => { valores[el.dataset.k] = el.value; });
    let datos;
    try { datos = datosParaGuardar(valores); } catch (e) { Toast.error(e.message); return; }
    const btn = $('exDatosGuardar'); if (btn) btn.disabled = true;
    try {
      const { data, error } = await sb.rpc('guardar_empresa_expediente', { p_datos: datos });
      if (error) throw error;
      if (D.exp) D.exp.expediente = data;
      Toast.success('Datos legales guardados');
      pintarPanel();
    } catch (e) {
      Toast.error(humanizeError(e, 'No se guardaron los datos legales'));
    } finally { if (btn) btn.disabled = false; }
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
  function panelHtml(exp) {
    if (tab === 'datos') return panelDatos(exp);
    return panelDocumentos(exp);
  }
  /** Repinta pestañas y panel con D.exp sin volver a pedir datos. */
  function pintarPanel() {
    const el = $('exCuerpo'); if (!el || !D.exp || M !== 'ex') return;
    el.innerHTML = tabsHtml(D.exp) + `<div id="exPanel" role="tabpanel" aria-labelledby="exTab-${tab}">${panelHtml(D.exp)}</div>`;
  }
  function setTab(k) {
    if (!TABS.some((t) => t.k === k)) return;
    tab = k;
    try { localStorage.setItem('ex_tab', k); } catch (e) { /* sin almacenamiento */ }
    pintarPanel();
    const b = $('exTab-' + k); if (b) b.focus();
  }
  async function render(c, force) {
    const turno = ++pintadas;
    c.innerHTML = cabecera() + `<div id="exCuerpo" aria-busy="true" aria-live="polite">${Skeleton.table(4, 4)}</div>`;
    const cuerpo = () => (turno === pintadas && M === 'ex' ? $('exCuerpo') : null);
    try {
      await cargar(force);
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      pintarPanel();
    } catch (e) {
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      el.innerHTML = errorHtml(e);
    }
  }
  function recargar() { const c = $('c'); if (c) render(c, true); }

  return {
    render, cargar, recargar, setTab, guardarDatos, abrirArchivo,
    nuevoDocumento, renovarDocumento, editarDocumento, guardarDocumento, historialDocumento, eliminarDocumento, sugerirVencimiento,
    // puras
    hoyMx, estadoDocumento, vencimientoSugerido, faltantes, resumen, categoria, datosParaGuardar, domicilio, vacioTotal,
    tipoArchivo, validarArchivo, nombreSeguro, rutaArchivo, sha256Hex, nombreDeRuta, agruparPorCategoria, cadenaVersiones, validarDocumento,
    CATEGORIAS, ESTADOS, DIAS_POR_VENCER, CAMPOS_DATOS, TABS, TIPOS_ARCHIVO, MAX_BYTES,
  };
})();
if (typeof module !== 'undefined') module.exports = Expediente;
