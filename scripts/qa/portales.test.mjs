// Accesos a portales cifrados en Vault (US-847) por la API real (PostgREST como anon + x-obra-token).
// Comprueba que la contraseña nunca vuelve al navegador: ni la vista, ni las RPC, ni el esquema control_obra (expuesto)
// ni vault. NUNCA imprime ni compara el valor real de la contraseña de ComprasMX: sólo usa una contraseña ficticia en la
// empresa de QA_TOKEN_B y la borra al final. Tokens del .env (set -a; . ./.env; set +a); sin ellos se omite.
//   OBRA_QA_TOKEN (o QA_TOKEN_A) empresa 1 nivel 100 · QA_TOKEN_B otra empresa nivel 100 · OBRA_QA_TOKEN_N80 (opcional)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const A = process.env.QA_TOKEN_A || process.env.OBRA_QA_TOKEN || '';
const B = process.env.QA_TOKEN_B || '';
const N80 = process.env.OBRA_QA_TOKEN_N80 || '';
const skip = A && B ? false : 'QA_TOKEN_A/OBRA_QA_TOKEN y QA_TOKEN_B no definidos';
const FICTICIA = 'qa-ficticia-' + Date.now();

async function rest(path, token, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json',
      ...(token ? { 'x-obra-token': token } : {}), ...(opts.headers || {}) },
  });
  const texto = await r.text();
  let body = null; try { body = JSON.parse(texto); } catch {}
  return { status: r.status, body, texto };
}
const rpc = (name, token, args = {}, perfil) => rest(`rpc/${name}`, token, { method: 'POST', body: JSON.stringify(args), headers: perfil ? { 'Content-Profile': perfil } : {} });

