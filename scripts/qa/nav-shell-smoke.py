# -*- coding: utf-8 -*-
"""
nav-shell-smoke.py (US-607): la barra de la constructora se pinta con NavShell (build local en dist/).
Comprueba: marca desde EMPRESA_INFO (sin «Control de Obra v3») con el rol debajo; cabeceras de grupo <button aria-expanded>;
Contabilidad cerrada por omisión y el resto abierto; abrir un grupo persiste en nav_prefs.colapsados (caché local + servidor:
se recarga sin caché y sigue abierto); cambiar de módulo NO repinta el aside (NavShell.marcarActivo) y N.dirty=true sí;
pie con Buscar / Ayuda / Colapsar / Cerrar sesión; modo colapsado (.sb.col + .nvs-col); ficha de obra; móvil 390 con
objetivos ≥ 44 px. Capturas en --out. Cero errores de consola. Restaura las preferencias previas del usuario al final.

Uso (con OBRA_QA_TOKEN en el entorno):
  PYTHONIOENCODING=utf-8 python scripts/qa/nav-shell-smoke.py --app http://127.0.0.1:8765/index.html?app=1 --out docs/qa/nav
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

LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&typeof NavShell==='object'&&document.querySelector('#nv .nvs')&&R._last!==undefined"

def abrir(pw, ancho, alto, tag, limpiar=True):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
    page = ctx.new_page()
    page.on('console', lambda m: errores.append(f'{tag} console.error: {m.text}') if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text else None)
    page.on('pageerror', lambda e: errores.append(f'{tag} pageerror: {e}'))
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

def snap(page, nombre):
    if args.out: page.screenshot(path=os.path.join(args.out, nombre), full_page=False)

previas = None
with sync_playwright() as pw:
    ctx, page = abrir(pw, 1440, 900, 'app1440')
    previas = prefs_servidor(page)
    print('prefs previas del usuario de QA:', json.dumps(previas, ensure_ascii=False))
    # Punto de partida determinista: sin preferencias
    r = guardar_prefs(page, {})
    check(r and r.get('success') is True, f'no se pudieron limpiar las prefs: {r}')
    page.evaluate("()=>{Object.keys(localStorage).filter(k=>k.startsWith('nav_prefs')).forEach(k=>localStorage.removeItem(k));}")
    page.reload(wait_until='domcontentloaded'); page.wait_for_function(LISTO, timeout=90000); page.wait_for_timeout(1200)

    # 1) Marca: nombre completo de la empresa, rol debajo, sin «Control de Obra v3»; nada del código viejo
    m = page.evaluate("()=>({sb:document.querySelector('#sb').textContent,nombre:document.querySelector('#nv .nvs-marca-nombre')?.textContent,sub:document.querySelector('#nv .nvs-marca-sub')?.textContent,emp:EMPRESA_INFO.nombre,rol:navRolLabel(),viejo:document.querySelectorAll('#nv .cat-section, #nv .nav-item, #brandName').length,logo:!!document.querySelector('#nv .nvs-logo-img')})")
    check('Control de Obra v3' not in m['sb'], 'sigue «Control de Obra v3» en el aside')
    check(m['nombre'] == m['emp'] and len(m['emp']) > 3, f'marca {m["nombre"]!r} != EMPRESA_INFO {m["emp"]!r}')
    check(m['sub'] and m['rol'] in m['sub'], f'sub de la marca {m["sub"]!r} sin el rol {m["rol"]!r}')
    check(m['viejo'] == 0, f'quedan {m["viejo"]} nodos de la barra vieja')
    print('marca:', m['nombre'], '·', m['sub'], '· logo' if m['logo'] else '· sin logo')

    # 2) Cabeceras <button aria-expanded>; Contabilidad cerrada, el resto abierto; Administración plana
    g = page.evaluate("()=>[...document.querySelectorAll('#nv .nvs-grupo')].map(s=>{const h=s.querySelector('.nvs-grupo-h');return{k:s.dataset.grupo,tag:h?h.tagName:null,exp:h?h.getAttribute('aria-expanded'):null,hidden:!!s.querySelector('.nvs-grupo-items[hidden]'),plano:s.classList.contains('nvs-plano')}})")
    print('grupos:', g)
    for x in g:
        if x['plano']:
            check(x['tag'] is None, f'grupo plano {x["k"]} con cabecera'); continue
        check(x['tag'] == 'BUTTON' and x['exp'] in ('true', 'false'), f'cabecera de {x["k"]} no es <button aria-expanded>')
        esperado = 'false' if x['k'] == 'contabilidad' else 'true'
        check(x['exp'] == esperado, f'grupo {x["k"]} aria-expanded={x["exp"]}, esperaba {esperado}')
        check(x['hidden'] == (esperado == 'false'), f'grupo {x["k"]} hidden={x["hidden"]} no coincide con aria-expanded')
    check(any(x['k'] == 'contabilidad' for x in g) and any(x['k'] == 'administracion' and x['plano'] for x in g), 'faltan Contabilidad o Administración plana')
    snap(page, 'us607-inicio-1440.png')

    # 3) Abrir Contabilidad → aria-expanded, caché local y servidor; recarga sin caché → sigue abierto
    page.click('#nv .nvs-grupo[data-grupo="contabilidad"] .nvs-grupo-h')
    page.wait_for_timeout(200)
    est = page.evaluate("()=>({exp:document.querySelector('#nv .nvs-grupo[data-grupo=\"contabilidad\"] .nvs-grupo-h').getAttribute('aria-expanded'),hidden:document.querySelector('#nv .nvs-grupo[data-grupo=\"contabilidad\"] .nvs-grupo-items').hasAttribute('hidden'),cache:JSON.parse(localStorage.getItem('nav_prefs:'+currentUser.id)||'{}')})")
    check(est['exp'] == 'true' and not est['hidden'], f'Contabilidad no abrió: {est}')
    check(est['cache'].get('colapsados', {}).get('contabilidad') is False and est['cache']['colapsados'].get('administracion') is True, f'caché local sin colapsados esperados: {est["cache"]}')
    page.evaluate("async()=>{await NavPrefs.pendiente;}")
    srv = prefs_servidor(page)
    check(srv.get('colapsados', {}).get('contabilidad') is False, f'el servidor no guardó colapsados: {srv}')
    print('servidor tras abrir Contabilidad:', srv)
    ctx.close()
    ctx, page = abrir(pw, 1440, 900, 'app1440b', limpiar=False)
    exp = page.evaluate("()=>document.querySelector('#nv .nvs-grupo[data-grupo=\"contabilidad\"] .nvs-grupo-h').getAttribute('aria-expanded')")
    check(exp == 'true', f'tras recargar sin caché Contabilidad aria-expanded={exp} (debía venir abierto del servidor)')

    # 4) Cambiar de módulo NO repinta (marcarActivo); N.dirty=true sí
    page.evaluate("()=>{document.querySelector('#nv .nvs').dataset.qa='marca';}")
    page.evaluate("()=>{M='g';R();}"); page.wait_for_function("()=>R._last==='g'", timeout=30000); page.wait_for_timeout(600)
    a = page.evaluate("()=>({marca:document.querySelector('#nv .nvs')?.dataset.qa,cur:[...document.querySelectorAll('#nv [aria-current=\"page\"]')].map(b=>b.dataset.k),act:[...document.querySelectorAll('#nv .nvs-item.active')].map(b=>b.dataset.k),grupo:document.querySelector('#nv .nvs-grupo[data-grupo=\"dinero\"]').classList.contains('nvs-grupo-activo'),exp:document.querySelector('#nv .nvs-grupo[data-grupo=\"contabilidad\"] .nvs-grupo-h').getAttribute('aria-expanded'),badge:document.querySelector('#nv .nvs-grupos [data-k=\"g\"] .nvs-badge')?.textContent||''})")
    check(a['marca'] == 'marca', 'cambiar de módulo repintó el aside completo')
    check(a['cur'] == ['g'] and set(a['act']) == {'g'}, f'activo tras M=g: aria-current={a["cur"]} active={a["act"]}')
    check(a['grupo'], 'Dinero no lleva nvs-grupo-activo con Compras activo')
    check(a['exp'] == 'true', 'Contabilidad se cerró al cambiar de módulo')
    print('Compras activo; badge por aprobar:', a['badge'] or '(sin badge)')
    snap(page, 'us607-compras-1440.png')
    page.evaluate("()=>{N.dirty=true;R();}"); page.wait_for_timeout(400)
    check(page.evaluate("()=>document.querySelector('#nv .nvs')?.dataset.qa") is None, 'N.dirty=true no repintó')
    check(page.evaluate("()=>document.querySelector('#nv .nvs-grupo[data-grupo=\"contabilidad\"] .nvs-grupo-h').getAttribute('aria-expanded')") == 'true', 'tras repintar Contabilidad perdió el estado abierto')

    # 5) Pie: Buscar (Ctrl+K), Ayuda, Colapsar, Cerrar sesión; Buscar abre la paleta
    pie = page.evaluate("()=>[...document.querySelectorAll('#nv .nvs-pie .nvs-accion')].map(b=>b.dataset.accion)")
    check(pie == ['buscar', 'ayuda', 'colapsar', 'salir'], f'pie {pie}')
    page.click('#nv .nvs-pie [data-accion="buscar"]'); page.wait_for_timeout(300)
    check(page.evaluate("()=>!!document.querySelector('#cmdk.ac')"), 'Buscar no abrió Ctrl+K')
    page.keyboard.press('Escape'); page.wait_for_timeout(200)

    # 6) Colapsar: .sb.col + .nvs-col, #mn a 64 px, acción cambia a «Expandir menú»; y de regreso
    page.click('#nv .nvs-pie [data-accion="colapsar"]'); page.wait_for_timeout(500)
    c = page.evaluate("()=>({col:document.querySelector('#sb').classList.contains('col'),nvs:!!document.querySelector('#nv .nvs.nvs-col'),ml:getComputedStyle(document.querySelector('#mn')).marginLeft,w:document.querySelector('#sb').getBoundingClientRect().width,t:document.querySelector('#nv .nvs-pie [data-accion=\"colapsar\"]').getAttribute('aria-label'),titles:[...document.querySelectorAll('#nv .nvs-grupo-h')].every(h=>h.title)})")
    check(c['col'] and c['nvs'] and c['ml'] == '64px' and 60 <= c['w'] <= 68 and c['t'] == 'Expandir menú' and c['titles'], f'colapsado: {c}')
    snap(page, 'us607-colapsado-1440.png')
    page.click('#nv .nvs-pie [data-accion="colapsar"]'); page.wait_for_timeout(500)
    check(page.evaluate("()=>!document.querySelector('#sb').classList.contains('col')&&!document.querySelector('#nv .nvs-col')"), 'no se expandió de nuevo')

    # 7) Ficha de obra: activo sigue en Obras, breadcrumb «Obra»
    page.evaluate("()=>abrirFichaObra(D.o[0].id)"); page.wait_for_function("()=>R._last==='o'", timeout=30000); page.wait_for_timeout(800)
    f = page.evaluate("()=>({cur:[...document.querySelectorAll('#nv [aria-current=\"page\"]')].map(b=>b.dataset.k),bc:document.querySelector('#breadcrumbCat').textContent,ficha:fichaObraId})")
    check(f['cur'] == ['o'] and f['bc'] == 'Obra' and f['ficha'], f'ficha de obra: {f}')
    snap(page, 'us607-ficha-1440.png')
    page.evaluate("()=>cerrarFichaObra()"); page.wait_for_timeout(300)
    ctx.close()

    # 8) Móvil 390: desde US-613 el menú móvil es la hoja (.nvs-sheet), no el aside a pantalla completa
    ctx, page = abrir(pw, 390, 844, 'app390', limpiar=False)
    page.evaluate("()=>tgMb()"); page.wait_for_timeout(600)
    mv = page.evaluate("()=>{const vis=[...document.querySelectorAll('#navHoja .nvs-item')].filter(b=>b.getClientRects().length);return{hoja:!!document.querySelector('#navHoja .nvs-sheet.ac'),aside:getComputedStyle(document.getElementById('sb')).display,n:vis.length,chicos:vis.filter(b=>b.getBoundingClientRect().height<44).map(b=>b.dataset.k),v3:document.getElementById('sb').textContent.includes('Control de Obra v3')}}")
    check(mv['hoja'] and mv['aside'] == 'none' and mv['n'] > 10 and mv['chicos'] == [] and not mv['v3'], f'móvil: {mv}')
    snap(page, 'us607-movil-390.png')
    page.click('#navHoja [data-k="g"]'); page.wait_for_timeout(700)
    check(page.evaluate("()=>!document.querySelector('#navHoja .nvs-sheet.ac')&&M==='g'"), 'tocar Compras no cerró la hoja')

    # Restaurar las preferencias previas del usuario de QA
    r = guardar_prefs(page, previas or {})
    check(r and r.get('success') is True, f'no se restauraron las prefs previas: {r}')
    print('prefs restauradas:', json.dumps(prefs_servidor(page), ensure_ascii=False))
    ctx.close()

print('\nerrores de consola:', len(errores))
for e in errores: print('  ', e)
print('comprobaciones fallidas:', len(fallos))
for f in fallos: print('  ', f)
sys.exit(1 if errores or fallos else 0)
