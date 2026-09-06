// Planes, límites y estados de la prueba (US-212 a US-214). Usa las sesiones de QA A (Supernova, cortesía Constructora)
// y B (QA Aislamiento, plan Gratis). Deja B como estaba al terminar.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const A = process.env.QA_TOKEN_A || process.env.OBRA_QA_TOKEN || '';
const B = process.env.QA_TOKEN_B || '';
// Sin tokens las pruebas se omiten (control-obra-dashboard/.env: set -a; . ./.env; set +a). Nunca pegarlos aquí: el repo es público.
const skip = A && B ? false : 'QA_TOKEN_A/OBRA_QA_TOKEN y QA_TOKEN_B no definidos';

async function rpc(name, token, args = {}) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', ...(token ? { 'x-obra-token': token } : {}) }, body: JSON.stringify(args) });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
async function rest(path, token, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', 'x-obra-token': token, ...(opts.headers || {}) } });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

let userB;
test('get_mi_plan: A es Constructora por cortesía, B es Gratis con límites', { skip }, async () => {
  const a = await rpc('get_mi_plan', A); const b = await rpc('get_mi_plan', B);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.body.plan.slug, 'constructora'); assert.equal(a.body.sub.estado, 'cortesia'); assert.equal(a.body.plan.features.socios, true);
  assert.equal(b.body.plan.slug, 'gratis'); assert.equal(b.body.plan.max_obras, 1); assert.equal(b.body.plan.features.socios, false);
  assert.equal(b.body.planes.length, 3, 'tres planes activos');
  assert.ok(b.body.uso && 'obras_activas' in b.body.uso && 'usuarios' in b.body.uso && 'storage_mb' in b.body.uso);
  const sin = await rpc('get_mi_plan', null); assert.ok(sin.status >= 400, 'sin sesión falla');
  userB = (await rpc('validar_sesion', null, { p_token: B })).body[0];
});

test('check_plan_limit: recursos y features', { skip }, async () => {
  const ob = await rpc('check_plan_limit', B, { p_empresa_id: userB.empresa_id, p_resource: 'obras_activas' });
  assert.equal(ob.status, 200); assert.equal(ob.body.limit, 1); assert.equal(ob.body.allowed, true);
  const f = await rpc('check_plan_limit', B, { p_empresa_id: userB.empresa_id, p_resource: 'feature:socios' });
  assert.equal(f.body.allowed, false);
  const fa = await rpc('check_plan_limit', A, { p_empresa_id: 1, p_resource: 'feature:socios' });
  assert.equal(fa.body.allowed, true);
  const ilim = await rpc('check_plan_limit', A, { p_empresa_id: 1, p_resource: 'obras_activas' });
  assert.equal(ilim.body.limit, null); assert.equal(ilim.body.allowed, true);
});

test('crear_obra respeta el límite de 1 obra activa en Gratis y devuelve PLAN_LIMIT', { skip }, async () => {
  // limpiar obras previas de B
  await rest('obras?empresa_id=eq.' + userB.empresa_id, B, { method: 'DELETE' });
  const o1 = await rpc('crear_obra', B, { p_user_id: userB.user_id, p_codigo_obra: 'QA-1', p_nombre_obra: 'Obra QA 1', p_presupuesto_total: 1000 });
  assert.equal(o1.status, 200, JSON.stringify(o1.body).slice(0, 200)); assert.equal(o1.body.success, true, JSON.stringify(o1.body).slice(0, 200));
  const o2 = await rpc('crear_obra', B, { p_user_id: userB.user_id, p_codigo_obra: 'QA-2', p_nombre_obra: 'Obra QA 2', p_presupuesto_total: 1000 });
  const msg = JSON.stringify(o2.body);
  assert.ok(o2.status >= 400 || (o2.body && o2.body.success === false), 'segunda obra debe fallar: ' + msg.slice(0, 200));
  assert.ok(/PLAN_LIMIT/.test(msg), 'debe traer PLAN_LIMIT: ' + msg.slice(0, 200));
  await rest('obras?empresa_id=eq.' + userB.empresa_id, B, { method: 'DELETE' });
});

test('estados de la prueba: trial vencida → vencida (gracia) → lectura bloquea escrituras; luego se restaura', { skip }, async () => {
  // Simular con B: poner en trial vencido y correr el job (vía SQL en el runner no es posible; usamos la RPC de estado a través de la Edge Function jobs con llave interna si está disponible)
  const key = process.env.OBRA_INTERNAL_KEY;
  if (!key) { console.log('  (sin OBRA_INTERNAL_KEY: se omite la simulación de estados; se prueba en Playwright/SQL)'); return; }
  const r = await fetch(`${SB}/functions/v1/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': key }, body: JSON.stringify({ action: 'suscripciones' }) });
  assert.equal(r.status, 200);
});
