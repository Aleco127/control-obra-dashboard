// Build de Control de Obra (US-224, US-226): compila Tailwind, minifica JS con hash en el nombre, genera el service worker
// y deja todo listo en dist/. src/ sigue siendo la fuente editable; nunca se edita dist/ a mano.
// Uso: node scripts/build.mjs   (variables: BUILD_ID para forzar una versión)
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src'), DIST = join(ROOT, 'dist');
const BUILD_ID = process.env.BUILD_ID || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const t0 = Date.now();

if (existsSync(DIST)) rmSync(DIST, { recursive: true });
mkdirSync(join(DIST, 'js'), { recursive: true }); mkdirSync(join(DIST, 'css'), { recursive: true });

// 1) CSS: Tailwind compilado + styles.css con hash
execSync(`npx tailwindcss -c tailwind.config.js -i src/css/tailwind.css -o dist/css/tw.css --minify`, { cwd: ROOT, stdio: 'inherit' });
const tw = readFileSync(join(DIST, 'css', 'tw.css'));
const twName = `tw.${hash(tw)}.css`; writeFileSync(join(DIST, 'css', twName), tw); rmSync(join(DIST, 'css', 'tw.css'));
const stylesSrc = readFileSync(join(SRC, 'css', 'styles.css'));
const stylesName = `styles.${hash(stylesSrc)}.css`; writeFileSync(join(DIST, 'css', stylesName), stylesSrc);
// US-604: nav-shell.css (barra de módulos) con hash; lo enlazan index.html y portal.html
const navCssSrc = readFileSync(join(SRC, 'css', 'nav-shell.css'));
const navCssName = `nav-shell.${hash(navCssSrc)}.css`; writeFileSync(join(DIST, 'css', navCssName), navCssSrc);
const conHashCss = (html, pagina) => {
  let n = 0;
  html = html.replace(/<link href="css\/nav-shell\.css\?v=[^"]*" rel="stylesheet">/g, () => { n++; return `<link href="css/${navCssName}" rel="stylesheet">`; });
  if (n !== 1) throw new Error(`build: ${pagina} debe enlazar css/nav-shell.css?v= exactamente una vez (encontrado ${n})`);
  return html;
};

// 2) JS externos minificados con hash
const jsMap = {};
for (const f of readdirSync(join(SRC, 'js')).filter((f) => f.endsWith('.js'))) {
  const code = readFileSync(join(SRC, 'js', f), 'utf8');
  const min = (await esbuild.transform(code, { minify: true, target: 'es2019', legalComments: 'none' })).code;
  const name = `${basename(f, '.js')}.${hash(min)}.js`;
  writeFileSync(join(DIST, 'js', name), min); jsMap[f] = name;
}

