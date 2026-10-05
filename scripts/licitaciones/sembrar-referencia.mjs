#!/usr/bin/env node
// Siembra del banco de precios con lo verificado en la skill /opus-budget-direct (US-824).
//
// Lee scripts/licitaciones/referencia-2026.json y, con la sesión de un usuario de nivel >= 80 (la empresa la pone el
// servidor desde la sesión), carga cada insumo y su precio con fuente = 'referencia', la plaza y la fecha de su
// fuente. Idempotente: el insumo se busca por clave + unidad + tipo (sin distinguir mayúsculas) y el precio se
// escribe con upsert sobre (insumo_id, fecha, plaza, fuente, licitacion_id); correrlo dos veces no duplica nada.
// Los parámetros laborales 2026 son fila de fábrica (migración 098): aquí sólo se comprueba que coincidan.
//
// Uso:  set -a; . ./.env; set +a; node scripts/licitaciones/sembrar-referencia.mjs [--dry-run]
// Token: BANCO_TOKEN o OBRA_QA_TOKEN (sesión x-obra-token). Repo público: nunca escribas el token aquí.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const TOKEN = process.env.BANCO_TOKEN || process.env.OBRA_QA_TOKEN || '';
const DRY = process.argv.includes('--dry-run');
const aqui = dirname(fileURLToPath(import.meta.url));
const REF = JSON.parse(readFileSync(resolve(aqui, 'referencia-2026.json'), 'utf8'));

async function rest(path, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', Prefer: 'return=representation',
      'x-obra-token': TOKEN, ...(opts.headers || {}) },
  });
  let body = null; try { body = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path.split('?')[0]} → ${r.status} ${JSON.stringify(body)}`);
  return body;
}

/** Aplana los grupos del JSON en filas listas para cargar (función pura, la prueba la usa). */
export function filasReferencia(ref) {
  const out = [];
  for (const g of ref.grupos) {
    for (const i of g.insumos) {
      const unidad = i.unidad || g.unidad;
      const datos = { fuente_texto: g.fuente_texto, grupo: g.nombre };
      if (g.tipo === 'mano_obra') Object.assign(datos, { salario_base: i.salario_base, sbc: i.sbc, fsr: i.fsr, costo_jornada: i.precio });
      out.push({ clave: i.clave, descripcion: i.descripcion, unidad, tipo: g.tipo, familia: g.familia || null,
        precio: i.precio, fecha: g.fecha, plaza: g.plaza, fuente: 'referencia', datos, notas: g.fuente_texto });
    }
  }
  return out;
}

async function comprobarParametros() {
  const p = REF.parametros_laborales;
  const filas = await rest(`parametros_laborales?anio=eq.${p.anio}&select=*`);
  const fab = (filas || []).find((f) => f.es_fabrica);
  if (!fab) return `Falta la fila de fábrica ${p.anio}: aplica migrations/098_parametros_laborales_2026.sql`;
  const dif = [];
  for (const k of ['uma', 'salario_minimo', 'salario_minimo_frontera', 'salario_albanil', 'dias_vacaciones', 'riesgo_trabajo_pct', 'isn_pct']) {
    if (Math.abs(Number(fab[k]) - Number(p[k])) > 1e-6) dif.push(`${k}: BD ${fab[k]} · referencia ${p[k]}`);
  }
  const pcts = (fab.cesantia_tabla || []).map((x) => Number(x.pct));
  if (JSON.stringify(pcts) !== JSON.stringify(p.cesantia_pcts)) dif.push(`cesantía: BD ${pcts.join(', ')}`);
  return dif.length ? 'Parámetros 2026 distintos: ' + dif.join('; ') : null;
}

async function main() {
  if (!TOKEN) { console.error('Falta BANCO_TOKEN u OBRA_QA_TOKEN en el entorno.'); process.exit(2); }
  const avisoParam = await comprobarParametros();
  console.log(avisoParam ? `⚠ ${avisoParam}` : '✓ Parámetros laborales 2026 (fábrica) coinciden con la referencia');

  const filas = filasReferencia(REF);
  const existentes = [];
  for (let desde = 0; ; desde += 1000) {
    const pag = await rest(`insumos?select=id,clave,unidad,tipo&order=id&limit=1000&offset=${desde}`);
    existentes.push(...pag); if (pag.length < 1000) break;
  }
  const llave = (c, u, t) => `${String(c).trim().toLowerCase()}|${String(u || '').trim().toLowerCase()}|${t}`;
  const porLlave = new Map(existentes.map((i) => [llave(i.clave, i.unidad, i.tipo), i.id]));

  let nuevos = 0, reusados = 0, precios = 0;
  for (const f of filas) {
    const k = llave(f.clave, f.unidad, f.tipo);
    let id = porLlave.get(k);
    if (id) reusados++;
    else if (DRY) { nuevos++; precios++; continue; }
    else {
      const [ins] = await rest('insumos', { method: 'POST', body: JSON.stringify({ clave: f.clave, descripcion: f.descripcion, unidad: f.unidad, tipo: f.tipo, familia: f.familia }) });
      id = ins.id; porLlave.set(k, id); nuevos++;
    }
    if (DRY) { precios++; continue; }
    await rest('insumo_precios?on_conflict=insumo_id,fecha,plaza,fuente,licitacion_id', {
      method: 'POST', headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify({ insumo_id: id, precio: f.precio, fecha: f.fecha, plaza: f.plaza, fuente: f.fuente, licitacion_id: null, datos: f.datos, notas: f.notas }),
    });
    precios++;
  }
  console.log(`${DRY ? '[simulación] ' : ''}${filas.length} precios de referencia · ${nuevos} insumos nuevos · ${reusados} ya existían · ${precios} precios escritos (upsert)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
