// US-854 / US-855: el conector local inicia sesión con la cuenta de la empresa SÓLO con un boleto de un solo uso, UN
// intento por petición, y cierra la sesión del portal. Se prueba contra un SIMULADOR del inicio de sesión de Keycloak
// (servidor local en este archivo), nunca contra ComprasMX, y con una contraseña FICTICIA en la empresa de QA_TOKEN_B.
// Requiere Python + Playwright + Google Chrome, QA_TOKEN_B y el secreto de ingesta (entorno o
// ~/.config/control-obra/convocatorias.env); si falta algo, se omite. Sólo corre con CONECTOR_SESION=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const B = process.env.QA_TOKEN_B || '';
const PUERTO = 18880;
const PUERTO_SIM = 18881;
const APP = 'https://app.supernovarquitectos.com';
const SCRIPT = fileURLToPath(new URL('../licitaciones/conector-local.py', import.meta.url));
const PY = ['python', 'python3', 'py'].find((c) => spawnSync(c, ['--version']).status === 0);
const PW = PY && spawnSync(PY, ['-c', 'import playwright']).status === 0;
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const ENV_SECRETO = join(HOME, '.config', 'control-obra', 'convocatorias.env');
const TIENE_SECRETO = !!process.env.CONVOCATORIAS_INGESTA_SECRET || (existsSync(ENV_SECRETO) && /CONVOCATORIAS_INGESTA_SECRET\s*=/.test(readFileSync(ENV_SECRETO, 'utf8')));
const CHROME = ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].some((v) => process.env[v] && existsSync(join(process.env[v], 'Google', 'Chrome', 'Application', 'chrome.exe')));
// Abre Chrome y usa el acceso de ComprasMX de la empresa B, igual que portales.test.mjs: si corren a la vez se pisan.
// Por eso es opcional: CONECTOR_SESION=1 node --env-file=.env --test scripts/qa/conector-sesion.test.mjs
const skip = !process.env.CONECTOR_SESION ? 'opcional: CONECTOR_SESION=1 (abre Chrome; no correr junto con portales.test.mjs)' : !PY ? 'sin Python' : !PW ? 'sin Playwright' : !CHROME ? 'sin Google Chrome' : !B ? 'sin QA_TOKEN_B' : !TIENE_SECRETO ? 'sin secreto de ingesta' : false;
const PASS = 'qa-ficticia-sim-' + Date.now();
const DATOS = join(process.env.LOCALAPPDATA || HOME, 'control-obra');

