// Esquema de licitaciones, expediente y banco de precios (US-801 a US-803) por la API real (PostgREST como anon +
// x-obra-token). Comprueba D3 en el servidor: nivel >= 80 lee y escribe; otra empresa no ve nada; nivel < 80 no ve
// nada ni puede buscar insumos. Tokens del .env (set -a; . ./.env; set +a); sin ellos se omite. Repo público: nunca
// pegar tokens aquí.
//   OBRA_QA_TOKEN (o QA_TOKEN_A) empresa A nivel 100 · QA_TOKEN_B otra empresa · OBRA_QA_TOKEN_N70 (opcional) nivel 70 de A
// Crea una licitación «QA-ESQ-<ts>» con un requisito, un insumo con un precio y un documento, y los borra al final.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const A = process.env.QA_TOKEN_A || process.env.OBRA_QA_TOKEN || '';
const B = process.env.QA_TOKEN_B || '';
const N70 = process.env.OBRA_QA_TOKEN_N70 || '';
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

const TABLAS = ['licitaciones', 'licitacion_archivos', 'licitacion_requisitos', 'licitacion_requisito_historial',
  'perfiles_convocante', 'empresa_expediente', 'empresa_documentos', 'empresa_documentos_estado', 'personal_tecnico',
  'obras_ejecutadas', 'maquinaria', 'insumos', 'insumo_precios', 'insumos_resumen', 'conceptos_historicos',
  'concepto_precios', 'matriz_componentes', 'parametros_laborales'];

test('las 18 vistas nuevas responden a nivel 100', { skip }, async () => {
  for (const t of TABLAS) {
    const r = await rest(`${t}?select=*&limit=1`, A);
    assert.equal(r.status, 200, `${t}: ${r.status} ${JSON.stringify(r.body)}`);
  }
});

