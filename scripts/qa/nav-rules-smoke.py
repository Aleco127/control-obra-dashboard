# -*- coding: utf-8 -*-
"""
nav-rules-smoke.py (US-606): comprueba en el navegador (build local en dist/) que la barra, la barra inferior móvil,
Ctrl+K y los favoritos usan NavRules.moduloVisible: un trabajador (nivel 10) ve exactamente Bitácora, Fotos, Asistencia
y Obras; abrir por hash un módulo que no le toca lo manda al primero visible; el administrador sigue viendo todos los
módulos habilitados. Cero errores de consola a 1440 y 390.

Uso (con OBRA_QA_TOKEN y OBRA_QA_TOKEN_TRABAJADOR en el entorno):
  PYTHONIOENCODING=utf-8 python scripts/qa/nav-rules-smoke.py --app http://127.0.0.1:8765/index.html?app=1 --out docs/qa/nav
"""
import argparse, os, sys
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8765/index.html?app=1')
ap.add_argument('--out', default='')
args = ap.parse_args()
ADMIN = os.environ.get('OBRA_QA_TOKEN', '')
TRAB = os.environ.get('OBRA_QA_TOKEN_TRABAJADOR', '')
if not ADMIN or not TRAB:
    print('Faltan OBRA_QA_TOKEN u OBRA_QA_TOKEN_TRABAJADOR en el entorno'); sys.exit(2)

TRAB_VE = ['b', 'f', 'o', 't']
TRAB_LABELS = ['Asistencia', 'Bitácora', 'Fotos', 'Obras']
errores, fallos = [], []
def check(cond, msg):
    if not cond: fallos.append(msg)

def abrir(pw, ancho, alto, token, tag):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
    page = ctx.new_page()
    page.on('console', lambda m: errores.append(f'{tag}{ancho} console.error: {m.text}') if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text else None)
    page.on('pageerror', lambda e: errores.append(f'{tag}{ancho} pageerror: {e}'))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", token)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function("()=>typeof D!=='undefined'&&currentUser&&currentUser.nivel!==undefined&&typeof NavRules==='object'&&document.querySelectorAll('#nv .nvs-item').length>0&&R._last!==undefined", timeout=90000)
    page.wait_for_timeout(800)
    return ctx, page

def barra(page):
    return page.evaluate("()=>[...document.querySelectorAll('#nv .nvs-grupos .nvs-item')].map(b=>b.getAttribute('aria-label'))")
def cmdk(page):
    return page.evaluate("()=>sec.flatMap(s=>s.i.filter(x=>moduloVisibleParaUsuario(x[0])).map(x=>x[0]))")

with sync_playwright() as pw:
    # ---- Trabajador (nivel 10, empresa 11) ----
    for ancho, alto in ((1440, 900), (390, 844)):
        ctx, page = abrir(pw, ancho, alto, TRAB, 'trab')
        u = page.evaluate("()=>({rol:currentUser.rol,nivel:currentUser.nivel,emp:currentUser.empresa_id})")
        check(u['rol'] == 'trabajador' and u['nivel'] == 10 and u['emp'] == 11, f'trab{ancho}: sesión inesperada {u}')
        # permMap ya no existe
        check(page.evaluate("()=>typeof permMap==='undefined'"), f'trab{ancho}: permMap sigue definido')
        # 1) la barra muestra sólo Bitácora, Fotos, Asistencia y Obras
        items = barra(page)
        check(sorted(items) == TRAB_LABELS, f'trab{ancho}: barra muestra {items}')
        fav = page.evaluate("()=>[...document.querySelectorAll('#nv .nvs-item')].map(b=>b.getAttribute('aria-label')).filter(l=>!" + str(TRAB_LABELS) + ".includes(l))")
        check(fav == [], f'trab{ancho}: favoritos con módulos invisibles {fav}')
        # 2) Ctrl+K y visibles coinciden
        check(sorted(cmdk(page)) == TRAB_VE, f'trab{ancho}: Ctrl+K lista {cmdk(page)}')
        check(page.evaluate("()=>NavRules.visibles(currentUser)") == ['o', 'b', 'f', 't'], f'trab{ancho}: NavRules.visibles')
        # 3) el módulo inicial no es uno invisible (d no está en su tabla) y abrir #g redirige
        m0 = page.evaluate("()=>M")
        check(m0 in TRAB_VE, f'trab{ancho}: módulo inicial {m0}')
        for k in ['g', 'd', 'h', 'so', 'cb']:
            page.evaluate(f"()=>{{M='{k}';R();}}")
            page.wait_for_timeout(500)
            m = page.evaluate("()=>M")
            check(m == 'o', f'trab{ancho}: abrir #{k} dejó M={m} (se esperaba o)')
            check(page.evaluate("()=>location.hash") == '#o', f'trab{ancho}: hash tras #{k} = {page.evaluate("()=>location.hash")}')
        # 4) los cuatro módulos abren sin error y se marcan activos
        for k, label in (('b', 'Bitácora'), ('f', 'Fotos'), ('t', 'Asistencia'), ('o', 'Obras')):
            page.evaluate(f"()=>{{M='{k}';R();}}")
            page.wait_for_timeout(600)
            act = page.evaluate("()=>[...document.querySelectorAll('#nv [data-k][aria-current=\"page\"]')].map(b=>b.getAttribute('aria-label'))")
            check(label in act, f'trab{ancho} {k}: activo {act}')
        # 5) barra inferior móvil: sólo módulos visibles y se completa hasta 4
        if ancho < 768:
            mbn = page.evaluate("()=>[...document.querySelectorAll('#mobileBottomNav .mbn-item')].map(b=>b.getAttribute('aria-label')).filter(l=>l!=='Más módulos')")
            check(sorted(l.split(' (')[0] for l in mbn) == TRAB_LABELS, f'trab{ancho}: barra inferior {mbn}')
        if args.out:
            os.makedirs(args.out, exist_ok=True)
            page.evaluate("()=>{M='b';R();}")
            page.wait_for_timeout(700)
            page.screenshot(path=os.path.join(args.out, f'us606-trabajador-{ancho}.png'), full_page=False)
        ctx.close()

    # ---- Administrador (nivel 100, empresa 1): ve todo lo habilitado ----
    ctx, page = abrir(pw, 1440, 900, ADMIN, 'admin')
    n = page.evaluate("()=>({barra:document.querySelectorAll('#nv .nvs-grupos .nvs-item').length,hab:sec.flatMap(s=>s.i).filter(x=>isModuloEnabled(x[0])).length,vis:NavRules.visibles(currentUser).length})")
    check(n['barra'] == n['hab'] and n['vis'] == 34, f'admin: barra {n}')
    check(sorted(cmdk(page)) == sorted(page.evaluate("()=>sec.flatMap(s=>s.i).filter(x=>isModuloEnabled(x[0])).map(x=>x[0])")), 'admin: Ctrl+K no lista todo lo habilitado')
    for k in ['d', 'g', 'o', 'h', 'z', 'cb']:
        page.evaluate(f"()=>{{M='{k}';R();}}")
        page.wait_for_timeout(500)
        check(page.evaluate("()=>M") == k, f'admin: #{k} redirigido')
    ctx.close()

print('errores de consola:', len(errores))
for e in errores: print('  ', e)
print('comprobaciones fallidas:', len(fallos))
for f in fallos: print('  ', f)
sys.exit(1 if errores or fallos else 0)