// ---- Simulador de Keycloak -------------------------------------------------------------------------------------------
const sim = { logins: 0, logouts: 0, passEsperada: PASS };
const pagina = (cuerpo) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Sim</title></head><body>${cuerpo}</body></html>`;
const formulario = (error) => pagina(`<form method="post" action="/auth/realms/procura/login-actions/authenticate">
${error ? `<span id="input-error">${error}</span>` : ''}<input name="username"><input name="password" type="password">
<input type="submit" name="login" value="Iniciar sesión"></form>`);
const servidor = http.createServer((req, res) => {
  const cookie = req.headers.cookie || '';
  const html = (s, c, extra = {}) => { res.writeHead(c || 200, { 'Content-Type': 'text/html; charset=utf-8', ...extra }); res.end(s); };
  if (req.url.startsWith('/panel/api/invitaciones')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ registros: [] }] }));
  }
  if (req.url.startsWith('/panel/invitaciones')) {
    return html(pagina('<h1>Invitaciones</h1><script>fetch("/panel/api/invitaciones")</script>'));
  }
  if (req.url.startsWith('/panel')) {
    if (/sim=dentro/.test(cookie)) return html(pagina('<h1>Panel del licitante</h1><nav><a href="/panel/invitaciones">Invitaciones</a><a href="/panel/">Inicio</a></nav>'));
    return html('', 302, { Location: '/auth/realms/procura/protocol/openid-connect/auth' });
  }
  if (req.url.includes('/openid-connect/logout')) {
    sim.logouts++;
    return html(pagina('<p>Sesión cerrada</p>'), 200, { 'Set-Cookie': 'sim=; Path=/; Max-Age=0' });
  }
  if (req.method === 'POST' && req.url.includes('/login-actions/authenticate')) {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      sim.logins++;
      const p = new URLSearchParams(b);
      if (p.get('username') === 'qa.sim' && p.get('password') === sim.passEsperada) {
        return html('', 302, { Location: '/panel/', 'Set-Cookie': 'sim=dentro; Path=/' });
      }
      html(formulario('Usuario o contraseña incorrectos.'));
    });
    return;
  }
  if (req.url.includes('/openid-connect/auth')) return html(formulario(''));
  html('no', 404);
});

let proc;
function pedir(metodo, ruta, cuerpo) {
  return new Promise((ok, mal) => {
    const datos = cuerpo === undefined ? null : Buffer.from(JSON.stringify(cuerpo));
    const h = { Host: `127.0.0.1:${PUERTO}`, Origin: APP, 'Content-Type': 'application/json' };
    if (datos) h['Content-Length'] = datos.length;
    const req = http.request({ host: '127.0.0.1', port: PUERTO, method: metodo, path: ruta, headers: h }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => (b += c));
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} ok({ status: res.statusCode, json: j, texto: b }); });
    });
    req.on('error', mal);
    if (datos) req.write(datos);
    req.end();
  });
}
async function rpc(nombre, args) {
  const r = await fetch(`${SB}/rest/v1/rpc/${nombre}`, { method: 'POST', body: JSON.stringify(args),
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', 'x-obra-token': B } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function emitir(proposito) {
  const r = await fetch(`${SB}/functions/v1/portal-credencial`, { method: 'POST', body: JSON.stringify({ accion: 'emitir', portal: 'comprasmx', proposito }),
    headers: { 'Content-Type': 'application/json', 'x-obra-token': B } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function estadoB() {
  const r = await fetch(`${SB}/rest/v1/empresa_portales?select=estado,probado_at,ultimo_error&portal=eq.comprasmx`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-obra-token': B } });
  return (await r.json())[0];
}
function archivos(dir) {
  const out = [];
  const rec = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); const s = statSync(p); if (s.isDirectory()) { if (n !== '__pycache__') rec(p); } else if (!/\.log$/.test(n)) out.push(p); } };
  if (existsSync(dir)) rec(dir);
  return out.sort();
}

before(async () => {
  if (skip) return;
  await new Promise((r) => servidor.listen(PUERTO_SIM, '127.0.0.1', r));
  const env = { ...process.env, CONECTOR_PUERTO: String(PUERTO),
    COMPRASMX_PANEL_URL: `http://127.0.0.1:${PUERTO_SIM}/panel/`,
    COMPRASMX_LOGOUT_URL: `http://127.0.0.1:${PUERTO_SIM}/auth/realms/procura/protocol/openid-connect/logout` };
  // La red de la oficina inspecciona TLS: si el conector instalado lo tiene activado, la prueba hace lo mismo.
  const instalado = join(DATOS, 'conector', 'conector.env');
  if (existsSync(instalado) && /CONVOCATORIAS_TLS_INSEGURO\s*=\s*1/.test(readFileSync(instalado, 'utf8'))) env.CONVOCATORIAS_TLS_INSEGURO = '1';
  proc = spawn(PY, [SCRIPT, '--consola'], { env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { await pedir('GET', '/estado'); return; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error('el conector no arrancó');
});
after(async () => {
  proc?.kill();
  servidor.close();
  if (!skip) await rpc('quitar_portal_credencial', { p_portal: 'comprasmx' });
});

test('boleto no válido o sin canjear: 400/401 sin abrir el portal', { skip }, async () => {
  assert.equal((await pedir('POST', '/comprasmx/probar-acceso', { boleto: 'corto' })).status, 400);
  const r = await pedir('POST', '/comprasmx/probar-acceso', { boleto: 'A'.repeat(43) });
  assert.equal(r.status, 401);
  assert.equal(r.json.ok, false);
  assert.equal(sim.logins, 0);
  const b = await pedir('POST', '/comprasmx/buscar', { texto: 'x', boleto: 'corto' });
  assert.equal(b.status, 400);
});

test('probar acceso: UN intento, entra, informa «correcto», cierra la sesión; el boleto no sirve dos veces; sin archivos nuevos', { skip, timeout: 180000 }, async () => {
  const antes = archivos(DATOS);
  const g = await rpc('guardar_portal_credencial', { p_portal: 'comprasmx', p_usuario: 'qa.sim', p_password: PASS });
  assert.equal(g.status, 200);
  const e = await emitir('probar');
  assert.equal(e.status, 200);
  const r = await pedir('POST', '/comprasmx/probar-acceso', { boleto: e.body.boleto });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.ok, true, r.texto);
  assert.equal(r.json.estado, 'correcto');
  assert.equal(r.json.sesion_cerrada, true);
  assert.ok(!r.texto.includes(PASS), 'la respuesta no trae la contraseña');
  assert.equal(sim.logins, 1, 'un solo intento');
  assert.equal(sim.logouts, 1, 'cerró la sesión del portal');
  assert.equal((await estadoB()).estado, 'correcto');
  const otra = await pedir('POST', '/comprasmx/probar-acceso', { boleto: e.body.boleto });
  assert.equal(otra.status, 401, 'el boleto ya se usó');
  assert.equal(sim.logins, 1);
  assert.deepEqual(archivos(DATOS), antes, 'el conector no deja cookies ni estado en disco');
});

test('buscar con la cuenta y contraseña rechazada: {error:"sesion"} sin buscar, estado «fallo», no se reintenta', { skip, timeout: 180000 }, async () => {
  const antes = archivos(DATOS);
  sim.passEsperada = PASS + '-otra';   // el portal ya no acepta la guardada
  const e = await emitir('buscar');
  assert.equal(e.status, 200, JSON.stringify(e.body));
  const n0 = sim.logins;
  const r = await pedir('POST', '/comprasmx/buscar', { texto: 'agua', entidades: ['Chihuahua'], boleto: e.body.boleto });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.error, 'sesion');
  assert.equal(r.json.mensaje, 'Usuario o contraseña incorrectos.');
  assert.equal(r.json.corrida_id, null, 'no se registró ninguna búsqueda');
  assert.equal(sim.logins, n0 + 1, 'un solo intento');
  const est = await estadoB();
  assert.equal(est.estado, 'fallo');
  assert.equal(est.ultimo_error, 'Usuario o contraseña incorrectos.');
  const bloq = await emitir('buscar');
  assert.equal(bloq.status, 409, 'en «fallo» no hay otro boleto hasta cambiar la contraseña');
  assert.equal((await pedir('GET', '/estado')).json.ocupado, false);
  assert.deepEqual(archivos(DATOS), antes);
});
