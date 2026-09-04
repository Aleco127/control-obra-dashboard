# -*- coding: utf-8 -*-
"""
nav-colapsada-smoke.py (US-611): modo colapsado con nombres y flyout (build local en dist/).
Comprueba: colapsar deja el aside en --sb-w-col y el contenido con el mismo margen (sin píxeles a mano en tgSb);
cada ítem conserva title y aria-label; el flyout se abre al pasar el cursor y al enfocar, se cierra con Esc dejando el
foco en la cabecera y se reabre al salir el foco; la preferencia viaja a nav_prefs.barra_colapsada y se aplica antes del
primer pintado (la clase html.sb-col existe ya en el primer frame tras recargar). Sin desbordes ni errores de consola.

Uso (con OBRA_QA_TOKEN en el entorno):
  PYTHONIOENCODING=utf-8 python scripts/qa/nav-colapsada-smoke.py --app http://127.0.0.1:8765/index.html?app=1 --out docs/qa/nav
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

def abrir(pw, ancho, alto, tag, limpiar=True):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX')
    page = ctx.new_page()
    page.on('console', lambda m: errores.append(tag + ' console.error: ' + m.text) if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text else None)
    page.on('pageerror', lambda e: errores.append(tag + ' pageerror: ' + str(e)))
    page.goto(args.app, wait_until='domcontentloaded')
    if limpiar:
        page.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    else:
        page.evaluate("t=>{Object.keys(localStorage).filter(k=>k.startsWith('obra_cache')).forEach(k=>localStorage.removeItem(k));localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=90000)
    page.wait_for_timeout(1500)
    return ctx, page

def snap(page, nombre):
    if args.out: page.screenshot(path=os.path.join(args.out, nombre), full_page=False)

previas = None
with sync_playwright() as pw:
    ctx, page = abrir(pw, 1440, 900, 'app1440')
    previas = page.evaluate("async()=>{const{data}=await sb.rpc('load_all_data_seguro',{p_token:currentUser.token});return data&&data.nav_prefs||{};}")
    print('prefs previas:', json.dumps(previas, ensure_ascii=False))

    # 1) Expandida: anchos desde los tokens, sin estilos en línea
    exp = page.evaluate("""()=>{const s=$('sb'),m=$('mn');const cs=getComputedStyle(document.documentElement);
      return{sb:Math.round(s.getBoundingClientRect().width),mn:getComputedStyle(m).marginLeft,inline:m.getAttribute('style')||'',
        tokenW:cs.getPropertyValue('--sb-w').trim(),tokenC:cs.getPropertyValue('--sb-w-col').trim(),clase:document.documentElement.className};}""")
    print('expandida:', exp)
    check(str(exp['sb']) + 'px' == exp['tokenW'], 'el aside no mide --sb-w: ' + str(exp))
    check(exp['mn'] == exp['tokenW'], 'el contenido no usa --sb-w de margen: ' + str(exp['mn']))
    check('margin-left' not in exp['inline'], 'tgSb sigue dejando margen en linea: ' + exp['inline'])
    snap(page, 'us611-expandida-1440.png')

    # 2) Colapsar: 64 px, clase en <html>, title y aria-label en cada ítem
    page.evaluate("()=>tgSb()"); page.wait_for_timeout(600)
    col = page.evaluate("""()=>{const s=$('sb'),m=$('mn');
      const items=[...document.querySelectorAll('#nv .nvs-item')].map(b=>({k:b.dataset.k,t:b.getAttribute('title'),a:b.getAttribute('aria-label')}));
      return{sb:Math.round(s.getBoundingClientRect().width),mn:getComputedStyle(m).marginLeft,html:document.documentElement.classList.contains('sb-col'),
        sbcol:s.classList.contains('col'),nvs:!!document.querySelector('#nv .nvs.nvs-col'),
        sinTitle:items.filter(i=>!i.t).map(i=>i.k),sinAria:items.filter(i=>!i.a).map(i=>i.k),n:items.length,
        tokenC:getComputedStyle(document.documentElement).getPropertyValue('--sb-w-col').trim()};}""")
    print('colapsada:', json.dumps(col, ensure_ascii=False))
    check(str(col['sb']) + 'px' == col['tokenC'] and col['mn'] == col['tokenC'], 'colapsada no mide --sb-w-col: ' + str(col))
    check(col['html'] and col['sbcol'] and col['nvs'], 'faltan las clases sb-col/.col/.nvs-col: ' + str(col))
    check(not col['sinTitle'] and not col['sinAria'], 'items sin title/aria-label: ' + str(col['sinTitle']) + str(col['sinAria']))
    check(col['n'] > 5, 'muy pocos items para la prueba: ' + str(col['n']))
    snap(page, 'us611-colapsada-1440.png')
    check(page.evaluate("()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"), 'desborde horizontal colapsada')

    # 3) Flyout: se abre con el cursor
    sel = '#nv .nvs-grupo[data-grupo="obra"]'
    visible = "()=>{const f=document.querySelector('#nv .nvs-grupo[data-grupo=\"obra\"] .nvs-fly');return !!f&&getComputedStyle(f).display!=='none';}"
    check(not page.evaluate(visible), 'el flyout no deberia verse en reposo')
    page.hover(sel + ' .nvs-grupo-h'); page.wait_for_timeout(300)
    check(page.evaluate(visible), 'el flyout no se abrio al pasar el cursor')
    snap(page, 'us611-flyout-1440.png')
    page.mouse.move(900, 500); page.wait_for_timeout(300)
    check(not page.evaluate(visible), 'el flyout no se cerro al retirar el cursor')

    # 4) Flyout con el teclado: enfocar la cabecera lo abre, Esc lo cierra y deja el foco en la cabecera
    page.evaluate("()=>document.querySelector('#nv .nvs-grupo[data-grupo=\"obra\"] .nvs-grupo-h').focus()")
    page.wait_for_timeout(300)
    check(page.evaluate(visible), 'el flyout no se abrio al enfocar la cabecera')
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    tras = page.evaluate("""()=>{const g=document.querySelector('#nv .nvs-grupo[data-grupo="obra"]');const f=g.querySelector('.nvs-fly');
      return{visible:getComputedStyle(f).display!=='none',cerrado:g.classList.contains('nvs-fly-cerrado'),foco:document.activeElement.className,dentro:g.contains(document.activeElement)};}""")
    print('tras Esc:', tras)
    check(not tras['visible'] and tras['cerrado'], 'Esc no cerro el flyout: ' + str(tras))
    check(tras['dentro'] and 'nvs-grupo-h' in tras['foco'], 'Esc deberia dejar el foco en la cabecera: ' + str(tras))
    # Al salir el foco del grupo se limpia la marca (el flyout vuelve a responder)
    page.evaluate("()=>document.querySelector('#nv .nvs-pie .nvs-accion').focus()"); page.wait_for_timeout(300)
    check(not page.evaluate("()=>document.querySelector('#nv .nvs-grupo[data-grupo=\"obra\"]').classList.contains('nvs-fly-cerrado')"), 'la marca de cerrado no se limpio al salir el foco')

    # 5) axe sobre la barra colapsada (el criterio pide capturas colapsado/expandido sin violaciones)
    page.evaluate("()=>tgSb(true)"); page.wait_for_timeout(500)
    try:
        page.add_script_tag(url='https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js')
        page.wait_for_function("()=>typeof axe!=='undefined'", timeout=20000)
        res = page.evaluate("async()=>{const r=await axe.run(document.getElementById('sb'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return r.violations.map(v=>({id:v.id,n:v.nodes.length}));}")
        print('axe (barra colapsada):', res)
        check(not res, 'axe encontro violaciones en la barra colapsada: ' + str(res))
    except Exception as e:
        print('axe no cargo:', e)
        fallos.append('no se pudo correr axe sobre la barra colapsada: ' + str(e))

    # 6) La preferencia llega al servidor y se aplica antes de pintar tras recargar
    page.evaluate("async()=>{await NavPrefs.pendiente;}")
    srv = page.evaluate("async()=>{const{data}=await sb.rpc('load_all_data_seguro',{p_token:currentUser.token});return data&&data.nav_prefs||{};}")
    check(srv.get('barra_colapsada') is True, 'el servidor no guardo barra_colapsada: ' + str(srv))
    check(page.evaluate("()=>localStorage.getItem('nav_barra_col')") == '1', 'falta el espejo local nav_barra_col')
    ctx.close()

    ctx, page = abrir(pw, 1440, 900, 'app1440b', limpiar=False)
    ini = page.evaluate("()=>({html:document.documentElement.classList.contains('sb-col'),sb:Math.round($('sb').getBoundingClientRect().width),modelo:navModelo().colapsado})")
    print('tras recargar:', ini)
    check(ini['html'] and ini['sb'] == 64 and ini['modelo'], 'la barra no volvio colapsada: ' + str(ini))

    # Dejar la barra como estaba y restaurar las preferencias del usuario
    page.evaluate("()=>tgSb(false)"); page.wait_for_timeout(400)
    check(not page.evaluate("()=>document.documentElement.classList.contains('sb-col')"), 'tgSb(false) no expandio')
    page.evaluate("async()=>{await NavPrefs.pendiente;}")
    r = page.evaluate("async p=>{const{data}=await sb.rpc('guardar_nav_prefs',{p_prefs:p});return data;}", previas or {})
    print('prefs restauradas:', json.dumps(previas, ensure_ascii=False), '->', r)
    ctx.close()

print('')
print('== errores de consola ==')
for e in errores: print(' -', e)
print('== fallos ==')
for f in fallos: print(' -', f)
print('')
print('RESULTADO:', 'OK' if not errores and not fallos else 'FALLA')
sys.exit(0 if not errores and not fallos else 1)