test('la migración no contiene contraseñas y la tabla no tiene columna de contraseña', () => {
  const sql = readFileSync(new URL('../../migrations/090_empresa_portales.sql', import.meta.url), 'utf8');
  const tabla = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS control_obra.empresa_portales'), sql.indexOf('DROP TRIGGER IF EXISTS trg_empresa_portales_touch'));
  assert.ok(!/password|contrasena|contraseña/i.test(tabla), 'sin columna de contraseña');
  assert.match(sql, /UNIQUE \(empresa_id, portal\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION control_obra\.portal_credencial\(integer, text\) FROM PUBLIC, anon, authenticated;\s*GRANT EXECUTE ON FUNCTION control_obra\.portal_credencial\(integer, text\) TO service_role;/);
  // La adopción toma id y usuario de Vault dentro del SQL; ningún literal de contraseña en el archivo
  assert.ok(!/"password"\s*:\s*"/.test(sql) && !/create_secret\s*\(\s*'/.test(sql), 'ninguna contraseña literal ni secreto escrito a mano');
});

test('empresa 1: la vista muestra ComprasMX adoptado (usuario y estado) y nunca la contraseña ni el id del secreto', { skip }, async () => {
  const r = await rest('empresa_portales?select=*', A);
  assert.equal(r.status, 200, r.texto);
  const c = r.body.find((x) => x.portal === 'comprasmx');
  assert.ok(c, 'el secreto portal:1:comprasmx tiene su fila');
  assert.ok(c.usuario && c.usuario.length > 0);
  assert.ok(['sin_probar', 'correcto', 'fallo'].includes(c.estado));
  for (const k of Object.keys(c)) assert.ok(!/pass|secret|vault/i.test(k), `columna inesperada ${k}`);
  // Pedir la columna del secreto o una contraseña falla
  assert.notEqual((await rest('empresa_portales?select=vault_secret_id', A)).status, 200);
  assert.notEqual((await rest('empresa_portales?select=password', A)).status, 200);
  // control_obra está expuesto: la tabla sólo deja leer columnas sin el secreto
  const t = await rest('empresa_portales?select=vault_secret_id', A, { headers: { 'Accept-Profile': 'control_obra' } });
  assert.notEqual(t.status, 200, 'vault_secret_id no se puede leer por el esquema control_obra');
  const t2 = await rest('empresa_portales?select=id,usuario', A, { headers: { 'Accept-Profile': 'control_obra' } });
  assert.equal(t2.status, 200);
  // Escribir directo en la tabla no se puede: sólo por RPC
  const w = await rest('empresa_portales', A, { method: 'POST', body: JSON.stringify({ portal: 'otro', usuario: 'x' }), headers: { 'Content-Profile': 'control_obra' } });
  assert.notEqual(w.status, 201);
});

test('nadie desde la app lee vault ni la función de servicio (anon, empresa A, empresa B)', { skip }, async () => {
  for (const tok of ['', A, B]) {
    const v = await rest('decrypted_secrets?select=name', tok, { headers: { 'Accept-Profile': 'vault' } });
    assert.notEqual(v.status, 200, 'vault.decrypted_secrets no está accesible');
    const f = await rpc('portal_credencial', tok, { p_empresa: 1, p_portal: 'comprasmx' }, 'control_obra');
    assert.ok([401, 403, 404].includes(f.status), `portal_credencial niega (${f.status})`);
    assert.ok(!/password/i.test(f.texto));
  }
  // Sin sesión no se guarda ni se lee la lista
  assert.notEqual((await rpc('guardar_portal_credencial', '', { p_portal: 'otro', p_usuario: 'x', p_password: FICTICIA })).status, 200);
  const anon = await rest('empresa_portales?select=*', '');
  assert.deepEqual(anon.status === 200 ? anon.body : [], []);
});

test('empresa B: guarda, cambia sólo el usuario, no ve a la empresa 1 y quita el acceso; la contraseña nunca regresa', { skip }, async () => {
  try {
    const g = await rpc('guardar_portal_credencial', B, { p_portal: 'otro', p_usuario: 'qa.portales', p_password: FICTICIA });
    assert.equal(g.status, 200, g.texto);
    assert.ok(!g.texto.includes(FICTICIA) && !/password/i.test(g.texto), 'la respuesta no trae la contraseña');
    assert.equal(g.body.estado, 'sin_probar');
    const u = await rpc('guardar_portal_credencial', B, { p_portal: 'otro', p_usuario: 'qa.portales2', p_password: null });
    assert.equal(u.status, 200, 'sin contraseña conserva la actual');
    assert.equal(u.body.usuario, 'qa.portales2');
    const sinPass = await rpc('guardar_portal_credencial', B, { p_portal: 'chihuahua', p_usuario: 'x', p_password: '' });
    assert.equal(sinPass.status, 400, 'un acceso nuevo exige contraseña');
    const vista = await rest('empresa_portales?select=*', B);
    assert.ok(!vista.texto.includes(FICTICIA));
    assert.ok(vista.body.every((x) => x.empresa_id !== 1), 'B no ve los accesos de la empresa 1');
    assert.ok(vista.body.some((x) => x.portal === 'otro' && x.usuario === 'qa.portales2'));
    const malo = await rpc('guardar_portal_credencial', B, { p_portal: 'sat', p_usuario: 'x', p_password: 'y' });
    assert.equal(malo.status, 400, 'portal fuera del catálogo');
  } finally {
    const q = await rpc('quitar_portal_credencial', B, { p_portal: 'otro' });
    assert.equal(q.status, 200, q.texto);
  }
  const despues = await rest('empresa_portales?select=portal', B);
  assert.ok(!despues.body.some((x) => x.portal === 'otro'), 'quitar borra la fila (y el trigger el secreto)');
});

// ---- US-854: boleto de credencial (función de borde portal-credencial) ------------------------------------------------
// canjear/resultado exigen el secreto de ingesta del conector (CONVOCATORIAS_INGESTA_SECRET del entorno o de
// ~/.config/control-obra/convocatorias.env). Todo se hace en la empresa de QA_TOKEN_B con una contraseña FICTICIA: nunca
// se emite ni se canjea un boleto de la empresa 1. Opcional: OBRA_QA_TOKEN_N70 (sesión de nivel < 80).
const FN = `${SB}/functions/v1/portal-credencial`;
function secretoIngesta() {
  if (process.env.CONVOCATORIAS_INGESTA_SECRET) return process.env.CONVOCATORIAS_INGESTA_SECRET;
  try {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const txt = readFileSync(`${home}/.config/control-obra/convocatorias.env`, 'utf8');
    const m = txt.match(/^\s*(?:export\s+)?CONVOCATORIAS_INGESTA_SECRET\s*=\s*["']?([^"'\r\n]+)/m);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}
const SECRETO = secretoIngesta();
const N70 = process.env.OBRA_QA_TOKEN_N70 || '';
async function fn(cuerpo, headers = {}) {
  const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(cuerpo) });
  const texto = await r.text();
  let body = null; try { body = JSON.parse(texto); } catch {}
  return { status: r.status, body, texto };
}
const conSecreto = (c) => fn(c, { 'x-convocatorias-secret': SECRETO });

test('la migración 112 deja portal_boletos sólo para service_role y guarda sólo el hash', () => {
  const sql = readFileSync(new URL('../../migrations/112_portal_boletos.sql', import.meta.url), 'utf8');
  assert.match(sql, /REVOKE ALL ON control_obra\.portal_boletos FROM PUBLIC, anon, authenticated;/);
  assert.ok(!/CREATE (OR REPLACE )?VIEW/i.test(sql), 'sin vista pública');
  assert.match(sql, /boleto_sha256 text NOT NULL UNIQUE/);
  assert.match(sql, /interval '120 seconds'/);
  for (const f of ['portal_boleto_emitir', 'portal_boleto_canjear', 'portal_boleto_resultado']) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION control_obra\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
  }
  const ts = readFileSync(new URL('../../supabase/functions/portal-credencial/index.ts', import.meta.url), 'utf8');
  assert.ok(!/console\.(log|info|error|warn)/.test(ts), 'la función no escribe en la bitácora');
});

test('portal_boletos y sus funciones no se alcanzan desde la app', { skip }, async () => {
  for (const tok of ['', A, B]) {
    const t = await rest('portal_boletos?select=*', tok, { headers: { 'Accept-Profile': 'control_obra' } });
    assert.notEqual(t.status, 200, 'la tabla de boletos no se lee');
    const c = await rpc('portal_boleto_canjear', tok, { p_sha256: '0'.repeat(64) }, 'control_obra');
    assert.ok([401, 403, 404].includes(c.status), `canjear por PostgREST niega (${c.status})`);
  }
});

test('emitir: sin sesión 401; con sesión de nivel < 80, 403; portal sin inicio de sesión 400', { skip }, async () => {
  assert.equal((await fn({ accion: 'emitir', portal: 'comprasmx' })).status, 401);
  assert.equal((await fn({ accion: 'emitir', portal: 'comprasmx' }, { 'x-obra-token': 'no-es-un-token' })).status, 401);
  assert.equal((await fn({ accion: 'emitir', portal: 'chihuahua' }, { 'x-obra-token': B })).status, 400);
  if (N70) assert.equal((await fn({ accion: 'emitir', portal: 'comprasmx' }, { 'x-obra-token': N70 })).status, 403);
});

test('canjear y resultado sin el secreto del conector → 401 (aun con sesión de usuario)', { skip }, async () => {
  const boleto = 'A'.repeat(43);
  for (const h of [{}, { 'x-obra-token': A }, { 'x-convocatorias-secret': 'x'.repeat(40) }]) {
    assert.equal((await fn({ accion: 'canjear', boleto }, h)).status, 401);
    assert.equal((await fn({ accion: 'resultado', boleto, estado: 'correcto' }, h)).status, 401);
  }
});

test('boleto: emitir no trae la contraseña; canjear sirve una vez; anulado o vencido 401; fallo bloquea hasta cambiar la contraseña',
  { skip: skip || (SECRETO ? false : 'sin CONVOCATORIAS_INGESTA_SECRET') }, async () => {
    const pass = 'qa-ficticia-boleto-' + Date.now();
    try {
      // Sin acceso guardado → 404
      const sin = await fn({ accion: 'emitir', portal: 'comprasmx' }, { 'x-obra-token': B });
      assert.equal(sin.status, 404, sin.texto);
      const g = await rpc('guardar_portal_credencial', B, { p_portal: 'comprasmx', p_usuario: 'qa.boleto', p_password: pass });
      assert.equal(g.status, 200, g.texto);

      const e1 = await fn({ accion: 'emitir', portal: 'comprasmx' }, { 'x-obra-token': B });
      assert.equal(e1.status, 200, e1.texto);
      assert.match(e1.body.boleto, /^[A-Za-z0-9_-]{43}$/, '256 bits en base64url');
      assert.ok(!/password/i.test(e1.texto) && !e1.texto.includes(pass), 'emitir no trae la contraseña');
      assert.ok(new Date(e1.body.expira_at) - Date.now() <= 125000, 'vive 120 s');

      // Un boleto nuevo anula el anterior sin canjear (expira_at = ahora: misma regla que uno vencido)
      const e2 = await fn({ accion: 'emitir', portal: 'comprasmx', proposito: 'buscar' }, { 'x-obra-token': B });
      assert.equal(e2.status, 200, e2.texto);
      assert.equal((await conSecreto({ accion: 'canjear', boleto: e1.body.boleto })).status, 401, 'boleto anulado/vencido');

      const c1 = await conSecreto({ accion: 'canjear', boleto: e2.body.boleto });
      assert.equal(c1.status, 200, c1.texto);
      assert.equal(c1.body.usuario, 'qa.boleto');
      assert.equal(c1.body.password, pass);
      assert.equal(c1.body.proposito, 'buscar');
      assert.equal((await conSecreto({ accion: 'canjear', boleto: e2.body.boleto })).status, 401, 'la segunda vez 401');

      // Con un inicio de sesión en curso (canjeado sin resultado) no se emite otro
      assert.equal((await fn({ accion: 'emitir', portal: 'comprasmx' }, { 'x-obra-token': B })).status, 409);

      const r1 = await conSecreto({ accion: 'resultado', boleto: e2.body.boleto, estado: 'fallo', mensaje: 'Usuario o contraseña incorrectos. (simulado)' });
      assert.equal(r1.status, 200, r1.texto);
      assert.equal(r1.body.estado, 'fallo');
      assert.equal((await conSecreto({ accion: 'resultado', boleto: e2.body.boleto, estado: 'correcto' })).status, 401, 'un resultado por boleto');
      const v = await rest('empresa_portales?select=portal,estado,probado_at,ultimo_error&portal=eq.comprasmx', B);
      assert.equal(v.body[0].estado, 'fallo');
      assert.ok(v.body[0].probado_at);
      assert.match(v.body[0].ultimo_error, /simulado/);

      // En «fallo» no se emite (no se reintenta) hasta que un administrador cambie la contraseña
      const bloq = await fn({ accion: 'emitir', portal: 'comprasmx' }, { 'x-obra-token': B });
      assert.equal(bloq.status, 409, bloq.texto);
      assert.match(bloq.body.error, /cambiar la contraseña/);
      const g2 = await rpc('guardar_portal_credencial', B, { p_portal: 'comprasmx', p_usuario: 'qa.boleto', p_password: pass + '-2' });
      assert.equal(g2.body.estado, 'sin_probar');
      const e3 = await fn({ accion: 'emitir', portal: 'comprasmx' }, { 'x-obra-token': B });
      assert.equal(e3.status, 200, e3.texto);
      const c3 = await conSecreto({ accion: 'canjear', boleto: e3.body.boleto });
      assert.equal(c3.status, 200);
      const r3 = await conSecreto({ accion: 'resultado', boleto: e3.body.boleto, estado: 'correcto' });
      assert.equal(r3.body.estado, 'correcto');
      assert.equal(r3.body.ultimo_error, null);
    } finally {
      await rpc('quitar_portal_credencial', B, { p_portal: 'comprasmx' });
    }
  });

test('nivel 80: ve la lista pero el RPC de guardar rechaza', { skip: N80 ? skip : 'OBRA_QA_TOKEN_N80 no definido (verificado por SQL en transacción)' }, async () => {
  const g = await rpc('guardar_portal_credencial', N80, { p_portal: 'otro', p_usuario: 'x', p_password: FICTICIA });
  assert.notEqual(g.status, 200);
  assert.notEqual((await rpc('quitar_portal_credencial', N80, { p_portal: 'comprasmx' })).status, 200);
});
