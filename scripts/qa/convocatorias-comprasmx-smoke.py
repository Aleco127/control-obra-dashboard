# -*- coding: utf-8 -*-
"""
convocatorias-comprasmx-smoke.py (PRD licitaciones: US-852), contra el build local (dist/) y el CONECTOR REAL de esta PC.

1. Permiso «acceso a la red local» NEGADO (SIMULADO): desde http://127.0.0.1 Chrome no pide ese permiso (loopback a
   loopback), así que se simula como lo vería la app servida en https: la petición a 127.0.0.1:8879 falla (page.route) y
   navigator.permissions.query({name:'local-network-access'}) responde 'denied' (script de inicio). La app debe explicar
   el permiso y el candado, no decir «el conector no responde». Luego, con el conector «apagado» y el permiso 'granted',
   debe decir que el conector no responde. Ninguna de las dos toca el portal.
2. Con el permiso concedido (ctx.grant_permissions(['local-network-access'], origin=<app>)): UNA búsqueda real en
   ComprasMX acotada (entidad, tipo, últimos N días, tope). Comprueba que cada fila traída tiene descripción y fecha de
   publicación dentro del rango, que la lista la muestra con «Ver más» si es larga, y que el buscador de la lista la
   cubre.

Trato con el portal: una sola búsqueda por corrida del script, con los filtros más estrechos. La corrida queda registrada
(es la búsqueda de Ricardo); no se borra nada de convocatorias (son públicas).

Uso (OBRA_QA_TOKEN en el entorno; dist servido con node scripts/serve-dist.mjs dist 8777; conector instalado):
  PYTHONIOENCODING=utf-8 python scripts/qa/convocatorias-comprasmx-smoke.py --dias 30 --entidad Chihuahua --out <carpeta>
"""
import argparse, os, sys, json, datetime
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8777/index.html?app=1')
ap.add_argument('--out', default='')
ap.add_argument('--dias', default='30')
ap.add_argument('--entidad', default='Chihuahua')
ap.add_argument('--tipo', default='obra_publica')
ap.add_argument('--max', default='30')
ap.add_argument('--solo-permiso', action='store_true', help='sólo la prueba sin permiso (no toca el portal)')
args = ap.parse_args()
TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
if not TOKEN:
    print('Falta OBRA_QA_TOKEN en el entorno'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)
ORIGEN = args.app.split('/index.html')[0]
errores, fallos = [], []
def check(cond, msg):
    if not cond: fallos.append(msg)
    print(('  ok  ' if cond else '  FALLA ') + msg)
LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&typeof NavShell==='object'&&document.querySelector('#nv .nvs')&&R._last!==undefined"

