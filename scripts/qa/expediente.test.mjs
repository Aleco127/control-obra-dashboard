// Expediente de la empresa (épica B): funciones puras de src/js/expediente.js y RPC por la API real.
// Sin tokens sólo corren las pruebas puras. Tokens del .env (set -a; . ./.env; set +a). Repo público: nunca pegar tokens.
//   OBRA_QA_TOKEN (o QA_TOKEN_A) empresa A nivel 100 · QA_TOKEN_B otra empresa
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Expediente = require('../../src/js/expediente.js');

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const A = process.env.QA_TOKEN_A || process.env.OBRA_QA_TOKEN || '';
const B = process.env.QA_TOKEN_B || '';
const skip = A && B ? false : 'QA_TOKEN_A/OBRA_QA_TOKEN y QA_TOKEN_B no definidos';

async function rest(path, token, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(token ? { 'x-obra-token': token } : {}), ...(opts.headers || {}) },
  });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
const rpc = (name, token, args = {}) => rest(`rpc/${name}`, token, { method: 'POST', body: JSON.stringify(args) });

// ---- US-807: datos legales ------------------------------------------------------------------------------------------
test('datosParaGuardar: limpia, convierte montos y valida RFC y fechas', () => {
  const d = Expediente.datosParaGuardar({ representante_cargo: '  Administrador único ', representante_rfc: 'coga850101ab1',
    capital_contable: '$1,250,000.50', escritura_fecha: '2020-02-13', cmic_registro: '', otro_campo: 'x' });
  assert.deepEqual(d, { representante_cargo: 'Administrador único', representante_rfc: 'COGA850101AB1', capital_contable: 1250000.5, escritura_fecha: '2020-02-13', cmic_registro: null });
  assert.throws(() => Expediente.datosParaGuardar({ capital_contable: 'mucho' }), /importe válido/);
  assert.throws(() => Expediente.datosParaGuardar({ capital_contable: '-5' }), /importe válido/);
  assert.throws(() => Expediente.datosParaGuardar({ escritura_fecha: '13/02/2020' }), /fecha no es válida/);
  assert.throws(() => Expediente.datosParaGuardar({ representante_rfc: 'ABC' }), /RFC/);
  assert.equal(Expediente.domicilio({ direccion: 'Calle 1 #2', ciudad: 'Cuauhtémoc', estado: 'Chihuahua', codigo_postal: '31500' }), 'Calle 1 #2, Cuauhtémoc, Chihuahua, C.P. 31500');
  assert.equal(Expediente.domicilio(null), '');
});

