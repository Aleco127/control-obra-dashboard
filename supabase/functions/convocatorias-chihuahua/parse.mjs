// Funciones puras del recolector de Contrataciones Chihuahua (contrataciones.chihuahua.gob.mx).
// Sin APIs de Deno ni de Node: las usa la función de borde (index.ts) y las prueba
// scripts/qa/convocatorias-chihuahua.test.mjs con node. Formato del portal documentado en docs/licitaciones/fuentes.md.

export const BASE = 'https://contrataciones.chihuahua.gob.mx';

// Valores del formulario de búsqueda (los <select> de la página).
export const MATERIA = { obra_publica: '3', servicios_obra: '1' };
export const ESTATUS = { vigente: '0', en_seguimiento: '2' };

// Búsqueda a petición (US-850): catálogos del formulario del portal.
export const TIPO_LICITACION = { licitacion_publica: '1', invitacion: '2', adjudicacion_directa: '3' };
export const ESTATUS_PORTAL = { vigente: '0', en_seguimiento: '2', terminado: '1', cancelado: '3' };

// Lo que manda el navegador al pulsar «Buscar»: los <select> sin elegir van como -1 y los textos vacíos como ''.
// Con Tipo_de_Licitaci_n vacío ('') el servidor responde [] — por eso fallaban las pruebas del 4-oct.
// Fechas en dd/mm/aaaa (bootstrap-datepicker del portal); rdFechas 2 = «Fechas por procedimiento» (1 = por contrato).
// Probado el 5-oct-2026: desc_procedimiento='pavimentacion' vigente/obra → 31; con 01/09/2026-05/10/2026 → 3.
export function formBusqueda(token, { materia, estatus, texto = '', tipoLicitacion = '-1', desde = '', hasta = '' }) {
  return new URLSearchParams({
    Unidades_Responsables: '', Tipo_de_Licitaci_n: String(tipoLicitacion), Estatus: String(estatus), num_pricedimineto: '',
    num_contrato: '', fechainicio: String(desde), fechafin: String(hasta), TipoProc: String(materia), nom_proveedor: '',
    concepto_contratacion: '', rdFechas: '2', desc_procedimiento: String(texto), csrfmiddlewaretoken: token,
  });
}