test('D3 y aislamiento: A escribe, B y nivel 70 no ven nada; historial por trigger; buscar_insumos', { skip }, async () => {
  const ts = Date.now();
  const codigo = `QA-ESQ-${ts}`;
  let licId = null, insId = null, docId = null;
  try {
    const lic = await rest('licitaciones', A, { method: 'POST', body: JSON.stringify({ codigo, nombre: 'Prueba de esquema', plaza: 'cuauhtemoc' }) });
    assert.equal(lic.status, 201, JSON.stringify(lic.body));
    licId = lic.body[0].id;
    assert.ok(lic.body[0].empresa_id, 'empresa_id lo pone el servidor desde la sesión');

    // Código único por empresa (sin importar mayúsculas)
    const dup = await rest('licitaciones', A, { method: 'POST', body: JSON.stringify({ codigo: codigo.toLowerCase(), nombre: 'dup' }) });
    assert.equal(dup.status, 409, 'el código se repite dentro de la empresa');

    const req = await rest('licitacion_requisitos', A, { method: 'POST', body: JSON.stringify({ licitacion_id: licId, anexo_id: 'AL-01', sobre: 'legal', descripcion: 'Acta constitutiva', origen: 'expediente' }) });
    assert.equal(req.status, 201, JSON.stringify(req.body));
    const upd = await rest(`licitacion_requisitos?id=eq.${req.body[0].id}`, A, { method: 'PATCH', body: JSON.stringify({ estado: 'en_revision' }) });
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    const hist = await rest(`licitacion_requisito_historial?requisito_id=eq.${req.body[0].id}&order=id`, A);
    assert.deepEqual(hist.body.map((x) => [x.estado_anterior, x.estado_nuevo]), [[null, 'pendiente'], ['pendiente', 'en_revision']]);
    assert.ok(hist.body.every((x) => x.usuario_id), 'el historial guarda el usuario de la sesión');
    const histIns = await rest('licitacion_requisito_historial', A, { method: 'POST', body: JSON.stringify({ requisito_id: req.body[0].id, licitacion_id: licId, estado_nuevo: 'validado' }) });
    assert.notEqual(histIns.status, 201, 'nadie escribe el historial a mano');

    const ins = await rest('insumos', A, { method: 'POST', body: JSON.stringify({ clave: `QA-${ts}`, descripcion: 'Cemento gris QA esquema', unidad: 'bulto', tipo: 'material' }) });
    assert.equal(ins.status, 201, JSON.stringify(ins.body));
    insId = ins.body[0].id;
    assert.equal(ins.body[0].descripcion_norm, 'cemento gris qa esquema');
    const p1 = await rest('insumo_precios', A, { method: 'POST', body: JSON.stringify({ insumo_id: insId, precio: 250, fecha: '2026-08-01', plaza: 'cuauhtemoc', fuente: 'referencia' }) });
    assert.equal(p1.status, 201, JSON.stringify(p1.body));
    // Idempotente: misma (insumo, fecha, plaza, fuente, licitación NULL) => conflicto; con upsert no duplica
    const p2 = await rest('insumo_precios?on_conflict=insumo_id,fecha,plaza,fuente,licitacion_id', A, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ insumo_id: insId, precio: 255, fecha: '2026-08-01', plaza: 'cuauhtemoc', fuente: 'referencia' }) });
    assert.ok([200, 201].includes(p2.status), `upsert: ${p2.status} ${JSON.stringify(p2.body)}`);
    const precios = await rest(`insumo_precios?insumo_id=eq.${insId}`, A);
    assert.equal(precios.body.length, 1, 'reimportar no duplica');
    assert.equal(Number(precios.body[0].precio), 255);

    const res = await rest(`insumos_resumen?id=eq.${insId}`, A);
    assert.equal(Number(res.body[0].ultimo_precio), 255);
    assert.equal(res.body[0].muestras, 1);

    const bus = await rpc('buscar_insumos', A, { p_texto: 'semento gris qa', p_plaza: 'juarez' });
    assert.equal(bus.status, 200, JSON.stringify(bus.body));
    const hit = bus.body.find((x) => x.id === insId);
    assert.ok(hit, 'tolera errores de dedo');
    assert.equal(hit.de_otra_plaza, true, 'sin precio en Juárez cae al último general y lo marca');
    const porClave = await rpc('buscar_insumos', A, { p_texto: `qa-${ts}` });
    assert.equal(porClave.body[0].id, insId);
    assert.equal(porClave.body[0].coincidencia, 'clave', 'la clave exacta va primero');

    const doc = await rest('empresa_documentos', A, { method: 'POST', body: JSON.stringify({ categoria: 'opinion_sat', nombre: `QA ${ts}`, fecha_vencimiento: '2000-01-01' }) });
    assert.equal(doc.status, 201, JSON.stringify(doc.body));
    docId = doc.body[0].id;
    const est = await rest(`empresa_documentos_estado?id=eq.${docId}`, A);
    assert.equal(est.body[0].estado, 'vencido');

    // Otra empresa: nada
    for (const [t, filtro] of [['licitaciones', `id=eq.${licId}`], ['licitacion_requisitos', `licitacion_id=eq.${licId}`],
      ['insumos', `id=eq.${insId}`], ['insumo_precios', `insumo_id=eq.${insId}`], ['empresa_documentos', `id=eq.${docId}`]]) {
      const r = await rest(`${t}?${filtro}`, B);
      assert.equal(r.status, 200);
      assert.equal(r.body.length, 0, `B no debe ver ${t} de A`);
    }
    const bB = await rpc('buscar_insumos', B, { p_texto: `qa-${ts}` });
    assert.equal(bB.body.length, 0, 'buscar_insumos de B no trae insumos de A');
    const robo = await rest('insumo_precios', B, { method: 'POST', body: JSON.stringify({ insumo_id: insId, precio: 1, fecha: '2026-01-01', fuente: 'manual' }) });
    assert.notEqual(robo.status, 201, 'B no puede colgar precios de un insumo de A');

    // Nivel 70 de la misma empresa: 0 filas y sin búsqueda (opcional)
    if (N70) {
      for (const t of ['licitaciones', 'insumos', 'insumo_precios', 'conceptos_historicos', 'concepto_precios', 'matriz_componentes', 'empresa_documentos']) {
        const r = await rest(`${t}?select=id&limit=5`, N70);
        assert.equal(r.status, 200);
        assert.equal(r.body.length, 0, `nivel 70 no debe ver ${t}`);
      }
      const b70 = await rpc('buscar_insumos', N70, { p_texto: 'cemento' });
      assert.notEqual(b70.status, 200, 'nivel 70 no puede buscar en el banco');
      const w70 = await rest('licitaciones', N70, { method: 'POST', body: JSON.stringify({ codigo: `${codigo}-N70`, nombre: 'x' }) });
      assert.notEqual(w70.status, 201, 'nivel 70 no puede crear licitaciones');
    }
  } finally {
    if (docId) await rest(`empresa_documentos?id=eq.${docId}`, A, { method: 'DELETE' });
    if (insId) await rest(`insumos?id=eq.${insId}`, A, { method: 'DELETE' });
    if (licId) await rest(`licitaciones?id=eq.${licId}`, A, { method: 'DELETE' });
  }
  const quedan = await rest(`licitaciones?codigo=like.QA-ESQ-*`, A);
  assert.equal(quedan.body.length, 0, 'la prueba limpia lo que crea');
});
