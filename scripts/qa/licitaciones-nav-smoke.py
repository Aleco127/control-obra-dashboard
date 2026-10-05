# -*- coding: utf-8 -*-
"""
licitaciones-nav-smoke.py (PRD licitaciones US-805 y US-806), contra el build local (dist/).

Comprueba en 1440 y 390 px:
  - el grupo «Licitaciones» existe entre Obra y Calidad con lc, ex y bp, y entra CERRADO por defecto aunque el usuario
    ya tenga preferencias guardadas (grupo que nunca tocó = valor de fábrica);
  - Ctrl+K encuentra los tres módulos y la hoja móvil los muestra;
  - cada módulo abre desde su archivo diferido (__LAZY), pinta el esqueleto y luego su estado vacío con acción (o la
    lista si ya hay datos) sin errores; registra `modulo_abierto` sin PII; los datos quedan en D.lic / D.exp / D.ins y
    NO entran a JSON.stringify(D) (no se guardan en localStorage);
  - el candado de plan (Suscripcion.moduloPermitido simulado en false) muestra el aviso de siempre;
  - un error de red muestra el EmptyState de error con humanizeError y «Reintentar»;
  - axe (wcag2a/aa) sobre el contenido de cada módulo; cero errores de consola.
No cambia nav_prefs (navega con irAModulo); aun así compara las preferencias al final y las restaura si cambiaron.

Uso (OBRA_QA_TOKEN en el entorno; dist servido con node scripts/serve-dist.mjs dist 8765):
  PYTHONIOENCODING=utf-8 python scripts/qa/licitaciones-nav-smoke.py --app http://127.0.0.1:8765/index.html?app=1 --out docs/qa/licitaciones
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8765/index.html?app=1')
ap.add_argument('--out', default='')
args = ap.parse_args()
TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
if not TOKEN:
    print('Falta OBRA_QA_TOKEN en el entorno'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)
AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'

errores, fallos = [], []
def check(cond, msg):
    if not cond: fallos.append(msg)
    print(('  ok  ' if cond else '  FALLA ') + msg)

LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&typeof NavShell==='object'&&document.querySelector('#nv .nvs')&&R._last!==undefined"
MODS = [('lc', 'Licitaciones', 'lcCuerpo', 'Nueva licitación'), ('ex', 'Expediente', 'exCuerpo', 'Subir documento'), ('bp', 'BancoPrecios', 'bpCuerpo', 'Agregar insumo')]

def abrir(pw, ancho, alto, tag):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
    page = ctx.new_page()
    def on_console(m):
        if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text and 'qa-red-caida' not in m.text:
            errores.append(f'{tag} console.error: {m.text}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: errores.append(f'{tag} pageerror: {e}'))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=90000)
    page.wait_for_timeout(800)
    page.evaluate("()=>{window.__tel=[];const o=Telemetry.track;Telemetry.track=(e,m)=>{window.__tel.push([e,m]);return o(e,m);};}")
    return ctx, page

def snap(page, nombre):
    if args.out: page.screenshot(path=os.path.join(args.out, nombre), full_page=False)

def prefs_servidor(page):
    return page.evaluate("async()=>{const{data}=await sb.rpc('load_all_data_seguro',{p_token:currentUser.token});return data&&data.nav_prefs||{};}")

def axe(page, selector, tag):
    try:
        if not page.evaluate("()=>typeof axe!=='undefined'"):
            page.add_script_tag(url=AXE); page.wait_for_function("()=>typeof axe!=='undefined'", timeout=20000)
        v = page.evaluate("async s=>{const r=await axe.run(document.querySelector(s),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return r.violations.map(x=>({id:x.id,n:x.nodes.length,t:x.nodes.slice(0,2).map(n=>n.target.join(' '))}));}", selector)
        check(not v, f'{tag}: axe sin violaciones en {selector} {v if v else ""}')
    except Exception as e:
        fallos.append(f'axe no cargó: {e}')

def abrir_modulo(page, k, cuerpo, tag, accion):
    page.evaluate("k=>irAModulo(k,'grupo')", k)
    page.wait_for_function("id=>{const el=document.getElementById(id);return el&&!el.hasAttribute('aria-busy');}", arg=cuerpo, timeout=30000)
    info = page.evaluate("""([k,id])=>{const el=document.getElementById(id);const em=el.querySelector('.empty');
      return {M, h1:(document.querySelector('#c h1')||{}).textContent||'', vacio:!!em,
        accion:em?[...em.querySelectorAll('button')].map(b=>b.textContent.trim()):[], tabla:!!el.querySelector('table'),
        lazy:typeof __LAZY!=='undefined'&&!!__LAZY[k]&&__LAZY_OK[k]===true,
        desborde:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};}""", [k, cuerpo])
    print(f'  {tag} {k}:', json.dumps(info, ensure_ascii=False))
    check(info['M'] == k and info['h1'], f'{tag}: {k} abre con su encabezado')
    check(info['lazy'], f'{tag}: {k} se cargó como módulo diferido (__LAZY)')
    check(info['vacio'] or info['tabla'], f'{tag}: {k} pinta estado vacío o lista')
    if info['vacio']: check(any(accion in a for a in info['accion']), f'{tag}: el estado vacío de {k} trae la acción «{accion}»')
    check(not info['desborde'], f'{tag}: {k} sin desborde horizontal')
    return info

previas = None
with sync_playwright() as pw:
    # ---------------- 1440 ----------------
    ctx, page = abrir(pw, 1440, 900, 'app1440')
    previas = prefs_servidor(page)
    print('prefs previas (se restauran si cambian):', json.dumps(previas, ensure_ascii=False))
    print('1440')
    html0 = page.evaluate("async()=>await (await fetch('index.html',{cache:'no-store'})).text()")
    check(not any(f'<script src="js/{f}.' in html0 for f in ['licitaciones', 'expediente', 'banco-precios']), '1440: ningún módulo de licitaciones viene en el HTML de arranque')
    check(all(f in html0 for f in ['js/licitaciones.', 'js/expediente.', 'js/banco-precios.']), '1440: los tres están en el mapa __LAZY del build')
    g = page.evaluate("""()=>{const grupos=[...document.querySelectorAll('#nv .nvs-grupo')].map(s=>s.dataset.grupo);
      const s=document.querySelector('#nv .nvs-grupo[data-grupo="licitaciones"]');if(!s)return {grupos};
      const h=s.querySelector('.nvs-grupo-h');
      return {grupos, abierto:h&&h.getAttribute('aria-expanded'), texto:h&&h.textContent.trim(),
        icono:!!s.querySelector('.ri-auction-line'), items:[...s.querySelectorAll('.nvs-item')].map(b=>b.dataset.k)};}""")
    print('  grupo:', json.dumps(g, ensure_ascii=False))
    check('licitaciones' in g['grupos'], '1440: existe el grupo licitaciones')
    if 'licitaciones' in g['grupos']:
        i = g['grupos'].index('licitaciones')
        check(g['grupos'][i - 1] == 'obra' and g['grupos'][i + 1] == 'calidad', '1440: Licitaciones va entre Obra y Calidad')
        check(g['abierto'] == 'false', '1440: el grupo entra cerrado por defecto')
        check(g['icono'], '1440: el grupo usa ri-auction-line')
        check([k for k in g['items'] if k] == ['lc', 'ex', 'bp'], '1440: el grupo trae lc, ex y bp en ese orden')
    snap(page, 'us805-barra-1440.png')

    # Ctrl+K
    page.evaluate("()=>abrirCmdk()"); page.wait_for_timeout(300)
    page.fill('#cmdkIn', 'banco'); page.wait_for_timeout(300)
    t = page.evaluate("()=>document.getElementById('cmdk').textContent")
    check('Banco de precios' in t, '1440: Ctrl+K encuentra «Banco de precios»')
    page.fill('#cmdkIn', 'expediente'); page.wait_for_timeout(300)
    check('Expediente' in page.evaluate("()=>document.getElementById('cmdk').textContent"), '1440: Ctrl+K encuentra «Expediente»')
    page.fill('#cmdkIn', 'licitaci'); page.wait_for_timeout(300)
    check('Licitaciones' in page.evaluate("()=>document.getElementById('cmdk').textContent"), '1440: Ctrl+K encuentra «Licitaciones»')
    page.evaluate("()=>cerrarCmdk()"); page.wait_for_timeout(200)

    for k, glob, cuerpo, accion in MODS:
        abrir_modulo(page, k, cuerpo, '1440', accion)
        snap(page, f'us806-{k}-1440.png')
        axe(page, '#c', f'1440 {k}')
    tel = page.evaluate("()=>window.__tel.filter(t=>t[0]==='modulo_abierto').map(t=>t[1])")
    print('  telemetría modulo_abierto:', tel)
    for k, *_ in MODS:
        ev = [m for m in tel if m.get('modulo') == k]
        check(len(ev) >= 1 and all(set(m.keys()) <= {'modulo'} for m in ev), f'1440: modulo_abierto de {k} sin PII (sólo {{modulo}})')
    d = page.evaluate("""()=>({lic:Array.isArray(D.lic), exp:!!(D.exp&&Array.isArray(D.exp.documentos)), ins:!!(D.ins&&Array.isArray(D.ins.filas)),
      enum:Object.keys(D).filter(k=>['lic','exp','ins'].includes(k)), json:['"lic"','"exp"','"ins"'].some(x=>JSON.stringify(D).includes(x+':'))})""")
    print('  datos:', d)
    check(d['lic'] and d['exp'] and d['ins'], '1440: los módulos dejan D.lic, D.exp y D.ins')
    check(not d['enum'] and not d['json'], '1440: D.lic/D.exp/D.ins no son enumerables (no van a localStorage)')

    # Candado de plan
    page.evaluate("()=>{window.__mp=Suscripcion.moduloPermitido;Suscripcion.moduloPermitido=k=>!['lc','ex','bp'].includes(k)&&window.__mp(k);N.dirty=true;}")
    page.evaluate("()=>irAModulo('bp','grupo')"); page.wait_for_timeout(500)
    cand = page.evaluate("()=>({txt:document.getElementById('c').textContent, lock:!!document.querySelector('#nv [data-k=\"bp\"][data-candado=\"1\"]')})")
    check('no está en tu plan' in cand['txt'] and 'Estudio y Constructora' in cand['txt'], '1440: candado de plan con el aviso de siempre')
    check('Licitaciones, expediente y banco de precios' in cand['txt'], '1440: el aviso nombra la función')
    check(cand['lock'], '1440: el ítem bp lleva data-candado en la barra')
    snap(page, 'us805-candado-1440.png')
    page.evaluate("()=>{Suscripcion.moduloPermitido=window.__mp;N.dirty=true;R();}")

    # Error de red → EmptyState de error con Reintentar
    page.evaluate("""()=>{window.__from=sb.from.bind(sb);sb.from=(t)=>t==='licitaciones'?{select:()=>({order:()=>({order:()=>Promise.resolve({data:null,error:{message:'Failed to fetch (qa-red-caida)'}})})})}:window.__from(t);}""")
    page.evaluate("()=>irAModulo('d','grupo')"); page.wait_for_timeout(300)
    page.evaluate("()=>{M='lc';Licitaciones.render(document.getElementById('c'),true);}")
    page.wait_for_function("()=>{const el=document.getElementById('lcCuerpo');return el&&!el.hasAttribute('aria-busy');}", timeout=15000)
    err = page.evaluate("()=>document.getElementById('lcCuerpo').textContent")
    check('No se pudieron cargar las licitaciones' in err and 'Sin conexión' in err and 'Reintentar' in err, '1440: error con humanizeError y Reintentar')
    snap(page, 'us806-error-1440.png')
    page.evaluate("()=>{sb.from=window.__from;}")
    page.evaluate("()=>Licitaciones.recargar()")
    page.wait_for_function("()=>{const el=document.getElementById('lcCuerpo');return el&&!el.hasAttribute('aria-busy')&&!el.textContent.includes('No se pudieron');}", timeout=15000)
    check(True, '1440: «Reintentar» vuelve a cargar')
    ctx.close()

    # ---------------- 390 ----------------
    print('390')
    ctx, page = abrir(pw, 390, 844, 'app390')
    page.click('#mobileBottomNav [data-accion="mas"]'); page.wait_for_timeout(600)
    hoja = page.evaluate("""()=>{const h=document.querySelector('#navHoja .nvs-sheet');if(!h)return null;
      return {eyebrows:[...h.querySelectorAll('.nvs-eyebrow')].map(e=>e.textContent.trim()), ks:[...h.querySelectorAll('.nvs-item')].map(b=>b.dataset.k).filter(Boolean)};}""")
    print('  hoja:', json.dumps(hoja, ensure_ascii=False))
    check(hoja and 'Licitaciones' in hoja['eyebrows'], '390: la hoja móvil trae la sección Licitaciones')
    check(hoja and all(k in hoja['ks'] for k in ['lc', 'ex', 'bp']), '390: la hoja móvil trae lc, ex y bp')
    snap(page, 'us805-hoja-390.png')
    page.click('#navHoja [data-k="lc"]'); page.wait_for_timeout(300)
    page.wait_for_function("()=>{const el=document.getElementById('lcCuerpo');return el&&!el.hasAttribute('aria-busy');}", timeout=30000)
    for k, glob, cuerpo, accion in MODS:
        abrir_modulo(page, k, cuerpo, '390', accion)
        snap(page, f'us806-{k}-390.png')
        axe(page, '#c', f'390 {k}')
    ctx.close()

    # Restaurar preferencias si algo las cambió
    ctx, page = abrir(pw, 1440, 900, 'final')
    despues = prefs_servidor(page)
    if json.dumps(despues, sort_keys=True) != json.dumps(previas, sort_keys=True):
        r = page.evaluate("async p=>{const{data,error}=await sb.rpc('guardar_nav_prefs',{p_prefs:p});return error?{error:error.message}:data;}", previas)
        print('prefs restauradas:', r)
    else:
        print('prefs sin cambios')
    ctx.close()

print('')
print('== errores de consola ==')
for e in errores: print(' -', e)
print('== fallos ==')
for f in fallos: print(' -', f)
print('RESULTADO:', 'OK' if not errores and not fallos else 'FALLA')
sys.exit(0 if not errores and not fallos else 1)
