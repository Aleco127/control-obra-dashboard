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
html = html.replace(/<script>tailwind\.config=\{[\s\S]*?\}<\/script>/, `<link href="css/${twName}" rel="stylesheet">`);
html = html.replace(/<link href="css\/styles\.css\?v=[^"]*" rel="stylesheet">/, `<link href="css/${stylesName}" rel="stylesheet">`);
html = html.replace(/<script src="js\/([a-z0-9-]+\.js)\?v=[^"]*"><\/script>/g, (m, f) => jsMap[f] ? `<script src="js/${jsMap[f]}"></script>` : m);
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
adminHtml = adminHtml.replace(/<script src="https:\/\/cdn\.tailwindcss\.com[^"]*"[^>]*>\s*<\/script>/, `<link href="css/${twName}" rel="stylesheet">`);
adminHtml = adminHtml.replace(/<script>\s*tailwind\.config\s*=\s*\{[\s\S]*?\}\s*<\/script>/, '');
writeFileSync(join(DIST, 'admin.html'), adminHtml);

// 5) Copias tal cual
for (const f of ['manifest.json', 'privacidad.html', 'terminos.html']) if (existsSync(join(SRC, f))) cpSync(join(SRC, f), join(DIST, f));
for (const d of ['img', 'ayuda']) if (existsSync(join(SRC, d))) cpSync(join(SRC, d), join(DIST, d), { recursive: true });
if (existsSync(join(ROOT, 'docs', 'img'))) cpSync(join(ROOT, 'docs', 'img'), join(DIST, 'docs', 'img'), { recursive: true });
if (existsSync(join(SRC, 'status.html'))) cpSync(join(SRC, 'status.html'), join(DIST, 'status.html'));

// 6) Service worker: precache del app shell (US-226)
const precache = ['./', 'index.html', 'manifest.json', `css/${twName}`, `css/${stylesName}`, ...Object.values(jsMap).map((n) => `js/${n}`), 'img/icon-192.png', 'img/icon-512.png'];
const sw = `// Service worker de Control de Obra · build ${BUILD_ID} (generado por scripts/build.mjs; no editar)
const CACHE='obra-${BUILD_ID}';
const PRECACHE=${JSON.stringify(precache)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PRECACHE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k.startsWith('obra-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET')return;
  // Supabase y funciones: siempre red (la app cachea datos en IndexedDB)
  if(u.hostname.endsWith('supabase.co')||u.pathname.startsWith('/functions/'))return;
  // Navegación: red primero, app shell si no hay conexión
  if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('index.html')));return;}
  // Activos propios con hash y CDN: caché primero, luego red (stale-while-revalidate)
  if(u.origin===location.origin||/cdn\\.jsdelivr\\.net|cdnjs\\.cloudflare\\.com|fonts\\.(googleapis|gstatic)\\.com/.test(u.hostname)){
    e.respondWith(caches.open(CACHE).then(async c=>{const hit=await c.match(e.request);const net=fetch(e.request).then(r=>{if(r&&r.ok&&(u.origin===location.origin||r.type==='basic'||r.type==='cors'))c.put(e.request,r.clone());return r;}).catch(()=>hit);return hit||net;}));
  }
});`;
writeFileSync(join(DIST, 'sw.js'), sw);
writeFileSync(join(DIST, 'js', `sw-register.js`), `// Registro del service worker y aviso de versión nueva (US-226)
if('serviceWorker' in navigator&&location.protocol==='https:'){window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').then(reg=>{reg.addEventListener('updatefound',()=>{const nw=reg.installing;nw&&nw.addEventListener('statechange',()=>{if(nw.state==='installed'&&navigator.serviceWorker.controller){window.dispatchEvent(new CustomEvent('obra:actualizacion',{detail:reg}));}});});}).catch(()=>{});navigator.serviceWorker.addEventListener('controllerchange',()=>{if(window.__recargando)return;window.__recargando=true;location.reload();});});}
window.addEventListener('obra:actualizacion',e=>{if(typeof Toast==='undefined')return;const reg=e.detail;const t=document.createElement('div');t.id='swUpdate';t.setAttribute('role','status');t.className='px-4 py-2 text-sm flex items-center gap-3 justify-center';t.style.cssText='position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:var(--z-toast,1200);background:var(--ink,#1e293b);color:#fff;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25)';t.innerHTML='Hay una versión nueva. <button type="button" class="btn btn-p text-xs" id="swUpdBtn">Actualizar</button>';document.body.appendChild(t);document.getElementById('swUpdBtn').onclick=()=>{reg.waiting&&reg.waiting.postMessage('SKIP_WAITING');t.remove();};});
// Instalar como app (Android/Chrome); en iOS se explica desde Ayuda
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();window.__installPrompt=e;if(localStorage.getItem('pwaInstallOculto'))return;const b=document.createElement('div');b.id='pwaInstall';b.className='px-4 py-2 text-sm flex items-center gap-3 justify-center';b.style.cssText='position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:var(--z-toast,1200);background:var(--surface,#fff);color:var(--ink,#1e293b);border:1px solid var(--line,#e2e8f0);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.15)';b.innerHTML='Instala Control de Obra en tu teléfono <button type="button" class="btn btn-p text-xs" id="pwaYes">Instalar</button><button type="button" class="btn btn-s text-xs" id="pwaNo" aria-label="Ahora no">Ahora no</button>';document.body.appendChild(b);document.getElementById('pwaYes').onclick=async()=>{b.remove();e.prompt();try{await e.userChoice;}catch(_){}};document.getElementById('pwaNo').onclick=()=>{localStorage.setItem('pwaInstallOculto','1');b.remove();};});`);

// 7) Reporte
const size = (p) => statSync(p).size;
const totalJs = Object.values(jsMap).reduce((a, n) => a + size(join(DIST, 'js', n)), 0);
writeFileSync(join(DIST, 'build.json'), JSON.stringify({ build: BUILD_ID, css: [twName, stylesName], js: jsMap, inline: { antes: inlineBytes, despues: inlineMin, scripts: k } }, null, 2));
console.log(`build ${BUILD_ID} en ${Date.now() - t0} ms`);
console.log(`  index.html ${(size(join(DIST, 'index.html')) / 1024).toFixed(0)} KB (scripts inline ${(inlineBytes / 1024).toFixed(0)} → ${(inlineMin / 1024).toFixed(0)} KB) · css ${(tw.length / 1024).toFixed(0)} + ${(stylesSrc.length / 1024).toFixed(0)} KB · js ${(totalJs / 1024).toFixed(0)} KB (${Object.keys(jsMap).length} archivos) · sw precache ${precache.length}`);
