// Bucket privado `licitaciones` (US-804): una empresa no puede leer, listar, firmar ni borrar archivos de otra,
// ni subir a la carpeta de otra. Corre contra producción con dos sesiones de QA (nivel 100):
//   OBRA_QA_TOKEN (o QA_TOKEN_A) = empresa A (Supernova) y QA_TOKEN_B = empresa «QA Aislamiento».
// Sin ellas las pruebas se omiten (cargar .env: set -a; . ./.env; set +a). Nunca pegar tokens aquí: el repo es público.
// Opcional: OBRA_QA_TOKEN_N70 (sesión de un usuario nivel 70 de la empresa A) comprueba que D3 aplica al bucket.
// Limpia lo que sube (también si una aserción falla).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const A = process.env.QA_TOKEN_A || process.env.OBRA_QA_TOKEN || '';
const B = process.env.QA_TOKEN_B || '';
const N70 = process.env.OBRA_QA_TOKEN_N70 || '';
const skip = A && B ? false : 'QA_TOKEN_A/OBRA_QA_TOKEN y QA_TOKEN_B no definidos';
const BUCKET = 'licitaciones';

const h = (token, extra = {}) => ({ apikey: ANON, Authorization: `Bearer ${ANON}`, ...(token ? { 'x-obra-token': token } : {}), ...extra });
async function empresaDe(token) {
  const r = await fetch(`${SB}/rest/v1/rpc/validar_sesion`, { method: 'POST', headers: h(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ p_token: token }) });
  const j = await r.json();
  return Array.isArray(j) && j[0] ? j[0].empresa_id : null;
}
// PDF mínimo válido (el bucket valida el tipo declarado, no el contenido)
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const subir = (token, path, mime = 'application/pdf', body = PDF) =>
  fetch(`${SB}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: h(token, { 'Content-Type': mime, 'x-upsert': 'false' }), body });
const firmar = (token, path) =>
  fetch(`${SB}/storage/v1/object/sign/${BUCKET}/${path}`, { method: 'POST', headers: h(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: 60 }) });
const bajar = (token, path) => fetch(`${SB}/storage/v1/object/authenticated/${BUCKET}/${path}`, { headers: h(token) });
const listar = async (token, prefix) => {
  const r = await fetch(`${SB}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: h(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ prefix, limit: 100 }) });
  return r.ok ? r.json() : [];
};
const borrar = async (token, paths) => {
  const r = await fetch(`${SB}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: h(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: paths }) });
  return r.ok ? r.json() : [];
};

test('bucket licitaciones: aislamiento entre empresas y rutas válidas', { skip }, async () => {
  const empA = await empresaDe(A);
  const empB = await empresaDe(B);
  assert.ok(empA && empB && empA !== empB, 'las dos sesiones de QA deben ser de empresas distintas');
  const ts = Date.now();
  const carpetaA = `empresa/${empA}/licitaciones/qa-${ts}/bases`;
  const pathA = `${carpetaA}/bases-qa.pdf`;
  const pathExpA = `empresa/${empA}/expediente/opinion_sat/qa-${ts}.pdf`;
  const pathB = `empresa/${empB}/licitaciones/qa-${ts}/bases/bases-qa.pdf`;
  const creados = { A: [], B: [] };
  try {
    // A sube a su licitación y a su expediente
    let r = await subir(A, pathA);
    assert.equal(r.status, 200, `A sube bases: ${r.status} ${await r.text()}`);
    creados.A.push(pathA);
    r = await subir(A, pathExpA);
    assert.equal(r.status, 200, `A sube al expediente: ${r.status} ${await r.text()}`);
    creados.A.push(pathExpA);

    // A lee, firma y lista lo suyo
    r = await firmar(A, pathA);
    assert.equal(r.status, 200, 'A firma su URL');
    const { signedURL } = await r.json();
    assert.ok(signedURL, 'A recibe la URL firmada');
    const descarga = await fetch(`${SB}/storage/v1${signedURL}`);
    assert.equal(descarga.status, 200, 'la URL firmada de A descarga');
    assert.equal((await bajar(A, pathA)).status, 200, 'A descarga con su sesión');
    assert.ok((await listar(A, carpetaA + '/')).some((f) => f.name === 'bases-qa.pdf'), 'A ve su archivo al listar');

    // B no puede leer, firmar, listar ni borrar lo de A
    assert.notEqual((await firmar(B, pathA)).status, 200, 'B NO debe firmar la URL de A');
    assert.notEqual((await bajar(B, pathA)).status, 200, 'B NO debe descargar el archivo de A');
    assert.equal((await listar(B, carpetaA + '/')).length, 0, 'B NO debe listar la carpeta de A');
    await borrar(B, [pathA]);
    assert.equal((await bajar(A, pathA)).status, 200, 'el borrado de B no debe afectar el archivo de A');
    // Sin sesión tampoco
    assert.notEqual((await firmar('', pathA)).status, 200, 'sin sesión NO se firma');

    // B no puede subir a la carpeta de A; sí a la suya
    r = await subir(B, `empresa/${empA}/licitaciones/qa-${ts}/bases/intruso.pdf`);
    assert.notEqual(r.status, 200, 'B NO debe subir a la carpeta de A');
    if (r.status === 200) creados.A.push(`empresa/${empA}/licitaciones/qa-${ts}/bases/intruso.pdf`);
    r = await subir(B, pathB);
    assert.equal(r.status, 200, `B sube a su propia carpeta: ${r.status} ${await r.text()}`);
    creados.B.push(pathB);
    assert.notEqual((await firmar(A, pathB)).status, 200, 'A NO debe firmar la URL de B');

    // Rutas fuera de licitaciones|expediente y tipos no admitidos se rechazan
    r = await subir(A, `empresa/${empA}/otra-cosa/qa-${ts}.pdf`);
    assert.notEqual(r.status, 200, 'carpeta de tercer nivel no admitida');
    if (r.status === 200) creados.A.push(`empresa/${empA}/otra-cosa/qa-${ts}.pdf`);
    r = await subir(A, `${carpetaA}/script.html`, 'text/html', new TextEncoder().encode('<b>x</b>'));
    assert.notEqual(r.status, 200, 'tipo text/html no admitido');
    if (r.status === 200) creados.A.push(`${carpetaA}/script.html`);

    // D3: un usuario de nivel < 80 de la misma empresa no ve nada (opcional)
    if (N70) {
      assert.notEqual((await firmar(N70, pathA)).status, 200, 'nivel 70 NO debe firmar');
      assert.equal((await listar(N70, carpetaA + '/')).length, 0, 'nivel 70 NO debe listar');
    }
  } finally {
    if (creados.A.length) await borrar(A, creados.A);
    if (creados.B.length) await borrar(B, creados.B);
  }
  assert.equal((await listar(A, carpetaA + '/')).length, 0, 'la prueba limpia lo que sube');
});
