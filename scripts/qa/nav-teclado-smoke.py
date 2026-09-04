# -*- coding: utf-8 -*-
"""
nav-teclado-smoke.py (US-612): teclado y accesibilidad de la barra (build local en dist/).
Comprueba: #nv es navigation y la barra es un solo tab stop (roving tabindex, el 0 sigue al módulo activo);
flechas arriba/abajo recorren lo visible, Inicio/Fin saltan, flecha derecha/izquierda abre y cierra el grupo enfocado
y lleva a la estrella desde un ítem; Enter activa; Alt+1..Alt+6 abren los fijados y salen en la ayuda de atajos;
un solo aria-current; axe sin violaciones en #sb y #mobileBottomNav a 1440 y 390. Cero errores de consola.

Uso (con OBRA_QA_TOKEN en el entorno):
  PYTHONIOENCODING=utf-8 python scripts/qa/nav-teclado-smoke.py --app http://127.0.0.1:8765/index.html?app=1 --out docs/qa/nav
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

LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&document.querySelector('#nv .nvs')"

def abrir(pw, ancho, alto, tag):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
    page = ctx.new_page()
    page.on('console', lambda m: errores.append(tag + ' console.error: ' + m.text) if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text else None)
    page.on('pageerror', lambda e: errores.append(tag + ' pageerror: ' + str(e)))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=90000)
    page.wait_for_timeout(2000)
    return ctx, page

def foco(page):
    return page.evaluate("()=>{const a=document.activeElement;return a?{k:a.dataset.k||null,g:a.closest('.nvs-grupo')?.dataset.grupo||null,cls:a.className,ti:a.tabIndex}:null;}")

def axe_sobre(page, sel, tag):
    try:
        page.add_script_tag(url=AXE)
        page.wait_for_function("()=>typeof axe!=='undefined'", timeout=20000)
    except Exception as e:
        fallos.append('axe no cargo en ' + tag + ': ' + str(e)); return
    v = page.evaluate("""async s=>{const el=document.querySelector(s);if(!el)return 'sin-elemento';
      const r=await axe.run(el,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return r.violations.map(x=>({id:x.id,n:x.nodes.length}));}""", sel)
    print('axe', tag, sel, '->', v)
    if v == 'sin-elemento':
        print('  (no existe en este viewport, se omite)'); return
    check(not v, 'axe en ' + sel + ' (' + tag + '): ' + str(v))

previas = None
with sync_playwright() as pw:
    ctx, page = abrir(pw, 1440, 900, 'app1440')
    # Punto de partida determinista: barra expandida (otro smoke pudo dejar barra_colapsada en el servidor)
    previas = page.evaluate("async()=>{const{data}=await sb.rpc('load_all_data_seguro',{p_token:currentUser.token});return data&&data.nav_prefs||{};}")
    page.evaluate("()=>tgSb(false)"); page.wait_for_timeout(600)

    # 1) La barra es un solo tab stop y el 0 está en el módulo activo
    rov = page.evaluate("""()=>{const nv=document.getElementById('nv');
      const items=[...nv.querySelectorAll('.nvs-item,.nvs-grupo-h,.nvs-mas')].filter(el=>el.offsetParent!==null);
      return{rol:nv.getAttribute('role'),aria:nv.getAttribute('aria-label'),n:items.length,
        cero:items.filter(el=>el.tabIndex===0).map(el=>el.dataset.k||el.className),
        menos:items.filter(el=>el.tabIndex===-1).length,
        estrellas:[...nv.querySelectorAll('.nvs-fijar')].filter(el=>el.tabIndex!==-1).length,
        current:[...nv.querySelectorAll('[aria-current="page"]')].map(el=>el.dataset.k)};}""")
    print('roving:', json.dumps(rov, ensure_ascii=False))
    check(rov['rol'] == 'navigation' and rov['aria'], '#nv sin role/aria-label: ' + str(rov))
    check(len(rov['cero']) == 1, 'deberia haber un solo tabindex=0 en la barra: ' + str(rov['cero']))
    check(rov['menos'] == rov['n'] - 1, 'el resto deberia estar fuera de la tabulacion')
    check(rov['estrellas'] == 0, 'las estrellas deben salir del orden de tabulacion (se llega con la flecha derecha)')
    check(len(rov['current']) == 1, 'aria-current deberia ser unico: ' + str(rov['current']))
    check(rov['cero'][0] == rov['current'][0], 'el tab stop deberia estar en el modulo activo: ' + str(rov))

    # 2) Flechas, Inicio y Fin
    page.evaluate("()=>{const i=[...document.querySelectorAll('#nv .nvs-item,#nv .nvs-grupo-h,#nv .nvs-mas')].filter(e=>e.offsetParent!==null);navRoving(i[0]);i[0].focus();}")
    a = foco(page)
    page.keyboard.press('ArrowDown'); page.wait_for_timeout(150)
    b = foco(page)
    check(b != a, 'la flecha abajo no movio el foco: ' + str(a) + ' -> ' + str(b))
    check(b['ti'] == 0, 'el elemento enfocado deberia quedarse con tabindex=0: ' + str(b))
    page.keyboard.press('ArrowUp'); page.wait_for_timeout(150)
    check(foco(page)['cls'] == a['cls'], 'la flecha arriba no regreso')
    page.keyboard.press('End'); page.wait_for_timeout(150)
    fin = foco(page)
    page.keyboard.press('Home'); page.wait_for_timeout(150)
    ini = foco(page)
    check(fin != ini, 'Inicio y Fin llevan al mismo sitio: ' + str(ini))
    n = page.evaluate("()=>[...document.querySelectorAll('#nv .nvs-item,#nv .nvs-grupo-h,#nv .nvs-mas')].filter(e=>e.offsetParent!==null).length")
    home = page.evaluate("()=>{const i=[...document.querySelectorAll('#nv .nvs-item,#nv .nvs-grupo-h,#nv .nvs-mas')].filter(e=>e.offsetParent!==null);const a=document.activeElement;return{ok:i[0]===a,primero:i[0]?(i[0].dataset.k||i[0].className):null,activo:a?(a.dataset.k||a.className):null,col:document.documentElement.classList.contains('sb-col')};}")
    check(home['ok'], 'Home no llevo al primero: ' + str(home))

    # 3) Flecha derecha/izquierda sobre un grupo lo abre y lo cierra
    page.evaluate("()=>{const h=document.querySelector('#nv .nvs-grupo[data-grupo=\"contabilidad\"] .nvs-grupo-h');navRoving(h);h.focus();}")
    page.keyboard.press('ArrowRight'); page.wait_for_timeout(250)
    abierto = page.evaluate("()=>document.querySelector('#nv .nvs-grupo[data-grupo=\"contabilidad\"] .nvs-grupo-h').getAttribute('aria-expanded')")
    check(abierto == 'true', 'la flecha derecha no abrio el grupo: ' + str(abierto))
    page.keyboard.press('ArrowLeft'); page.wait_for_timeout(250)
    cerrado = page.evaluate("()=>document.querySelector('#nv .nvs-grupo[data-grupo=\"contabilidad\"] .nvs-grupo-h').getAttribute('aria-expanded')")
    check(cerrado == 'false', 'la flecha izquierda no cerro el grupo: ' + str(cerrado))

    # 4) Flecha derecha desde un ítem lleva a su estrella; izquierda vuelve
    page.evaluate("()=>{const it=document.querySelector('#nv .nvs-fijados .nvs-item');navRoving(it);it.focus();}")
    page.keyboard.press('ArrowRight'); page.wait_for_timeout(200)
    est = page.evaluate("()=>({fijar:document.activeElement.dataset.fijar||null,cls:document.activeElement.className})")
    check(est['fijar'] is not None, 'la flecha derecha no llevo a la estrella: ' + str(est))
    page.keyboard.press('ArrowLeft'); page.wait_for_timeout(200)
    check(page.evaluate("()=>document.activeElement.classList.contains('nvs-item')"), 'la flecha izquierda no volvio al modulo')

    # 5) Enter activa el módulo enfocado
    page.evaluate("()=>{M='d';R();const it=[...document.querySelectorAll('#nv .nvs-grupos .nvs-item')].find(e=>e.offsetParent!==null&&e.dataset.k!=='d');navRoving(it);it.focus();window.__k=it.dataset.k;}")
    esperado = page.evaluate("()=>window.__k")
    page.keyboard.press('Enter'); page.wait_for_timeout(900)
    check(page.evaluate("()=>M") == esperado, 'Enter no abrio el modulo ' + str(esperado) + ' (M=' + str(page.evaluate("()=>M")) + ')')

    # 6) Alt+1..Alt+6 abren los fijados y están en la ayuda
    fij = page.evaluate("()=>navFijados()")
    print('fijados:', fij)
    if len(fij) >= 2:
        page.evaluate("()=>{M='d';R();}"); page.wait_for_timeout(400)
        page.keyboard.press('Alt+2'); page.wait_for_timeout(900)
        check(page.evaluate("()=>M") == fij[1], 'Alt+2 deberia abrir ' + fij[1] + ' y abrio ' + str(page.evaluate("()=>M")))
    ayuda = page.evaluate("()=>Object.keys(Shortcuts._descriptions||{}).filter(k=>/^alt\\+[1-6]$/.test(k))")
    check(len(ayuda) == 6, 'faltan atajos alt+1..alt+6 en la ayuda: ' + str(ayuda))
    desc = page.evaluate("()=>Shortcuts._descriptions['alt+1']")
    check('Mi trabajo' in (desc or ''), 'la descripcion del atajo no menciona Mi trabajo: ' + str(desc))

    # 7) axe en la barra y en la barra inferior (1440)
    axe_sobre(page, '#sb', '1440')
    axe_sobre(page, '#mobileBottomNav', '1440')
    page.evaluate("async()=>{await NavPrefs.pendiente;}")
    r = page.evaluate("async p=>{const{data}=await sb.rpc('guardar_nav_prefs',{p_prefs:p});return data;}", previas or {})
    print('prefs restauradas:', json.dumps(previas, ensure_ascii=False), '->', r)
    ctx.close()

    # 8) axe a 390
    ctx2, page2 = abrir(pw, 390, 844, 'app390')
    axe_sobre(page2, '#mobileBottomNav', '390')
    page2.evaluate("()=>{if(typeof tgMb==='function')tgMb();}"); page2.wait_for_timeout(700)
    axe_sobre(page2, '#sb', '390')
    if args.out: page2.screenshot(path=os.path.join(args.out, 'us612-movil-390.png'))
    ctx2.close()

print('')
print('== errores de consola ==')
for e in errores: print(' -', e)
print('== fallos ==')
for f in fallos: print(' -', f)
print('')
print('RESULTADO:', 'OK' if not errores and not fallos else 'FALLA')
sys.exit(0 if not errores and not fallos else 1)
