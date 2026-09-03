// US-602: novedades del portal desde el servidor (migración 057).
// portal_datos devuelve novedades {fotos, documentos, pagos_vencidos, proximo_pago_dias, ultimo_visto_at}
// y actualiza portal_usuarios.ultimo_visto_at al final; portal_obra (enlace de obra) recibe ceros;
// portal_evento registra telemetría con límite de 60 por sesión y hora.
// Requiere PORTAL_QA_TOKEN (usuario qa.portal, empresa 11, obra 48) y, para el enlace de obra,
// PORTAL_QA_OBRA_TOKEN (48 hex de la obra 48). Sin tokens, las pruebas se omiten.
// PORTAL_QA_RATE=1 activa la prueba del límite (61 llamadas; deja la llave del enlace agotada una hora).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const TOKEN = process.env.PORTAL_QA_TOKEN || '';
const OBRA_TOKEN = process.env.PORTAL_QA_OBRA_TOKEN || '';
const OBRA = 48;
const skip = TOKEN ? false : 'PORTAL_QA_TOKEN no definido';
const skipObra = OBRA_TOKEN ? false : 'PORTAL_QA_OBRA_TOKEN no definido';
const skipRate = process.env.PORTAL_QA_RATE === '1' && OBRA_TOKEN ? false : 'PORTAL_QA_RATE=1 y PORTAL_QA_OBRA_TOKEN para probar el límite';

async function rpc(name, args = {}) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
const datos = () => rpc('portal_datos', { p_token: TOKEN, p_obra_id: OBRA });
const evento = (token, ev, meta) => rpc('portal_evento', { p_token: token, p_evento: ev, ...(meta === undefined ? {} : { p_meta: meta }) });

// «Hoy» como lo calcula el servidor: fecha civil en America/Mexico_City
function hoyMx() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const dias = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

const formaNovedades = (n) => {
  assert.ok(n && typeof n === 'object', 'novedades debe ser un objeto');
  for (const k of ['fotos', 'documentos', 'pagos_vencidos']) assert.equal(typeof n[k], 'number', `${k} numérico`);
  assert.ok(n.proximo_pago_dias === null || Number.isInteger(n.proximo_pago_dias), 'proximo_pago_dias entero o nulo');
  assert.ok('ultimo_visto_at' in n, 'ultimo_visto_at presente');
};

let primera = null;

test('portal_datos devuelve novedades coherentes con el plan de pagos', { skip }, async () => {
  const r = await datos();
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.ok(!r.body.error, `error del portal: ${r.body.error}`);
  primera = r.body;
  formaNovedades(r.body.novedades);
  const hoy = hoyMx();
  const conSaldo = (r.body.plan_pagos || []).filter((x) => Number(x.monto || 0) - Number(x.cobrado || 0) > 0.5);
  const vencidos = conSaldo.filter((x) => x.vence && x.vence < hoy).length;
  const proximos = conSaldo.filter((x) => x.vence && x.vence >= hoy).map((x) => x.vence).sort();
  assert.equal(r.body.novedades.pagos_vencidos, vencidos, 'pagos_vencidos = CxC vencidas con saldo > 0.50');
  assert.equal(r.body.novedades.proximo_pago_dias, proximos.length ? dias(proximos[0], hoy) : null, 'proximo_pago_dias = días a la siguiente CxC con saldo');
  // fotos y documentos nuevos nunca superan los visibles en el mismo payload
  assert.ok(r.body.novedades.fotos <= (r.body.fotos || []).length || (r.body.fotos || []).length === 60);
  assert.ok(r.body.novedades.documentos <= (r.body.documentos || []).length);
  for (const f of r.body.fotos || []) assert.ok('creada' in f, 'cada foto trae creada (created_at) para etiquetar «Nuevo»');
  for (const d of r.body.documentos || []) assert.ok('creado' in d, 'cada documento trae creado (created_at)');
});

