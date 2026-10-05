#!/usr/bin/env node
// Carga inicial de históricos al banco de precios (US-828). Usa EXACTAMENTE el mismo camino que la pestaña
// «Importar de OPUS» (US-825/826): la función pura BancoPrecios.conciliarInsumos() + mapaImportacion() y la RPC
// importar_opus_insumos. Idempotente: la licitación se busca por código (no se pisan datos ya capturados; sólo se
// llenan los vacíos) y la RPC no duplica insumos, precios, conceptos ni componentes.
//
// Política de la carga (no hay a quién preguntar): un «parecido por descripción» se acepta como el mismo insumo SÓLO
// si la similitud es ≥ 0.80 y la unidad es la misma (sin mayúsculas); todos los demás entran como nuevos y quedan
// listados en el reporte para revisarlos con «Fusionar» en el banco. Los proyectos privados mal cotizados (Fachada
// Ortiz Mena, Casa 20x40) NO se cargan.
//
// Uso:  set -a; . ./.env; set +a; node scripts/licitaciones/cargar-historicos.mjs [--dry-run] [--reporte salida.json]
// Token: BANCO_TOKEN u OBRA_QA_TOKEN (sesión x-obra-token de la empresa a cargar). Repo público: sin tokens aquí.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const BP = require('../../src/js/banco-precios.js');
const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const TOKEN = process.env.BANCO_TOKEN || process.env.OBRA_QA_TOKEN || '';
const DRY = process.argv.includes('--dry-run');
const iRep = process.argv.indexOf('--reporte');
const REPORTE = iRep > 0 ? process.argv[iRep + 1] : null;
const DIR = process.env.OPUS_INSUMOS_DIR || 'C:/dev/Codex/output/insumos';
const UMBRAL_CARGA = 0.8;

