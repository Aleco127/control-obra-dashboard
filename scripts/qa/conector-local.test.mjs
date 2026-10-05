// Conector local de ComprasMX (US-851): CORS, Host, Content-Type, validación y contrato de /estado, sin tocar el
// portal (ninguna petición válida de búsqueda). Levanta el conector en un puerto de prueba para no chocar con el
// instalado en 8879. Si no hay Python en la máquina, la prueba se omite.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const PUERTO = 18879;
const SCRIPT = fileURLToPath(new URL('../licitaciones/conector-local.py', import.meta.url));
const PY = ['python', 'python3', 'py'].find((c) => spawnSync(c, ['--version']).status === 0);
const APP = 'https://app.supernovarquitectos.com';
let proc;

function pedir(metodo, ruta, { headers = {}, cuerpo } = {}) {
  return new Promise((ok, mal) => {
    const datos = cuerpo === undefined ? null : Buffer.from(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
    const h = { Host: `127.0.0.1:${PUERTO}`, ...headers };
    if (datos) h['Content-Length'] = datos.length;
    const req = http.request({ host: '127.0.0.1', port: PUERTO, method: metodo, path: ruta, headers: h }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let json = null;
        try { json = b ? JSON.parse(b) : null; } catch { /* sin cuerpo JSON */ }
        ok({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', mal);
    if (datos) req.write(datos);
    req.end();
  });
}

const json = { 'Content-Type': 'application/json' };

before(async () => {
  if (!PY) return;
  proc = spawn(PY, [SCRIPT, '--consola'], { env: { ...process.env, CONECTOR_PUERTO: String(PUERTO) }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { await pedir('GET', '/estado'); return; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error('el conector no arrancó');
});
after(() => proc?.kill());

const t = (nombre, fn) => test(nombre, { skip: !PY && 'sin Python' }, fn);

t('GET /estado responde el contrato y no está ocupado', async () => {
  const r = await pedir('GET', '/estado');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(typeof r.json.version, 'string');
  assert.equal(r.json.ocupado, false);
  assert.equal(typeof r.json.chrome, 'boolean');
  assert.deepEqual(Object.keys(r.json).sort(), ['chrome', 'ocupado', 'ok', 'version']);
});

t('preflight de la app: CORS + Private Network Access', async () => {
  const r = await pedir('OPTIONS', '/comprasmx/buscar', { headers: {
    Origin: APP, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
    'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers['access-control-allow-origin'], APP);
  assert.equal(r.headers['access-control-allow-private-network'], 'true');
  assert.match(r.headers['access-control-allow-methods'], /POST/);
  assert.match(r.headers['access-control-allow-headers'], /Content-Type/i);
});

t('preflight del alias y de localhost con puerto también pasan', async () => {
  for (const o of ['https://obra.srv1090924.hstgr.cloud', 'http://localhost:8774', 'http://127.0.0.1:5173']) {
    const r = await pedir('OPTIONS', '/comprasmx/buscar', { headers: { Origin: o, 'Access-Control-Request-Method': 'POST' } });
    assert.equal(r.status, 204, o);
    assert.equal(r.headers['access-control-allow-origin'], o);
  }
});

t('preflight de un origen ajeno: 403 y sin cabeceras CORS', async () => {
  for (const o of ['https://evil.example', 'http://app.supernovarquitectos.com', 'https://app.supernovarquitectos.com.evil.io', 'null']) {
    const r = await pedir('OPTIONS', '/comprasmx/buscar', { headers: { Origin: o, 'Access-Control-Request-Method': 'POST' } });
    assert.equal(r.status, 403, o);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  }
});

t('POST sin Origin o con Origin ajeno: 403', async () => {
  const a = await pedir('POST', '/comprasmx/buscar', { headers: json, cuerpo: { texto: 'x' } });
  assert.equal(a.status, 403);
  const b = await pedir('POST', '/comprasmx/buscar', { headers: { ...json, Origin: 'https://evil.example' }, cuerpo: { texto: 'x' } });
  assert.equal(b.status, 403);
  assert.equal(b.headers['access-control-allow-origin'], undefined);
  const c = await pedir('POST', '/comprasmx/cancelar', { headers: { ...json, Origin: 'https://evil.example' }, cuerpo: {} });
  assert.equal(c.status, 403);
});

t('POST sin Content-Type JSON (formulario «simple» de otra página): 415', async () => {
  const r = await pedir('POST', '/comprasmx/buscar', { headers: { Origin: APP, 'Content-Type': 'text/plain' }, cuerpo: '{"texto":"x"}' });
  assert.equal(r.status, 415);
});

t('Host distinto de 127.0.0.1/localhost (DNS rebinding): 403', async () => {
  const r = await pedir('GET', '/estado', { headers: { Host: `evil.example:${PUERTO}` } });
  assert.equal(r.status, 403);
});

t('GET /estado con Origin ajeno: 403', async () => {
  const r = await pedir('GET', '/estado', { headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

t('filtros no válidos: 400 sin abrir Chrome (US-852: nunca sin límite de fecha, máximo 90 días)', async () => {
  const futuro = new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10);
  for (const cuerpo of [{ tipos: ['adquisiciones'] }, { texto: 'x', desde: '05/10/2026' }, { max_resultados: 0 },
    { texto: 'x', desde: '2026-01-01', hasta: '2026-06-30' }, { texto: 'x', desde: futuro }, { texto: 'x', desde: '2026-10-05', hasta: '2026-09-01' }]) {
    const r = await pedir('POST', '/comprasmx/buscar', { headers: { ...json, Origin: APP }, cuerpo });
    assert.equal(r.status, 400, JSON.stringify(cuerpo));
    assert.match(r.json.error, /Filtros no válidos/);
    assert.equal(r.headers['access-control-allow-origin'], APP);
  }
  const e = await pedir('GET', '/estado');
  assert.equal(e.json.ocupado, false);
});

t('cancelar sin búsqueda en curso no hace nada', async () => {
  const r = await pedir('POST', '/comprasmx/cancelar', { headers: { ...json, Origin: APP }, cuerpo: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, cancelando: false });
});

t('rutas desconocidas: 404', async () => {
  const r = await pedir('GET', '/secreto');
  assert.equal(r.status, 404);
});
