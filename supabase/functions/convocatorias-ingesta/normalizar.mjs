// Normalización y validación de convocatorias que llegan a convocatorias-ingesta. Pura (sin Deno ni Node): la usa
// index.ts y la prueba scripts/qa/convocatorias-ingesta.test.mjs. Acepta dos formas:
//   1. Un registro crudo de ComprasMX (whitney/sitiopublico/expedientes → data[0].registros[i]), opcionalmente con
//      `detalle` = data.registro[0] de expedientes/<uuid>. Se reconoce por `uuid_procedimiento`.
//   2. Una convocatoria ya normalizada ({fuente, id_externo, ...}); se valida campo por campo.
// Devuelve el objeto listo para convocatorias_upsert o null si no sirve.

export const SITIO_COMPRASMX = 'https://comprasmx.buengobierno.gob.mx/sitiopublico/';
const TIPOS_PROC = new Set(['licitacion_publica', 'invitacion', 'adjudicacion_directa', 'otro']);
const TIPOS_CONT = new Set(['obra_publica', 'servicios_obra', 'adquisicion', 'arrendamiento', 'servicios', 'otro']);
const ESTATUS = new Set(['vigente', 'en_seguimiento', 'terminado', 'cancelado', 'otro']);

const ENTIDADES = ['Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas', 'Chihuahua',
  'Ciudad de México', 'Coahuila', 'Colima', 'Durango', 'Estado de México', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco',
  'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro', 'Quintana Roo', 'San Luis Potosí',
  'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas'];

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9ñ]+/g, ' ').trim();
const ENT_POR_NORM = new Map(ENTIDADES.map((e) => [norm(e), e]));
ENT_POR_NORM.set('mexico', 'Estado de México');
ENT_POR_NORM.set('coahuila de zaragoza', 'Coahuila');
ENT_POR_NORM.set('michoacan de ocampo', 'Michoacán');
ENT_POR_NORM.set('veracruz de ignacio de la llave', 'Veracruz');
ENT_POR_NORM.set('distrito federal', 'Ciudad de México');

