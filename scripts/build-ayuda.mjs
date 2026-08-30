// Genera el centro de ayuda (src/ayuda/) a partir de docs/manual-de-usuario.md (US-223).
// Una página por sección "## " del manual, un índice con buscador y un JSON para la búsqueda dentro de la app.
// Uso: node scripts/build-ayuda.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MD = readFileSync(join(ROOT, 'docs', 'manual-de-usuario.md'), 'utf8');
const OUT = join(ROOT, 'src', 'ayuda');
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

const slug = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(t) {
  return esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, a, b) => /^https?:/.test(b) ? `<a href="${b}" target="_blank" rel="noopener">${a}</a>` : a);
}
// Conversor markdown mínimo: encabezados, párrafos, listas, tablas, código, imágenes
function md2html(lines) {
  const out = []; let i = 0; let lista = null; let code = false; let tabla = [];
  const cerrarLista = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  const cerrarTabla = () => { if (tabla.length) { const [h, , ...b] = tabla; const cells = (r) => r.split('|').slice(1, -1).map((c) => c.trim()); out.push(`<div class="tbl"><table><thead><tr>${cells(h).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${b.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); tabla = []; } };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('```')) { cerrarLista(); cerrarTabla(); code = !code; out.push(code ? '<pre><code>' : '</code></pre>'); continue; }
    if (code) { out.push(esc(l)); continue; }
    if (/^\|/.test(l)) { cerrarLista(); tabla.push(l); continue; } else cerrarTabla();
    const h = l.match(/^(#{3,6})\s+(.*)/); if (h) { cerrarLista(); out.push(`<h${h[1].length} id="${slug(h[2])}">${inline(h[2])}</h${h[1].length}>`); continue; }
    const img = l.match(/^!\[([^\]]*)\]\(([^)]+)\)/); if (img) { cerrarLista(); out.push(`<figure><img src="../${img[2].replace(/^\.?\/?docs\//, 'docs/').replace(/^img\//, 'docs/img/')}" alt="${esc(img[1])}" loading="lazy"></figure>`); continue; }
    const li = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (li) { const tipo = /^\s*\d+\./.test(l) ? 'ol' : 'ul'; if (lista !== tipo) { cerrarLista(); out.push(`<${tipo}>`); lista = tipo; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (!l.trim()) { cerrarLista(); continue; }
    cerrarLista(); out.push(`<p>${inline(l)}</p>`);
  }
  cerrarLista(); cerrarTabla();
  return out.join('\n');
}

// Partir el manual por "## "
const lines = MD.split(/\r?\n/);
const secciones = []; let actual = null;
for (const l of lines) {
  const m = l.match(/^##\s+(.*)/);
  if (m) { actual = { titulo: m[1].trim(), lineas: [] }; secciones.push(actual); continue; }
  if (actual) actual.lineas.push(l);
}
const utiles = secciones.filter((s) => !/tabla de contenidos/i.test(s.titulo) && s.lineas.join('').trim().length > 40);

const css = `
:root{--bg:#f8fafc;--surface:#fff;--ink:#1e293b;--muted:#475569;--line:#e2e8f0;--accent:#0369a1;--primary:#1e3a5f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6}
.wrap{max-width:860px;margin:0 auto;padding:24px 18px 64px}header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:1px solid var(--line);margin-bottom:20px}
.brand{font-weight:700;color:var(--primary)}.brand small{display:block;font-weight:400;color:var(--muted);font-size:12px}
a{color:var(--accent)}h1{font-size:26px;line-height:1.2;margin:0 0 12px}h2{font-size:22px;margin:28px 0 8px}h3{font-size:18px;margin:22px 0 6px}h4{font-size:16px;margin:18px 0 6px}
p,li{max-width:72ch}code{background:#eef2f7;padding:1px 5px;border-radius:4px;font-size:.92em}pre{background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;overflow-x:auto;font-size:13px}
.tbl{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px;margin:8px 0 14px}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}th{background:var(--bg)}
figure{margin:14px 0}figure img{max-width:100%;border:1px solid var(--line);border-radius:8px}
input.buscar{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:10px;font-size:16px;margin:8px 0 16px}
.lista a{display:block;padding:10px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:8px;text-decoration:none;color:var(--ink);background:var(--surface)}.lista a:hover{border-color:var(--accent)}.lista small{display:block;color:var(--muted);font-size:13px}
.btn{display:inline-block;background:var(--primary);color:#fff;text-decoration:none;padding:9px 14px;border-radius:8px;font-size:14px}
footer{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
nav.mini{font-size:14px;margin-bottom:12px}`;

const layout = (titulo, body, extraHead = '') => `<!DOCTYPE html><html lang="es-MX"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)} · Ayuda · Control de Obra</title><meta name="robots" content="noindex">${extraHead}<style>${css}</style></head><body><div class="wrap">
<header><div class="brand">Centro de ayuda<small>Control de Obra · Supernova Arquitectos</small></div><div><a class="btn" href="https://wa.me/526143443936?text=Hola,%20necesito%20ayuda%20con%20Control%20de%20Obra">WhatsApp de soporte</a></div></header>
${body}
<footer>Soporte: <a href="mailto:soporte@supernovarquitectos.com">soporte@supernovarquitectos.com</a> · WhatsApp +52 614 344 3936 (lunes a viernes, 9 a 18 h) · <a href="../index.html">Volver a la app</a></footer></div></body></html>`;

const indice = [];
for (const s of utiles) {
  const file = slug(s.titulo) + '.html';
  const html = md2html(s.lineas);
  const texto = s.lineas.join(' ').replace(/[#*`|>\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim();
  indice.push({ titulo: s.titulo, url: file, resumen: texto.slice(0, 160), texto: texto.slice(0, 4000).toLowerCase() });
  writeFileSync(join(OUT, file), layout(s.titulo, `<nav class="mini"><a href="index.html">Todos los temas</a></nav><h1>${inline(s.titulo)}</h1>${html}`));
}
writeFileSync(join(OUT, 'indice.json'), JSON.stringify(indice.map(({ titulo, url, resumen, texto }) => ({ titulo, url, resumen, texto })), null, 0));
const lista = indice.map((s) => `<a href="${s.url}" data-t="${esc((s.titulo + ' ' + s.resumen).toLowerCase())}">${esc(s.titulo)}<small>${esc(s.resumen)}…</small></a>`).join('');
writeFileSync(join(OUT, 'index.html'), layout('Centro de ayuda', `<h1>¿En qué te ayudamos?</h1><p>Guías por módulo, por rol y por proceso (proyecto, compras, cobranza, personal, cierre). Escribe una palabra para filtrar.</p><input class="buscar" id="q" placeholder="Buscar: gastos, cobro, socios, cierre…" aria-label="Buscar en la ayuda"><div class="lista" id="lista">${lista}</div>`,
  `<script>document.addEventListener('DOMContentLoaded',()=>{const q=document.getElementById('q'),ls=[...document.querySelectorAll('#lista a')];q.addEventListener('input',()=>{const v=q.value.toLowerCase().trim();ls.forEach(a=>{a.style.display=!v||a.dataset.t.includes(v)?'':'none';});});const u=new URLSearchParams(location.search).get('q');if(u){q.value=u;q.dispatchEvent(new Event('input'));}});</script>`));
console.log(`ayuda: ${indice.length} páginas en src/ayuda/`);
