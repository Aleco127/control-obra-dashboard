# -*- coding: utf-8 -*-
"""
nav-fijados-smoke.py (US-608): «Mi trabajo», los módulos que el usuario fija con la estrella (build local en dist/).
Comprueba: siembra la primera vez (4 más usados o d/o/g/w) y que queda guardada en el servidor; la estrella fija y quita
con persistencia; el tope de 6 avisa con Toast y no fija; el módulo fijado no se pinta activo dos veces; el editor ✎
reordena y quita; Ctrl+K encabeza con «Mi trabajo»; la lista sobrevive a una recarga sin caché. Cero errores de consola.
Restaura las preferencias previas del usuario al final (el token de QA es la cuenta real de Ricardo).

Uso (con OBRA_QA_TOKEN en el entorno):
  PYTHONIOENCODING=utf-8 python scripts/qa/nav-fijados-smoke.py --app http://127.0.0.1:8765/index.html?app=1 --out docs/qa/nav
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

LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&typeof NavShell==='object'&&document.querySelector('#nv .nvs')"

def abrir(pw, ancho, alto, tag, limpiar=True):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
    page = ctx.new_page()
    page.on('console', lambda m: errores.append(tag + ' console.error: ' + m.text) if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text else None)
    page.on('pageerror', lambda e: errores.append(tag + ' pageerror: ' + str(e)))
    page.goto(args.app, wait_until='domcontentloaded')
    if limpiar:
        page.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    else:
        page.evaluate("t=>{Object.keys(localStorage).filter(k=>k.startsWith('obra_cache')||k.startsWith('nav_prefs')).forEach(k=>localStorage.removeItem(k));localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=90000)
    page.wait_for_timeout(1200)
    return ctx, page

def prefs_servidor(page):
    return page.evaluate("async()=>{const{data}=await sb.rpc('load_all_data_seguro',{p_token:currentUser.token});return data&&data.nav_prefs||{};}")

def guardar_prefs(page, p):
    return page.evaluate("async p=>{const{data,error}=await sb.rpc('guardar_nav_prefs',{p_prefs:p});return error?{error:error.message}:data;}", p)

def fijados_dom(page):
    return page.evaluate("()=>[...document.querySelectorAll('#nv .nvs-fijados .nvs-item')].map(b=>b.dataset.k)")

def snap(page, nombre):
    if args.out: page.screenshot(path=os.path.join(args.out, nombre), full_page=False)

previas = None
with sync_playwright() as pw:
    ctx, page = abrir(pw, 1440, 900, 'app1440')
    previas = prefs_servidor(page)
    print('prefs previas del usuario de QA:', json.dumps(previas, ensure_ascii=False))
    r = guardar_prefs(page, {})
    check(r and r.get('success') is True, 'no se pudieron limpiar las prefs: ' + str(r))
    page.evaluate("()=>{Object.keys(localStorage).filter(k=>k.startsWith('nav_prefs')).forEach(k=>localStorage.removeItem(k));}")
    page.reload(wait_until='domcontentloaded'); page.wait_for_function(LISTO, timeout=90000)
    page.wait_for_function("()=>Array.isArray(NavPrefs.get().fijados)", timeout=60000)   # la siembra corre al llegar los datos
    page.wait_for_timeout(500)

    # 1) Siembra: sin preferencias se fijan hasta 4 módulos y se guardan en el servidor
    sem = page.evaluate("()=>({dom:[...document.querySelectorAll('#nv .nvs-fijados .nvs-item')].map(b=>b.dataset.k),fn:navFijados(),semilla:navFijadosSemilla(),cache:JSON.parse(localStorage.getItem('nav_prefs:'+currentUser.id)||'{}')})")
    print('siembra:', sem['dom'], '· semilla calculada:', sem['semilla'])
    check(len(sem['dom']) >= 2, 'Mi trabajo sembro ' + str(sem['dom']))
    check(sem['dom'] == sem['fn'] == sem['semilla'], 'la barra no pinta lo sembrado: ' + str(sem))
    check(sem['cache'].get('fijados') == sem['dom'], 'la cache local no guardo la siembra: ' + str(sem['cache']))
    page.evaluate("async()=>{await NavPrefs.pendiente;}")
    srv = prefs_servidor(page)
    check(srv.get('fijados') == sem['dom'], 'el servidor no guardo la siembra: ' + str(srv))
    check(page.evaluate("()=>!!document.querySelector('#nv .nvs-fijados .nvs-editar')"), 'falta el boton de editar Mi trabajo')
    snap(page, 'us608-mitrabajo-1440.png')

    # 2) La estrella fija un módulo que no estaba y lo quita; persiste en caché y servidor
    libre = page.evaluate("()=>[...document.querySelectorAll('#nv .nvs-grupos [data-fijar]')].map(b=>b.dataset.fijar).find(k=>!navFijados().includes(k))")
    check(bool(libre), 'no hay ningun modulo sin fijar para la prueba')
    page.click('#nv .nvs-grupos [data-fijar="' + libre + '"]'); page.wait_for_timeout(400)
    tras = page.evaluate("()=>({dom:[...document.querySelectorAll('#nv .nvs-fijados .nvs-item')].map(b=>b.dataset.k),pressed:[...document.querySelectorAll('#nv [data-fijar]')].filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.fijar)})")
    check(libre in tras['dom'], libre + ' no aparecio en Mi trabajo: ' + str(tras['dom']))
    check(tras['pressed'].count(libre) == 2, 'la estrella de ' + libre + ' deberia estar rellena en el grupo y en Mi trabajo: ' + str(tras['pressed']))
    page.evaluate("async()=>{await NavPrefs.pendiente;}")
    check(prefs_servidor(page).get('fijados') == tras['dom'], 'el servidor no guardo al fijar')
    page.click('#nv .nvs-grupos [data-fijar="' + libre + '"]'); page.wait_for_timeout(400)
    check(libre not in fijados_dom(page), libre + ' no se quito de Mi trabajo')

    # 3) Tope de 6: el séptimo avisa y no entra
    lleno = page.evaluate("""()=>{const libres=[...document.querySelectorAll('#nv .nvs-grupos [data-fijar]')].map(b=>b.dataset.fijar).filter(k=>!navFijados().includes(k));
      for(const k of libres){if(navFijados().length>=6)break;navFijar(k);}
      const sobra=[...document.querySelectorAll('#nv .nvs-grupos [data-fijar]')].map(b=>b.dataset.fijar).find(k=>!navFijados().includes(k));
      navFijar(sobra);return{n:navFijados().length,sobra:sobra,dentro:navFijados().includes(sobra)};}""")
    page.wait_for_timeout(500)
    check(lleno['n'] == 6 and not lleno['dentro'], 'el tope de 6 no se respeto: ' + str(lleno))
    aviso = page.evaluate("()=>document.body.innerText.includes('admite hasta 6')")
    check(aviso, 'no salio el Toast al pasarse del tope')
    check(len(fijados_dom(page)) == 6, 'la barra pinta ' + str(len(fijados_dom(page))) + ' fijados, esperaba 6')

    # 4) Un fijado activo no se pinta dos veces
    # un fijado que viva en un grupo (Inicio va suelto y no tiene .nvs-grupo)
    k0 = page.evaluate("()=>[...document.querySelectorAll('#nv .nvs-fijados .nvs-item')].map(b=>b.dataset.k).find(k=>document.querySelector('#nv section.nvs-grupo [data-k=\"'+k+'\"]'))")
    check(bool(k0), 'ningun fijado vive en un grupo')
    page.evaluate("k=>{M=k;R();}", k0); page.wait_for_timeout(600)
    dob = page.evaluate("k=>({cur:[...document.querySelectorAll('#nv [aria-current=\"page\"]')].map(b=>b.dataset.k),act:[...document.querySelectorAll('#nv .nvs-item.active')].map(b=>[b.dataset.k,b.hasAttribute('data-fijado')]),grupo:!!document.querySelector('#nv .nvs-grupo-activo')})", k0)
    check(dob['cur'] == [k0], 'aria-current ' + str(dob['cur']))
    check(dob['act'] == [[k0, True]], 'solo la copia fijada debe llevar .active: ' + str(dob['act']))
    check(dob['grupo'], 'el grupo del modulo activo perdio nvs-grupo-activo')

    # 5) Editor: reordena y quita
    page.click('#nv .nvs-fijados .nvs-editar'); page.wait_for_timeout(400)
    check(page.evaluate("()=>!!document.querySelector('#mdlNavFijados.ac')"), 'el editor no abrio')
    antes = fijados_dom(page)
    page.click('#mdlNavFijadosContent [data-nf^="bajar:"]'); page.wait_for_timeout(500)
    desp = fijados_dom(page)
    check(desp[0] == antes[1] and desp[1] == antes[0], 'bajar no reordeno: ' + str(antes) + ' -> ' + str(desp))
    snap(page, 'us608-editor-1440.png')
    page.click('#mdlNavFijadosContent [data-nf="quitar:' + desp[0] + '"]'); page.wait_for_timeout(500)
    check(desp[0] not in fijados_dom(page), 'quitar no funciono: ' + str(fijados_dom(page)))
    page.click('#mdlNavFijadosContent [data-nf="listo:"]'); page.wait_for_timeout(300)
    check(page.evaluate("()=>!document.querySelector('#mdlNavFijados.ac')"), 'el editor no cerro')

    # 6) Ctrl+K encabeza con «Mi trabajo»
    page.evaluate("async()=>{await NavPrefs.pendiente;}")
    esperados = fijados_dom(page)
    page.keyboard.press('Control+k'); page.wait_for_timeout(600)
    cmdk = page.evaluate("()=>({grupos:[...document.querySelectorAll('#cmdkList .cmdk-group')].map(g=>g.textContent),primeros:[...document.querySelectorAll('#cmdkList .cmdk-item')].slice(0,8).map(i=>i.textContent.trim())})")
    check(bool(cmdk['grupos']) and cmdk['grupos'][0] == 'Mi trabajo', 'Ctrl+K no encabeza con Mi trabajo: ' + str(cmdk['grupos']))
    print('Ctrl+K:', cmdk['grupos'], '·', cmdk['primeros'][:6])
    page.keyboard.press('Escape'); page.wait_for_timeout(200)

    # 7) Sobrevive a una recarga sin caché (viene del servidor)
    ctx.close()
    ctx, page = abrir(pw, 1440, 900, 'app1440b', limpiar=False)
    check(fijados_dom(page) == esperados, 'tras recargar sin cache: ' + str(fijados_dom(page)) + ' != ' + str(esperados))

    # 8) Móvil 390: la estrella no estorba y los objetivos siguen siendo grandes
    ctx2, page2 = abrir(pw, 390, 844, 'app390', limpiar=False)
    page2.evaluate("()=>{if(typeof tgMb==='function')tgMb();}"); page2.wait_for_timeout(700)
    tap = page2.evaluate("()=>[...document.querySelectorAll('#nv .nvs-item,#nv .nvs-accion,#nv .nvs-grupo-h')].map(b=>Math.round(b.getBoundingClientRect().height)).filter(h=>h>0)")
    check(all(h >= 40 for h in tap), 'objetivos pequenos en movil: ' + str(sorted(set(tap))[:5]))
    check(page2.evaluate("()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"), 'desborde horizontal en 390')
    snap(page2, 'us608-mitrabajo-390.png')
    ctx2.close()

    # Restaurar las preferencias del usuario real
    r = guardar_prefs(page, previas or {})
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
