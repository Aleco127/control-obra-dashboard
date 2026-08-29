#!/usr/bin/env node
/**
 * design-tokens-check.mjs (US-031)
 * Compara los tokens declarados en :root de src/css/styles.css contra los usados (var(--x)),
 * detecta valores crudos repetidos (hex/rgba) fuera de :root y colores crudos nuevos en index.html.
 * Sale con código 1 si hay tokens sin uso, tokens usados sin declarar o valores crudos repetidos ≥ 3 veces.
 *
 *   node scripts/qa/design-tokens-check.mjs [--strict]
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(resolve(root, 'src/css/styles.css'), 'utf8');
const html = readFileSync(resolve(root, 'src/index.html'), 'utf8');
const strict = process.argv.includes('--strict');

// 1) Tokens declarados en :root
const rootBlock = (css.match(/:root\s*\{([\s\S]*?)\n\}/) || ['', ''])[1];
const declared = new Set([...rootBlock.matchAll(/--([\w-]+)\s*:/g)].map(m => m[1]));

// 2) Tokens usados en CSS + HTML + JS
const used = new Set();
for (const src of [css, html, ...['ui-utils', 'wizard-obra', 'outbox', 'telemetry'].map(f => { try { return readFileSync(resolve(root, `src/js/${f}.js`), 'utf8'); } catch { return ''; } })]) {
  for (const m of src.matchAll(/var\(--([\w-]+)/g)) used.add(m[1]);
  for (const m of src.matchAll(/getPropertyValue\('--([\w-]+)'\)/g)) used.add(m[1]);
}
// Los tokens de referencia (--ref-*) sólo se usan dentro de :root: cuentan como usados si algún semántico los consume
for (const m of rootBlock.matchAll(/var\(--(ref-[\w-]+)\)/g)) used.add(m[1]);

const unused = [...declared].filter(t => !used.has(t));
const undeclared = [...used].filter(t => !declared.has(t));

// 3) Valores crudos repetidos fuera de :root (hex de 3/6 dígitos y rgba)
const cssNoRoot = css.replace(/:root\s*\{[\s\S]*?\n\}/, '').replace(/\/\*[\s\S]*?\*\//g, '');
const raw = {};
for (const m of cssNoRoot.matchAll(/#(?:[0-9a-fA-F]{3}){1,2}\b|rgba?\([^)]*\)/g)) { const k = m[0].toLowerCase(); raw[k] = (raw[k] || 0) + 1; }
const repeated = Object.entries(raw).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);

// 4) Colores crudos nuevos en index.html (fuera de las funciones de PDF/impresión/charts que necesitan hex)
const htmlHex = [...html.matchAll(/(?:color|background|border-color)\s*:\s*(#(?:[0-9a-fA-F]{3}){1,2})\b/g)].map(m => m[1].toLowerCase());
const htmlHexCount = htmlHex.reduce((a, h) => (a[h] = (a[h] || 0) + 1, a), {});

// 5) Escala tipográfica y de espaciado usada en el CSS (informativo)
const fontSizes = {};
for (const m of css.matchAll(/font-size\s*:\s*([^;}]+)/g)) { const v = m[1].trim(); fontSizes[v] = (fontSizes[v] || 0) + 1; }

console.log('== design-tokens-check ==');
console.log(`Tokens declarados: ${declared.size} · usados: ${used.size}`);
console.log(`Tokens sin uso (${unused.length}): ${unused.join(', ') || 'ninguno'}`);
console.log(`Tokens usados sin declarar (${undeclared.length}): ${undeclared.join(', ') || 'ninguno'}`);
console.log(`Valores crudos repetidos ≥3 fuera de :root (${repeated.length}): ${repeated.map(([k, n]) => `${k}×${n}`).join(', ') || 'ninguno'}`);
console.log(`Colores hex inline en index.html (${Object.keys(htmlHexCount).length} distintos): ${Object.entries(htmlHexCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}×${n}`).join(', ')}`);
console.log('Escala tipográfica en styles.css: ' + Object.entries(fontSizes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}(${n})`).join(' '));

let fail = unused.length > 0 || undeclared.length > 0 || repeated.length > 0;
if (strict && Object.keys(htmlHexCount).length > 0) fail = true;
console.log(fail ? '\nRESULTADO: FALLA' : '\nRESULTADO: OK');
process.exit(fail ? 1 : 0);
