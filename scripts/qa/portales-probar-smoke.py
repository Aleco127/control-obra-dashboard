# -*- coding: utf-8 -*-
"""
portales-probar-smoke.py (US-854): Expediente › Portales › «Probar acceso», contra el build local, SIN tocar el portal ni
emitir boletos reales: el conector (127.0.0.1:8879) y la función de borde portal-credencial se simulan con ctx.route.

Casos (1440 y 390 px, axe wcag2a/aa sobre #c y cero errores de consola):
  apagado   el conector no responde → aviso de cómo abrirlo; no se pide boleto.
  correcto  boleto simulado → conector simulado {ok:true} → mensaje en verde y estado refrescado.
  fallo     conector simulado {ok:false, mensaje} → mensaje del portal, chip «Falló», sin botón «Probar acceso» y aviso
            de cambiar la contraseña.
También comprueba que el texto del panel ya no dice que las credenciales son sólo para descargar documentos, y que la
contraseña no viaja en ninguna petición del navegador.

Uso (OBRA_QA_TOKEN en el entorno; dist servido con node scripts/serve-dist.mjs dist 8775):
  PYTHONIOENCODING=utf-8 python scripts/qa/portales-probar-smoke.py --app http://127.0.0.1:8775/index.html?app=1 [--out dir]
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8775/index.html?app=1')
ap.add_argument('--out', default='')
args = ap.parse_args()
TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
if not TOKEN:
    print('Falta OBRA_QA_TOKEN en el entorno'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)
AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&typeof NavShell==='object'&&document.querySelector('#nv .nvs')&&R._last!==undefined"
BOLETO = 'S' * 43
errores, fallos = [], []

def check(cond, msg):
    if not cond: fallos.append(msg)
    print(('  ok  ' if cond else '  FALLA ') + msg)

def preparar(pw, ancho, alto, tag, modo):
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
    llamadas = {'emitir': 0, 'probar': 0, 'cuerpos': []}

    def conector(route):
        url = route.request.url
        if modo == 'apagado':
            return route.abort('connectionrefused')
        if url.endswith('/estado'):
            return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                                 body=json.dumps({'ok': True, 'version': '1.3.0', 'ocupado': False, 'chrome': True}))
        if url.endswith('/comprasmx/probar-acceso'):
            llamadas['probar'] += 1
            llamadas['cuerpos'].append(route.request.post_data or '')
            r = {'ok': True, 'mensaje': 'El portal aceptó el usuario y la contraseña.', 'estado': 'correcto'} if modo == 'correcto' \
                else {'ok': False, 'intento': True, 'mensaje': 'Usuario o contraseña incorrectos.', 'estado': 'fallo'}
            return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(r))
        return route.fulfill(status=404, body='{}')
    ctx.route('http://127.0.0.1:8879/**', conector)

    def funcion(route):
        if route.request.method == 'OPTIONS':
            return route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'})
        llamadas['emitir'] += 1
        llamadas['cuerpos'].append(route.request.post_data or '')
        return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                             body=json.dumps({'ok': True, 'boleto': BOLETO, 'expira_at': '2099-01-01T00:00:00Z', 'portal': 'comprasmx', 'usuario': 'QA'}))
    ctx.route('**/functions/v1/portal-credencial', funcion)

    if modo in ('correcto', 'fallo'):
        def vista(route):
            if route.request.method != 'GET':
                return route.continue_()
            resp = route.fetch()
            filas = resp.json()
            if llamadas['probar']:
                for f in filas:
                    if f.get('portal') == 'comprasmx':
                        f['estado'] = 'correcto' if modo == 'correcto' else 'fallo'
                        f['probado_at'] = '2026-10-05T20:00:00Z'
                        f['ultimo_error'] = None if modo == 'correcto' else 'Usuario o contraseña incorrectos.'
            return route.fulfill(response=resp, body=json.dumps(filas))
        ctx.route('**/rest/v1/empresa_portales*', vista)

    page = ctx.new_page()
    page.on('console', lambda m: errores.append(f'{tag} console.error: {m.text}') if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text and 'net::ERR_FAILED' not in m.text else None)
    page.on('pageerror', lambda e: errores.append(f'{tag} pageerror: {e}'))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=90000)
    page.evaluate("()=>irAModulo('ex','grupo')")
    page.wait_for_function("()=>{const el=document.getElementById('exCuerpo');return el&&!el.hasAttribute('aria-busy')&&typeof Expediente!=='undefined';}", timeout=60000)
    page.evaluate("()=>Expediente.setTab('portales')")
    page.wait_for_timeout(400)
    return br, page, llamadas

def axe(page, tag):
    if not page.evaluate("()=>typeof axe!=='undefined'"):
        page.add_script_tag(url=AXE); page.wait_for_function("()=>typeof axe!=='undefined'", timeout=20000)
    v = page.evaluate("async()=>{const r=await axe.run(document.querySelector('#c'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return r.violations.map(x=>({id:x.id,n:x.nodes.length,t:x.nodes.slice(0,2).map(n=>n.target.join(' '))}));}")
    check(not v, f'{tag}: axe sin violaciones {v if v else ""}')

def probar(page):
    page.click('#exPorProbar-comprasmx')
    page.wait_for_selector('.dialog-confirm, [role=alertdialog], [role=dialog]', timeout=5000)
    page.get_by_role('button', name='Probar acceso').last.click()

with sync_playwright() as pw:
    for ancho, alto in ((1440, 900), (390, 844)):
        for modo in ('apagado', 'correcto', 'fallo'):
            tag = f'{modo} {ancho}'
            print(f'== {tag}')
            br, page, ll = preparar(pw, ancho, alto, tag, modo)
            try:
                txt = page.inner_text('#exCuerpo')
                check('sólo para descargar' not in txt and 'buscar con tu cuenta' in txt, f'{tag}: texto del panel actualizado')
                check(page.locator('#exPorProbar-comprasmx').count() == 1, f'{tag}: botón «Probar acceso» en ComprasMX')
                probar(page)
                if modo == 'apagado':
                    page.wait_for_function("()=>/no responde|red local/.test(document.getElementById('exPorRes-comprasmx').innerText)", timeout=15000)
                    check(ll['emitir'] == 0, f'{tag}: sin conector no se pide boleto')
                    check('conector' in page.inner_text('#exPorRes-comprasmx'), f'{tag}: explica cómo abrir el conector')
                elif modo == 'correcto':
                    page.wait_for_function("()=>/aceptó/.test((document.getElementById('exPorRes-comprasmx')||{}).innerText||'')", timeout=15000)
                    check(ll['emitir'] == 1 and ll['probar'] == 1, f'{tag}: un boleto y una prueba')
                    check(json.loads(ll['cuerpos'][-1]).get('boleto') == BOLETO, f'{tag}: el conector recibe sólo el boleto')
                    check('Correcto' in page.inner_text('#exCuerpo'), f'{tag}: estado refrescado a «Correcto»')
                else:
                    page.wait_for_function("()=>/rechazó el último/.test((document.getElementById('exCuerpo')||{}).innerText||'')", timeout=15000)
                    t = page.inner_text('#exCuerpo')
                    check('Usuario o contraseña incorrectos.' in t, f'{tag}: muestra el mensaje del portal')
                    check('Falló' in t and 'Cambia la contraseña' in t, f'{tag}: chip «Falló» y pide cambiar la contraseña')
                    check(t.count('Usuario o contraseña incorrectos.') == 1, f'{tag}: el mensaje del portal no se repite')
                    check(page.locator('#exPorProbar-comprasmx').count() == 0, f'{tag}: sin «Probar acceso» hasta cambiar la contraseña')
                check(all('password' not in c for c in ll['cuerpos']), f'{tag}: ninguna petición del navegador lleva contraseña')
                check(not page.evaluate("()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1"), f'{tag}: sin desborde horizontal')
                axe(page, tag)
                if args.out: page.screenshot(path=os.path.join(args.out, f'portales-{modo}-{ancho}.png'), full_page=True)
            finally:
                br.close()

print('\nErrores de consola:', errores or 'ninguno')
if errores: fallos += errores
print('FALLAS:', len(fallos))
sys.exit(1 if fallos else 0)