test('los campos de Datos coinciden con la lista del RPC 088', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../../migrations/088_guardar_empresa_expediente.sql', import.meta.url), 'utf8');
  const lista = (n) => [...sql.match(new RegExp(`${n}\\s+text\\[\\] := ARRAY\\[([^\\]]*)\\]`))[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  const delRpc = [...lista('v_txt'), ...lista('v_num'), ...lista('v_fec')].sort();
  assert.deepEqual(Expediente.CAMPOS_DATOS.map((c) => c.k).sort(), delRpc);
});

test('guardar_empresa_expediente: nivel 100 guarda en su empresa; sin sesión y con llaves ajenas se rechaza', { skip }, async () => {
  const antes = await rest('empresa_expediente?select=*', A);
  assert.equal(antes.status, 200);
  const previo = antes.body[0] || null;
  const antesB = await rest('empresa_expediente?select=empresa_id', B);
  const previoB = antesB.body[0] || null;
  try {
    const sinSesion = await rpc('guardar_empresa_expediente', '', { p_datos: { cmic_registro: 'x' } });
    assert.notEqual(sinSesion.status, 200, 'sin sesión no guarda');
    const ajena = await rpc('guardar_empresa_expediente', A, { p_datos: { empresa_id: 999 } });
    assert.equal(ajena.status, 400, JSON.stringify(ajena.body));
    const malo = await rpc('guardar_empresa_expediente', A, { p_datos: { capital_contable: 'abc' } });
    assert.equal(malo.status, 400);

    const marca = `QA-807-${Date.now()}`;
    const ok = await rpc('guardar_empresa_expediente', A, { p_datos: { cmic_registro: marca, capital_contable: 1234.5, poliza_rc_vigencia: '2027-01-31', representante_rfc: 'coga850101ab1' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.cmic_registro, marca);
    assert.equal(Number(ok.body.capital_contable), 1234.5);
    assert.equal(ok.body.representante_rfc, 'COGA850101AB1');
    // Clave ausente = no tocar
    const ok2 = await rpc('guardar_empresa_expediente', A, { p_datos: { afianzadora: 'Fianzas QA' } });
    assert.equal(ok2.body.cmic_registro, marca);
    // La otra empresa no ve la fila de A
    const vistaB = await rest('empresa_expediente?select=cmic_registro', B);
    assert.ok(!(vistaB.body || []).some((x) => x.cmic_registro === marca), 'B no ve el expediente de A');
    const empA = ok.body.empresa_id;
    const okB = await rpc('guardar_empresa_expediente', B, { p_datos: { notas: 'QA aislamiento' } });
    assert.equal(okB.status, 200, JSON.stringify(okB.body));
    assert.notEqual(okB.body.empresa_id, empA, 'cada sesión escribe en su propia empresa');
  } finally {
    if (previo) {
      const campos = Expediente.CAMPOS_DATOS.map((c) => c.k);
      await rpc('guardar_empresa_expediente', A, { p_datos: Object.fromEntries(campos.map((k) => [k, previo[k]])) });
    } else {
      await rest('empresa_expediente?empresa_id=not.is.null', A, { method: 'DELETE' });
    }
    if (!previoB) await rest('empresa_expediente?empresa_id=not.is.null', B, { method: 'DELETE' });
  }
});

// ---- US-808: documentos con vigencia --------------------------------------------------------------------------------
test('archivos: tipo por extensión, validación de 50 MB, nombre seguro, ruta del bucket y SHA-256', async () => {
  assert.equal(Expediente.tipoArchivo('Opinión SAT.PDF'), 'application/pdf');
  assert.equal(Expediente.tipoArchivo('plano.dwg'), 'image/vnd.dwg');
  assert.equal(Expediente.tipoArchivo('virus.exe'), null);
  assert.equal(Expediente.validarArchivo({ name: 'a.pdf', size: 10 }), null);
  assert.match(Expediente.validarArchivo({ name: 'a.exe', size: 10 }), /no es de un tipo admitido/);
  assert.match(Expediente.validarArchivo({ name: 'a.pdf', size: 51 * 1024 * 1024 }), /máximo es 50 MB/);
  assert.match(Expediente.validarArchivo(null), /Elige un archivo/);
  assert.equal(Expediente.nombreSeguro('Opinión de cumplimiento (SAT) #1.pdf'), 'Opinion_de_cumplimiento_SAT_1.pdf');
  assert.equal(Expediente.rutaArchivo(1, 'opinion_sat', 'Opinión.pdf', 1700000000000), 'empresa/1/expediente/opinion_sat/1700000000000_Opinion.pdf');
  assert.equal(Expediente.nombreDeRuta('empresa/1/expediente/opinion_sat/1700000000000_Opinion.pdf'), 'Opinion.pdf');
  const h = await Expediente.sha256Hex(new TextEncoder().encode('abc'));
  assert.equal(h, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('documentos: agrupados por categoría sin reemplazados, cadena de versiones y validación del formulario', () => {
  const docs = [
    { id: 1, categoria: 'opinion_sat', nombre: 'SAT agosto', estado: 'reemplazado', fecha_vencimiento: '2026-09-01' },
    { id: 2, categoria: 'opinion_sat', nombre: 'SAT septiembre', estado: 'reemplazado', reemplaza_id: 1, fecha_vencimiento: '2026-10-01' },
    { id: 3, categoria: 'opinion_sat', nombre: 'SAT octubre', estado: 'por_vencer', reemplaza_id: 2, fecha_vencimiento: '2026-10-31' },
    { id: 4, categoria: 'acta_constitutiva', nombre: 'Acta', estado: 'sin_vencimiento' },
    { id: 5, categoria: 'identificacion', nombre: 'INE vieja', estado: 'vencido', fecha_vencimiento: '2026-01-01' },
    { id: 6, categoria: 'identificacion', nombre: 'Pasaporte', estado: 'vigente', fecha_vencimiento: '2030-01-01' },
  ];
  const g = Expediente.agruparPorCategoria(docs);
  assert.deepEqual(g.map((x) => x.cat.k), ['opinion_sat', 'acta_constitutiva', 'identificacion'], 'en el orden de CATEGORIAS');
  assert.deepEqual(g[0].docs.map((d) => d.id), [3], 'sin reemplazados');
  assert.deepEqual(g[2].docs.map((d) => d.id), [5, 6], 'el que vence antes primero');
  assert.deepEqual(Expediente.cadenaVersiones(docs, 3).map((d) => d.id), [3, 2, 1]);
  assert.deepEqual(Expediente.cadenaVersiones(docs, 1).map((d) => d.id), [3, 2, 1], 'desde una versión vieja también sube a la vigente');
  assert.deepEqual(Expediente.cadenaVersiones(docs, 4).map((d) => d.id), [4]);
  const falta = Expediente.faltantes(docs);
  assert.ok(!falta.includes('opinion_sat') && !falta.includes('identificacion') && !falta.includes('acta_constitutiva'));
  assert.ok(falta.includes('opinion_imss') && !falta.includes('otro'));
  assert.equal(Expediente.validarDocumento({ categoria: 'opinion_sat', nombre: 'x' }, false), null);
  assert.match(Expediente.validarDocumento({ categoria: '', nombre: 'x' }, false), /categoría/);
  assert.match(Expediente.validarDocumento({ categoria: 'poder', nombre: ' ' }, false), /nombre/);
  assert.match(Expediente.validarDocumento({ categoria: 'poder', nombre: 'x', fecha_emision: '2026-10-02', fecha_vencimiento: '2026-10-01' }, false), /anterior a la emisión/);
  assert.match(Expediente.validarDocumento({ categoria: 'poder', nombre: 'x' }, true), /Elige un archivo/);
  assert.equal(Expediente.vencimientoSugerido('opinion_imss', '2026-10-04'), '2026-11-03');
  assert.equal(Expediente.vencimientoSugerido('opinion_infonavit', '2026-10-04'), '2026-11-03');
  assert.equal(Expediente.vencimientoSugerido('acta_constitutiva', '2026-10-04'), null);
});