// 'AAAA-MM-DD' → 'DD/MM/AAAA' ('' si no es una fecha válida).
export function fechaDmy(iso) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Valida los filtros de una búsqueda de usuario y arma las consultas al portal: UNA por tipo de contratación pedido
// (obra pública o servicios relacionados; sin tipo = las dos, máximo 2 consultas). Devuelve {error} o
// {filtros (normalizados, para la bitácora), consultas: [{materia, estatus, texto, tipoLicitacion, desde, hasta}]}.
export function filtrosManual(b) {
  const x = b && typeof b === 'object' ? b : {};
  const texto = String(x.texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const tipo = String(x.tipo_contratacion ?? '');
  if (tipo && !MATERIA[tipo]) return { error: 'Tipo de contratación no válido.' };
  const proc = String(x.tipo_procedimiento ?? '');
  if (proc && !TIPO_LICITACION[proc]) return { error: 'Tipo de procedimiento no válido.' };
  const est = x.estatus === undefined || x.estatus === null ? 'vigente' : String(x.estatus);
  if (est && !ESTATUS_PORTAL[est]) return { error: 'Estatus no válido.' };
  const desde = x.desde ? fechaDmy(x.desde) : '';
  const hasta = x.hasta ? fechaDmy(x.hasta) : '';
  if ((x.desde && !desde) || (x.hasta && !hasta)) return { error: 'Las fechas van como AAAA-MM-DD.' };
  if (desde && hasta && String(x.desde) > String(x.hasta)) return { error: 'La fecha inicial es posterior a la final.' };
  if (!est && !texto && !desde && !hasta) return { error: 'Con «Todos los estatus» escribe un texto o un rango de fechas: sin eso el portal devolvería miles de registros.' };
  const max = Math.max(1, Math.min(200, Math.trunc(Number(x.max_resultados ?? 50)) || 50));
  const tipos = tipo ? [tipo] : Object.keys(MATERIA);
  const filtros = { texto, tipo_contratacion: tipo, tipo_procedimiento: proc, estatus: est,
                    desde: desde ? String(x.desde) : '', hasta: hasta ? String(x.hasta) : '', max_resultados: max };
  const consultas = tipos.map((t) => ({ materia: MATERIA[t], estatus: est ? ESTATUS_PORTAL[est] : '-1', texto,
                                        tipoLicitacion: proc ? TIPO_LICITACION[proc] : '-1', desde, hasta }));
  return { filtros, consultas };
}

export function tokenCsrf(html) {
  const m = String(html).match(/csrfmiddlewaretoken:\s*"([^"]+)"/) || String(html).match(/name="csrfmiddlewaretoken"[^>]*value="([^"]+)"/);
  return m ? m[1] : null;
}

const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function tipoProcedimiento(s) {
  const t = sinAcentos(s);
  if (!t) return null;
  if (t.startsWith('licitacion')) return 'licitacion_publica';
  if (t.startsWith('invitacion')) return 'invitacion';
  if (t.startsWith('adjudicacion')) return 'adjudicacion_directa';
  return 'otro';
}
export function tipoContratacion(s) {
  const t = sinAcentos(s);
  if (!t) return null;
  if (t.startsWith('servicios relacionados')) return 'servicios_obra';
  if (t.startsWith('obra')) return 'obra_publica';
  if (t.startsWith('adquisicion')) return 'adquisicion';
  if (t.startsWith('arrendamiento')) return 'arrendamiento';
  if (t.startsWith('servicios')) return 'servicios';
  return 'otro';
}
export function estatus(s) {
  const t = sinAcentos(s);
  if (!t) return null;
  if (t.startsWith('vigente')) return 'vigente';
  if (t.includes('seguimiento')) return 'en_seguimiento';
  if (t.startsWith('terminado')) return 'terminado';
  if (t.startsWith('cancelad')) return 'cancelado';
  return 'otro';
}
export function municipio(unidad) {
  const m = String(unidad ?? '').trim().match(/^Municipio de (.+)$/i);
  return m ? m[1].trim() : null;
}

// Un renglón de POST /busqueda/ → convocatoria normalizada (sin fechas: esas vienen del detalle).
export function normalizarFila(x) {
  const id = x && x.id_procedimiento != null ? String(x.id_procedimiento) : null;
  if (!id) return null;
  const link = x.link_detalle ? new URL(String(x.link_detalle), BASE).toString() : null;
  return {
    fuente: 'chihuahua',
    id_externo: id,
    numero_procedimiento: x.numero_procedimiento ? String(x.numero_procedimiento).trim() : null,
    titulo: String(x.descripcion_procedimiento ?? '').trim(),
    dependencia: x.unidad_compradora ? String(x.unidad_compradora).trim() : null,
    unidad_compradora: x.unidad_solicitante ? String(x.unidad_solicitante).trim() : null,
    tipo_procedimiento: tipoProcedimiento(x.tipo_procedimiento),
    tipo_contratacion: tipoContratacion(x.materia),
    entidad: 'Chihuahua',
    municipio: municipio(x.unidad_compradora),
    estatus: estatus(x.estatus),
    url_detalle: link,
    datos: { busqueda: { concepto_contratacion: x.concepto_contratacion ?? null, materia: x.materia ?? null,
                         tipo_procedimiento: x.tipo_procedimiento ?? null, estatus: x.estatus ?? null } },
  };
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
const limpiar = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENT[m] ?? m)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();

// dd/mm/aaaa [+ HH:MM] → ISO con la hora de Chihuahua (UTC-6 todo el año desde 2022; Juárez usa horario de
// verano de EE. UU., UTC-7 en invierno: diferencia de 1 h aceptada, se guarda la hora que publica el portal).
export function fechaIso(fecha, hora) {
  const f = String(fecha ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!f) return null;
  const h = String(hora ?? '').match(/(\d{1,2}):(\d{2})/);
  const pad = (n) => String(n).padStart(2, '0');
  return `${f[3]}-${pad(f[2])}-${pad(f[1])}T${h ? pad(h[1]) + ':' + h[2] : '00:00'}:00-06:00`;
}

// Página /licitaciones/<id>/ → {estatus, campos{}, publicacion, junta_aclaraciones, apertura, fallo, documentos[]}
export function parseDetalle(html) {
  const s = String(html);
  const campos = {};
  const re = /<p class="bold">([\s\S]*?)<\/p>\s*<\/div>\s*<div[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(s))) {
    const k = limpiar(m[1]);
    if (k && !(k in campos)) campos[k] = limpiar(m[2]);
  }
  const est = s.match(/Estatus del Procedimiento<\/h4>\s*<h4[^>]*>([\s\S]*?)<\/h4>/i);
  const documentos = [];
  const filas = s.split(/<tr[\s>]/i).slice(1);
  for (const f of filas) {
    const href = f.match(/<a[^>]+href="([^"]+)"/i);
    if (!href) continue;
    const celdas = [...f.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => limpiar(c[1]));
    if (celdas.length < 2) continue;
    const url = href[1].replace(/&amp;/g, '&');
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) continue;
    documentos.push({ tipo: celdas[0] || null, fecha: (celdas[1] || '').match(/\d{1,2}\/\d{1,2}\/\d{4}/)?.[0] ?? null,
                      url: new URL(url, BASE).toString() });
  }
  const g = (k) => campos[k] ?? null;
  return {
    estatus: est ? estatus(limpiar(est[1])) : null,
    estatus_texto: est ? limpiar(est[1]) : null,
    campos,
    publicacion: fechaIso(g('Fecha de publicación de la convocatoria')),
    junta_aclaraciones: fechaIso(g('Fecha de junta de aclaraciones'), g('Hora junta de aclaraciones')),
    apertura: fechaIso(g('Fecha de apertura de propuestas'), g('Hora apertura de propuestas')),
    fallo: fechaIso(g('Fecha del fallo'), g('Hora del fallo')),
    documentos,
  };
}

// Mezcla el detalle con la convocatoria: lo que trae el detalle manda.
export function conDetalle(conv, det, ahoraIso) {
  const c = { ...conv };
  for (const k of ['publicacion', 'junta_aclaraciones', 'apertura', 'fallo']) if (det[k]) c[k] = det[k];
  if (det.estatus) c.estatus = det.estatus;
  const campos = det.campos || {};
  if (campos['Descripción del procedimiento']) c.titulo = campos['Descripción del procedimiento'];
  if (campos['Descripción ente público contratante']) c.dependencia = campos['Descripción ente público contratante'];
  if (campos['Descripción ente público solicitante']) c.unidad_compradora = campos['Descripción ente público solicitante'];
  if (campos['Materia']) c.tipo_contratacion = tipoContratacion(campos['Materia']);
  c.datos = { ...(c.datos || {}), detalle: { campos, documentos: det.documentos } };
  c.detalle_at = ahoraIso;
  return c;
}
