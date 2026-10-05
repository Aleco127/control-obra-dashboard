// Convocatorias (US-839) por la API real (PostgREST como anon + x-obra-token). Comprueba que:
//   * `convocatorias` y `convocatoria_corridas` NO se leen ni se escriben directo (no hay vista pública y las RPC de
//     escritura son sólo de service_role);
//   * sin sesión `convocatorias_buscar` / `convocatorias_estado` rechazan; con nivel >= 80 responden;
//   * el seguimiento es por empresa (B no ve las marcas de A) y `convocatoria_marcar` hace upsert.
// Tokens del .env (set -a; . ./.env; set +a); sin ellos se omite lo que los necesita. Repo público: nunca pegar
// tokens aquí. El seguimiento que se crea se borra al final (el token A es la cuenta real de Ricardo).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const A = process.env.QA_TOKEN_A || process.env.OBRA_QA_TOKEN || '';
const B = process.env.QA_TOKEN_B || '';

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

test('sin sesión: nada se lee ni se escribe', async () => {
  assert.notEqual((await rest('convocatorias?select=id&limit=1', '')).status, 200, 'no hay vista pública de convocatorias');
  assert.notEqual((await rest('convocatoria_corridas?select=id&limit=1', '')).status, 200);
  const b = await rpc('convocatorias_buscar', '', {});
  assert.notEqual(b.status, 200, JSON.stringify(b.body));
  assert.notEqual((await rpc('convocatorias_estado', '')).status, 200);
  const up = await rpc('convocatorias_upsert', '', { p_items: [{ fuente: 'chihuahua', id_externo: 'qa-anon', titulo: 'x' }] });
  assert.notEqual(up.status, 200, 'anon no escribe convocatorias');
  const co = await rpc('convocatoria_corrida_iniciar', '', { p_fuente: 'chihuahua', p_origen: 'qa' });
  assert.notEqual(co.status, 200, 'anon no registra corridas');
  const pr = await rpc('convocatorias_por_revisar', '', { p_fuente: 'chihuahua', p_vistos: [] });
  assert.notEqual(pr.status, 200);
});

test('nivel >= 80: buscar, estado de las fuentes y filtros de fábrica', { skip: A ? false : 'OBRA_QA_TOKEN no definido' }, async () => {
  const r = await rpc('convocatorias_buscar', A, { p_fuentes: ['chihuahua'], p_tipos: ['obra_publica'], p_limite: 5 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body));
  if (r.body.length) {
    const c = r.body[0];
    for (const k of ['id', 'fuente', 'numero_procedimiento', 'titulo', 'apertura', 'url_detalle', 'seguimiento_estado', 'total']) assert.ok(k in c, k);
    assert.equal(c.fuente, 'chihuahua');
    assert.equal(c.tipo_contratacion, 'obra_publica');
  }
  const t = await rpc('convocatorias_buscar', A, { p_texto: 'CONSTRUCCIÓN', p_limite: 3, p_solo_vigentes: false });
  assert.equal(t.status, 200);
  for (const c of t.body) assert.match(`${c.numero_procedimiento} ${c.titulo} ${c.dependencia} ${c.unidad_compradora}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(), /construccion/);

  const e = await rpc('convocatorias_estado', A);
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.deepEqual(e.body.map((x) => x.fuente).sort(), ['chihuahua', 'comprasmx']);

  const f = await rest('convocatoria_filtros?select=nombre,fuentes,entidades,tipos_contratacion,de_fabrica&de_fabrica=eq.true', A);
  assert.equal(f.status, 200);
  // Sólo la empresa 1 trae filtros de fábrica; si el token es de otra empresa la lista puede venir vacía.
  for (const x of f.body) assert.deepEqual(x.tipos_contratacion, ['obra_publica', 'servicios_obra']);
});

test('seguimiento por empresa con convocatoria_marcar', { skip: A && B ? false : 'OBRA_QA_TOKEN y QA_TOKEN_B no definidos' }, async () => {
  const r = await rpc('convocatorias_buscar', A, { p_estados: ['nueva'], p_limite: 1, p_solo_vigentes: false });
  assert.equal(r.status, 200);
  if (!r.body.length) return;
  const id = r.body[0].id;
  try {
    const m = await rpc('convocatoria_marcar', A, { p_convocatoria_id: id, p_estado: 'interesa', p_nota: 'qa_ralph_prueba' });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    assert.equal(m.body.estado, 'interesa');
    const m2 = await rpc('convocatoria_marcar', A, { p_convocatoria_id: id, p_estado: 'descartada' });
    assert.equal(m2.body.id, m.body.id, 'upsert: misma fila');
    assert.equal(m2.body.nota, 'qa_ralph_prueba', 'sin nota conserva la anterior');
    const mal = await rpc('convocatoria_marcar', A, { p_convocatoria_id: id, p_estado: 'convertida' });
    assert.notEqual(mal.status, 200, '«convertida» sólo la pone la conversión en licitación');
    const vA = await rpc('convocatorias_buscar', A, { p_estados: ['descartada'], p_texto: r.body[0].numero_procedimiento, p_solo_vigentes: false });
    assert.ok(vA.body.some((x) => x.id === id && x.seguimiento_estado === 'descartada'));
    const vB = await rest(`convocatoria_seguimiento?convocatoria_id=eq.${id}`, B);
    assert.equal(vB.status, 200);
    assert.equal(vB.body.length, 0, 'B no ve el seguimiento de A');
  } finally {
    await rest(`convocatoria_seguimiento?convocatoria_id=eq.${id}&nota=eq.qa_ralph_prueba`, A, { method: 'DELETE' });
  }
});
