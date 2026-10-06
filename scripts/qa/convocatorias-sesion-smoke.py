# -*- coding: utf-8 -*-
"""
convocatorias-sesion-smoke.py (US-855): «Buscar con la cuenta de la empresa» en Licitaciones › Convocatorias, contra el
build local y SIN tocar ComprasMX: el conector (127.0.0.1:8879), portal-credencial y el acceso de empresa_portales se
simulan con ctx.route. Casos en 1440 y 390 px (axe wcag2a/aa sobre #cvPanel o el modal y cero errores de consola):
  interruptor  acceso «correcto» → interruptor con el usuario; apagar ComprasMX lo oculta.
  fallo        acceso en «fallo» → aviso con enlace a Expediente › Portales, sin interruptor.
  sin_acceso   sin acceso y nivel 100 → enlace para agregarlo.
  rechazo      búsqueda con la cuenta y el conector responde {error:'sesion'} → mensaje del portal y «Buscar sin la
               cuenta», que vuelve a buscar SIN boleto (y sin pedir otro).
  lista        filtro de fuente «ComprasMX (con sesión)» → fichas «Con sesión» en la lista.
Uso: OBRA_QA_TOKEN en el entorno; dist en 8775.
  PYTHONIOENCODING=utf-8 python scripts/qa/convocatorias-sesion-smoke.py [--app ...] [--out dir]
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8775/index.html?app=1')
ap.add_argument('--out', default='')
args = ap.parse_args()
TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
if not TOKEN:
    print('Falta OBRA_QA_TOKEN'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)
AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&typeof NavShell==='object'&&document.querySelector('#nv .nvs')&&R._last!==undefined"
CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'}
errores, fallos = [], []

def check(c, m):
    if not c: fallos.append(m)
    print(('  ok  ' if c else '  FALLA ') + m)

def abrir(pw, ancho, alto, tag, acceso):
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
    ll = {'emitir': 0, 'buscar': []}

    def portales(route):
        if route.request.method != 'GET': return route.continue_()
        return route.fulfill(status=200, content_type='application/json', body=json.dumps([acceso] if acceso else []))
    ctx.route('**/rest/v1/empresa_portales*', portales)

    def funcion(route):
        if route.request.method == 'OPTIONS': return route.fulfill(status=200, headers=CORS)
        ll['emitir'] += 1
        return route.fulfill(status=200, content_type='application/json', headers=CORS,
                             body=json.dumps({'ok': True, 'boleto': 'B' * 43, 'expira_at': '2099-01-01T00:00:00Z', 'portal': 'comprasmx', 'usuario': 'QA'}))
    ctx.route('**/functions/v1/portal-credencial', funcion)

    def conector(route):
        u = route.request.url
        if u.endswith('/estado'):
            return route.fulfill(status=200, content_type='application/json', headers=CORS, body=json.dumps({'ok': True, 'version': '1.3.0', 'ocupado': False, 'chrome': True}))
        if u.endswith('/comprasmx/buscar'):
            cuerpo = json.loads(route.request.post_data or '{}'); ll['buscar'].append(cuerpo)
            if cuerpo.get('boleto'):
                r = {'corrida_id': None, 'encontradas': 0, 'nuevas': 0, 'error': 'sesion', 'mensaje': 'Usuario o contraseña incorrectos.'}
            else:
                r = {'corrida_id': None, 'encontradas': 0, 'nuevas': 0, 'error': 'Bloqueo: simulado (sin portal)'}
            return route.fulfill(status=200, content_type='application/json', headers=CORS, body=json.dumps(r))
        return route.fulfill(status=200, content_type='application/json', headers=CORS, body='{"ok":true}')
    ctx.route('http://127.0.0.1:8879/**', conector)

    page = ctx.new_page()
    page.on('console', lambda m: errores.append(f'{tag}: {m.text}') if m.type == 'error' and 'ERR_' not in m.text and 'Tailwind' not in m.text else None)
    page.on('pageerror', lambda e: errores.append(f'{tag} pageerror: {e}'))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=120000)
    page.evaluate("()=>irAModulo('lc')")
    page.wait_for_function("()=>typeof Convocatorias!=='undefined'&&document.getElementById('lcTab-convocatorias')", timeout=90000)
    page.click('#lcTab-convocatorias')
    page.wait_for_function("()=>{const p=document.getElementById('cvPanel');return p&&!p.querySelector('[aria-busy]')}", timeout=60000)
    return br, page, ll

def axe(page, sel, tag):
    page.add_script_tag(url=AXE); page.wait_for_function("()=>typeof axe!=='undefined'")
    v = page.evaluate("async s=>{const r=await axe.run(document.querySelector(s),{runOnly:['wcag2a','wcag2aa']});return r.violations.map(x=>x.id+': '+x.nodes.length+' '+(x.nodes[0]&&x.nodes[0].target.join(' ')))}", sel)
    check(not v, f'{tag}: axe sin violaciones en {sel} {v}')

def form(page):
    page.evaluate("()=>Convocatorias.abrirBusqueda()")
    page.wait_for_selector('#cvFormBus')
    page.wait_for_function("()=>(document.getElementById('cvbCuenta')||{}).innerHTML!==''", timeout=15000)

def casilla(page, sel, v):
    if page.is_checked(sel) != bool(v): page.click(f'label.zk-switch:has({sel})')

OK = {'portal': 'comprasmx', 'usuario': 'QA-RFC', 'estado': 'correcto', 'ultimo_error': None}
FALLO = {'portal': 'comprasmx', 'usuario': 'QA-RFC', 'estado': 'fallo', 'ultimo_error': 'Usuario o contraseña incorrectos.'}
with sync_playwright() as pw:
    for ancho, alto in ((1440, 900), (390, 844)):
        t = f'{ancho}'
        print('== interruptor', t)
        br, page, ll = abrir(pw, ancho, alto, 'interruptor ' + t, OK)
        form(page)
        check('usuario QA-RFC' in page.inner_text('#cvbCuenta') and page.locator('#cvbSesion').count() == 1, f'{t}: interruptor con el usuario')
        casilla(page, '#cvbFed', False)
        check(page.locator('#cvbCuenta.hidden').count() == 1, f'{t}: sin ComprasMX el interruptor se oculta')
        casilla(page, '#cvbFed', True)
        axe(page, '#cvFormBus', 'interruptor ' + t)
        if args.out: page.screenshot(path=os.path.join(args.out, f'sesion-form-{ancho}.png'))
        print('== rechazo', t)
        casilla(page, '#cvbChih', False); casilla(page, '#cvbSesion', True)
        page.fill('#cvbTexto', 'agua')
        page.click('#cvFormBus button[type=submit]')
        page.wait_for_function("()=>!Convocatorias.estado.busqueda&&/Buscar sin la cuenta/.test(document.getElementById('cvPanel').innerText)", timeout=30000)
        txt = page.inner_text('#cvPanel')
        check('Usuario o contraseña incorrectos.' in txt, f'{t}: muestra el mensaje del portal')
        check(ll['emitir'] == 1 and len(ll['buscar']) == 1 and ll['buscar'][0].get('boleto') == 'B' * 43, f'{t}: un boleto y una búsqueda con él')
        check(all('password' not in json.dumps(b) for b in ll['buscar']), f'{t}: el conector no recibe contraseña')
        axe(page, '#cvPanel', 'rechazo ' + t)
        if args.out: page.screenshot(path=os.path.join(args.out, f'sesion-rechazo-{ancho}.png'), full_page=True)
        page.get_by_role('button', name='Buscar sin la cuenta').first.click()
        page.wait_for_function("()=>!Convocatorias.estado.busqueda", timeout=30000)
        page.wait_for_timeout(500)
        check(len(ll['buscar']) == 2 and 'boleto' not in ll['buscar'][1] and ll['buscar'][1].get('texto') == 'agua', f'{t}: «Buscar sin la cuenta» repite los filtros sin boleto')
        check(ll['emitir'] == 1, f'{t}: no se pide otro boleto (sin reintento del acceso)')
        print('== lista', t)
        page.evaluate("()=>{Convocatorias.cerrarResultados();}")
        page.wait_for_timeout(500)
        if ancho < 640:
            if not page.evaluate("()=>document.getElementById('cvFiltrosPanel').open"): page.click('#cvFiltrosPanel summary')
        page.select_option('#cvFuente', 'comprasmx_sesion')
        page.wait_for_function("()=>!Convocatorias.estado.ocupado", timeout=30000)
        page.select_option('#cvEstado', '') if page.locator('#cvEstado').count() else None
        page.wait_for_function("()=>!Convocatorias.estado.ocupado", timeout=30000)
        if page.locator('#cvMis').is_checked(): page.click('label.zk-switch:has(#cvMis)')
        page.wait_for_function("()=>!Convocatorias.estado.ocupado", timeout=30000)
        page.wait_for_timeout(500)
        filas = page.evaluate("()=>Convocatorias.estado.filas.map(f=>f.con_sesion)")
        check(len(filas) > 0 and all(filas), f'{t}: el filtro «ComprasMX (con sesión)» trae sólo lo traído con la cuenta ({len(filas)})')
        check('Con sesión' in page.inner_text('#cvLista'), f'{t}: ficha «Con sesión» en la lista')
        check('Fuente: ComprasMX (con sesión)' in page.inner_text('#cvFichas'), f'{t}: ficha del filtro puesto')
        check('con la cuenta de la empresa' in page.inner_text('#cvPanel footer'), f'{t}: el pie dice que la última búsqueda fue con la cuenta')
        check(not page.evaluate("()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1"), f'{t}: sin desborde horizontal')
        axe(page, '#cvPanel', 'lista ' + t)
        if args.out: page.screenshot(path=os.path.join(args.out, f'sesion-lista-{ancho}.png'), full_page=True)
        page.evaluate("()=>Convocatorias.quitarFiltros()")
        br.close()

        for nombre, acceso, esperado in (('fallo', FALLO, 'rechazó el último inicio de sesión'), ('sin_acceso', None, 'agrega el acceso a ComprasMX')):
            print('==', nombre, t)
            br, page, ll = abrir(pw, ancho, alto, f'{nombre} {t}', acceso)
            form(page)
            txt = page.inner_text('#cvbCuenta')
            check(esperado in txt and 'Expediente › Portales' in txt, f'{t}: {nombre}: aviso con enlace a Expediente › Portales')
            check(page.locator('#cvbSesion').count() == 0, f'{t}: {nombre}: sin interruptor')
            axe(page, '#cvFormBus', f'{nombre} {t}')
            if nombre == 'fallo':
                page.get_by_role('button', name='Expediente › Portales').click()
                page.wait_for_function("()=>document.getElementById('exPorRes-comprasmx')||/Portales/.test((document.querySelector('[aria-selected=true]')||{}).innerText||'')", timeout=60000)
                check(True, f'{t}: el enlace abre Expediente › Portales')
            br.close()

print('\nErrores de consola:', errores or 'ninguno')
fallos += errores
print('FALLAS:', len(fallos))
sys.exit(1 if fallos else 0)
