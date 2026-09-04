# -*- coding: utf-8 -*-
"""
nav-obra-smoke.py (US-609): la tarjeta «Obra activa» de la barra (build local en dist/).
Comprueba: sin obra elegida dice «Todas las obras · N activas» con botón «Elegir»; el popover lista las obras permitidas
(con buscador a partir de 8) y al elegir una se sincroniza con #obraFilter y con selectedObra; el camino inverso
(#obraFilter -> filterByObra) actualiza la tarjeta; clic en la tarjeta abre la ficha; colapsada se reduce al semáforo
con title «Obra activa: CÓDIGO»; en móvil 390 la tarjeta no se pinta en el aside. Cero errores de consola.

Uso (con OBRA_QA_TOKEN en el entorno):
  PYTHONIOENCODING=utf-8 python scripts/qa/nav-obra-smoke.py --app http://127.0.0.1:8765/index.html?app=1 --out docs/qa/nav
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
    page.wait_for_timeout(1500)
    return ctx, page

def snap(page, nombre):
    if args.out: page.screenshot(path=os.path.join(args.out, nombre), full_page=False)

with sync_playwright() as pw:
    ctx, page = abrir(pw, 1440, 900, 'app1440')
    # Punto de partida: sin obra elegida
    page.evaluate("()=>{selectedObra=null;localStorage.removeItem('selectedObra');const s=$('obraFilter');if(s)s.value='';N.dirty=true;R();}")
    page.wait_for_timeout(500)
    v = page.evaluate("()=>({sub:document.querySelector('#nv .nvs-ctx-sub')?.textContent,accion:document.querySelector('#nv .nvs-ctx [data-accion=\"ctx-accion\"]')?.textContent,titulo:!!document.querySelector('#nv .nvs-ctx-titulo'),activas:navObrasActivas().length})")
    print('sin obra:', v)
    check(bool(v['sub']) and v['sub'].startswith('Todas las obras'), 'sin obra no dice Todas las obras: ' + str(v['sub']))
    check(str(v['activas']) in (v['sub'] or ''), 'el conteo de activas no aparece: ' + str(v))
    check(v['accion'] == 'Elegir', 'el boton deberia decir Elegir: ' + str(v['accion']))
    check(not v['titulo'], 'sin obra no debe haber titulo de obra')
    snap(page, 'us609-sinobra-1440.png')

    # Popover: se abre, lista las obras permitidas y aparece el buscador si hay >= 8
    page.click('#nv .nvs-ctx [data-accion="ctx-accion"]'); page.wait_for_timeout(400)
    pop = page.evaluate("()=>({abierto:!!document.querySelector('#navObrasPop'),buscador:!!document.querySelector('#navObrasBuscar'),n:document.querySelectorAll('#navObrasLista [data-obra]').length,permitidas:navObrasActivas().length,rol:document.querySelector('#navObrasPop')?.getAttribute('role')})")
    print('popover:', pop)
    check(pop['abierto'] and pop['rol'] == 'dialog', 'el popover no abrio como dialog')
    check(pop['n'] == pop['permitidas'] + 1, 'la lista deberia traer las ' + str(pop['permitidas']) + ' obras mas «Todas»: ' + str(pop['n']))
    check(pop['buscador'] == (pop['permitidas'] >= 8), 'buscador=' + str(pop['buscador']) + ' con ' + str(pop['permitidas']) + ' obras')
    snap(page, 'us609-popover-1440.png')
    if pop['buscador']:
        obj = page.evaluate("()=>navObrasActivas()[0].nombre_obra")
        page.fill('#navObrasBuscar', obj[:6]); page.wait_for_timeout(300)
        n = page.evaluate("()=>document.querySelectorAll('#navObrasLista [data-obra]').length")
        check(0 < n <= pop['n'], 'el buscador no filtro: ' + str(n))
        page.fill('#navObrasBuscar', 'zzzzzz'); page.wait_for_timeout(300)
        check(page.evaluate("()=>!!document.querySelector('.nvs-pop-vacio')"), 'sin coincidencias no salio el mensaje')
        page.fill('#navObrasBuscar', ''); page.wait_for_timeout(300)

    # Elegir una obra: se sincroniza con selectedObra y con el chip del header
    oid = page.evaluate("()=>navObrasActivas()[0].id")
    page.click('#navObrasLista [data-obra="' + str(oid) + '"]'); page.wait_for_timeout(700)
    sinc = page.evaluate("()=>({sel:selectedObra,chip:$('obraFilter')?.value,ls:localStorage.getItem('selectedObra'),titulo:document.querySelector('#nv .nvs-ctx-titulo')?.textContent,sub:document.querySelector('#nv .nvs-ctx-sub')?.textContent,barra:!!document.querySelector('#nv .nvs-ctx-bar'),accion:document.querySelector('#nv .nvs-ctx [data-accion=\"ctx-accion\"]')?.textContent,pop:!!document.querySelector('#navObrasPop')})")
    print('tras elegir:', sinc)
    check(str(sinc['sel']) == str(oid) and str(sinc['chip']) == str(oid) and str(sinc['ls']) == str(oid), 'no se sincronizo con el chip/localStorage: ' + str(sinc))
    check(bool(sinc['titulo']), 'la tarjeta no muestra el nombre de la obra')
    check(sinc['accion'] == 'Cambiar', 'con obra elegida el boton dice Cambiar')
    check(sinc['barra'], 'falta la barra de avance')
    check(not sinc['pop'], 'el popover no se cerro al elegir')
    snap(page, 'us609-conobra-1440.png')

    # Camino inverso: cambiar en #obraFilter actualiza la tarjeta
    otra = page.evaluate("()=>{const l=navObrasActivas();return l.length>1?l[1].id:null;}")
    if otra:
        page.evaluate("id=>{const s=$('obraFilter');s.value=String(id);filterByObra();}", otra)
        page.wait_for_timeout(700)
        inv = page.evaluate("id=>({sel:selectedObra,titulo:document.querySelector('#nv .nvs-ctx-titulo')?.textContent,esperado:(D.o.find(o=>o.id===id)||{}).nombre_obra})", otra)
        check(str(inv['sel']) == str(otra) and inv['titulo'] == inv['esperado'], 'el chip no actualizo la tarjeta: ' + str(inv))
    else:
        print('(solo hay una obra: no se prueba el camino inverso)')

    # Clic en la tarjeta abre la ficha de la obra
    page.click('#nv .nvs-ctx [data-accion="ctx"]'); page.wait_for_timeout(900)
    check(page.evaluate("()=>typeof fichaObraId!=='undefined'&&!!fichaObraId"), 'la tarjeta no abrio la ficha de obra')
    page.evaluate("()=>{if(typeof cerrarFichaObra==='function')cerrarFichaObra();}"); page.wait_for_timeout(500)

    # Colapsada: sólo el semáforo, con title «Obra activa: CÓDIGO»
    page.evaluate("()=>tgSb()"); page.wait_for_timeout(600)
    col = page.evaluate("()=>{const b=document.querySelector('#nv .nvs-ctx-btn');const t=document.querySelector('#nv .nvs-ctx-titulo');const s=document.querySelector('#nv .nvs-sem');return{title:b?b.getAttribute('title'):null,tituloVisible:t?getComputedStyle(t).display!=='none':false,sem:s?Math.round(s.getBoundingClientRect().width):0,cod:(D.o.find(o=>o.id==selectedObra)||{}).codigo_obra};}")
    print('colapsada:', col)
    check(col['title'] == 'Obra activa: ' + str(col['cod']), 'title colapsado: ' + str(col['title']))
    check(not col['tituloVisible'], 'colapsada la tarjeta no debe mostrar el nombre')
    check(col['sem'] >= 10, 'el semaforo deberia agrandarse al colapsar: ' + str(col['sem']))
    snap(page, 'us609-colapsada-1440.png')
    page.evaluate("()=>tgSb()"); page.wait_for_timeout(400)
    ctx.close()

    # Móvil: la tarjeta no se pinta en el aside
    ctx2, page2 = abrir(pw, 390, 844, 'app390')
    page2.evaluate("()=>{if(typeof tgMb==='function')tgMb();}"); page2.wait_for_timeout(700)
    mov = page2.evaluate("()=>({ctx:!!document.querySelector('#nv .nvs-ctx'),chip:!!document.querySelector('#obraFilter'),modelo:navContexto()})")
    print('movil:', mov)
    check(not mov['ctx'], 'en movil el aside no debe pintar la tarjeta')
    check(mov['modelo'] is None, 'navContexto deberia devolver null en movil')
    check(mov['chip'], 'falta el chip del header en movil')
    check(page2.evaluate("()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"), 'desborde horizontal en 390')
    snap(page2, 'us609-movil-390.png')
    ctx2.close()

print('')
print('== errores de consola ==')
for e in errores: print(' -', e)
print('== fallos ==')
for f in fallos: print(' -', f)
print('')
print('RESULTADO:', 'OK' if not errores and not fallos else 'FALLA')
sys.exit(0 if not errores and not fallos else 1)