// 3) index.html: quitar Tailwind CDN + config inline, enlazar CSS compilado, scripts con hash, minificar scripts inline
let html = readFileSync(join(SRC, 'index.html'), 'utf8');
html = html.replace(/<script src="https:\/\/cdn\.tailwindcss\.com[^"]*"[^>]*>\s*<\/script>/, '');
html = html.replace(/<script>tailwind\.config=\{[\s\S]*?\}<\/script>/, '');
// El CSS compilado va DESPUÉS de styles.css: el CDN inyectaba sus reglas al final del head y así ganaban a .btn/.inp
html = conHashCss(html, 'index.html');
// styles.css → styles con hash; el Tailwind compilado va justo después de nav-shell.css (que sigue a styles.css en el head)
html = html.replace(/<link href="css\/styles\.css\?v=[^"]*" rel="stylesheet">/, `<link href="css/${stylesName}" rel="stylesheet">`);
html = html.replace(`<link href="css/${navCssName}" rel="stylesheet">`, `<link href="css/${navCssName}" rel="stylesheet"><link href="css/${twName}" rel="stylesheet">`);
html = html.replace(/<script src="js\/([a-z0-9-]+\.js)\?v=[^"]*"><\/script>/g, (m, f) => jsMap[f] ? `<script src="js/${jsMap[f]}"></script>` : m);
// 3b) US-227: módulos hoja del script principal salen a js/mod-<clave>.<hash>.js y se cargan bajo demanda
//     (por marcador "// ========== NOMBRE ==========" en src/index.html; src sigue siendo una sola fuente).
const LAZY = [
  { key: 'n', marker: 'MÓDULO NÓMINA' },
  { key: 'ce', marker: 'MÓDULO CFDIs EMITIDOS' },
  { key: 'y', marker: 'MÓDULO SEGURIDAD' },
  { key: 't', marker: 'MÓDULO ASISTENCIA' },
  { key: 'c', marker: 'MODULO CALENDARIO' },
  { key: 'rp', marker: 'MODULO REPSE' },
  { key: 'su', marker: 'MODULO SUA' },
  { key: 'r', marker: 'MÓDULO RFI' },
  { key: 'u', marker: 'MÓDULO PUNCH LIST' },
  { key: 'm', marker: 'MODULO MATERIALES' },
  { key: 's', marker: 'MODULO SUBCONTRATOS' },
  { key: 'es', marker: 'MODULO ESTIMACIONES' },
];
const lazyMap = {};
{
  const mainMatch = html.match(/<script>([\s\S]*?)<\/script>/g).map((m) => m).sort((x, y) => y.length - x.length)[0];
  let main = mainMatch.slice(8, -9);
  const lines = main.split('\n');
  const markIdx = lines.map((l, i) => (l.startsWith('// ========== ') ? i : -1)).filter((i) => i >= 0);
  const cortes = [];
  for (const { key, marker } of LAZY) {
    const i = lines.findIndex((l) => l.startsWith('// ========== ' + marker));
    if (i < 0) { console.warn('lazy: marcador no encontrado', marker); continue; }
    const j = markIdx.find((k) => k > i) ?? lines.length;
    cortes.push({ key, i, j });
  }
  cortes.sort((a, b) => b.i - a.i); // de abajo hacia arriba para no mover índices
  let extraidas = 0;
  for (const { key, i, j } of cortes) {
    const code = lines.slice(i, j).join('\n');
    const min = (await esbuild.transform(code, { minify: true, target: 'es2019', legalComments: 'none' })).code; // falla el build si el corte no es JS válido
    const name = `mod-${key}.${hash(min)}.js`;
    writeFileSync(join(DIST, 'js', name), min); lazyMap[key] = 'js/' + name; extraidas += j - i;
    lines.splice(i, j - i, `// [build] módulo '${key}' cargado bajo demanda desde ${name}`);
  }
  main = lines.join('\n');
  // Cargador: R() espera el módulo antes de despachar; el resto se precarga tras el arranque
  const loader = `const __LAZY=${JSON.stringify(lazyMap)};const __LAZY_OK={};
function cargarModulo(k){const src=__LAZY[k];if(!src||__LAZY_OK[k])return Promise.resolve();return __LAZY_OK[k]=new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=()=>{__LAZY_OK[k]=true;res();};s.onerror=()=>{delete __LAZY_OK[k];rej(new Error('No se pudo cargar el módulo '+k));};document.head.appendChild(s);});}
window.addEventListener('load',()=>{setTimeout(()=>{Object.keys(__LAZY).forEach(k=>cargarModulo(k).catch(()=>{}));},1500);});
`;
  main = loader + main;
  const rIni = 'function R(){N();updateBreadcrumb();updateMobileBottomNav();const c=$(\'c\');';
  if (!main.includes(rIni)) throw new Error('build: no se encontró el inicio de R() para inyectar la carga bajo demanda');
  main = main.replace(rIni, 'async function R(){N();updateBreadcrumb();updateMobileBottomNav();const c=$(\'c\');');
  const disp = "if(M==='d'){Ds(c);";
  if (!main.includes(disp)) throw new Error('build: no se encontró el despacho de R()');
  main = main.replace(disp, "if(__LAZY[M]&&__LAZY_OK[M]!==true){c.innerHTML='<div class=\"p-8 text-center text-slate-500\"><i class=\"ri-loader-4-line animate-spin text-xl\" aria-hidden=\"true\"></i><p class=\"text-sm mt-2\">Cargando módulo…</p></div>';try{await cargarModulo(M);}catch(e){c.innerHTML=EmptyState({icon:'ri-wifi-off-line',title:'No se pudo cargar este módulo',body:'Revisa tu conexión e intenta de nuevo.',action:{label:'Reintentar',onClick:'R()'}});return;}}\n" + disp);
  html = html.replace(mainMatch, () => '<script>' + main + '</script>'); // función: evita que $' o $& del código se interpreten como patrones
  console.log(`  módulos bajo demanda: ${Object.keys(lazyMap).length} (${extraidas} líneas fuera del script principal)`);
}
// scripts inline (el principal de ~25k líneas y los pequeños): minificar con esbuild
let inlineBytes = 0, inlineMin = 0, k = 0;
const partes = html.split(/(<script>[\s\S]*?<\/script>)/);
for (let i = 0; i < partes.length; i++) {
  const m = partes[i].match(/^<script>([\s\S]*?)<\/script>$/);
  if (!m) continue;
  try {
    const out = await esbuild.transform(m[1], { minify: true, target: 'es2019', legalComments: 'none' });
    inlineBytes += m[1].length; inlineMin += out.code.length; k++;
    partes[i] = `<script>${out.code}</script>`;
  } catch (e) { console.warn('script inline sin minificar:', String(e.message).slice(0, 120)); }
}
html = partes.join('');
// Service worker + versión visible
html = html.replace('<link rel="manifest" href="manifest.json">', `<link rel="manifest" href="manifest.json"><meta name="build" content="${BUILD_ID}"><script src="js/sw-register.js?v=${BUILD_ID}"></script>`);
writeFileSync(join(DIST, 'index.html'), html);

