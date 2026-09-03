// US-601: preferencias de navegación por usuario (migración 056).
// guardar_nav_prefs valida sesión, sanea el objeto y load_all_data_seguro lo devuelve junto a nivel.
// Requiere OBRA_QA_TOKEN (control-obra-dashboard/.env: set -a; . ./.env; set +a). Sin token, las pruebas se omiten.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const TOKEN = process.env.OBRA_QA_TOKEN || '';
const skip = TOKEN ? false : 'OBRA_QA_TOKEN no definido';

async function rpc(name, token, args = {}) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', ...(token ? { 'x-obra-token': token } : {}) },
    body: JSON.stringify(args),
  });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
const guardar = (prefs, token = TOKEN) => rpc('guardar_nav_prefs', token, { p_prefs: prefs });

let previas = null;

test('sin sesión guardar_nav_prefs rechaza', { skip }, async () => {
  const r = await guardar({ fijados: ['g'] }, null);
  assert.ok(r.status >= 400, `esperaba 4xx: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  const falso = await guardar({ fijados: ['g'] }, 'qa-token-inexistente');
  assert.ok(falso.status >= 400, `token inválido: ${falso.status}`);
});

test('guarda las preferencias completas, sin repetidos y en orden', { skip }, async () => {
  const antes = await rpc('load_all_data_seguro', TOKEN, { p_token: TOKEN });
  assert.equal(antes.status, 200);
  assert.ok(antes.body && 'nav_prefs' in antes.body, 'load_all_data_seguro ya debe traer nav_prefs');
  previas = antes.body.nav_prefs || {};
  const r = await guardar({ fijados: ['g', 'o', 'g', 'w'], colapsados: { dinero: true, equipo: false }, barra_colapsada: false });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.equal(r.body.success, true);
  assert.deepEqual(r.body.nav_prefs.fijados, ['g', 'o', 'w']);
  assert.deepEqual(r.body.nav_prefs.colapsados, { dinero: true, equipo: false });
  assert.equal(r.body.nav_prefs.barra_colapsada, false);
});

test('load_all_data_seguro devuelve nav_prefs junto a nivel', { skip }, async () => {
  const r = await rpc('load_all_data_seguro', TOKEN, { p_token: TOKEN });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.nivel, 'number');
  assert.deepEqual(r.body.nav_prefs.fijados, ['g', 'o', 'w']);
  assert.equal(r.body.nav_prefs.colapsados.dinero, true);
});

test('rechaza llaves extra, más de 6 fijados, tipos incorrectos y claves raras (y no guarda nada)', { skip }, async () => {
  const casos = [
    { tema: 'oscuro' },
    { fijados: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
    { fijados: 'g' },
    { fijados: ['<script>'] },
    { fijados: [1] },
    { colapsados: ['dinero'] },
    { colapsados: { dinero: 'sí' } },
    { barra_colapsada: 'sí' },
  ];
  for (const c of casos) {
    const r = await guardar(c);
    assert.ok(r.status >= 400, `debió rechazar ${JSON.stringify(c)}: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  const sigue = await rpc('load_all_data_seguro', TOKEN, { p_token: TOKEN });
  assert.deepEqual(sigue.body.nav_prefs.fijados, ['g', 'o', 'w'], 'un rechazo no debe tocar lo guardado');
});

test('el objeto completo reemplaza (no parcha) y se restauran las preferencias previas', { skip }, async () => {
  const r = await guardar({ barra_colapsada: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.nav_prefs, { barra_colapsada: true }, 'fijados y colapsados deben desaparecer');
  const back = await guardar(previas || {});
  assert.equal(back.status, 200, `no se pudieron restaurar las preferencias previas: ${JSON.stringify(back.body).slice(0, 120)}`);
});
