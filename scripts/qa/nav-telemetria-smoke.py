# -*- coding: utf-8 -*-
"""
nav-telemetria-smoke.py (US-615): de dónde viene cada clic de navegación (build local en dist/).
Comprueba: los ítems llevan data-origen según la superficie (fijado, grupo, flyout, bottom, hoja) y al tocarlos
se registra `nav_click {modulo, origen, colapsado, grupo}`; Ctrl+K manda 'cmdk', Alt+N manda 'atajo' y la tarjeta
de obra manda 'ctx_obra'; el pie tiene el campo falso «Buscar… Ctrl+K» que abre la paleta. Cero errores de consola.

Uso (con OBRA_QA_TOKEN en el entorno):
  PYTHONIOENCODING=utf-8 python scripts/qa/nav-telemetria-smoke.py --app http://127.0.0.1:8765/index.html?app=1
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
    page.evaluate("()=>{window.__tel=[];const o=Telemetry.track;Telemetry.track=(e,m)=>{window.__tel.push([e,m]);return o(e,m);};}")
    return ctx, page

def clicks(page):
    return page.evaluate("()=>window.__tel.filter(t=>t[0]==='nav_click').map(t=>t[1])")

with sync_playwright() as pw:
    ctx, page = abrir(pw, 1440, 900, 'app1440')
    page.evaluate("()=>tgSb(false)"); page.wait_for_timeout(500)

    # 1) data-origen por superficie
    org = page.evaluate("()=>({fij:[...document.querySelectorAll('#nv .nvs-fijados [data-k]')].map(b=>b.dataset.origen),grupo:[...new Set([...document.querySelectorAll('#nv .nvs-grupos [data-k]')].map(b=>b.dataset.origen))]})")
    print('data-origen:', org)
    check(org['fij'] and all(o == 'fijado' for o in org['fij']), 'los fijados deberian marcar origen fijado: ' + str(org['fij']))
    check(org['grupo'] == ['grupo'], 'los items de grupo deberian marcar origen grupo: ' + str(org['grupo']))

    # 2) Clic en un fijado y en un módulo del grupo
    page.evaluate("()=>{const b=[...document.querySelectorAll('#nv .nvs-fijados [data-k]')].find(x=>x.dataset.k!==M);if(b)b.click();}")
    page.wait_for_timeout(800)
    page.evaluate("()=>{const b=[...document.querySelectorAll('#nv .nvs-grupos [data-k]')].find(x=>x.dataset.k!==M&&x.offsetParent!==null);if(b)b.click();}")
    page.wait_for_timeout(800)

    # 3) Ctrl+K
    page.keyboard.press('Control+k'); page.wait_for_timeout(600)
    page.evaluate("()=>{const i=_cmdkItems.findIndex(x=>x.t==='Módulos'||x.t==='Mi trabajo');if(i>=0)ejecutarCmdk(i);}")
    page.wait_for_timeout(900)

    # 4) Atajo Alt+N (el primer fijado que no sea el módulo activo)
    page.evaluate("()=>{M='z';R();}"); page.wait_for_timeout(500)
    page.keyboard.press('Alt+1'); page.wait_for_timeout(900)

    # 5) Tarjeta de obra activa
    page.evaluate("()=>{const o=navObrasActivas()[0];if(o)seleccionarObraGlobal(o.id);N.dirty=true;R();}")
    page.wait_for_timeout(700)
    page.evaluate("()=>{const b=document.querySelector('#nv .nvs-ctx [data-accion=\"ctx\"]');if(b)b.click();}")
    page.wait_for_timeout(900)
    page.evaluate("()=>{if(typeof cerrarFichaObra==='function')cerrarFichaObra();}"); page.wait_for_timeout(400)

    # 6) Flyout (barra colapsada)
    page.evaluate("()=>tgSb(true)"); page.wait_for_timeout(700)
    page.evaluate("()=>{const b=[...document.querySelectorAll('#nv .nvs-fly [data-k]')].find(x=>x.dataset.k!==M);if(b)b.click();}")
    page.wait_for_timeout(800)
    page.evaluate("()=>tgSb(false)"); page.wait_for_timeout(500)

    tel = clicks(page)
    origenes = sorted(set(t['origen'] for t in tel))
    print('origenes en escritorio:', origenes)
    for esperado in ('fijado', 'grupo', 'cmdk', 'atajo', 'ctx_obra', 'flyout'):
        check(esperado in origenes, 'falta nav_click con origen ' + esperado + ': ' + str(origenes))
    completos = [t for t in tel if 'modulo' in t and 'origen' in t and 'colapsado' in t and 'grupo' in t]
    check(len(completos) == len(tel), 'todos los nav_click deben traer modulo, origen, colapsado y grupo: ' + str(tel[:2]))
    check(any(t['colapsado'] is True for t in tel), 'ningun nav_click registro la barra colapsada')

    # 7) El campo falso de búsqueda del pie abre Ctrl+K
    campo = page.evaluate("()=>{const b=document.querySelector('#nv [data-accion=\"buscar\"]');return b?{cls:b.className,tx:b.textContent.replace(/\\s+/g,' ').trim(),aria:b.getAttribute('aria-label')}:null;}")
    print('campo de busqueda:', campo)
    check(campo and 'nvs-campo' in campo['cls'], 'el pie deberia tener el campo falso de busqueda: ' + str(campo))
    check(campo and 'Buscar' in campo['tx'] and 'Ctrl+K' in campo['tx'], 'el campo deberia decir Buscar y Ctrl+K: ' + str(campo))
    page.click('#nv [data-accion="buscar"]'); page.wait_for_timeout(500)
    check(page.evaluate("()=>!!document.querySelector('#cmdk.ac')"), 'el campo no abrio la paleta')
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    if args.out: page.screenshot(path=os.path.join(args.out, 'us615-pie-1440.png'))
    ctx.close()

    # 8) Móvil: bottom y hoja
    ctx2, page2 = abrir(pw, 390, 844, 'app390')
    page2.evaluate("()=>{const b=[...document.querySelectorAll('#mobileBottomNav .nvs-bottom-item[data-k]')].find(x=>x.dataset.k!==M);if(b)b.click();}")
    page2.wait_for_timeout(800)
    page2.evaluate("()=>abrirHojaModulos()"); page2.wait_for_timeout(700)
    page2.evaluate("()=>{const b=[...document.querySelectorAll('#navHoja [data-k]')].find(x=>x.dataset.k!==M);if(b)b.click();}")
    page2.wait_for_timeout(900)
    tel2 = clicks(page2)
    org2 = sorted(set(t['origen'] for t in tel2))
    print('origenes en movil:', org2)
    check('bottom' in org2 and 'hoja' in org2, 'faltan origenes bottom/hoja: ' + str(org2))
    ctx2.close()

print('')
print('== errores de consola ==')
for e in errores: print(' -', e)
print('== fallos ==')
for f in fallos: print(' -', f)
print('')
print('RESULTADO:', 'OK' if not errores and not fallos else 'FALLA')
sys.exit(0 if not errores and not fallos else 1)
