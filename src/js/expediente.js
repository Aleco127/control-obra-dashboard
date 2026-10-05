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
    { k: 'personal', t: 'Personal técnico', ic: 'ri-team-line' },
    { k: 'obras', t: 'Obras ejecutadas', ic: 'ri-building-2-line' },
    { k: 'maquinaria', t: 'Maquinaria', ic: 'ri-truck-line' },
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

  // -- Personal técnico (US-810) --
  /** Empleados que aún no están en el personal técnico (por empleado_id), activos primero y por nombre. */
  function empleadosDisponibles(empleados, personal) {
    const ligados = new Set((personal || []).map((p) => p.empleado_id).filter(Boolean));
    const activo = (e) => !e.estatus || /^activ/i.test(String(e.estatus));
    return (empleados || []).filter((e) => !ligados.has(e.id))
      .sort((a, b) => (activo(b) - activo(a)) || String(a.nombre_completo || '').localeCompare(String(b.nombre_completo || ''), 'es'));
  }
  /** Fila nueva de personal_tecnico a partir de un empleado (liga empleado_id y copia nombre y puesto). */
  function personaDesdeEmpleado(e) {
    return { empleado_id: e.id, nombre: String(e.nombre_completo || '').trim(), puesto: e.puesto ? String(e.puesto).trim() : null, activo: true };
  }
  /** Personal activo primero y luego por nombre. */
  function ordenarPersonal(personal) {
    return [...(personal || [])].sort((a, b) => (b.activo - a.activo) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  }

  // -- Obras ejecutadas (US-811) --
  const MODALIDADES = { licitacion_publica: 'Licitación pública', invitacion: 'Invitación a cuando menos tres', adjudicacion_directa: 'Adjudicación directa', privada: 'Privada' };
  const ESTATUS_TERMINADA = /^(completada|terminada|concluida|finalizada|entregada|archivada)$/i;
  /**
   * Obras del panel que se pueden traer al currículum: no ligadas todavía, sin las de ejemplo ni las canceladas.
   * Por defecto sólo las terminadas (estatus Completada/Terminada/Archivada o avance >= 100); con incluirEnProceso, todas.
   */
  function obrasParaCurriculum(obras, ejecutadas, incluirEnProceso) {
    const ligadas = new Set((ejecutadas || []).map((x) => x.obra_id).filter(Boolean));
    return (obras || []).filter((o) => !ligadas.has(o.id) && !o.es_ejemplo && !/^cancelad/i.test(String(o.estatus || '')))
      .filter((o) => incluirEnProceso || ESTATUS_TERMINADA.test(String(o.estatus || '')) || Number(o.avance_porcentaje) >= 100)
      .sort((a, b) => String(b.fecha_fin_estimada || b.fecha_inicio || '').localeCompare(String(a.fecha_fin_estimada || a.fecha_inicio || '')));
  }
  const obraTerminada = (o) => ESTATUS_TERMINADA.test(String(o.estatus || '')) || Number(o.avance_porcentaje) >= 100;
  /** Fila de obras_ejecutadas a partir de una obra del panel: cliente, monto (con IVA) y fechas ya llenos, obra_id ligado. */
  function obraEjecutadaDesdeObra(o, clientes) {
    const cli = (clientes || []).find((c) => c.id === o.cliente_id);
    const monto = Number(o.presupuesto_total);
    return {
      obra_id: o.id, nombre: String(o.nombre_obra || o.codigo_obra || 'Obra').trim(),
      cliente: (cli && (cli.razon_social || cli.nombre)) || (o.cliente ? String(o.cliente).trim() : null),
      monto: Number.isFinite(monto) && monto > 0 ? Math.round(monto * 100) / 100 : null,
      fecha_inicio: o.fecha_inicio ? String(o.fecha_inicio).slice(0, 10) : null,
      fecha_fin: o.fecha_fin_estimada ? String(o.fecha_fin_estimada).slice(0, 10) : null,
      ubicacion: o.ubicacion || null, descripcion: o.descripcion || null,
    };
  }
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  /** Periodo legible «mar 2025 a oct 2025» (o sólo una punta si falta la otra). */
  function periodo(ini, fin) {
    const f = (x) => (x ? MESES[+String(x).slice(5, 7) - 1] + ' ' + String(x).slice(0, 4) : '');
    if (ini && fin) return `${f(ini)} a ${f(fin)}`;
    if (ini) return `desde ${f(ini)}`;
    if (fin) return `hasta ${f(fin)}`;
    return '';
  }
  /** Renglones del currículum para Excel (la más reciente primero). */
  function filasCurriculum(ejecutadas) {
    return [...(ejecutadas || [])]
      .sort((a, b) => String(b.fecha_fin || b.fecha_inicio || '').localeCompare(String(a.fecha_fin || a.fecha_inicio || '')))
      .map((x) => ({
        Obra: x.nombre, Cliente: x.cliente || '', Contrato: x.contrato || '',
        Monto: x.monto == null ? '' : Number(x.monto), Periodo: periodo(x.fecha_inicio, x.fecha_fin),
        Inicio: x.fecha_inicio || '', Fin: x.fecha_fin || '', Modalidad: MODALIDADES[x.modalidad] || '', 'Ubicación': x.ubicacion || '',
      }));
  }

  // -- Maquinaria y equipo (US-812) --
  const ESTADOS_MAQ = { operativo: 'Operativo', en_reparacion: 'En reparación', fuera_de_servicio: 'Fuera de servicio', vendido: 'Vendido' };
  /** Estado de la póliza con la regla de los documentos (≤ 30 días = por vencer); null si no tiene vigencia. */
  function estadoPoliza(m, hoy) {
    if (!m || !m.poliza_vigencia) return null;
    return estadoDocumento({ fecha_vencimiento: m.poliza_vigencia }, hoy);
  }
  /** Valida el formulario de un equipo. Devuelve null o el mensaje de error. */
  function validarMaquina(v) {
    if (!String(v.descripcion || '').trim()) return 'Escribe la descripción del equipo.';
    if (v.anio != null && v.anio !== '' && (!Number.isInteger(Number(v.anio)) || Number(v.anio) < 1950 || Number(v.anio) > 2100)) return 'El año del modelo debe estar entre 1950 y 2100.';
    if (v.estado_operativo && !ESTADOS_MAQ[v.estado_operativo]) return 'Elige el estado del equipo.';
    return null;
  }
  /** Renglones de la relación de maquinaria para Excel (en el orden de la lista). */
  function filasMaquinaria(maquinaria, hoy) {
    return [...(maquinaria || [])].sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion), 'es')).map((m) => {
      const ep = estadoPoliza(m, hoy);
      return {
        'Descripción': m.descripcion, Marca: m.marca || '', Modelo: m.modelo || '', 'Año': m.anio == null ? '' : Number(m.anio),
        Serie: m.serie || '', Capacidad: m.capacidad || '', Propiedad: m.propia === false ? 'Rentada' : 'Propia',
        Estado: ESTADOS_MAQ[m.estado_operativo] || '', Factura: m.factura || '', 'Póliza': m.poliza || '',
        'Vigencia de la póliza': m.poliza_vigencia || '', 'Estado de la póliza': ep ? ESTADOS[ep.estado] : '',
      };
    });
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
    if (k === 'personal') return exp.personal.filter((p) => p.activo).length;
    if (k === 'obras') return exp.obras.length;
    if (k === 'maquinaria') return exp.maquinaria.length;
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

  /** Campo de archivo de un formulario: muestra el actual (ver / quitar) y deja elegir uno nuevo que lo reemplaza. */
  function campoArchivoHtml(id, etiqueta, pathActual) {
    const actual = pathActual ? `<div class="flex flex-wrap items-center gap-2 text-xs text-ink-muted mb-1"><i class="ri-attachment-2" aria-hidden="true"></i><span class="break-all">${S(nombreDeRuta(pathActual))}</span>
<button type="button" class="text-accent hover:underline min-h-[44px]" onclick="Expediente.abrirArchivo(${S(JSON.stringify(pathActual))})">Ver</button>
<label class="inline-flex items-center gap-1 min-h-[44px]"><input type="checkbox" id="${id}Quitar"> Quitar archivo</label></div>` : '';
    return `<div>${lbl(id, etiqueta)}${actual}<input type="file" id="${id}" class="inp" accept="${ACCEPT}"${pathActual ? ` aria-describedby="${id}Ayuda"` : ''}>${pathActual ? `<p id="${id}Ayuda" class="text-xs text-ink-muted mt-1">Si eliges otro archivo, reemplaza al actual.</p>` : ''}</div>`;
  }
  /**
   * Sube los archivos elegidos en los campos {id, col} y calcula los cambios de la fila.
   * Devuelve {cambios: {col: ruta|null}, subidos: [rutas nuevas], viejos: [rutas a borrar tras guardar]}.
   * Si algo falla borra lo que alcanzó a subir y relanza el error.
   */
  async function aplicarArchivos(defs, carpeta, actual) {
    const r = { cambios: {}, subidos: [], viejos: [] };
    try {
      for (const d of defs) {
        const inp = $(d.id); const f = inp && inp.files && inp.files[0];
        const quitar = $(d.id + 'Quitar') && $(d.id + 'Quitar').checked;
        const previo = actual ? actual[d.col] : null;
        if (f) {
          const up = await subirArchivo(f, carpeta);
          r.subidos.push(up.path); r.cambios[d.col] = up.path;
          if (previo) r.viejos.push(previo);
        } else if (quitar && previo) { r.cambios[d.col] = null; r.viejos.push(previo); }
      }
    } catch (e) { await borrarObjetos(r.subidos); throw e; }
    return r;
  }
  const errorDe = (e, ctx) => (e && e.message && !e.code && !e.statusCode ? e.message : humanizeError(e, ctx));
  /** Valida antes de subir: tipo y tamaño de cada archivo elegido. */
  function validarCamposArchivo(defs) {
    for (const d of defs) { const inp = $(d.id); const f = inp && inp.files && inp.files[0]; if (f) { const e = validarArchivo(f); if (e) return e; } }
    return null;
  }
  const chipSimple = (txt, tono) => `<span class="chip" style="${tono ? `background:var(--${tono}-soft);color:var(--${tono})` : 'background:var(--surface-2);color:var(--ink-muted)'}">${S(txt)}</span>`;

  // -- Personal técnico (US-810) --
  const ARCH_PERSONAL = [{ id: 'exPerCv', col: 'cv_path', t: 'Currículum' }, { id: 'exPerCed', col: 'cedula_path', t: 'Cédula profesional' }, { id: 'exPerIde', col: 'identificacion_path', t: 'Identificación' }];
  function panelPersonal(exp) {
    const lista = ordenarPersonal(exp.personal);
    const barra = `<div class="flex flex-wrap items-center justify-between gap-2 mb-3"><p class="text-sm text-ink-muted">Residentes, superintendentes y especialistas que propones en los concursos, con su currículum y cédula.</p>
<div class="flex flex-wrap gap-2"><button type="button" class="btn btn-s" onclick="Expediente.traerEmpleados()"><i class="ri-user-shared-line" aria-hidden="true"></i> Traer de Empleados</button>
<button type="button" class="btn btn-p" onclick="Expediente.nuevaPersona()"><i class="ri-user-add-line" aria-hidden="true"></i> Agregar persona</button></div></div>`;
    if (!lista.length) return barra + EmptyState({ icon: 'ri-team-line', title: 'Sin personal técnico', body: 'Agrega a las personas que propones como residente o superintendente, o tráelas de Empleados para no capturar dos veces.', action: { label: 'Traer de Empleados', icon: 'ri-user-shared-line', onClick: 'Expediente.traerEmpleados()' } });
    return barra + `<ul class="g rounded-xl px-4 divide-y divide-slate-100" aria-label="Personal técnico">${lista.map((p) => {
      const det = [p.puesto, p.profesion, p.cedula_profesional ? 'Cédula ' + p.cedula_profesional : '', p.anios_experiencia != null ? p.anios_experiencia + ' año' + (p.anios_experiencia === 1 ? '' : 's') + ' de experiencia' : ''].filter(Boolean).join(' · ');
      const arch = ARCH_PERSONAL.filter((a) => p[a.col]).map((a) => `<span class="inline-flex items-center text-xs text-ink-muted">${S(a.t)}${botonesArchivo(p[a.col], a.t + ' de ' + p.nombre)}</span>`).join('');
      const falta = ARCH_PERSONAL.filter((a) => !p[a.col]).map((a) => a.t.toLowerCase());
      return `<li class="ex-per flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
<div class="flex-1 min-w-[12rem]"><p class="font-medium break-words">${S(p.nombre)} ${p.empleado_id ? '<span class="text-xs text-ink-muted font-normal">· de Empleados</span>' : ''}</p><p class="text-xs text-ink-muted">${S(det || 'Sin datos profesionales')}</p>
${falta.length && p.activo ? `<p class="text-xs text-warn">Falta: ${S(falta.join(', '))}</p>` : ''}<div class="flex flex-wrap gap-x-3">${arch}</div></div>
${p.activo ? chipSimple('Activo', 'ok') : chipSimple('Inactivo')}
<div class="flex items-center"><button type="button" class="btn-icon" onclick="Expediente.alternarActivo(${p.id})" aria-label="${p.activo ? 'Marcar como inactivo' : 'Marcar como activo'} a ${S(p.nombre)}" title="${p.activo ? 'Marcar inactivo' : 'Marcar activo'}"><i class="${p.activo ? 'ri-user-unfollow-line' : 'ri-user-follow-line'}" aria-hidden="true"></i></button>
<button type="button" class="btn-icon" onclick="Expediente.editarPersona(${p.id})" aria-label="Editar a ${S(p.nombre)}" title="Editar"><i class="ri-pencil-line" aria-hidden="true"></i></button>
<button type="button" class="btn-icon" onclick="Expediente.eliminarPersona(${p.id})" aria-label="Eliminar a ${S(p.nombre)}" title="Eliminar"><i class="ri-delete-bin-line" aria-hidden="true"></i></button></div></li>`;
    }).join('')}</ul>`;
  }
  const personaPorId = (id) => D.exp && D.exp.personal.find((p) => p.id === id);
  function modalPersona(p) {
    const x = p || {};
    const html = `<form id="exPerForm" onsubmit="Expediente.guardarPersona(event)" novalidate class="space-y-3">
<input type="hidden" id="exPerId" value="${x.id || ''}"><input type="hidden" id="exPerEmp" value="${x.empleado_id || ''}">
${x.empleado_id ? `<p class="text-xs text-ink-muted"><i class="ri-links-line" aria-hidden="true"></i> Ligado a Empleados: el nombre y el puesto se copiaron de ahí.</p>` : ''}
<div>${lbl('exPerNombre', 'Nombre', true)}<input type="text" id="exPerNombre" class="inp" required maxlength="160" value="${S(x.nombre || '')}"></div>
<div class="grid sm:grid-cols-2 gap-3"><div>${lbl('exPerPuesto', 'Puesto en la propuesta')}<input type="text" id="exPerPuesto" class="inp" value="${S(x.puesto || '')}" placeholder="Superintendente de obra"></div>
<div>${lbl('exPerProf', 'Profesión')}<input type="text" id="exPerProf" class="inp" value="${S(x.profesion || '')}" placeholder="Ingeniero civil"></div>
<div>${lbl('exPerCedula', 'Cédula profesional')}<input type="text" id="exPerCedula" class="inp" inputmode="numeric" value="${S(x.cedula_profesional || '')}"></div>
<div>${lbl('exPerAnios', 'Años de experiencia')}<input type="number" id="exPerAnios" class="inp" min="0" max="70" step="1" value="${x.anios_experiencia != null ? S(x.anios_experiencia) : ''}"></div></div>
${ARCH_PERSONAL.map((a) => campoArchivoHtml(a.id, a.t, x[a.col])).join('')}
<label class="zk-switch"><input type="checkbox" id="exPerActivo" ${x.id ? (x.activo ? 'checked' : '') : 'checked'}><span class="zk-slider" aria-hidden="true"></span><span class="zk-label">Activo (se puede proponer en concursos)</span></label>
<div>${lbl('exPerNotas', 'Notas')}<textarea id="exPerNotas" class="inp" rows="2">${S(x.notas || '')}</textarea></div>
<div class="flex flex-wrap justify-end gap-2 pt-2"><button type="button" class="btn btn-s" onclick="closeMdl('mdlExpPer')">Cancelar</button>
<button type="submit" class="btn btn-p" id="exPerGuardar"><i class="ri-save-line" aria-hidden="true"></i> ${x.id ? 'Guardar cambios' : 'Agregar persona'}</button></div></form>`;
    abrirModal('mdlExpPer', x.id ? 'Editar persona' : 'Agregar persona', html);
  }
  function nuevaPersona(base) { modalPersona(base || null); }
  function editarPersona(id) { const p = personaPorId(id); if (p) modalPersona(p); }
  async function guardarPersona(ev) {
    if (ev) ev.preventDefault();
    const id = +$('exPerId').value || null; const actual = id ? personaPorId(id) : null;
    const nombre = $('exPerNombre').value.trim();
    if (!nombre) { Toast.error('Escribe el nombre de la persona.'); return; }
    const aniosTxt = $('exPerAnios').value.trim();
    const anios = aniosTxt === '' ? null : Number(aniosTxt);
    if (anios !== null && (!Number.isInteger(anios) || anios < 0)) { Toast.error('Los años de experiencia deben ser un número entero.'); return; }
    const errArch = validarCamposArchivo(ARCH_PERSONAL); if (errArch) { Toast.error(errArch); return; }
    const btn = $('exPerGuardar'); btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    let arch = null;
    try {
      arch = await aplicarArchivos(ARCH_PERSONAL, 'personal', actual);
      const fila = Object.assign({ nombre, puesto: $('exPerPuesto').value.trim() || null, profesion: $('exPerProf').value.trim() || null,
        cedula_profesional: $('exPerCedula').value.trim() || null, anios_experiencia: anios, activo: $('exPerActivo').checked,
        notas: $('exPerNotas').value.trim() || null }, arch.cambios);
      if (!id) fila.empleado_id = +$('exPerEmp').value || null;
      const q = id ? sb.from('personal_tecnico').update(fila).eq('id', id).select().single() : sb.from('personal_tecnico').insert(fila).select().single();
      const { data, error } = await q;
      if (error) throw error;
      await borrarObjetos(arch.viejos);
      D.exp.personal = id ? D.exp.personal.map((p) => (p.id === id ? data : p)) : D.exp.personal.concat(data);
      closeMdl('mdlExpPer');
      Toast.success(id ? 'Persona actualizada' : 'Persona agregada al personal técnico');
      pintarPanel();
    } catch (e) {
      if (arch) await borrarObjetos(arch.subidos);
      Toast.error(errorDe(e, 'No se guardó la persona'));
    } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
  async function alternarActivo(id) {
    const p = personaPorId(id); if (!p) return;
    const { data, error } = await sb.from('personal_tecnico').update({ activo: !p.activo }).eq('id', id).select().single();
    if (error) { Toast.error(humanizeError(error, 'No se cambió el estado')); return; }
    D.exp.personal = D.exp.personal.map((x) => (x.id === id ? data : x));
    Toast.success(data.activo ? `${p.nombre} está activo` : `${p.nombre} quedó inactivo`);
    pintarPanel();
  }
  async function eliminarPersona(id) {
    const p = personaPorId(id); if (!p) return;
    if (!await Dialog.confirm({ title: 'Eliminar persona', body: `Se quitará a «${p.nombre}» del personal técnico junto con su currículum, cédula e identificación. En Empleados no cambia nada.`, confirmText: 'Eliminar persona', tone: 'danger' })) return;
    const { error } = await sb.from('personal_tecnico').delete().eq('id', id);
    if (error) { Toast.error(humanizeError(error, 'No se eliminó la persona')); return; }
    await borrarObjetos(ARCH_PERSONAL.map((a) => p[a.col]));
    D.exp.personal = D.exp.personal.filter((x) => x.id !== id);
    Toast.success('Persona eliminada');
    pintarPanel();
  }
  /** «Traer de Empleados»: lista los empleados aún no ligados; al elegir uno abre el alta con nombre y puesto copiados. */
  function traerEmpleados() {
    const disp = empleadosDisponibles(D.e || [], D.exp.personal);
    const html = disp.length ? `<p class="text-sm text-ink-muted mb-2">Elige a quién agregar. Se copian el nombre y el puesto y queda ligado a su ficha de Empleados.</p>
${disp.length > 8 ? `<div class="mb-2">${lbl('exTraerBuscar', 'Buscar empleado')}<input type="search" id="exTraerBuscar" class="inp" oninput="Expediente.filtrarTraer(this.value)"></div>` : ''}
<ul id="exTraerLista" class="divide-y divide-slate-100 max-h-[55vh] overflow-y-auto">${disp.map((e) => `<li data-n="${S(String(e.nombre_completo || '').toLowerCase())}" class="flex items-center gap-2 py-1"><div class="flex-1 min-w-0"><p class="font-medium truncate">${S(e.nombre_completo || 'Sin nombre')}</p><p class="text-xs text-ink-muted">${S([e.puesto, e.estatus].filter(Boolean).join(' · '))}</p></div>
<button type="button" class="btn btn-s" onclick="Expediente.elegirEmpleado(${e.id})" aria-label="Traer a ${S(e.nombre_completo || '')}">Traer</button></li>`).join('')}</ul>`
      : '<p class="text-sm text-ink-muted">Todos tus empleados ya están en el personal técnico, o aún no das de alta empleados.</p>';
    abrirModal('mdlExpTraer', 'Traer de Empleados', html + `<div class="flex justify-end pt-3"><button type="button" class="btn btn-s" onclick="closeMdl('mdlExpTraer')">Cerrar</button></div>`);
  }
  function filtrarTraer(q) {
    const t = String(q || '').toLowerCase().trim();
    document.querySelectorAll('#exTraerLista li').forEach((li) => { li.hidden = !!t && !li.dataset.n.includes(t); });
  }
  function elegirEmpleado(id) {
    const e = (D.e || []).find((x) => x.id === id); if (!e) return;
    closeMdl('mdlExpTraer');
    modalPersona(personaDesdeEmpleado(e));
  }

  // -- Obras ejecutadas (US-811) --
  const ARCH_OBRA = [{ id: 'exObrContrato', col: 'contrato_path', t: 'Contrato' }, { id: 'exObrActa', col: 'acta_path', t: 'Acta de entrega-recepción' }];
  const dinero = (n) => (n == null || n === '' ? '' : typeof fmt === 'function' ? fmt(n) : '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 }));
  function panelObras(exp) {
    const lista = [...exp.obras].sort((a, b) => String(b.fecha_fin || b.fecha_inicio || '').localeCompare(String(a.fecha_fin || a.fecha_inicio || '')));
    const total = lista.reduce((s, o) => s + (Number(o.monto) || 0), 0);
    const barra = `<div class="flex flex-wrap items-center justify-between gap-2 mb-3"><p class="text-sm text-ink-muted">El currículum de la empresa: obras que respaldan tu experiencia en los concursos.${lista.length ? ` ${lista.length} obra${lista.length === 1 ? '' : 's'} por ${S(dinero(total))}.` : ''}</p>
<div class="flex flex-wrap gap-2"><button type="button" class="btn btn-s" onclick="Expediente.traerObras()"><i class="ri-building-2-line" aria-hidden="true"></i> Traer de mis obras</button>
${lista.length ? `<button type="button" class="btn btn-s" onclick="Expediente.exportarCurriculum()"><i class="ri-file-excel-2-line" aria-hidden="true"></i> Exportar a Excel</button>` : ''}
<button type="button" class="btn btn-p" onclick="Expediente.nuevaObra()"><i class="ri-add-line" aria-hidden="true"></i> Agregar obra</button></div></div>`;
    if (!lista.length) return barra + EmptyState({ icon: 'ri-building-2-line', title: 'Sin obras en el currículum', body: 'Trae las obras terminadas del panel con cliente, monto y fechas ya llenos, o captura las que hiciste antes de usar el panel.', action: { label: 'Traer de mis obras', icon: 'ri-building-2-line', onClick: 'Expediente.traerObras()' } });
    return barra + `<ul class="g rounded-xl px-4 divide-y divide-slate-100" aria-label="Obras ejecutadas">${lista.map((o) => {
      const det = [o.cliente, o.contrato ? 'Contrato ' + o.contrato : '', o.monto != null ? dinero(o.monto) : '', periodo(o.fecha_inicio, o.fecha_fin), MODALIDADES[o.modalidad]].filter(Boolean).join(' · ');
      const arch = ARCH_OBRA.filter((a) => o[a.col]).map((a) => `<span class="inline-flex items-center text-xs text-ink-muted">${S(a.t)}${botonesArchivo(o[a.col], a.t + ' de ' + o.nombre)}</span>`).join('')
        + (o.evidencia_paths || []).map((p, i) => `<span class="inline-flex items-center text-xs text-ink-muted">Evidencia ${i + 1}${botonesArchivo(p, 'evidencia ' + (i + 1) + ' de ' + o.nombre)}</span>`).join('');
      return `<li class="ex-obra flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
<div class="flex-1 min-w-[12rem]"><p class="font-medium break-words">${S(o.nombre)} ${o.obra_id ? '<span class="text-xs text-ink-muted font-normal">· del panel</span>' : ''}</p><p class="text-xs text-ink-muted">${S(det || 'Sin datos')}</p>
<div class="flex flex-wrap gap-x-3">${arch}</div></div>
<div class="flex items-center"><button type="button" class="btn-icon" onclick="Expediente.editarObra(${o.id})" aria-label="Editar ${S(o.nombre)}" title="Editar"><i class="ri-pencil-line" aria-hidden="true"></i></button>
<button type="button" class="btn-icon" onclick="Expediente.eliminarObra(${o.id})" aria-label="Quitar del currículum ${S(o.nombre)}" title="Quitar del currículum"><i class="ri-delete-bin-line" aria-hidden="true"></i></button></div></li>`;
    }).join('')}</ul>`;
  }
  const obraPorId = (id) => D.exp && D.exp.obras.find((o) => o.id === id);
  function modalObra(o) {
    const x = o || {};
    const ev = x.evidencia_paths || [];
    const html = `<form id="exObrForm" onsubmit="Expediente.guardarObra(event)" novalidate class="space-y-3">
<input type="hidden" id="exObrId" value="${x.id || ''}">
${x.obra_id ? `<p class="text-xs text-ink-muted"><i class="ri-links-line" aria-hidden="true"></i> Ligada a una obra del panel.</p>` : ''}
<div>${lbl('exObrNombre', 'Obra', true)}<input type="text" id="exObrNombre" class="inp" required maxlength="250" value="${S(x.nombre || '')}" placeholder="Construcción de aula en escuela primaria"></div>
<div class="grid sm:grid-cols-2 gap-3"><div>${lbl('exObrCliente', 'Cliente o dependencia')}<input type="text" id="exObrCliente" class="inp" value="${S(x.cliente || '')}"></div>
<div>${lbl('exObrContratoNum', 'Número de contrato')}<input type="text" id="exObrContratoNum" class="inp" value="${S(x.contrato || '')}"></div>
<div>${lbl('exObrMonto', 'Monto con IVA')}<input type="text" inputmode="decimal" id="exObrMonto" class="inp" value="${x.monto != null ? S(x.monto) : ''}" placeholder="0.00"></div>
<div>${lbl('exObrModalidad', 'Modalidad')}<select id="exObrModalidad" class="inp"><option value="">Sin especificar</option>${Object.entries(MODALIDADES).map(([k, t]) => `<option value="${k}" ${x.modalidad === k ? 'selected' : ''}>${S(t)}</option>`).join('')}</select></div>
<div>${lbl('exObrIni', 'Inicio')}<input type="date" id="exObrIni" class="inp" value="${S(x.fecha_inicio || '')}"></div>
<div>${lbl('exObrFin', 'Terminación')}<input type="date" id="exObrFin" class="inp" value="${S(x.fecha_fin || '')}"></div></div>
<div>${lbl('exObrUbic', 'Ubicación')}<input type="text" id="exObrUbic" class="inp" value="${S(x.ubicacion || '')}"></div>
<div>${lbl('exObrDesc', 'Descripción de los trabajos')}<textarea id="exObrDesc" class="inp" rows="2">${S(x.descripcion || '')}</textarea></div>
${ARCH_OBRA.map((a) => campoArchivoHtml(a.id, a.t, x[a.col])).join('')}
<div>${lbl('exObrEv', 'Evidencia (fotos, finiquito, estimaciones)')}
${ev.length ? `<ul class="text-xs text-ink-muted mb-1">${ev.map((p, i) => `<li class="flex flex-wrap items-center gap-2"><i class="ri-attachment-2" aria-hidden="true"></i><span class="break-all">${S(nombreDeRuta(p))}</span><label class="inline-flex items-center gap-1 min-h-[44px]"><input type="checkbox" id="exObrEvQuitar${i}"> Quitar</label></li>`).join('')}</ul>` : ''}
<input type="file" id="exObrEv" class="inp" accept="${ACCEPT}" multiple><p class="text-xs text-ink-muted mt-1">Puedes elegir varios archivos; se agregan a los que ya hay.</p></div>
<div>${lbl('exObrNotas', 'Notas')}<textarea id="exObrNotas" class="inp" rows="2">${S(x.notas || '')}</textarea></div>
<div class="flex flex-wrap justify-end gap-2 pt-2"><button type="button" class="btn btn-s" onclick="closeMdl('mdlExpObra')">Cancelar</button>
<button type="submit" class="btn btn-p" id="exObrGuardar"><i class="ri-save-line" aria-hidden="true"></i> ${x.id ? 'Guardar cambios' : 'Agregar obra'}</button></div></form>`;
    abrirModal('mdlExpObra', x.id ? 'Editar obra ejecutada' : 'Agregar obra ejecutada', html, 'max-w-2xl');
  }
  function nuevaObra() { modalObra(null); }
  function editarObra(id) { const o = obraPorId(id); if (o) modalObra(o); }
  async function guardarObra(ev) {
    if (ev) ev.preventDefault();
    const id = +$('exObrId').value || null; const actual = id ? obraPorId(id) : null;
    const nombre = $('exObrNombre').value.trim();
    if (!nombre) { Toast.error('Escribe el nombre de la obra.'); return; }
    const montoTxt = $('exObrMonto').value.trim().replace(/[$,\s]/g, '');
    const monto = montoTxt === '' ? null : Number(montoTxt);
    if (monto !== null && (!Number.isFinite(monto) || monto < 0)) { Toast.error('Monto: escribe un importe válido (sólo números).'); return; }
    const ini = $('exObrIni').value || null; const fin = $('exObrFin').value || null;
    if (ini && fin && fin < ini) { Toast.error('La terminación no puede ser anterior al inicio.'); return; }
    const evFiles = [...($('exObrEv').files || [])];
    const errArch = validarCamposArchivo(ARCH_OBRA) || evFiles.map(validarArchivo).find(Boolean); if (errArch) { Toast.error(errArch); return; }
    const btn = $('exObrGuardar'); btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    let arch = null; const evSubidos = [];
    try {
      arch = await aplicarArchivos(ARCH_OBRA, 'obras', actual);
      for (const f of evFiles) { const up = await subirArchivo(f, 'obras'); evSubidos.push(up.path); }
      const evPrevias = (actual && actual.evidencia_paths) || [];
      const evQuitar = evPrevias.filter((p, i) => $('exObrEvQuitar' + i) && $('exObrEvQuitar' + i).checked);
      const fila = Object.assign({ nombre, cliente: $('exObrCliente').value.trim() || null, contrato: $('exObrContratoNum').value.trim() || null,
        monto: monto === null ? null : Math.round(monto * 100) / 100, modalidad: $('exObrModalidad').value || null, fecha_inicio: ini, fecha_fin: fin,
        ubicacion: $('exObrUbic').value.trim() || null, descripcion: $('exObrDesc').value.trim() || null, notas: $('exObrNotas').value.trim() || null,
        evidencia_paths: evPrevias.filter((p) => !evQuitar.includes(p)).concat(evSubidos) }, arch.cambios);
      const q = id ? sb.from('obras_ejecutadas').update(fila).eq('id', id).select().single() : sb.from('obras_ejecutadas').insert(fila).select().single();
      const { data, error } = await q;
      if (error) throw error;
      await borrarObjetos(arch.viejos.concat(evQuitar));
      D.exp.obras = id ? D.exp.obras.map((o) => (o.id === id ? data : o)) : D.exp.obras.concat(data);
      closeMdl('mdlExpObra');
      Toast.success(id ? 'Obra actualizada' : 'Obra agregada al currículum');
      pintarPanel();
    } catch (e) {
      await borrarObjetos((arch ? arch.subidos : []).concat(evSubidos));
      Toast.error(errorDe(e, 'No se guardó la obra'));
    } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
  async function eliminarObra(id) {
    const o = obraPorId(id); if (!o) return;
    if (!await Dialog.confirm({ title: 'Quitar del currículum', body: `Se quitará «${o.nombre}» del currículum junto con su contrato, acta y evidencia.${o.obra_id ? ' La obra del panel no cambia.' : ''}`, confirmText: 'Quitar obra', tone: 'danger' })) return;
    const { error } = await sb.from('obras_ejecutadas').delete().eq('id', id);
    if (error) { Toast.error(humanizeError(error, 'No se quitó la obra')); return; }
    await borrarObjetos([o.contrato_path, o.acta_path, ...(o.evidencia_paths || [])]);
    D.exp.obras = D.exp.obras.filter((x) => x.id !== id);
    Toast.success('Obra quitada del currículum');
    pintarPanel();
  }
  /** «Traer de mis obras»: propone las obras terminadas del panel (con casilla para ver también las que siguen en proceso). */
  function traerObras(incluirEnProceso) {
    const cand = obrasParaCurriculum(D.o || [], D.exp.obras, !!incluirEnProceso);
    const filas = cand.map((o) => { const x = obraEjecutadaDesdeObra(o, D.cli); return `<li class="flex items-start gap-3 py-2"><input type="checkbox" class="mt-1 w-5 h-5" id="exTO-${o.id}" value="${o.id}" ${obraTerminada(o) ? 'checked' : ''}>
<label for="exTO-${o.id}" class="flex-1 min-w-0 cursor-pointer"><span class="font-medium block break-words">${S(x.nombre)}</span><span class="text-xs text-ink-muted">${S([x.cliente, x.monto != null ? dinero(x.monto) : '', periodo(x.fecha_inicio, x.fecha_fin), o.estatus].filter(Boolean).join(' · '))}</span></label></li>`; }).join('');
    const html = `<p class="text-sm text-ink-muted mb-2">Se copian cliente, monto con IVA y fechas, y la obra queda ligada. Después puedes agregar el número de contrato, el acta y la evidencia.</p>
<label class="zk-switch mb-2"><input type="checkbox" id="exTOProceso" ${incluirEnProceso ? 'checked' : ''} onchange="Expediente.traerObras(this.checked)"><span class="zk-slider" aria-hidden="true"></span><span class="zk-label">Mostrar también las obras en proceso</span></label>
${cand.length ? `<ul id="exTOLista" class="divide-y divide-slate-100 max-h-[50vh] overflow-y-auto">${filas}</ul>` : `<p class="text-sm text-ink-muted py-3">${incluirEnProceso ? 'Todas tus obras ya están en el currículum.' : 'No hay obras terminadas que falten en el currículum. Activa «Mostrar también las obras en proceso» para verlas todas.'}</p>`}
<div class="flex flex-wrap justify-end gap-2 pt-3"><button type="button" class="btn btn-s" onclick="closeMdl('mdlExpTraerObras')">Cancelar</button>
${cand.length ? `<button type="button" class="btn btn-p" id="exTOAgregar" onclick="Expediente.agregarObrasTraidas()"><i class="ri-add-line" aria-hidden="true"></i> Agregar al currículum</button>` : ''}</div>`;
    abrirModal('mdlExpTraerObras', 'Traer de mis obras', html, 'max-w-xl');
  }
  async function agregarObrasTraidas() {
    const ids = [...document.querySelectorAll('#exTOLista input[type=checkbox]:checked')].map((i) => +i.value);
    if (!ids.length) { Toast.error('Marca al menos una obra.'); return; }
    const filas = ids.map((id) => (D.o || []).find((o) => o.id === id)).filter(Boolean).map((o) => obraEjecutadaDesdeObra(o, D.cli));
    const btn = $('exTOAgregar'); if (btn) btn.disabled = true;
    try {
      const { data, error } = await sb.from('obras_ejecutadas').insert(filas).select();
      if (error) throw error;
      D.exp.obras = D.exp.obras.concat(data || []);
      closeMdl('mdlExpTraerObras');
      Toast.success(`${filas.length} obra${filas.length === 1 ? '' : 's'} agregada${filas.length === 1 ? '' : 's'} al currículum`);
      pintarPanel();
    } catch (e) { Toast.error(humanizeError(e, 'No se agregaron las obras')); } finally { if (btn) btn.disabled = false; }
  }
  function exportarCurriculum() {
    if (typeof XLSX === 'undefined') { Toast.error('No cargó el generador de Excel. Revisa tu conexión y vuelve a intentar.'); return; }
    const filas = filasCurriculum(D.exp.obras);
    const ws = XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 45 }, { wch: 32 }, { wch: 18 }, { wch: 16 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 26 }, { wch: 30 }];
    filas.forEach((f, i) => { const c = ws['D' + (i + 2)]; if (c && typeof c.v === 'number') c.z = '"$"#,##0.00'; });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Currículum');
    XLSX.writeFile(wb, `Curriculum_obras_${hoyMx()}.xlsx`);
    Toast.success('Currículum exportado a Excel');
  }

  // -- Maquinaria y equipo (US-812) --
  const ARCH_MAQ = [{ id: 'exMaqFacturaArch', col: 'factura_path', t: 'Factura' }, { id: 'exMaqPolizaArch', col: 'poliza_path', t: 'Póliza' }];
  function panelMaquinaria(exp) {
    const lista = [...exp.maquinaria].sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion), 'es'));
    const hoy = hoyMx();
    const porVencer = lista.filter((m) => { const e = estadoPoliza(m, hoy); return m.estado_operativo !== 'vendido' && e && (e.estado === 'vencido' || e.estado === 'por_vencer'); }).length;
    const barra = `<div class="flex flex-wrap items-center justify-between gap-2 mb-3"><p class="text-sm text-ink-muted">La relación de maquinaria y equipo para la propuesta técnica, con factura y póliza de seguro.${porVencer ? ` <span class="text-warn font-medium">${porVencer} póliza${porVencer === 1 ? '' : 's'} vencida${porVencer === 1 ? '' : 's'} o por vencer.</span>` : ''}</p>
<div class="flex flex-wrap gap-2">${lista.length ? `<button type="button" class="btn btn-s" onclick="Expediente.exportarMaquinaria()"><i class="ri-file-excel-2-line" aria-hidden="true"></i> Exportar a Excel</button>` : ''}
<button type="button" class="btn btn-p" onclick="Expediente.nuevaMaquina()"><i class="ri-add-line" aria-hidden="true"></i> Agregar equipo</button></div></div>`;
    if (!lista.length) return barra + EmptyState({ icon: 'ri-truck-line', title: 'Sin maquinaria registrada', body: 'Registra tu maquinaria y equipo con su factura y póliza; te avisamos 30, 15 y 3 días antes de que venza la póliza.', action: { label: 'Agregar equipo', icon: 'ri-add-line', onClick: 'Expediente.nuevaMaquina()' } });
    return barra + `<ul class="g rounded-xl px-4 divide-y divide-slate-100" aria-label="Maquinaria y equipo">${lista.map((m) => {
      const det = [[m.marca, m.modelo].filter(Boolean).join(' '), m.anio, m.serie ? 'Serie ' + m.serie : '', m.capacidad, m.propia === false ? 'Rentada' : 'Propia'].filter(Boolean).join(' · ');
      const ep = estadoPoliza(m, hoy);
      const pol = m.poliza || m.poliza_vigencia ? `Póliza ${S(m.poliza || 'sin número')}${m.poliza_vigencia ? ' · vigente hasta ' + S(fechaCorta(m.poliza_vigencia)) : ''}` : 'Sin póliza';
      const arch = ARCH_MAQ.filter((a) => m[a.col]).map((a) => `<span class="inline-flex items-center text-xs text-ink-muted">${S(a.t)}${botonesArchivo(m[a.col], a.t + ' de ' + m.descripcion)}</span>`).join('');
      return `<li class="ex-maq flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
