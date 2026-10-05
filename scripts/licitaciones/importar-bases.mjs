#!/usr/bin/env node
/**
 * importar-bases.mjs (US-819) — Camino alterno de Claude Code: carga un archivo licitacion-bases/v1 directo por RPC,
 * con la SESIÓN DEL USUARIO (no hay llave de servicio ni de Anthropic). Usa las mismas funciones puras que la pantalla
 * «Importar bases» del panel (validarBases, propuestaDeBases, datosDeRevision de src/js/licitaciones.js), así que el
 * resultado es idéntico. Sin --aplicar sólo muestra la revisión campo por campo: nada se guarda.
 *
 *   OBRA_TOKEN=<token de tu sesión> node scripts/licitaciones/importar-bases.mjs bases.json --codigo MC-2617057-057 [--crear] [--aplicar] [--sin-requisitos]
 *
 * OBRA_TOKEN: el token de la sesión abierta en el panel (consola del navegador: JSON.parse(localStorage.obra_session).token).
 * Nunca lo pegues en el repo ni en un archivo versionado: el repo es público.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../../src/js/licitaciones.js');

const SB = process.env.SUPABASE_URL || 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = process.env.SUPABASE_ANON || 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const TOKEN = process.env.OBRA_TOKEN || '';
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const flag = (n) => args.includes(n);
const archivo = args.find((a) => !a.startsWith('--') && a !== opt('--codigo'));

function salir(msg, code = 1) { console.error(msg); process.exit(code); }
if (!archivo) salir('Uso: node scripts/licitaciones/importar-bases.mjs <bases.json> --codigo <código> [--crear] [--aplicar] [--sin-requisitos]');

const v = L.validarBases(readFileSync(archivo, 'utf8'));
if (!v.ok) salir('El archivo no cumple licitacion-bases/v1:\n  - ' + v.errores.join('\n  - '));
const codigo = opt('--codigo') || (v.datos.concurso && v.datos.concurso.numero);
if (!codigo) salir('Indica --codigo o pon concurso.numero en el archivo.');
if (!TOKEN) salir('Falta OBRA_TOKEN (el token de tu sesión del panel). El archivo es válido; sin token sólo se puede validar.', 2);

const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', 'x-obra-token': TOKEN };
async function rest(ruta) {
  const r = await fetch(`${SB}/rest/v1/${ruta}`, { headers: H });
  if (!r.ok) salir(`Error ${r.status} al leer ${ruta.split('?')[0]}: ${await r.text()}`);
  return r.json();
}
async function rpc(nombre, cuerpo) {
  const r = await fetch(`${SB}/rest/v1/rpc/${nombre}`, { method: 'POST', headers: H, body: JSON.stringify(cuerpo) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* texto */ }
  if (!r.ok) salir(`${nombre}: ${(j && j.message) || t}`);
  return j;
}

const COLS = 'id,codigo,nombre,convocante,perfil_id,modalidad,ubicacion,plaza,visita,junta_aclaraciones,presentacion,fallo,inicio_obra,plazo_dias,anticipo_pct,presupuesto_base,estatus,bases';
let [lic] = await rest(`licitaciones?select=${COLS}&codigo=eq.${encodeURIComponent(codigo)}`);
if (!lic) {
  if (!flag('--crear')) salir(`No existe la licitación ${codigo}. Agrega --crear para darla de alta con este archivo.`);
  if (!flag('--aplicar')) salir(`La licitación ${codigo} no existe; se crearía con --crear --aplicar. Nada se guardó.`, 0);
  const nombre = (v.datos.concurso && (v.datos.concurso.nombre || v.datos.concurso.objeto)) || codigo;
  const r = await rpc('guardar_licitacion', { p_datos: { codigo, nombre: String(nombre).slice(0, 300) } });
  [lic] = await rest(`licitaciones?select=${COLS}&id=eq.${r.id}`);
  console.log(`Licitación creada: ${codigo} (id ${lic.id})`);
}
const reqs = await rest(`licitacion_requisitos?select=anexo_id&licitacion_id=eq.${lic.id}`);
const prop = L.propuestaDeBases(v.datos, lic, reqs);

console.log(`\nRevisión de ${archivo} contra ${lic.codigo}:`);
for (const c of prop.campos) console.log(`  ${c.igual ? '=' : c.aplicar ? '→' : '· (no se aplica; el código ya existe)'} ${c.et}${c.pagina ? ` (pág. ${c.pagina})` : ''}\n      actual:    ${c.mostrarActual || '—'}\n      propuesto: ${c.mostrarPropuesto}`);
for (const a of prop.avisos) console.log(`  ! ${a}`);
console.log(`  Requisitos nuevos: ${prop.requisitosNuevos.length} · ya existentes (no se tocan): ${prop.requisitosExistentes.length}`);

if (!flag('--aplicar')) { console.log('\nNada se guardó. Repite con --aplicar para guardar.'); process.exit(0); }
const r = await rpc('guardar_licitacion', { p_datos: L.datosDeRevision(lic, prop, v.datos) });
let ins = 0;
if (!flag('--sin-requisitos') && prop.requisitosNuevos.length) {
  const x = await rpc('importar_requisitos', { p_licitacion_id: lic.id, p_requisitos: prop.requisitosNuevos.map(({ pagina, ...q }) => q) });
  ins = x.insertados;
}
console.log(`\nAplicado: ${prop.campos.filter((c) => c.aplicar).length} datos y ${ins} requisitos en ${r.licitacion.codigo} (id ${r.id}).`);
