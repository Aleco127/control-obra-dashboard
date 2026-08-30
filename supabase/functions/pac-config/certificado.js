// Lectura del certificado de sello digital (.cer del SAT, DER X.509). Módulo puro: sin red y sin dependencias,
// para poder probarlo en node (scripts/qa/cfdi-emitir.test.mjs) y usarlo desde la Edge Function pac-config. US-231.
//
// Sólo necesitamos tres datos del certificado: número de serie, vigencia y a qué RFC pertenece. Se leen
// recorriendo el DER a mano, que sale más barato que arrastrar una librería de criptografía a la función.

/** Lee un TLV en DER y devuelve { tag, inicio, fin, contenido } donde fin es el índice siguiente al valor. */
function tlv(bytes, i) {
  const tag = bytes[i];
  let len = bytes[i + 1], p = i + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | bytes[p + k];
    p += n;
  }
  return { tag: tag, inicio: p, fin: p + len, contenido: bytes.subarray(p, p + len) };
}

function fecha(bytes) {
  const s = String.fromCharCode.apply(null, Array.from(bytes));
  const m = s.match(/^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  const anio = m[1].length === 2 ? (Number(m[1]) >= 50 ? 1900 + Number(m[1]) : 2000 + Number(m[1])) : Number(m[1]);
  return `${anio}-${m[2]}-${m[3]}`;
}

/**
 * Devuelve { serie, vigenciaIni, vigenciaFin, rfc } del .cer, o null si el archivo no es un certificado.
 * `cer` es un Uint8Array con el DER (el .cer del SAT ya viene en DER, no en PEM).
 */
export function leerCertificado(cer) {
  try {
    const b = cer instanceof Uint8Array ? cer : new Uint8Array(cer);
    if (b[0] !== 0x30) return null;
    const cert = tlv(b, 0);          // Certificate
    const tbs = tlv(b, cert.inicio); // TBSCertificate
    let i = tbs.inicio;
    if (b[i] === 0xa0) i = tlv(b, i).fin;              // version [0]
    const serial = tlv(b, i); i = serial.fin;          // serialNumber
    i = tlv(b, i).fin;                                 // signature
    i = tlv(b, i).fin;                                 // issuer
    const validez = tlv(b, i);                         // validity
    const desde = tlv(b, validez.inicio);
    const hasta = tlv(b, desde.fin);
    // El número de serie del CSD del SAT son 20 dígitos guardados como ASCII dentro del INTEGER.
    const serieTxt = String.fromCharCode.apply(null, Array.from(serial.contenido)).replace(/[^\d]/g, '');
    // El RFC vive en el subject (OID 2.5.4.45); basta con encontrarlo en el texto del certificado.
    const texto = String.fromCharCode.apply(null, Array.from(b)).replace(/[^\x20-\x7E]/g, ' ');
    // Sin \b al final: en el DER el RFC va pegado al byte de longitud del siguiente campo ("...IS126083...").
    const rfc = (texto.match(/[ ,/]([A-ZÑ&]{3,4}\d{6}[A-Z\d]{3})/) || [])[1] || null;
    return { serie: serieTxt || null, vigenciaIni: fecha(desde.contenido), vigenciaFin: fecha(hasta.contenido), rfc: rfc };
  } catch {
    return null;
  }
}

/** Un CSD sirve para sellar; un FIEL (e.firma) no. El SAT los distingue por el uso de llave, pero para el
 *  usuario basta un aviso claro cuando el certificado no corresponde al RFC que capturó. */
export function revisarCsd(info, rfcEsperado) {
  const errores = [];
  if (!info) return ['El archivo .cer no se pudo leer. Asegúrate de subir el certificado que te dio el SAT, sin comprimir.'];
  const hoy = new Date().toISOString().slice(0, 10);
  if (info.vigenciaFin && info.vigenciaFin < hoy) errores.push(`Ese certificado venció el ${info.vigenciaFin}. Tramita uno nuevo en el SAT.`);
  if (info.vigenciaIni && info.vigenciaIni > hoy) errores.push(`Ese certificado entra en vigor el ${info.vigenciaIni}.`);
  if (rfcEsperado && info.rfc && info.rfc.toUpperCase() !== String(rfcEsperado).toUpperCase()) {
    errores.push(`El certificado es del RFC ${info.rfc} y capturaste ${String(rfcEsperado).toUpperCase()}.`);
  }
  return errores;
}