<div class="flex-1 min-w-[12rem]"><p class="font-medium break-words">${S(m.descripcion)}</p><p class="text-xs text-ink-muted">${S(det)}</p><p class="text-xs text-ink-muted">${m.factura ? 'Factura ' + S(m.factura) + ' · ' : ''}${pol}</p>
<div class="flex flex-wrap gap-x-3">${arch}</div></div>
${m.estado_operativo !== 'operativo' ? chipSimple(ESTADOS_MAQ[m.estado_operativo] || m.estado_operativo) : ''}${ep && m.estado_operativo !== 'vendido' ? chipEstado(ep.estado, ep.dias) : ''}
<div class="flex items-center"><button type="button" class="btn-icon" onclick="Expediente.editarMaquina(${m.id})" aria-label="Editar ${S(m.descripcion)}" title="Editar"><i class="ri-pencil-line" aria-hidden="true"></i></button>
<button type="button" class="btn-icon" onclick="Expediente.eliminarMaquina(${m.id})" aria-label="Eliminar ${S(m.descripcion)}" title="Eliminar"><i class="ri-delete-bin-line" aria-hidden="true"></i></button></div></li>`;
    }).join('')}</ul>`;
  }
  const maquinaPorId = (id) => D.exp && D.exp.maquinaria.find((m) => m.id === id);
  function modalMaquina(m) {
    const x = m || {};
    const html = `<form id="exMaqForm" onsubmit="Expediente.guardarMaquina(event)" novalidate class="space-y-3">
<input type="hidden" id="exMaqId" value="${x.id || ''}">
<div>${lbl('exMaqDesc', 'Descripción', true)}<input type="text" id="exMaqDesc" class="inp" required maxlength="200" value="${S(x.descripcion || '')}" placeholder="Retroexcavadora"></div>
<div class="grid grid-cols-2 gap-3"><div>${lbl('exMaqMarca', 'Marca')}<input type="text" id="exMaqMarca" class="inp" value="${S(x.marca || '')}"></div>
<div>${lbl('exMaqModelo', 'Modelo')}<input type="text" id="exMaqModelo" class="inp" value="${S(x.modelo || '')}"></div>
<div>${lbl('exMaqAnio', 'Año')}<input type="number" id="exMaqAnio" class="inp" min="1950" max="2100" step="1" value="${x.anio != null ? S(x.anio) : ''}"></div>
<div>${lbl('exMaqSerie', 'Número de serie')}<input type="text" id="exMaqSerie" class="inp" value="${S(x.serie || '')}"></div>
<div>${lbl('exMaqCap', 'Capacidad')}<input type="text" id="exMaqCap" class="inp" value="${S(x.capacidad || '')}" placeholder="0.25 m³"></div>
<div>${lbl('exMaqEstado', 'Estado')}<select id="exMaqEstado" class="inp">${Object.entries(ESTADOS_MAQ).map(([k, t]) => `<option value="${k}" ${(x.estado_operativo || 'operativo') === k ? 'selected' : ''}>${S(t)}</option>`).join('')}</select></div></div>
<label class="zk-switch"><input type="checkbox" id="exMaqPropia" ${x.propia === false ? '' : 'checked'}><span class="zk-slider" aria-hidden="true"></span><span class="zk-label">Equipo propio (apágalo si es rentado)</span></label>
<fieldset class="space-y-3"><legend class="text-xs font-semibold text-ink-muted uppercase mb-1">Factura</legend>
<div>${lbl('exMaqFactura', 'Folio o UUID de la factura')}<input type="text" id="exMaqFactura" class="inp" value="${S(x.factura || '')}"></div>
${campoArchivoHtml('exMaqFacturaArch', 'Archivo de la factura', x.factura_path)}</fieldset>
<fieldset class="space-y-3"><legend class="text-xs font-semibold text-ink-muted uppercase mb-1">Póliza de seguro</legend>
<div class="grid grid-cols-2 gap-3"><div>${lbl('exMaqPoliza', 'Número de póliza')}<input type="text" id="exMaqPoliza" class="inp" value="${S(x.poliza || '')}"></div>
<div>${lbl('exMaqVig', 'Vigente hasta')}<input type="date" id="exMaqVig" class="inp" value="${S(x.poliza_vigencia || '')}" aria-describedby="exMaqVigAyuda"></div></div>
<p id="exMaqVigAyuda" class="text-xs text-ink-muted">Te avisamos 30, 15 y 3 días antes de que venza.</p>
${campoArchivoHtml('exMaqPolizaArch', 'Archivo de la póliza', x.poliza_path)}</fieldset>
<div>${lbl('exMaqNotas', 'Notas')}<textarea id="exMaqNotas" class="inp" rows="2">${S(x.notas || '')}</textarea></div>
<div class="flex flex-wrap justify-end gap-2 pt-2"><button type="button" class="btn btn-s" onclick="closeMdl('mdlExpMaq')">Cancelar</button>
<button type="submit" class="btn btn-p" id="exMaqGuardar"><i class="ri-save-line" aria-hidden="true"></i> ${x.id ? 'Guardar cambios' : 'Agregar equipo'}</button></div></form>`;
    abrirModal('mdlExpMaq', x.id ? 'Editar equipo' : 'Agregar equipo', html);
  }
  function nuevaMaquina() { modalMaquina(null); }
  function editarMaquina(id) { const m = maquinaPorId(id); if (m) modalMaquina(m); }
  async function guardarMaquina(ev) {
    if (ev) ev.preventDefault();
    const id = +$('exMaqId').value || null; const actual = id ? maquinaPorId(id) : null;
    const v = { descripcion: $('exMaqDesc').value.trim(), anio: $('exMaqAnio').value.trim(), estado_operativo: $('exMaqEstado').value };
    const err = validarMaquina(v) || validarCamposArchivo(ARCH_MAQ); if (err) { Toast.error(err); return; }
    const btn = $('exMaqGuardar'); btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    let arch = null;
    try {
      arch = await aplicarArchivos(ARCH_MAQ, 'maquinaria', actual);
      const fila = Object.assign({ descripcion: v.descripcion, marca: $('exMaqMarca').value.trim() || null, modelo: $('exMaqModelo').value.trim() || null,
        anio: v.anio === '' ? null : Number(v.anio), serie: $('exMaqSerie').value.trim() || null, capacidad: $('exMaqCap').value.trim() || null,
        estado_operativo: v.estado_operativo || 'operativo', propia: $('exMaqPropia').checked, factura: $('exMaqFactura').value.trim() || null,
        poliza: $('exMaqPoliza').value.trim() || null, poliza_vigencia: $('exMaqVig').value || null, notas: $('exMaqNotas').value.trim() || null }, arch.cambios);
      const q = id ? sb.from('maquinaria').update(fila).eq('id', id).select().single() : sb.from('maquinaria').insert(fila).select().single();
      const { data, error } = await q;
      if (error) throw error;
      await borrarObjetos(arch.viejos);
      D.exp.maquinaria = id ? D.exp.maquinaria.map((m) => (m.id === id ? data : m)) : D.exp.maquinaria.concat(data);
      closeMdl('mdlExpMaq');
      Toast.success(id ? 'Equipo actualizado' : 'Equipo agregado');
      avisarCambio();
      pintarPanel();
    } catch (e) {
      if (arch) await borrarObjetos(arch.subidos);
      Toast.error(errorDe(e, 'No se guardó el equipo'));
    } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
  async function eliminarMaquina(id) {
    const m = maquinaPorId(id); if (!m) return;
    if (!await Dialog.confirm({ title: 'Eliminar equipo', body: `Se borrará «${m.descripcion}» con su factura y póliza.`, confirmText: 'Eliminar equipo', tone: 'danger' })) return;
    const { error } = await sb.from('maquinaria').delete().eq('id', id);
    if (error) { Toast.error(humanizeError(error, 'No se eliminó el equipo')); return; }
    await borrarObjetos([m.factura_path, m.poliza_path]);
    D.exp.maquinaria = D.exp.maquinaria.filter((x) => x.id !== id);
    Toast.success('Equipo eliminado');
    avisarCambio();
    pintarPanel();
  }
  function exportarMaquinaria() {
    if (typeof XLSX === 'undefined') { Toast.error('No cargó el generador de Excel. Revisa tu conexión y vuelve a intentar.'); return; }
    const filas = filasMaquinaria(D.exp.maquinaria, hoyMx());
    const ws = XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 34 }, { wch: 16 }, { wch: 16 }, { wch: 7 }, { wch: 20 }, { wch: 16 }, { wch: 10 }, { wch: 18 }, { wch: 38 }, { wch: 18 }, { wch: 14 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Maquinaria');
    XLSX.writeFile(wb, `Relacion_maquinaria_${hoyMx()}.xlsx`);
    Toast.success('Relación de maquinaria exportada a Excel');
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
    if (tab === 'personal') return panelPersonal(exp);
    if (tab === 'obras') return panelObras(exp);
    if (tab === 'maquinaria') return panelMaquinaria(exp);
    return panelDocumentos(exp);
  }
  /** Repinta pestañas y panel con D.exp sin volver a pedir datos. */
  function pintarPanel() {
    const el = $('exCuerpo'); if (!el || !D.exp || M !== 'ex') return;
    el.innerHTML = tabsHtml(D.exp) + `<div id="exPanel" role="tabpanel" aria-labelledby="exTab-${tab}">${panelHtml(D.exp)}</div>`;
    // En móvil las pestañas se desplazan: la activa siempre a la vista (sin mover la página en vertical)
    const t = $('exTab-' + tab), barra = t && t.parentElement;
    if (t && barra && barra.scrollWidth > barra.clientWidth) barra.scrollLeft = Math.max(0, t.offsetLeft - barra.offsetLeft - 16);
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
    nuevaPersona, editarPersona, guardarPersona, alternarActivo, eliminarPersona, traerEmpleados, filtrarTraer, elegirEmpleado,
    nuevaObra, editarObra, guardarObra, eliminarObra, traerObras, agregarObrasTraidas, exportarCurriculum,
    nuevaMaquina, editarMaquina, guardarMaquina, eliminarMaquina, exportarMaquinaria,
    // puras
    hoyMx, estadoDocumento, vencimientoSugerido, faltantes, resumen, categoria, datosParaGuardar, domicilio, vacioTotal,
    tipoArchivo, validarArchivo, nombreSeguro, rutaArchivo, sha256Hex, nombreDeRuta, agruparPorCategoria, cadenaVersiones, validarDocumento,
    empleadosDisponibles, personaDesdeEmpleado, ordenarPersonal,
    obrasParaCurriculum, obraEjecutadaDesdeObra, periodo, filasCurriculum, MODALIDADES,
    estadoPoliza, filasMaquinaria, validarMaquina, ESTADOS_MAQ,
    CATEGORIAS, ESTADOS, DIAS_POR_VENCER, CAMPOS_DATOS, TABS, TIPOS_ARCHIVO, MAX_BYTES,
  };
})();
if (typeof module !== 'undefined') module.exports = Expediente;