export function entidad(s) {
  const n = norm(s);
  if (!n) return null;
  return ENT_POR_NORM.get(n) ?? String(s).trim().slice(0, 80);
}
export function tipoProcedimiento(s) {
  const t = norm(s);
  if (!t) return null;
  if (t.startsWith('licitacion')) return 'licitacion_publica';
  if (t.startsWith('invitacion')) return 'invitacion';
  if (t.startsWith('adjudicacion')) return 'adjudicacion_directa';
  return 'otro';
}
export function tipoContratacion(s) {
  const t = norm(s);
  if (!t) return null;
  if (t.startsWith('servicios relacionados')) return 'servicios_obra';
  if (t.startsWith('obra')) return 'obra_publica';
  if (t.startsWith('adquisicion')) return 'adquisicion';
  if (t.startsWith('arrendamiento')) return 'arrendamiento';
  if (t.startsWith('servicio')) return 'servicios';
  return 'otro';
}
export function estatus(s) {
  const t = norm(s);
  if (!t) return null;
  if (t.startsWith('vigente')) return 'vigente';
  if (t.includes('seguimiento')) return 'en_seguimiento';
  if (t.startsWith('conclu') || t.startsWith('terminad') || t.includes('adjudicad') || t.includes('fallo')) return 'terminado';
  if (t.startsWith('cancelad') || t.startsWith('desiert')) return 'cancelado';
  return 'otro';
}
// ComprasMX publica fechas sin zona en hora del centro de México (UTC-6 todo el año desde 2022).
export function fechaMx(s) {
  if (s == null || s === '') return null;
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(t)) return t + (t.length === 16 ? ':00' : '') + '-06:00';
  return Number.isFinite(Date.parse(t)) ? new Date(t).toISOString() : null;
}
const txt = (v, max = 500) => {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const uuidOk = (s) => /^[0-9a-f]{32}$/i.test(String(s ?? ''));

export function desdeComprasMx(r, det) {
  if (!r || !uuidOk(r.uuid_procedimiento)) return null;
  const d = det && typeof det === 'object' ? det : null;
  const uuid = String(r.uuid_procedimiento).toLowerCase();
  return {
    fuente: 'comprasmx',
    id_externo: uuid,
    numero_procedimiento: txt(r.numero_procedimiento, 120),
    titulo: txt(r.nombre_procedimiento ?? d?.nombre_procedimiento, 2000) ?? '',
    // US-852: objeto de la contratación tal como lo publica el portal (sólo viene en el detalle).
    descripcion: d ? txt(d.descripcion, 4000) : null,
    // Sin detalle sólo hay siglas («ICHIFE»): no se manda para no pisar el nombre completo leído antes.
    dependencia: d ? txt(d.nombre_dependencia ?? d.dependencia, 300) : null,
    unidad_compradora: txt(r.unidad_compradora ?? d?.unidad_compradora, 300),
    tipo_procedimiento: tipoProcedimiento(r.tipo_procedimiento ?? d?.tipo_procedimiento),
    tipo_contratacion: tipoContratacion(r.tipo_contratacion ?? d?.tipo_contratacion),
    entidad: entidad(r.entidad_federativa_contratacion ?? d?.entidad_federativa_contratacion),
    municipio: null,
    publicacion: fechaMx(d?.fecha_publicacion),
    junta_aclaraciones: fechaMx(r.fecha_aclaraciones ?? d?.fecha_junta_aclaracion),
    apertura: fechaMx(r.fecha_apertura ?? d?.fecha_apertura),
    fallo: fechaMx(d?.fecha_acto_fallo),
    estatus: estatus(d?.estatus_alterno ?? r.estatus_alterno ?? r.estatus),
    url_detalle: `${SITIO_COMPRASMX}#/sitiopublico/detalle/${uuid}/procedimiento`,
    datos: recortar({ expediente: sinDetalle(r), ...(d ? { detalle: d } : {}) }),
    ...(d ? { detalle_at: new Date().toISOString() } : {}),
  };
}

function sinDetalle(r) {
  const { detalle: _d, ...resto } = r;
  return resto;
}

// datos jsonb acotado (~30 KB) para que un portal con textos enormes no infle la tabla.
function recortar(o) {
  const s = JSON.stringify(o);
  if (s.length <= 30000) return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') {
      const vv = {};
      for (const [k2, v2] of Object.entries(v)) vv[k2] = typeof v2 === 'string' ? v2.slice(0, 1000) : v2;
      out[k] = vv;
    } else out[k] = v;
  }
  return out;
}

export function normalizar(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  if (x.uuid_procedimiento) return desdeComprasMx(x, x.detalle);
  const fuente = x.fuente === 'comprasmx' || x.fuente === 'chihuahua' ? x.fuente : null;
  const id = txt(x.id_externo, 120);
  if (!fuente || !id) return null;
  const enumOk = (v, set) => (v != null && set.has(v) ? v : null);
  const fecha = (v) => (v == null || v === '' ? null : Number.isFinite(Date.parse(String(v))) ? String(v) : null);
  let url = txt(x.url_detalle, 1000);
  if (url && !/^https:\/\//i.test(url)) url = null;
  const datos = x.datos && typeof x.datos === 'object' && !Array.isArray(x.datos) ? recortar(x.datos) : {};
  return {
    fuente, id_externo: id,
    numero_procedimiento: txt(x.numero_procedimiento, 120),
    titulo: txt(x.titulo, 2000) ?? '',
    descripcion: txt(x.descripcion, 4000),
    dependencia: txt(x.dependencia, 300),
    unidad_compradora: txt(x.unidad_compradora, 300),
    tipo_procedimiento: enumOk(x.tipo_procedimiento, TIPOS_PROC),
    tipo_contratacion: enumOk(x.tipo_contratacion, TIPOS_CONT),
    entidad: x.entidad ? entidad(x.entidad) : null,
    municipio: txt(x.municipio, 120),
    publicacion: fecha(x.publicacion), junta_aclaraciones: fecha(x.junta_aclaraciones),
    apertura: fecha(x.apertura), fallo: fecha(x.fallo),
    estatus: enumOk(x.estatus, ESTATUS),
    url_detalle: url,
    datos,
    ...(fecha(x.detalle_at) ? { detalle_at: fecha(x.detalle_at) } : {}),
  };
}