test('la segunda visita ya trae ultimo_visto_at reciente y sin fotos ni documentos nuevos', { skip }, async () => {
  const r = await datos();
  assert.equal(r.status, 200);
  formaNovedades(r.body.novedades);
  const visto = r.body.novedades.ultimo_visto_at;
  assert.ok(visto, 'la primera llamada debió dejar ultimo_visto_at');
  const hace = Date.now() - Date.parse(visto);
  assert.ok(hace >= 0 && hace < 5 * 60 * 1000, `ultimo_visto_at debe ser de hace unos segundos (${Math.round(hace / 1000)} s)`);
  assert.equal(r.body.novedades.fotos, 0, 'nada nuevo desde hace unos segundos');
  assert.equal(r.body.novedades.documentos, 0);
  // lo que no depende de la visita se conserva
  assert.equal(r.body.novedades.pagos_vencidos, primera.novedades.pagos_vencidos);
  assert.equal(r.body.novedades.proximo_pago_dias, primera.novedades.proximo_pago_dias);
});

test('portal_datos con sesión inválida o sin acceso no toca nada', { skip }, async () => {
  const mala = await rpc('portal_datos', { p_token: '0'.repeat(64), p_obra_id: OBRA });
  assert.equal(mala.body.error, 'sesion_invalida');
  const ajena = await rpc('portal_datos', { p_token: TOKEN, p_obra_id: 19 });
  assert.equal(ajena.body.error, 'sin_acceso');
});

test('el enlace de obra (portal_obra) recibe novedades en ceros', { skip: skipObra }, async () => {
  const r = await rpc('portal_obra', { p_token: OBRA_TOKEN });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.ok(!r.body.error, `error: ${r.body.error}`);
  assert.deepEqual(r.body.novedades, { fotos: 0, documentos: 0, pagos_vencidos: 0, proximo_pago_dias: null, ultimo_visto_at: null });
});

test('portal_evento registra con sesión de cuenta y valida evento y meta', { skip }, async () => {
  const ok = await evento(TOKEN, 'qa_ralph_prueba', { obra_id: OBRA, seccion: 'pagos' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 200));
  assert.equal(ok.body.ok, true);
  assert.equal(typeof ok.body.id, 'number');
  const sinMeta = await evento(TOKEN, 'qa_ralph_prueba');
  assert.equal(sinMeta.body.ok, true, 'p_meta es opcional');
  assert.equal((await evento(TOKEN, 'Mal Evento', {})).body.error, 'evento_invalido');
  assert.equal((await evento(TOKEN, '', {})).body.error, 'evento_invalido');
  assert.equal((await evento(TOKEN, 'qa_ralph_prueba', ['x'])).body.error, 'meta_invalida');
  assert.equal((await evento(TOKEN, 'qa_ralph_prueba', { s: 'x'.repeat(2100) })).body.error, 'meta_invalida');
  assert.equal((await evento('0'.repeat(64), 'seccion', {})).body.error, 'sesion_invalida');
  assert.equal((await evento('abc', 'seccion', {})).body.error, 'sesion_invalida');
});

test('portal_evento acepta el enlace de obra (llave token:<8 hex>)', { skip: skipObra }, async () => {
  const ok = await evento(OBRA_TOKEN, 'qa_ralph_prueba', { seccion: 'inicio' });
  assert.equal(ok.body.ok, true, JSON.stringify(ok.body).slice(0, 200));
  assert.equal((await evento('0'.repeat(48), 'seccion', {})).body.error, 'sesion_invalida');
});

test('límite de 60 eventos por sesión y hora', { skip: skipRate }, async () => {
  let limite = null;
  for (let i = 0; i < 61; i++) {
    const r = await evento(OBRA_TOKEN, 'qa_ralph_limite', { i });
    if (r.body.error === 'limite_eventos') { limite = i; break; }
    assert.equal(r.body.ok, true, `llamada ${i}: ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  assert.ok(limite !== null && limite <= 60, `debió cortar a más tardar en la llamada 61 (cortó en ${limite})`);
});
