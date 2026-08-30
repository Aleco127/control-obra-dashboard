// Aislamiento entre empresas por RLS (US-205/US-206). Corre contra producción con dos sesiones de QA.
// Tokens: QA_TOKEN_A (empresa 1, Supernova) y QA_TOKEN_B (empresa "QA Aislamiento"). Se leen de variables de entorno
// o de los valores por defecto de QA (caducan el 12-sep-2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const A = process.env.QA_TOKEN_A || 'qa-2e92575194312f35c916e55a461118130c5c1a61da6aa08e';
const B = process.env.QA_TOKEN_B || 'qa-b-7f3a91c2d5e64b08a1f2c3d4e5f60718';

async function rest(path, token, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', ...(token ? { 'x-obra-token': token } : {}), ...(opts.headers || {}) },
  });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
const rpc = (name, token, args = {}) => rest(`rpc/${name}`, token, { method: 'POST', body: JSON.stringify(args) });

const TABLAS = ['obras', 'gastos', 'empresas', 'obra_usuarios', 'cotizaciones', 'catalogo_conceptos_cot', 'plantillas_cotizacion', 'ui_events', 'pagos_recibidos', 'pagos_proveedores', 'socios', 'clientes', 'proveedores', 'estimaciones'];

test('la empresa A ve sus datos y la empresa B (nueva) ve cero filas en cada tabla', async () => {
  for (const t of TABLAS) {
    const a = await rest(`${t}?select=id&limit=5`, A);
    const b = await rest(`${t}?select=id&limit=5`, B);
    assert.equal(a.status, 200, `${t} A status ${a.status} ${JSON.stringify(a.body)}`);
    assert.equal(b.status, 200, `${t} B status ${b.status} ${JSON.stringify(b.body)}`);
    if (t === 'empresas') { assert.ok(b.body.length === 1 && b.body[0].id !== 1, 'B sólo ve su propia empresa'); continue; }
    // ui_events: B genera su propia telemetría al usarse en pruebas; se verifica que no vea la de otra empresa
    if (t === 'ui_events') { const be = await rest('ui_events?select=empresa_id&limit=50', B); assert.ok(be.body.every((r) => r.empresa_id !== 1), 'B no debe ver telemetría de A'); continue; }
    if (t === 'obra_usuarios') { const bu = await rest('obra_usuarios?select=empresa_id', B); assert.ok(bu.body.length >= 1 && bu.body.every((r) => r.empresa_id !== 1), 'B sólo ve usuarios de su empresa'); continue; }
    assert.ok(Array.isArray(b.body) && b.body.length === 0, `${t}: B no debe ver filas, vio ${JSON.stringify(b.body).slice(0, 120)}`);
  }
  const obrasA = await rest('obras?select=id', A);
  assert.ok(obrasA.body.length > 0, 'A debe ver sus obras');
});

test('sin token nadie ve nada', async () => {
  for (const t of ['obras', 'gastos', 'empresas', 'cotizaciones', 'ui_events']) {
    const r = await rest(`${t}?select=id&limit=1`, null);
    assert.ok(r.status === 200 && Array.isArray(r.body) && r.body.length === 0, `${t} sin token: ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
  }
});

test('B no puede escribir en datos de A (gasto, obra, cotización)', async () => {
  const obraA = (await rest('obras?select=id&limit=1', A)).body[0].id;
  const upd = await rest(`obras?id=eq.${obraA}`, B, { method: 'PATCH', body: JSON.stringify({ descripcion: 'hackeo' }), headers: { Prefer: 'return=representation' } });
  assert.ok(upd.status === 200 && Array.isArray(upd.body) && upd.body.length === 0 || upd.status >= 400, `PATCH obra de A desde B: ${upd.status} ${JSON.stringify(upd.body).slice(0, 80)}`);
  const ins = await rest('cotizaciones', B, { method: 'POST', body: JSON.stringify({ empresa_id: 1, obra_id: obraA, numero_cotizacion: 'HACK-1', cliente: 'x' }), headers: { Prefer: 'return=representation' } });
  assert.ok(ins.status >= 400, `INSERT cotización con empresa_id de A desde B debe fallar: ${ins.status}`);
  const uie = await rest('ui_events', B, { method: 'POST', body: JSON.stringify({ empresa_id: 1, evento: 'hack', modulo: 'x' }) });
  assert.ok(uie.status >= 400, `INSERT ui_events con empresa_id ajeno debe fallar: ${uie.status}`);
});

test('tablas de plataforma y secretos no son legibles con sesión de empresa', async () => {
  for (const t of ['app_secrets', 'platform_admins', 'platform_sessions', 'login_attempts', 'email_log', 'platform_errors']) {
    const r = await rest(`${t}?select=*&limit=1`, A);
    assert.ok(r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `${t}: ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
  }
});

test('la vista v_uso_modulos_30d sólo agrega la empresa propia', async () => {
  const a = await rest('v_uso_modulos_30d?select=empresa_id', A);
  assert.equal(a.status, 200);
  assert.ok(a.body.every((r) => r.empresa_id === 1), 'sólo empresa 1');
  const b = await rest('v_uso_modulos_30d?select=empresa_id', B);
  assert.ok(b.body.every((r) => r.empresa_id !== 1), 'B no debe ver el uso de A');
});

test('las vistas de métricas del MVP no son legibles con sesión de empresa', async () => {
  for (const v of ['v_activacion', 'v_retencion_semanal', 'v_conversion', 'v_churn_mensual']) {
    const r = await rest(`${v}?select=*&limit=1`, A);
    assert.ok(r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `${v}: ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
  }
  const le = await rest('landing_eventos?select=*&limit=1', A);
  assert.ok(le.status >= 400 || (Array.isArray(le.body) && le.body.length === 0), `landing_eventos: ${le.status}`);
});
