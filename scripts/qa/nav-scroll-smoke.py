# -*- coding: utf-8 -*-
"""
nav-scroll-smoke.py: el scroll de la barra de módulos (build local en dist/).
Comprueba: la barra de scroll de #nv no se ve en reposo y aparece al hacer scroll (clase .nv-scrolleando) sin mover
el contenido; mientras queden módulos abajo sale «Ver más» sobre un degradado y desaparece al llegar al final;
el botón baja una pantalla; con la barra colapsada #nv TAMBIÉN hace scroll (antes era overflow:visible y el pie
quedaba fuera de alcance en ventanas bajas), el flyout va en position:fixed y no se sale de la ventana, y el texto
«Ver más» se reduce a la flecha. Cero errores de consola y cero violaciones axe en el aside.

OBRA_QA_TOKEN es la cuenta real de Ricardo: se leen sus nav_prefs al empezar y se restauran al terminar.

Uso:
  PYTHONIOENCODING=utf-8 python scripts/qa/nav-scroll-smoke.py --app http://127.0.0.1:8765/index.html?app=1 --out docs/qa/nav
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
def snap(page, nombre, ancho=320):
    if args.out: page.screenshot(path=os.path.join(args.out, nombre), clip={'x': 0, 'y': 0, 'width': ancho, 'height': 700})

LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&document.querySelector('#nv .nvs')"

# 700 px de alto a propósito: con la ventana alta no hay scroll que probar
with sync_playwright() as pw:
    ctx = pw.chromium.launch().new_context(viewport={'width': 1440, 'height': 700}, locale='es-MX')
    page = ctx.new_page()
    page.on('console', lambda m: errores.append('console.error: ' + m.text) if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text else None)
    page.on('pageerror', lambda e: errores.append('pageerror: ' + str(e)))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=90000)
    page.wait_for_timeout(2500)
    previas = page.evaluate("async()=>{const{data}=await sb.rpc('load_all_data_seguro',{p_token:currentUser.token});return data&&data.nav_prefs||{};}")
    print('prefs previas:', json.dumps(previas, ensure_ascii=False))

    # ===== Expandida =====
    page.evaluate("()=>tgSb(false)"); page.wait_for_timeout(700)
    est = page.evaluate("""()=>{const nv=document.getElementById('nv'),m=document.getElementById('nvMas');
      return{scroll:nv.scrollHeight-nv.clientHeight,mas:!m.hidden,clase:nv.className,
        grad:getComputedStyle(m).backgroundImage,tx:getComputedStyle(document.querySelector('.nv-mas-tx')).display};}""")
    print('expandida:', dict((k, v) for k, v in est.items() if k != 'grad'))
    check(est['scroll'] > 8, 'no hay scroll en el aside a 700 px de alto: ' + str(est))
    check(est['mas'], 'no salio «Ver más» habiendo módulos abajo')
    check('linear-gradient' in est['grad'], 'el aviso no lleva degradado')
    check(est['tx'] != 'none', 'expandida deberia leerse «Ver más»')
    check('nv-scrolleando' not in est['clase'], 'la barra de scroll se ve en reposo')
    snap(page, 'nav-scroll-vermas-1440.png')

    # La barra aparece al hacer scroll y se va sola; el ancho útil no cambia (el hueco está reservado)
    a1 = page.evaluate("()=>document.getElementById('nv').clientWidth")
    page.evaluate("()=>document.getElementById('nv').scrollBy(0,60)"); page.wait_for_timeout(200)
    check('nv-scrolleando' in page.evaluate("()=>document.getElementById('nv').className"), 'la barra no aparecio al hacer scroll')
    check(a1 == page.evaluate("()=>document.getElementById('nv').clientWidth"), 'el contenido salta al aparecer la barra de scroll')
    snap(page, 'nav-scroll-barra-1440.png')
    page.wait_for_timeout(1300)
    check('nv-scrolleando' not in page.evaluate("()=>document.getElementById('nv').className"), 'la barra no se oculto tras 900 ms de quietud')

    # El botón baja; al final del scroll el aviso se va
    antes = page.evaluate("()=>document.getElementById('nv').scrollTop")
    page.click('#nvMas .nv-mas-btn'); page.wait_for_timeout(900)
    check(page.evaluate("()=>document.getElementById('nv').scrollTop") > antes, 'el boton «Ver más» no hizo scroll')
    page.evaluate("()=>{const n=document.getElementById('nv');n.scrollTop=n.scrollHeight;}"); page.wait_for_timeout(400)
    check(page.evaluate("()=>document.getElementById('nvMas').hidden"), '«Ver más» sigue visible al final del scroll')

    # ===== Colapsada: también hace scroll y el flyout no se recorta =====
    page.evaluate("()=>{tgSb(true);document.getElementById('nv').scrollTop=0;}"); page.wait_for_timeout(900)
    col = page.evaluate("""()=>{const nv=document.getElementById('nv');
      return{overflow:getComputedStyle(nv).overflowY,scroll:nv.scrollHeight-nv.clientHeight,
        mas:!document.getElementById('nvMas').hidden,tx:getComputedStyle(document.querySelector('.nv-mas-tx')).display};}""")
    print('colapsada:', col)
    check(col['overflow'] == 'auto', 'colapsada #nv deberia poder hacer scroll: ' + str(col))
    check(col['scroll'] > 8 and col['mas'], 'colapsada no avisa que quedan modulos abajo: ' + str(col))
    check(col['tx'] == 'none', 'colapsada no cabe el texto: solo la flecha')
    snap(page, 'nav-scroll-col-700.png', 120)
    page.evaluate("()=>{const n=document.getElementById('nv');n.scrollTop=n.scrollHeight;}"); page.wait_for_timeout(400)
    fin = page.evaluate("""()=>{const u=document.querySelector('#nv .nvs-pie .nvs-accion:last-child').getBoundingClientRect();
      return{bottom:Math.round(u.bottom),vh:window.innerHeight,mas:!document.getElementById('nvMas').hidden};}""")
    print('pie colapsado:', fin)
    check(fin['bottom'] <= fin['vh'], '«Cerrar sesion» queda fuera de la ventana colapsada: ' + str(fin))
    check(not fin['mas'], 'colapsada «Ver más» sigue al final del scroll')

    page.hover('#nv .nvs-grupo[data-grupo="contabilidad"] .nvs-grupo-h'); page.wait_for_timeout(400)
    fly = page.evaluate("""()=>{const g=document.querySelector('#nv .nvs-grupo[data-grupo="contabilidad"]'),f=g.querySelector('.nvs-fly');
      const rf=f.getBoundingClientRect();
      return{vis:getComputedStyle(f).display!=='none',pos:getComputedStyle(f).position,top:Math.round(rf.top),
        bottom:Math.round(rf.bottom),left:Math.round(rf.left),vh:window.innerHeight};}""")
    print('flyout con scroll:', fly)
    check(fly['vis'] and fly['pos'] == 'fixed', 'el flyout deberia abrirse en position:fixed: ' + str(fly))
    check(fly['top'] >= 0 and fly['bottom'] <= fly['vh'] + 1, 'el flyout se sale de la ventana: ' + str(fly))
    check(fly['left'] > 40, 'el flyout no queda al lado de la barra: ' + str(fly))
    snap(page, 'nav-scroll-col-flyout-700.png', 400)

    # axe sobre el aside (el aviso es aria-hidden con tabindex -1: no debe romper nada)
    try:
        page.add_script_tag(url=AXE); page.wait_for_function("()=>typeof axe!=='undefined'", timeout=20000)
        v = page.evaluate("async()=>{const r=await axe.run(document.getElementById('sb'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return r.violations.map(x=>({id:x.id,n:x.nodes.length}));}")
        print('axe #sb ->', v)
        check(not v, 'axe en el aside: ' + str(v))
    except Exception as e:
        fallos.append('axe no cargo: ' + str(e))

    # Ventana alta: sin nada que mostrar, no hay aviso
    page.set_viewport_size({'width': 1440, 'height': 1400}); page.wait_for_timeout(900)
    page.evaluate("()=>tgSb(false)"); page.wait_for_timeout(900)
    alto = page.evaluate("()=>{const nv=document.getElementById('nv');return{sc:nv.scrollHeight-nv.clientHeight,mas:!document.getElementById('nvMas').hidden};}")
    print('ventana alta:', alto)
    if alto['sc'] <= 8: check(not alto['mas'], 'sale «Ver más» sin nada que mostrar: ' + str(alto))

    # Móvil: no hay aside, no hay aviso
    page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(900)
    check(page.evaluate("()=>document.getElementById('nvMas').hidden||getComputedStyle(document.getElementById('sb')).display==='none'"), 'el aviso sale en el movil')

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