/** Los cuatro proyectos públicos con los datos de su licitación (fuentes: bases.json de LicitaGen y memorias). */
export const PROYECTOS = [
  { archivo: 'archivo-municipal-MC-2617057-057.opus-insumos.json', plaza: 'cuauhtemoc', fecha: '2026-09-14',
    licitacion: { codigo: 'MC-2617057-057', nombre: 'Construcción de Archivo Municipal II Etapa, Cd. Cuauhtémoc, Chihuahua',
      convocante: 'Municipio de Cuauhtémoc', modalidad: 'licitacion_publica', ubicacion: 'Cd. Cuauhtémoc, Chihuahua', plaza: 'cuauhtemoc',
      visita: '2026-08-20T10:00:00-06:00', junta_aclaraciones: '2026-09-03T10:00:00-06:00', presentacion: '2026-09-14T13:30:00-06:00',
      inicio_obra: '2026-09-15', plazo_dias: 100, anticipo_pct: 30, estatus: 'presentada',
      opus_proyecto: 'ARCHIVO MUNICIPAL II ETAPA MC-2617057-057',
      notas: 'Carga inicial del banco (US-828). Licitante: Grupo Constructor Montaña Blanca; Supernova hizo la ingeniería de costos. El resultado del fallo no está registrado: estatus «presentada» hasta capturarlo. Monto propuesto sin capturar: el .mdf actual ya no es el de la apertura.' } },
  { archivo: 'riego-polideportivo-III-MC-2617064-064.opus-insumos.json', plaza: 'cuauhtemoc', fecha: '2026-09-17',
    licitacion: { codigo: 'MC-2617064-064', nombre: 'Equipamiento para la aplicación de paisajismo y sistema de riego en Polideportivo III, Cd. Cuauhtémoc',
      convocante: 'Municipio de Cuauhtémoc', modalidad: 'licitacion_publica', ubicacion: 'Polideportivo III, Cd. Cuauhtémoc, Chihuahua', plaza: 'cuauhtemoc',
      visita: '2026-09-08T10:00:00-06:00', junta_aclaraciones: '2026-09-10T10:00:00-06:00', presentacion: '2026-09-17T13:30:00-06:00',
      fallo: '2026-09-22T12:00:00-06:00', plazo_dias: 90, anticipo_pct: 30, monto_propuesto: 2010515.56, monto_ganador: 2010515.56,
      ganador: 'Grupo Constructor Montaña Blanca en proposición conjunta con Supernova Arquitectos', estatus: 'ganada',
      opus_proyecto: 'RIEGO POLIDEPORTIVO III MC-2617064-064',
      notas: 'Carga inicial del banco (US-828). Acta de fallo 22-sep-2026: adjudicada por $2,010,515.56 sin IVA (APSA Ingeniería ofertó $2,228,925.07). Firma del contrato 02-oct-2026; la fecha de inicio real no está confirmada (las bases decían 22-sep).' } },
  { archivo: 'ichife-LO-67-010-908029999-N-12-2026.opus-insumos.json', plaza: 'casas_grandes', fecha: '2026-04-30',
    licitacion: { codigo: 'LO-67-010-908029999-N-12-2026', nombre: 'ICHIFE N-12-2026 · Partida 4: Universidad Tecnológica de Paquimé (6ta etapa), Casas Grandes',
      convocante: 'Instituto Chihuahuense de Infraestructura Física Educativa (ICHIFE)', modalidad: 'licitacion_publica', ubicacion: 'Casas Grandes, Chihuahua', plaza: 'casas_grandes',
      presentacion: '2026-04-30T10:00:00-06:00', fallo: '2026-05-12T10:00:00-06:00', inicio_obra: '2026-05-21', plazo_dias: 90, anticipo_pct: 30,
      estatus: 'presentada', opus_proyecto: 'ICHIFE-LO-67-010-908029999-N-12-2026',
      notas: 'Carga inicial del banco (US-828). Se prepararon las partidas 1, 4 y 6; el proyecto de OPUS es la partida 4 (Paquimé). El resultado no está registrado: estatus «presentada» hasta capturarlo. Las horas de presentación y fallo son aproximadas (las bases sólo dan el día).' } },
  { archivo: 'banregio-cuauhtemoc-CR-152.opus-insumos.json', plaza: 'cuauhtemoc', fecha: '2026-03-31',
    licitacion: { codigo: 'IBR-TRT-CUU-8721-2026-AI', nombre: 'Adaptación de local para Sucursal Banregio Cd. Cuauhtémoc CR 152',
      convocante: 'Inmobiliaria Banregio, S.A.', modalidad: 'privada', ubicacion: 'Calz. 16 de Septiembre, San Antonio, 31500 Cuauhtémoc, Chih.', plaza: 'cuauhtemoc',
      presentacion: '2026-03-31T12:00:00-06:00', inicio_obra: '2026-04-13', plazo_dias: 95, anticipo_pct: 30, estatus: 'presentada',
      opus_proyecto: 'BANREGIO CUAUHTEMOC CR 152',
      notas: 'Carga inicial del banco (US-828). El .mdf exportado es sólo el catálogo (193 conceptos sin matriz ni precios): entran los conceptos, no precios. Los APU reales viven en BanRegio.mdf, que no se exportó. El resultado no está registrado.' } },
];