PERMISO_SIMULADO = """(()=>{const q=navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query=(d)=>d&&d.name==='local-network-access'?Promise.resolve({state:window.__permisoRed||'denied'}):q(d);})()"""
def abrir(pw, ancho, alto, tag, permiso):
    nav = pw.chromium.launch(channel='chrome')
    ctx = nav.new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX')
    if permiso: ctx.grant_permissions(['local-network-access'], origin=ORIGEN)
    else:
        ctx.add_init_script(PERMISO_SIMULADO)
        ctx.route('http://127.0.0.1:8879/**', lambda r: r.abort('accessdenied'))
    page = ctx.new_page()
    def on_console(m):
        if m.type != 'error' or 'Tailwind' in m.text: return
        if not permiso and ('ERR_ACCESS_DENIED' in m.text or '127.0.0.1:8879' in m.text or 'loopback' in m.text or 'Failed to fetch' in m.text or 'local network' in m.text.lower()): return
        errores.append(f'{tag} console.error: {m.text}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: errores.append(f'{tag} pageerror: {e}'))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=90000)
    page.evaluate("()=>{if(typeof Licitaciones!=='undefined'&&Licitaciones.ficha)Licitaciones.volver();irAModulo('lc')}")
    page.wait_for_function("()=>typeof Convocatorias!=='undefined'&&document.getElementById('lcTab-convocatorias')", timeout=30000)
    page.click('#lcTab-convocatorias')
    page.wait_for_function("()=>{const p=document.getElementById('cvPanel');return p&&!p.querySelector('[aria-busy]')}", timeout=30000)
    return nav, ctx, page
def snap(page, nombre):
    if args.out: page.screenshot(path=os.path.join(args.out, nombre), full_page=False)
def casilla(page, sel, v):
    if page.is_checked(sel) != bool(v): page.click(f'label.zk-switch:has({sel})')
def formulario(page):
    page.click('button:has-text("Buscar en los portales")')
    page.wait_for_selector('#cvFormBus', timeout=10000)
    casilla(page, '#cvbChih', False); casilla(page, '#cvbFed', True)
    page.select_option('#cvbTipo', args.tipo); page.select_option('#cvbEntidad', args.entidad)
    page.select_option('#cvbPeriodo', args.dias); page.fill('#cvbMax', args.max)

with sync_playwright() as pw:
    # 1) Sin permiso de red local
    nav, ctx, page = abrir(pw, 1440, 900, 'sin permiso', False)
    try:
        formulario(page)
        check(page.input_value('#cvbPeriodo') == args.dias and not page.is_visible('#cvbDesde'), 'el formulario busca por periodo (sin rango a la vista)')
        page.select_option('#cvbPeriodo', 'rango')
        check(page.is_visible('#cvbDesde') and page.is_visible('#cvbHasta'), '«Rango de fechas…» muestra desde y hasta')
        page.fill('#cvbDesde', '2026-01-01'); page.fill('#cvbHasta', '2026-06-30')
        page.click('#cvFormBus button[type=submit]'); page.wait_for_timeout(600)
        check(page.is_visible('#cvFormBus'), 'un rango de más de 90 días no se busca (el formulario sigue abierto)')
        page.select_option('#cvbPeriodo', args.dias)
        page.click('#cvFormBus button[type=submit]')
        page.wait_for_function("()=>!Convocatorias.estado.busqueda", timeout=60000)
        txt = page.inner_text('#cvPanel')
        estado = page.evaluate("async()=>{try{return (await navigator.permissions.query({name:'local-network-access'})).state}catch(e){return 'sin-api:'+e.message}}")
        print('    estado del permiso sin conceder:', estado)
        check('Acceso a la red local' in txt and 'candado' in txt and 'no responde' not in txt, f'permiso negado: la app explica el permiso «Acceso a la red local» y el candado (permiso={estado})')
        snap(page, 'comprasmx-sin-permiso.png')
        # Conector apagado con el permiso dado: el aviso es otro
        page.evaluate("()=>{window.__permisoRed='granted';localStorage.removeItem('conv_ultima:'+(currentUser.id||currentUser.user_id||'u')+':comprasmx')}")
        page.click('button:has-text("Volver a la lista")') if page.query_selector('button:has-text("Volver a la lista")') else None
        formulario(page)
        page.click('#cvFormBus button[type=submit]')
        page.wait_for_function("()=>!Convocatorias.estado.busqueda", timeout=60000)
        txt = page.inner_text('#cvPanel')
        check('no responde' in txt and 'candado' not in txt, 'conector apagado con permiso dado: dice que el conector no responde')
    finally:
        ctx.close(); nav.close()
    if args.solo_permiso:
        for e in errores: print('  ERROR', e)
        print(f'\n{len(fallos)} fallas, {len(errores)} errores de consola'); sys.exit(1 if fallos or errores else 0)

    # 2) Con permiso: búsqueda real acotada
    nav, ctx, page = abrir(pw, 1440, 900, 'con permiso', True)
    try:
        formulario(page)
        page.click('#cvFormBus button[type=submit]')
        page.wait_for_selector('section[aria-label="Búsqueda en los portales"]', timeout=20000)
        txt0 = page.inner_text('section[aria-label="Búsqueda en los portales"]')
        check('con su descripción' in txt0, f'mientras busca dice el rango y que trae la descripción ({txt0.strip()[:160]})')
        page.wait_for_function("()=>!Convocatorias.estado.busqueda", timeout=600000)
        res = page.evaluate("()=>Convocatorias.estado.resultados")
        r = [x for x in (res or []) if x['fuente'] == 'comprasmx']
        check(bool(r) and not r[0].get('error'), f'la búsqueda real en ComprasMX terminó sin error ({r[0].get("error") if r else "sin resultado"})')
        if r and not r[0].get('error'):
            resp = r[0].get('respuesta') or {}
            filas = r[0].get('filas') or []
            print('    respuesta del conector:', json.dumps(resp, ensure_ascii=False))
            desde, hasta = resp.get('desde'), resp.get('hasta')
            hoy = datetime.date.today()
            check(desde and hasta and (datetime.date.fromisoformat(hasta) - datetime.date.fromisoformat(desde)).days == int(args.dias),
                  f'el conector buscó los últimos {args.dias} días ({desde} a {hasta})')
            check(len(filas) > 0, f'trajo convocatorias ({len(filas)})')
            sin_desc = [f['numero_procedimiento'] for f in filas if not (f.get('descripcion') or '').strip()]
            check(not sin_desc and resp.get('sin_descripcion', 0) == 0, f'todas las filas tienen descripción (sin: {sin_desc})')
            def pub_mx(ts):
                d = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00')) - datetime.timedelta(hours=6)
                return d.date().isoformat()
            fuera = [(f['numero_procedimiento'], f.get('publicacion')) for f in filas if not f.get('publicacion') or not (desde <= pub_mx(f['publicacion']) <= hasta)]
            check(not fuera, f'todas con fecha de publicación dentro del rango {desde}..{hasta} (fuera: {fuera})')
            check(all(f.get('entidad') == args.entidad for f in filas), 'todas de la entidad pedida')
            check(all(f.get('estatus') in ('vigente', 'en_seguimiento') for f in filas), 'sólo anuncios vigentes')
            snap(page, 'comprasmx-resultados.png')
            # La lista muestra la descripción y el buscador la cubre
            page.click('button:has-text("Volver a la lista")')
            page.wait_for_function("()=>document.getElementById('cvLista')", timeout=20000)
            page.click('#cvFichas button:has-text("Quitar filtros")') if page.query_selector('#cvFichas button') else None
            page.wait_for_function("()=>!Convocatorias.estado.ocupado", timeout=20000)
            larga = max(filas, key=lambda f: len(f.get('descripcion') or ''))
            # palabra que esté en la descripción y NO en el título/número/dependencia: prueba que el buscador cubre la descripción
            norm = lambda t: page.evaluate('t=>Convocatorias.norm(t)', t)
            otros = norm(' '.join([larga.get('numero_procedimiento') or '', larga.get('titulo') or '', larga.get('dependencia') or '', larga.get('unidad_compradora') or '']))
            cands = [w for w in norm(larga.get('descripcion') or '').split(' ') if len(w) >= 5 and w not in otros]
            if cands:
                page.fill('#cvTexto', cands[0]); page.wait_for_timeout(500)
                page.wait_for_function("()=>!Convocatorias.estado.ocupado", timeout=20000); page.wait_for_timeout(300)
                ids = page.evaluate("()=>Convocatorias.estado.filas.map(c=>c.id)")
                check(larga['id'] in ids, f'el buscador de la lista encuentra por una palabra que sólo está en la descripción («{cands[0]}»)')
                row = page.query_selector(f'tr[data-cv="{larga["id"]}"]')
                check(row is not None and row.query_selector('.cv-desc') is not None, 'la fila muestra la descripción')
                if row and len(larga.get('descripcion') or '') > 160:
                    b = row.query_selector('button:has-text("Ver más")'); b.click()
                    check(row.query_selector('.cv-desc.abierta') is not None and 'Ver menos' in b.inner_text(), '«Ver más» despliega la descripción completa')
                snap(page, 'comprasmx-lista-descripcion.png')
            else:
                print('    (ninguna palabra exclusiva de la descripción; se omite la prueba del buscador)')
    finally:
        ctx.close(); nav.close()
for e in errores: print('  ERROR', e)
print(f'\n{len(fallos)} fallas, {len(errores)} errores de consola')
sys.exit(1 if fallos or errores else 0)
