// Las funciones SECURITY DEFINER validan sesión y no confían en ids del cliente (US-207).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const A = process.env.QA_TOKEN_A || process.env.OBRA_QA_TOKEN || '';
const B = process.env.QA_TOKEN_B || '';
// Sin tokens las pruebas se omiten (control-obra-dashboard/.env: set -a; . ./.env; set +a). Nunca pegarlos aquí: el repo es público.
const skip = A && B ? false : 'QA_TOKEN_A/OBRA_QA_TOKEN y QA_TOKEN_B no definidos';

const rechazado = (r) => r.status >= 400 || (r.body && r.body.success === false && /No autorizado/.test(String(r.body.error)));
async function rpc(name, token, args = {}, extra = {}) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', ...(token ? { 'x-obra-token': token } : {}), ...extra },
    body: JSON.stringify(args),
  });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

let userA, userB;
test('validar_sesion devuelve el usuario de cada token', { skip }, async () => {
  const a = await rpc('validar_sesion', null, { p_token: A });
  const b = await rpc('validar_sesion', null, { p_token: B });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  userA = a.body[0]; userB = b.body[0];
  assert.equal(userA.empresa_id, 1);
  assert.notEqual(userA.empresa_id, userB.empresa_id);
  assert.ok('baja_programada_at' in userA && 'es_admin_empresa' in userA);
});

test('RPC con sesión de escritura fallan sin token (crear_obra, crear_gasto, get_next_*)', { skip }, async () => {
  const sin = await rpc('crear_obra', null, { p_user_id: userA.user_id, p_codigo_obra: 'X', p_nombre_obra: 'x' });
  assert.ok(sin.status >= 400 || (sin.body && sin.body.success === false), `crear_obra sin token: ${sin.status} ${JSON.stringify(sin.body).slice(0, 100)}`);
  const n1 = await rpc('get_next_pago_recibido_numero', null);
  assert.ok(n1.status >= 400, `get_next_pago_recibido_numero sin token debe fallar: ${n1.status}`);
  const n2 = await rpc('get_next_cuenta_cobrar_numero', null);
  assert.ok(n2.status >= 400, `get_next_cuenta_cobrar_numero sin token debe fallar: ${n2.status}`);
});

test('B no puede actuar en nombre de A pasando el user_id de A', { skip }, async () => {
  const r = await rpc('crear_obra', B, { p_user_id: userA.user_id, p_codigo_obra: 'HACK', p_nombre_obra: 'Obra hackeada' });
  assert.ok(rechazado(r), `crear_obra con p_user_id ajeno: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  const g = await rpc('crear_gasto', B, { p_user_id: userA.user_id, p_obra_id: 1, p_fecha_solicitud: '2026-08-29', p_monto_neto: 1 });
  assert.ok(rechazado(g), `crear_gasto con p_user_id ajeno: ${g.status} ${JSON.stringify(g.body).slice(0, 120)}`);
  const lvl = await rpc('get_user_access_level', B, { p_user_id: userA.user_id });
  assert.ok(rechazado(lvl), `get_user_access_level ajeno: ${lvl.status}`);
});

test('B no puede leer ni cambiar la configuración de la empresa A', { skip }, async () => {
  const c = await rpc('get_empresa_config', B, { p_empresa_id: 1 });
  assert.ok(rechazado(c), `get_empresa_config de A desde B: ${c.status} ${JSON.stringify(c.body).slice(0, 100)}`);
  const s = await rpc('save_empresa_modulos_config', B, { p_empresa_id: 1, p_modulos: {} });
  assert.ok(rechazado(s), `save_empresa_modulos_config de A desde B: ${s.status}`);
  const l = await rpc('check_plan_limit', B, { p_empresa_id: 1, p_resource: 'obras' });
  assert.ok(rechazado(l), `check_plan_limit de A desde B: ${l.status}`);
  const propio = await rpc('get_empresa_config', A, { p_empresa_id: 1 });
  assert.equal(propio.status, 200, 'A sí puede leer su configuración');
});

test('funciones de plataforma exigen x-platform-token; hash_password y mantenimiento no son públicas', { skip }, async () => {
  const st = await rpc('get_platform_stats', A);
  assert.ok(st.status >= 400, `get_platform_stats con sesión de empresa: ${st.status}`);
  const an = await rpc('get_platform_analytics', null);
  assert.ok(an.status >= 400, `get_platform_analytics sin nada: ${an.status}`);
  const hp = await rpc('hash_password', A, { p_password: 'x' });
  assert.ok(hp.status >= 400, `hash_password: ${hp.status}`);
  for (const f of ['limpiar_login_attempts', 'limpiar_sesiones_expiradas', 'update_repse_estatus_vencida', 'update_sua_estatus_vencido', 'eliminar_empresa_definitivo', 'bajas_pendientes']) {
    const r = await rpc(f, A, f === 'eliminar_empresa_definitivo' ? { p_empresa_id: 1 } : {});
    assert.ok(r.status >= 400, `${f} debe estar revocada: ${r.status}`);
  }
});

test('las funciones públicas siguen funcionando: registrar_usuario valida términos, verificar_login rechaza credenciales malas', { skip }, async () => {
  const reg = await rpc('registrar_usuario', null, { p_nombre: 'x', p_email: 'nadie@example.com', p_password: 'Prueba1234', p_tipo_registro: 'nueva', p_empresa_nombre: 'x', p_acepta_terminos: false });
  assert.equal(reg.status, 200); assert.equal(reg.body.success, false);
  const login = await rpc('verificar_login', null, { p_email: 'nadie@example.com', p_password: 'mala', p_ip_address: '127.0.0.1', p_user_agent: 'test' });
  assert.equal(login.status, 200); assert.equal(login.body.length, 0);
});