// 4) admin.html: Tailwind compilado también (misma config), sin CDN
let adminHtml = readFileSync(join(SRC, 'admin.html'), 'utf8');
adminHtml = adminHtml.replace(/<script src="https:\/\/cdn\.tailwindcss\.com[^"]*"[^>]*>\s*<\/script>/, '');
adminHtml = adminHtml.replace('</head>', `<link href="css/${twName}" rel="stylesheet"></head>`);
adminHtml = adminHtml.replace(/<script>\s*tailwind\.config\s*=\s*\{[\s\S]*?\}\s*<\/script>/, '');
writeFileSync(join(DIST, 'admin.html'), adminHtml);

// 4b) portal.html (US-603): página autónoma sin Tailwind; sólo se reemplazan sus <script src="js/…?v="> por la versión con hash
{
  let portalHtml = conHashCss(readFileSync(join(SRC, 'portal.html'), 'utf8'), 'portal.html');
  let n = 0;
  portalHtml = portalHtml.replace(/<script src="js\/([a-z0-9-]+\.js)\?v=[^"]*"><\/script>/g, (m, f) => { if (!jsMap[f]) return m; n++; return `<script src="js/${jsMap[f]}"></script>`; });
  if (!n) throw new Error('build: portal.html no enlaza ningún js/*.js con hash (se esperaba nav-shell.js)');
  writeFileSync(join(DIST, 'portal.html'), portalHtml);
}

// 5) Copias tal cual
for (const f of ['manifest.json', 'privacidad.html', 'terminos.html', 'landing.html']) if (existsSync(join(SRC, f))) cpSync(join(SRC, f), join(DIST, f));
for (const d of ['img', 'ayuda']) if (existsSync(join(SRC, d))) cpSync(join(SRC, d), join(DIST, d), { recursive: true });
if (existsSync(join(ROOT, 'docs', 'img'))) cpSync(join(ROOT, 'docs', 'img'), join(DIST, 'docs', 'img'), { recursive: true });
if (existsSync(join(SRC, 'status.html'))) cpSync(join(SRC, 'status.html'), join(DIST, 'status.html'));

