# -*- coding: utf-8 -*-
"""
nav-grupos-smoke.py (US-605): comprueba en el navegador (build local en dist/) que sec se deriva de NAV_GRUPOS
sin romper la barra vieja, el breadcrumb, Ctrl+K ni la barra inferior: abre d, g y cb con cero errores de consola,
el breadcrumb dice «Dinero › Compras y gastos» y el módulo cb se llama «Contabilidad» en la barra, el breadcrumb,
Ctrl+K y el título de la pantalla. Las 34 claves del PRD siguen accesibles por hash y por Ctrl+K.

Uso (con OBRA_QA_TOKEN en el entorno):
  PYTHONIOENCODING=utf-8 python scripts/qa/nav-grupos-smoke.py --app http://127.0.0.1:8765/index.html?app=1
"""
import argparse, os, sys
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8765/index.html?app=1')
ap.add_argument('--out', default='')
args = ap.parse_args()
TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
if not TOKEN:
    print('Falta OBRA_QA_TOKEN en el entorno'); sys.exit(2)

CLAVES = 'd o p w g pc ct es cb fc ce rt dc rp su ci so s m b c r u y k f e n t v l q z h'.split(' ')
errores, fallos = [], []
def check(cond, msg):
    if not cond: fallos.append(msg)

with sync_playwright() as pw:
    for ancho, alto in ((1440, 900), (390, 844)):
        ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
        page = ctx.new_page()
        page.on('console', lambda m, a=ancho: errores.append(f'app{a} console.error: {m.text}') if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text else None)
        page.on('pageerror', lambda e, a=ancho: errores.append(f'app{a} pageerror: {e}'))
        page.goto(args.app, wait_until='domcontentloaded')
        page.evaluate("t=>{localStorage.setItem('obra_session',JSON.stringify({token:t}));Object.keys(localStorage).filter(k=>k.startsWith('obra_cache')).forEach(k=>localStorage.removeItem(k))}", TOKEN)
        page.reload(wait_until='domcontentloaded')
        page.wait_for_function("()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&typeof NAV_GRUPOS==='object'", timeout=90000)
        page.wait_for_timeout(800)

        # 1) sec derivado: misma forma y 34 claves
        info = page.evaluate("()=>({n:sec.flatMap(s=>s.i).length,grupos:sec.map(s=>s.t),claves:sec.flatMap(s=>s.i.map(x=>x[0])),forma:sec.every(s=>typeof s.t==='string'&&typeof s.k==='string'&&Array.isArray(s.i)&&s.i.every(x=>x.length===3))})")
        check(info['n'] == 34 and sorted(info['claves']) == sorted(CLAVES), f'app{ancho}: sec trae {info["n"]} claves: {info["claves"]}')
        check(info['forma'], f'app{ancho}: sec perdió la forma {{t,k,ic,i}}')
        check(info['grupos'] == ['Inicio', 'Obra', 'Calidad', 'Dinero', 'Equipo', 'Contabilidad', 'Administración'], f'app{ancho}: grupos {info["grupos"]}')

        # 2) d, g, cb: breadcrumb, barra y título de pantalla
        for k, grupo, label in (('d', '', 'Inicio'), ('g', 'Dinero', 'Compras y gastos'), ('cb', 'Contabilidad', 'Contabilidad')):
            page.evaluate(f"()=>{{M='{k}';R();}}")
            page.wait_for_timeout(900)
            bc = page.evaluate("()=>({cat:document.getElementById('breadcrumbCat').textContent.trim(),page:document.getElementById('breadcrumbPage').textContent.trim(),flecha:document.getElementById('breadcrumbCat').nextElementSibling.hidden})")
            check(bc['cat'] == grupo and bc['page'] == label, f'app{ancho} {k}: breadcrumb {bc}')
            check(bc['flecha'] == (grupo == ''), f'app{ancho} {k}: flecha del breadcrumb oculta={bc["flecha"]}')
            activo = page.evaluate("()=>[...document.querySelectorAll('#nv .nav-item[aria-current=\"page\"]')].map(b=>b.getAttribute('aria-label')||b.textContent.trim())")
            check(label in activo, f'app{ancho} {k}: activo en la barra {activo}')
            if k == 'cb':
                h1 = page.evaluate("()=>(document.querySelector('#c h1')||{}).textContent||''").strip()
                check(h1 == 'Contabilidad', f'app{ancho} cb: título de pantalla «{h1}»')
                check(page.evaluate("()=>!/Panel fiscal/i.test(document.getElementById('c').textContent)"), f'app{ancho} cb: la pantalla aún dice Panel fiscal')
            check(page.evaluate("()=>location.hash")=='#'+k, f'app{ancho} {k}: hash {page.evaluate("()=>location.hash")}')

        # 3) Ctrl+K lista Contabilidad (no Panel Fiscal) y todas las claves habilitadas
        cmdk = page.evaluate("()=>{const mods=sec.flatMap(s=>s.i.filter(x=>isModuloEnabled(x[0])).map(x=>({k:x[0],l:getModuloLabel(x[0],x[2]),sub:s.t})));return mods;}")
        check(any(m['k'] == 'cb' and m['l'] == 'Contabilidad' and m['sub'] == 'Contabilidad' for m in cmdk), f'app{ancho}: Ctrl+K cb {[m for m in cmdk if m["k"]=="cb"]}')
        check(not any('Panel Fiscal' in m['l'] for m in cmdk), f'app{ancho}: Ctrl+K aún dice Panel Fiscal')
        check(sorted(m['k'] for m in cmdk) == sorted(CLAVES), f'app{ancho}: Ctrl+K lista {len(cmdk)} módulos')
        if ancho >= 768:
            page.keyboard.press('Control+k')
            page.wait_for_timeout(500)
            page.keyboard.type('Contab')
            page.wait_for_timeout(500)
            txt = page.evaluate("()=>(document.getElementById('cmdkList')||document.querySelector('[id*=cmdk]')||document.body).textContent")
            check('Contabilidad' in txt and 'Panel Fiscal' not in txt, f'app{ancho}: paleta Ctrl+K no muestra Contabilidad')
            page.keyboard.press('Escape')
            page.wait_for_timeout(300)

        # 4) hash: cada clave carga sin error de consola (se limpia el contador antes)
        antes = len(errores)
        for k in CLAVES:
            page.evaluate(f"()=>{{M='{k}';R();}}")
            page.wait_for_timeout(250 if ancho >= 768 else 200)
        check(len(errores) == antes, f'app{ancho}: errores al recorrer las 34 claves')

        # 5) barra inferior móvil sigue pintando 4 + «+» + «Más»
        if ancho < 768:
            page.evaluate("()=>{M='d';R();}")
            page.wait_for_timeout(500)
            n = page.evaluate("()=>document.querySelectorAll('#mobileBottomNav button').length")
            check(n >= 5, f'app{ancho}: barra inferior con {n} botones')
        if args.out:
            os.makedirs(args.out, exist_ok=True)
            page.evaluate("()=>{M='cb';R();}")
            page.wait_for_timeout(700)
            page.screenshot(path=os.path.join(args.out, f'us605-cb-{ancho}.png'), full_page=False)
        ctx.close()

print('errores de consola:', len(errores))
for e in errores: print('  ', e)
print('comprobaciones fallidas:', len(fallos))
for f in fallos: print('  ', f)
sys.exit(1 if errores or fallos else 0)
