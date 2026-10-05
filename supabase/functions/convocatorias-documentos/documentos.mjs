// Funciones puras de convocatorias-documentos (US-848): documentos públicos del detalle de Contrataciones Chihuahua.
// Sin APIs de Deno ni de Node: las usa index.ts y las prueba scripts/qa/convocatorias-documentos.test.mjs.

export const BASE = 'https://contrataciones.chihuahua.gob.mx';
// Sólo se bajan enlaces de estos hosts (los que publica el detalle): nada de URLs arbitrarias (SSRF).
export const HOSTS = new Set(['contratosadm.chihuahua.gob.mx', 'contrataciones.chihuahua.gob.mx']);
export const MAX_BYTES = 50 * 1024 * 1024;   // límite por archivo del bucket `licitaciones`

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
const limpiar = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENT[m] ?? m)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();
const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

/** Tabla «Documentos» del detalle /licitaciones/<id>/ → [{tipo, fecha, url}] (misma lectura que parseDetalle). */
export function parseDocumentos(html) {
  const out = [];
  for (const f of String(html).split(/<tr[\s>]/i).slice(1)) {
    const href = f.match(/<a[^>]+href="([^"]+)"/i);
    if (!href) continue;
    const celdas = [...f.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => limpiar(c[1]));
    if (celdas.length < 2) continue;
    const url = href[1].replace(/&amp;/g, '&');
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) continue;
    out.push({ tipo: celdas[0] || null, fecha: (celdas[1] || '').match(/\d{1,2}\/\d{1,2}\/\d{4}/)?.[0] ?? null, url: new URL(url, BASE).toString() });
  }
  return out;
}

/**
 * Id estable de cada documento («tipo|fecha|n»): los enlaces del portal llevan tokens que pueden cambiar entre
 * lecturas, así que se identifica por tipo y fecha (n = cuántos iguales van antes). Sirve para no volver a bajar.
 */
export function conIds(docs) {
  const vistos = new Map();
  return (docs || []).map((d) => {
    const base = `${sinAcentos(d.tipo) || 'documento'}|${d.fecha || ''}`;
    const n = (vistos.get(base) || 0) + 1; vistos.set(base, n);
    return { ...d, id: `${base}|${n}` };
  });
}

/** ¿La URL es de un host permitido y https? */
export function urlPermitida(u) {
  try { const x = new URL(String(u)); return x.protocol === 'https:' && HOSTS.has(x.hostname); } catch { return false; }
}

const EXT_MIME = { 'application/pdf': 'pdf', 'application/zip': 'zip', 'application/x-zip-compressed': 'zip',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'image/jpeg': 'jpg', 'image/png': 'png' };

/**
 * Nombre legible: «Convocatoria 2026-10-02.pdf». El portal manda nombres con un sello de hora que cambia en cada
 * descarga («Convocatoria_05102026111027LAGHE.pdf»): se usan el tipo y la fecha del detalle y sólo la extensión real.
 */
export function nombreArchivo(tipo, fecha, disposicion, contentType) {
  const m = String(disposicion || '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  let ext = m ? (decodeURIComponent(m[1]).split('.').pop() || '').toLowerCase() : '';
  if (!/^[a-z0-9]{2,5}$/.test(ext)) ext = EXT_MIME[String(contentType || '').split(';')[0].trim().toLowerCase()] || 'pdf';
  const f = String(fecha || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const dia = f ? `${f[3]}-${f[2].padStart(2, '0')}-${f[1].padStart(2, '0')}` : '';
  const t = String(tipo || 'Documento').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Documento';
  return `${t}${dia ? ' ' + dia : ''}.${ext}`;
}