// 6) Service worker: precache del app shell (US-226)
const precache = ['./', 'index.html', 'manifest.json', `css/${twName}`, `css/${stylesName}`, `css/${navCssName}`, ...Object.values(jsMap).map((n) => `js/${n}`), ...Object.values(lazyMap), 'landing.html', 'img/icon-192.png', 'img/icon-512.png'];
const sw = `// Service worker de Control de Obra · build ${BUILD_ID} (generado por scripts/build.mjs; no editar)
// Estrategia: red primero para todo; la caché sólo entra cuando no hay red. Las respuestas se guardan sin
// Content-Encoding (el cuerpo ya viene descomprimido) para que Chrome no falle al servirlas desde caché.
const CACHE='obra-${BUILD_ID}';
const PRECACHE=${JSON.stringify(precache)};
async function limpia(r){
  const h=new Headers(r.headers);['content-encoding','content-length','transfer-encoding','vary'].forEach(k=>h.delete(k));
  return new Response(await r.arrayBuffer(),{status:r.status,statusText:r.statusText,headers:h});
}
self.addEventListener('install',e=>{e.waitUntil((async()=>{const c=await caches.open(CACHE);for(const u of PRECACHE){try{const r=await fetch(u,{cache:'reload'});if(r.ok)await c.put(u,await limpia(r));}catch(_){}}await self.skipWaiting();})());});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k.startsWith('obra-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('sync',e=>{if(e.tag==='outbox')e.waitUntil(self.clients.matchAll({includeUncontrolled:true}).then(cs=>cs.forEach(c=>c.postMessage('OUTBOX_FLUSH'))));});
self.addEventListener('fetch',e=>{
  const req=e.request; if(req.method!=='GET')return;
  const u=new URL(req.url);
  if(u.hostname.endsWith('supabase.co')||u.pathname.startsWith('/functions/')||u.hostname.includes('openpay'))return;
  const propio=u.origin===location.origin; const cdn=/cdn\\.jsdelivr\\.net|cdnjs\\.cloudflare\\.com|fonts\\.(googleapis|gstatic)\\.com/.test(u.hostname);
  if(!propio&&!cdn)return;
  if(req.mode==='navigate'){e.respondWith(fetch(req).catch(()=>caches.match('index.html')));return;}
  e.respondWith((async()=>{
    try{
      const r=await fetch(req);
      if(r&&r.ok&&(r.type==='basic'||r.type==='cors')){const c=await caches.open(CACHE);limpia(r.clone()).then(x=>c.put(req,x)).catch(()=>{});}
      return r;
    }catch(_){
      const hit=await caches.match(req,{ignoreSearch:propio});
      return hit||Response.error();
    }
  })());
});`;
writeFileSync(join(DIST, 'sw.js'), sw);
writeFileSync(join(DIST, 'js', `sw-register.js`), `// Registro del service worker y aviso de versión nueva (US-226)
if('serviceWorker' in navigator&&location.protocol==='https:'){const teniaControl=!!navigator.serviceWorker.controller;window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').then(reg=>{reg.addEventListener('updatefound',()=>{const nw=reg.installing;nw&&nw.addEventListener('statechange',()=>{if(nw.state==='installed'&&navigator.serviceWorker.controller){window.dispatchEvent(new CustomEvent('obra:actualizacion',{detail:reg}));}});});}).catch(()=>{});navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!teniaControl||window.__recargando)return;window.__recargando=true;location.reload();});});}
window.addEventListener('obra:actualizacion',e=>{if(typeof Toast==='undefined')return;const reg=e.detail;const t=document.createElement('div');t.id='swUpdate';t.setAttribute('role','status');t.className='px-4 py-2 text-sm flex items-center gap-3 justify-center';t.style.cssText='position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:var(--z-toast,1200);background:var(--ink,#1e293b);color:#fff;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25)';t.innerHTML='Hay una versión nueva. <button type="button" class="btn btn-p text-xs" id="swUpdBtn">Actualizar</button>';document.body.appendChild(t);document.getElementById('swUpdBtn').onclick=()=>{reg.waiting&&reg.waiting.postMessage('SKIP_WAITING');t.remove();};});
// Instalar como app (Android/Chrome); en iOS se explica desde Ayuda
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();window.__installPrompt=e;if(localStorage.getItem('pwaInstallOculto'))return;const b=document.createElement('div');b.id='pwaInstall';b.className='px-4 py-2 text-sm flex items-center gap-3 justify-center';b.style.cssText='position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:var(--z-toast,1200);background:var(--surface,#fff);color:var(--ink,#1e293b);border:1px solid var(--line,#e2e8f0);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.15)';b.innerHTML='Instala Control de Obra en tu teléfono <button type="button" class="btn btn-p text-xs" id="pwaYes">Instalar</button><button type="button" class="btn btn-s text-xs" id="pwaNo" aria-label="Ahora no">Ahora no</button>';document.body.appendChild(b);document.getElementById('pwaYes').onclick=async()=>{b.remove();e.prompt();try{await e.userChoice;}catch(_){}};document.getElementById('pwaNo').onclick=()=>{localStorage.setItem('pwaInstallOculto','1');b.remove();};});`);

// 7) Reporte
const size = (p) => statSync(p).size;
const totalJs = Object.values(jsMap).reduce((a, n) => a + size(join(DIST, 'js', n)), 0);
writeFileSync(join(DIST, 'build.json'), JSON.stringify({ build: BUILD_ID, css: [twName, stylesName, navCssName], js: jsMap, lazy: lazyMap, inline: { antes: inlineBytes, despues: inlineMin, scripts: k } }, null, 2));
console.log(`build ${BUILD_ID} en ${Date.now() - t0} ms`);
console.log(`  index.html ${(size(join(DIST, 'index.html')) / 1024).toFixed(0)} KB (scripts inline ${(inlineBytes / 1024).toFixed(0)} → ${(inlineMin / 1024).toFixed(0)} KB) · css ${(tw.length / 1024).toFixed(0)} + ${(stylesSrc.length / 1024).toFixed(0)} + ${(navCssSrc.length / 1024).toFixed(0)} KB · js ${(totalJs / 1024).toFixed(0)} KB (${Object.keys(jsMap).length} archivos) · sw precache ${precache.length}`);