async function rest(path, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...opts,
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', Prefer: 'return=representation', 'x-obra-token': TOKEN, ...(opts.headers || {}) } });
  let body = null; try { body = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path.split('?')[0]} → ${r.status} ${JSON.stringify(body)}`);
  return body;
}
async function insumosDelBanco() {
  const out = [];
  for (let d = 0; ; d += 1000) { const p = await rest(`insumos?select=id,clave,descripcion,unidad,tipo&order=id&limit=1000&offset=${d}`); out.push(...p); if (p.length < 1000) break; }
  return out;
}
/** Decisiones de la carga: sólo parecidos ≥ 0.80 con la misma unidad (función pura, la prueba la usa). */
export function decisionesCarga(conc, umbral = UMBRAL_CARGA) {
  const d = {}; const aceptados = []; const pendientes = [];
  for (const p of conc.parecido) {
    const k = String(p.recurso.clave).trim().toLowerCase();
    const c = p.candidatos.find((x) => x.puntaje >= umbral && String(x.insumo.unidad).trim().toLowerCase() === String(p.recurso.unidad || '').trim().toLowerCase());
    if (c) { d[k] = c.insumo.id; aceptados.push({ clave: p.recurso.clave, descripcion: p.recurso.descripcion, unidad: p.recurso.unidad, con: c.insumo.clave, con_descripcion: c.insumo.descripcion, puntaje: c.puntaje }); }
    else { d[k] = 'nuevo'; pendientes.push({ clave: p.recurso.clave, descripcion: p.recurso.descripcion, unidad: p.recurso.unidad, candidato: p.candidato.clave, candidato_descripcion: p.candidato.descripcion, candidato_unidad: p.candidato.unidad, puntaje: p.puntaje }); }
  }
  return { decisiones: d, aceptados, pendientes };
}
async function asegurarLicitacion(l) {
  const ex = await rest(`licitaciones?codigo=ilike.${encodeURIComponent(l.codigo)}&select=*`);
  if (ex.length) {
    const vacios = Object.fromEntries(Object.entries(l).filter(([k, v]) => k !== 'codigo' && k !== 'estatus' && (ex[0][k] === null || ex[0][k] === undefined || ex[0][k] === '') && v !== undefined));
    if (Object.keys(vacios).length && !DRY) await rest(`licitaciones?id=eq.${ex[0].id}`, { method: 'PATCH', body: JSON.stringify(vacios) });
    return { id: ex[0].id, creada: false, llenados: Object.keys(vacios) };
  }
  if (DRY) return { id: null, creada: true, llenados: [] };
  const [n] = await rest('licitaciones', { method: 'POST', body: JSON.stringify(l) });
  return { id: n.id, creada: true, llenados: [] };
}

async function main() {
  if (!TOKEN) { console.error('Falta BANCO_TOKEN u OBRA_QA_TOKEN.'); process.exit(2); }
  let existentes = await insumosDelBanco();
  const rep = { fecha: new Date().toISOString(), dry_run: DRY, umbral: UMBRAL_CARGA, proyectos: [] };
  let falso = -1; const aliasDry = {};
  for (const p of PROYECTOS) {
    const doc = BP.leerOpusInsumos(readFileSync(resolve(DIR, p.archivo), 'utf8'));
    // Mismo alias que la pestaña: una clave de OPUS ya ligada en otra importación se respeta (excepto la de esta licitación)
    const maps = DRY ? [] : await rest('banco_importaciones?select=mapa,updated_at,licitacion_id&order=updated_at');
    const conc = BP.conciliarInsumos(doc.recursos, existentes, { alias: { ...aliasDry, ...BP.aliasDeImportaciones(maps) } });
    const { decisiones, aceptados, pendientes } = decisionesCarga(conc);
    const mapa = BP.mapaImportacion(conc, decisiones);
    const lic = await asegurarLicitacion(p.licitacion);
    const r = { archivo: p.archivo, licitacion: p.licitacion.codigo, licitacion_id: lic.id, licitacion_creada: lic.creada, campos_llenados: lic.llenados,
      plaza: p.plaza, fecha: p.fecha, esperado: doc.resumen, coincide: conc.coincide.map((x) => ({ clave: x.recurso.clave, con: x.insumo.clave, aviso: x.aviso })),
      parecidos_aceptados: aceptados, parecidos_como_nuevos: pendientes, nuevos: conc.nuevo.length, omitidos: conc.omitidos.length };
    if (!DRY) {
      r.resultado = await rest('rpc/importar_opus_insumos', { method: 'POST', body: JSON.stringify({ p_licitacion_id: lic.id, p_plaza: p.plaza, p_fecha: p.fecha, p_doc: doc, p_mapa: mapa, p_archivo: p.archivo }) });
      existentes = await insumosDelBanco();
    } else {
      // Simula los insumos nuevos para que la conciliación del siguiente archivo sea la misma que tendrá la carga real
      for (const x of [...conc.nuevo.map((n) => n.recurso), ...conc.parecido.filter((q) => decisiones[String(q.recurso.clave).trim().toLowerCase()] === 'nuevo').map((q) => q.recurso)]) existentes.push({ id: falso--, clave: x.clave, descripcion: x.descripcion, unidad: x.unidad || '', tipo: x.tipo });
    }
    rep.proyectos.push(r);
    const res = r.resultado || {};
    console.log(`${p.licitacion.codigo}: licitación ${lic.creada ? 'creada' : 'ya existía'} (${lic.id}) · coinciden ${conc.coincide.length} · parecidos aceptados ${aceptados.length} · parecidos como nuevos ${pendientes.length} · nuevos ${conc.nuevo.length}` +
      (DRY ? '' : ` → recursos ${res.recursos_importados}/${res.recursos} · insumos nuevos ${res.insumos_nuevos} · precios ${res.precios} · conceptos ${res.conceptos} (${res.conceptos_con_pu} con PU) · componentes ${res.componentes}+${res.componentes_auxiliares}`));
  }
  if (REPORTE) writeFileSync(REPORTE, JSON.stringify(rep, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
