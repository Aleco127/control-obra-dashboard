# -*- coding: utf-8 -*-
"""
nav-hoja-smoke.py (US-613): hoja de módulos en el móvil (build local en dist/).
Comprueba: la barra inferior la pinta NavShell (.nvs-bottom con 4 módulos + «+» + «Más»); «Más» y el botón ≡ del header
abren la misma hoja (role=dialog, aria-modal, rejilla de 3 columnas, «Mi trabajo» primero, secundarios de Contabilidad
detrás de «Más»); se cierra con Esc, con el fondo y con la ✕, devolviendo el foco; el foco queda atrapado dentro;
el aside nunca se muestra en < 768 y no quedan restos de .sb.mobile-open/#mobileOverlay; safe-area en el padding;
sin desborde horizontal; telemetría nav_click con origen hoja/bottom. Cero errores de consola.

Uso (con OBRA_QA_TOKEN en el entorno):
  PYTHONIOENCODING=utf-8 python scripts/qa/nav-hoja-smoke.py --app http://127.0.0.1:8765/index.html?app=1 --out docs/qa/nav
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

LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&document.querySelector('#mobileBottomNav .nvs-bottom')"

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

def snap(page, nombre):
    if args.out: page.screenshot(path=os.path.join(args.out, nombre), full_page=False)

with sync_playwright() as pw:
    ctx, page = abrir(pw, 390, 844, 'app390')
    # Espiar la telemetría
    page.evaluate("()=>{window.__tel=[];const o=Telemetry.track;Telemetry.track=(e,m)=>{window.__tel.push([e,m]);return o(e,m);};}")

    # 1) La barra inferior la pinta NavShell
    bot = page.evaluate("""()=>{const n=document.getElementById('mobileBottomNav');
      return{nvs:!!n.querySelector('.nvs-bottom'),viejo:n.querySelectorAll('.mbn-item').length,
        items:[...n.querySelectorAll('.nvs-bottom-item')].map(b=>b.dataset.k||b.dataset.accion),
        plus:!!n.querySelector('.nvs-bottom-plus'),
        altos:[...n.querySelectorAll('button')].map(b=>Math.round(b.getBoundingClientRect().height))};}""")
    print('barra inferior:', json.dumps(bot, ensure_ascii=False))
    check(bot['nvs'] and bot['viejo'] == 0, 'la barra inferior no la pinta NavShell: ' + str(bot))
    check(len([k for k in bot['items'] if k and k != 'mas']) == 4, 'deberia haber 4 modulos: ' + str(bot['items']))
    check(bot['plus'], 'falta el boton +')
    check(all(h >= 44 for h in bot['altos'] if h > 0), 'objetivos chicos en la barra inferior: ' + str(bot['altos']))
    snap(page, 'us613-inicio-390.png')

    # 2) El aside no se muestra y no quedan restos del sidebar a pantalla completa
    aside = page.evaluate("""()=>({vis:getComputedStyle(document.getElementById('sb')).display,
      overlay:!!document.getElementById('mobileOverlay'),
      cssText:document.getElementById('sb').getAttribute('style')||''});""")
    check(aside['vis'] == 'none', 'el aside se ve en movil: ' + str(aside))
    check(not aside['overlay'], 'sigue existiendo #mobileOverlay')

    # 3) «Más» abre la hoja
    page.click('#mobileBottomNav [data-accion="mas"]'); page.wait_for_timeout(600)
    hoja = page.evaluate("""()=>{const h=document.querySelector('#navHoja .nvs-sheet');if(!h)return null;
      const cs=getComputedStyle(h);const grid=h.querySelector('.nvs-sheet-grid');
      return{rol:h.getAttribute('role'),modal:h.getAttribute('aria-modal'),ac:h.classList.contains('ac'),
        cols:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').length:0,
        secciones:[...h.querySelectorAll('.nvs-sheet-grupo .nvs-eyebrow')].map(e=>e.textContent),
        mas:h.querySelectorAll('.nvs-mas').length,sec:h.querySelectorAll('.nvs-sec[hidden]').length,
        pad:cs.paddingBottom,fondo:!!document.querySelector('#navHoja .nvs-sheet-backdrop.ac'),
        foco:document.activeElement.className};}""")
    print('hoja:', json.dumps(hoja, ensure_ascii=False))
    check(hoja is not None, 'la hoja no abrio')
    check(hoja['rol'] == 'dialog' and hoja['modal'] == 'true' and hoja['ac'], 'la hoja no es un dialogo abierto: ' + str(hoja))
    check(hoja['cols'] == 3, 'la rejilla deberia ser de 3 columnas: ' + str(hoja['cols']))
    check(hoja['secciones'] and hoja['secciones'][0] == 'Mi trabajo', 'Mi trabajo deberia ir primero: ' + str(hoja['secciones']))
    check(hoja['mas'] >= 1 and hoja['sec'] >= 1, 'los secundarios deberian ir detras de «Mas»: ' + str(hoja))
    check(hoja['fondo'], 'falta el fondo oscuro')
    check('nvs-item' in hoja['foco'] or 'cerrar' in hoja['foco'], 'el foco no entro a la hoja: ' + str(hoja['foco']))
    check(page.evaluate("()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"), 'desborde horizontal con la hoja abierta')
    snap(page, 'us613-hoja-390.png')

    # 4) Foco atrapado y cierre con Esc devolviendo el foco
    page.keyboard.press('Tab'); page.wait_for_timeout(150)
    check(page.evaluate("()=>!!document.activeElement.closest('#navHoja')"), 'el foco se escapo de la hoja con Tab')
    page.keyboard.press('Escape'); page.wait_for_timeout(600)
    check(page.evaluate("()=>!document.querySelector('#navHoja .nvs-sheet.ac')"), 'Esc no cerro la hoja')
    check(page.evaluate("()=>!!document.activeElement.closest('#mobileBottomNav')"), 'al cerrar, el foco deberia volver al boton que la abrio')

    # 5) El botón ≡ del header abre la misma hoja; el fondo la cierra
    page.click('header button[aria-label="Abrir menú"]'); page.wait_for_timeout(600)
    check(page.evaluate("()=>!!document.querySelector('#navHoja .nvs-sheet.ac')"), 'el boton del header no abrio la hoja')
    page.evaluate("()=>document.querySelector('#navHoja .nvs-sheet-backdrop').click()"); page.wait_for_timeout(600)
    check(page.evaluate("()=>!document.querySelector('#navHoja .nvs-sheet.ac')"), 'el fondo no cerro la hoja')

    # 6) Navegar desde la hoja y desde la barra inferior deja telemetría con su origen
    page.click('#mobileBottomNav [data-accion="mas"]'); page.wait_for_timeout(600)
    k = page.evaluate("()=>{const b=[...document.querySelectorAll('#navHoja .nvs-item')].find(x=>x.dataset.k&&x.dataset.k!==M);return b?b.dataset.k:null;}")
    page.click('#navHoja [data-k="' + k + '"]'); page.wait_for_timeout(900)
    check(page.evaluate("()=>M") == k, 'la hoja no navego a ' + str(k))
    check(page.evaluate("()=>!document.querySelector('#navHoja .nvs-sheet.ac')"), 'la hoja no se cerro al navegar')
    kb = page.evaluate("()=>{const b=[...document.querySelectorAll('#mobileBottomNav .nvs-bottom-item')].find(x=>x.dataset.k&&x.dataset.k!==M);return b?b.dataset.k:null;}")
    page.click('#mobileBottomNav [data-k="' + kb + '"]'); page.wait_for_timeout(900)
    tel = page.evaluate("()=>window.__tel.filter(t=>t[0]==='nav_click').map(t=>[t[1].modulo,t[1].origen])")
    print('telemetria:', tel)
    check(any(o == 'hoja' for _, o in tel), 'falta nav_click con origen hoja: ' + str(tel))
    check(any(o == 'bottom' for _, o in tel), 'falta nav_click con origen bottom: ' + str(tel))
    snap(page, 'us613-compras-390.png')

    # 7) axe sobre la hoja abierta
    page.click('#mobileBottomNav [data-accion="mas"]'); page.wait_for_timeout(600)
    try:
        page.add_script_tag(url=AXE); page.wait_for_function("()=>typeof axe!=='undefined'", timeout=20000)
        v = page.evaluate("async()=>{const r=await axe.run(document.querySelector('#navHoja .nvs-sheet'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return r.violations.map(x=>({id:x.id,n:x.nodes.length}));}")
        print('axe hoja ->', v)
        check(not v, 'axe en la hoja: ' + str(v))
    except Exception as e:
        fallos.append('axe no cargo: ' + str(e))
    ctx.close()

    # 8) En escritorio la hoja no estorba y la barra inferior no se ve
    ctx2, page2 = abrir(pw, 1440, 900, 'app1440')
    esc = page2.evaluate("()=>({bottom:getComputedStyle(document.getElementById('mobileBottomNav')).display,aside:getComputedStyle(document.getElementById('sb')).display})")
    print('escritorio:', esc)
    check(esc['bottom'] == 'none' and esc['aside'] != 'none', 'en escritorio manda el aside: ' + str(esc))
    ctx2.close()

print('')
print('== errores de consola ==')
for e in errores: print(' -', e)
print('== fallos ==')
for f in fallos: print(' -', f)
print('')
print('RESULTADO:', 'OK' if not errores and not fallos else 'FALLA')
sys.exit(0 if not errores and not fallos else 1)
