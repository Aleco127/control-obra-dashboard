# -*- coding: utf-8 -*-
"""
convocatorias-smoke.py (PRD licitaciones: US-843, US-844, US-845, US-846, US-850), contra el build local (dist/).

Recorre en 1440 y 390 px la pestaña Licitaciones › Convocatorias con la sesión de QA (cuenta real de Ricardo,
empresa 1) y verifica lo que se ve en el navegador: lista paginada con chip de fuente, filtros, «Me interesa»,
«Descartar» con deshacer, «Ver en el portal» en otra pestaña, pie con la última búsqueda, filtros guardados con
vista previa, «Participar» con perfil sugerido y aviso en la ficha, contador de la barra, y «Buscar en los portales».

ComprasMX se prueba contra un SIMULADOR del conector local (US-851) que responde dentro del navegador (page.route sobre
http://127.0.0.1:8879) con el contrato fijo (GET /estado, POST /comprasmx/buscar, POST /comprasmx/cancelar, CORS +
Private Network Access); luego lo «apaga» para ver el aviso «el conector no responde». No es el conector real.
La búsqueda de Chihuahua es REAL (una consulta al portal con texto, tope 10) y sólo en 1440.

Deja todo como estaba: borra el seguimiento que crea, el filtro «QA-G …» y la licitación «QA-G-…». No toca nav_prefs.

Uso (OBRA_QA_TOKEN en el entorno; dist servido con node scripts/serve-dist.mjs dist 8775):
  PYTHONIOENCODING=utf-8 python scripts/qa/convocatorias-smoke.py --app http://127.0.0.1:8775/index.html?app=1 --out docs/qa/convocatorias
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8775/index.html?app=1')
ap.add_argument('--out', default='')
ap.add_argument('--sin-portal', action='store_true', help='no lanza la búsqueda real en Contrataciones Chihuahua')
args = ap.parse_args()
TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
if not TOKEN:
    print('Falta OBRA_QA_TOKEN en el entorno'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)
AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
errores, fallos = [], []
def check(cond, msg):
    if not cond: fallos.append(msg)
    print(('  ok  ' if cond else '  FALLA ') + msg)

# ---- Simulador del conector local (contrato de US-851) -------------------------------------------------------------
# Se atiende DENTRO del navegador con page.route (no abre el puerto 8879: en esta PC puede estar corriendo el conector
# real de US-851 y no se toca). «Apagado» = la petición falla como si nadie escuchara.
SIM = {'llamadas': [], 'corrida': 4}
CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Private-Network': 'true'}
def _sim(route):
    req = route.request
    ruta = req.url.split('8879', 1)[1]
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
    cuerpo = json.loads(req.post_data or '{}') if req.method == 'POST' else {}
    SIM['llamadas'].append((ruta, cuerpo))
    if req.method == 'GET' and ruta == '/estado':
        return route.fulfill(status=200, headers=CORS, content_type='application/json', body=json.dumps({'ok': True, 'version': 'simulador', 'ocupado': False, 'chrome': True}))
    if ruta == '/comprasmx/buscar':
        time.sleep(1.5)
        return route.fulfill(status=200, headers=CORS, content_type='application/json', body=json.dumps({'corrida_id': SIM['corrida'], 'encontradas': 3, 'nuevas': 1, 'error': None}))
    if ruta == '/comprasmx/cancelar':
        return route.fulfill(status=200, headers=CORS, content_type='application/json', body='{"ok":true}')
    return route.fulfill(status=404, headers=CORS, body='{}')
def conector_on(page):
    page.unroute('http://127.0.0.1:8879/**')
    page.route('http://127.0.0.1:8879/**', _sim)
def conector_off(page):
    page.unroute('http://127.0.0.1:8879/**')
    page.route('http://127.0.0.1:8879/**', lambda r: r.abort('connectionrefused'))

LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&typeof NavShell==='object'&&document.querySelector('#nv .nvs')&&R._last!==undefined"
def abrir(pw, ancho, alto, tag):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
    page = ctx.new_page()
    def on_console(m):
        t = m.text
        if m.type != 'error' or 'ERR_CONNECTION' in t or 'Tailwind' in t or '127.0.0.1:8879' in t: return
        if 'status of 400' in t or 'status of 409' in t or 'status of 429' in t: return   # rechazos provocados a propósito
        errores.append(f'{tag} console.error: {t}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: errores.append(f'{tag} pageerror: {e}'))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=90000)
    page.wait_for_timeout(800)
    return ctx, page
def snap(page, nombre):
    if args.out: page.screenshot(path=os.path.join(args.out, nombre), full_page=False)
def axe(page, sel, tag):
    page.add_script_tag(url=AXE)
    v = page.evaluate("async s=>{const r=await axe.run(document.querySelector(s),{runOnly:['wcag2a','wcag2aa']});return r.violations.map(x=>x.id+': '+x.nodes.length+' '+(x.nodes[0]&&x.nodes[0].target.join(' ')))}", sel)
    check(not v, f'{tag}: axe sin violaciones en {sel} {v}')
def sql(page, js):
    return page.evaluate("async c=>{const f=new Function('sb','return (async()=>{'+c+'})()');return await f(sb);}", js)
def esperar_lista(page):
    page.wait_for_function("()=>{const p=document.getElementById('cvPanel');return p&&!p.querySelector('[aria-busy]')&&(p.querySelector('table')||p.querySelector('.empty'))}", timeout=30000)
def casilla(page, sel, v):
    # El .zk-switch oculta el input (opacidad 0): se clica la etiqueta si hay que cambiarlo.
    if page.is_checked(sel) != bool(v): page.click(f'label.zk-switch:has({sel})')
def quieto(page):
    page.wait_for_function("()=>!Convocatorias.estado.ocupado", timeout=30000)
    page.wait_for_timeout(200)
def ir_conv(page):
    page.evaluate("()=>{if(typeof Licitaciones!=='undefined'&&Licitaciones.ficha)Licitaciones.volver();irAModulo('lc')}")
    page.wait_for_function("()=>typeof Convocatorias!=='undefined'&&document.getElementById('lcTab-convocatorias')", timeout=30000)
    page.click('#lcTab-convocatorias')
    esperar_lista(page)
def sin_desborde(page, tag):
    w = page.evaluate("()=>[document.documentElement.scrollWidth, window.innerWidth]")
    check(w[0] <= w[1] + 1, f'{tag}: sin desborde horizontal ({w[0]} <= {w[1]})')

creados = {'lic': [], 'conv': set(), 'filtro': []}

def recorrido(pw, ancho, alto):
    tag = str(ancho)
    ctx, page = abrir(pw, ancho, alto, tag)
    try:
        # US-846: contador de la barra antes de abrir la pestaña (con «visto» muy viejo cuenta todo lo nuevo que cumple)
        page.evaluate("async()=>{localStorage.setItem('conv_visto:'+(currentUser.id||currentUser.user_id||'u'),'2000-01-01T00:00:00Z');await convAvisosCargar();}")
        lc = page.evaluate("()=>navBadges().lc")
        check(isinstance(lc, int) and lc > 0, f'{tag}: navBadges().lc cuenta nuevas sin revisar ({lc})')
        ir_conv(page)
        page.wait_for_timeout(1200)
        check(page.evaluate("()=>navBadges().lc") == 0, f'{tag}: al abrir Convocatorias el contador vuelve a 0')
        # US-843: vista por defecto
        st = page.evaluate("()=>Convocatorias.estado.st")
        check(st['estado'] == 'nueva' and st['mis'] is True, f'{tag}: por omisión «Nuevas» que cumplen mis filtros {st}')
        check(page.is_checked('#cvMis'), f'{tag}: interruptor «Sólo las que cumplen mis filtros» encendido')
        heads = page.eval_on_selector_all('#cvPanel thead th', 'e=>e.map(x=>x.textContent.trim())')
        if ancho >= 768: check(heads[:5] == ['Convocatoria', 'Dependencia', 'Entidad', 'Tipo', 'Apertura'], f'{tag}: columnas {heads}')
        filas = page.eval_on_selector_all('#cvPanel tbody tr', 'e=>e.length')
        check(0 < filas <= 50, f'{tag}: lista paginada en el servidor ({filas} filas, máx. 50)')
        total = page.evaluate("()=>Convocatorias.estado.total")
        check(total > 50, f'{tag}: total del servidor sin traer todo ({total})')
        chip = page.inner_text('#cvPanel tbody tr:first-child .chip')
        check(chip in ('Chihuahua', 'Federal'), f'{tag}: chip de fuente ({chip})')
        a = page.query_selector('#cvPanel tbody tr:first-child a[target=_blank]')
        check(a is not None and 'noopener' in (a.get_attribute('rel') or '') and a.get_attribute('href').startswith('http'), f'{tag}: «Ver en el portal» abre en otra pestaña con rel=noopener')
        check('días' in page.inner_text('#cvPanel tbody') or 'Sin fecha publicada' in page.inner_text('#cvPanel tbody') or 'mañana' in page.inner_text('#cvPanel tbody'), f'{tag}: apertura con días restantes')
        pie = page.inner_text('#cvPanel footer')
        check('Contrataciones Chihuahua: última búsqueda' in pie and 'ComprasMX' in pie, f'{tag}: pie con la última búsqueda de cada fuente')
        check('48' not in pie, f'{tag}: sin aviso de antigüedad')
        snap(page, f'convocatorias-{tag}.png')
        sin_desborde(page, tag)
        axe(page, '#cvPanel', tag)
        # paginación
        if total > 50:
            page.click('text=Siguientes'); quieto(page)
            check('51 a ' in page.inner_text('#cvPanel'), f'{tag}: página 2')
            page.click('text=Anteriores'); quieto(page)
        # filtros de la lista
        page.fill('#cvTexto', 'pavimentacion'); page.press('#cvTexto', 'Enter'); quieto(page)
        txt = page.evaluate("()=>Convocatorias.estado.filas.map(c=>Convocatorias.textoConvocatoria(c))")
        check(len(txt) > 0 and all('pavimentacion' in t for t in txt), f'{tag}: búsqueda por texto sin acentos ({len(txt)} filas)')
        page.select_option('#cvEstado', ''); quieto(page)
        page.select_option('#cvAbren', '30'); quieto(page)
        ok = page.evaluate("()=>Convocatorias.estado.filas.every(c=>{const d=Convocatorias.diasA(c.apertura);return d!==null&&d>=0&&d<=31})")
        check(ok, f'{tag}: «abren en los próximos 30 días»')
        page.select_option('#cvAbren', ''); quieto(page); page.select_option('#cvEstado', 'nueva'); quieto(page)
        # Me interesa / Descartar con deshacer
        cid = page.evaluate("()=>Convocatorias.estado.filas[0]&&Convocatorias.estado.filas[0].id")
        creados['conv'].add(cid)
        page.select_option('#cvEstado', ''); quieto(page)
        page.click(f'tr[data-cv="{cid}"] >> text=Me interesa')
        page.wait_for_function(f"()=>document.querySelector('tr[data-cv=\"{cid}\"] [aria-pressed=true]')")
        check(True, f'{tag}: «Me interesa» marcado')
        page.select_option('#cvEstado', 'nueva'); quieto(page)
        cid2 = page.evaluate("()=>Convocatorias.estado.filas[0]&&Convocatorias.estado.filas[0].id")
        creados['conv'].add(cid2)
        page.click(f'tr[data-cv="{cid2}"] >> text=Descartar')
        page.wait_for_selector('text=Deshacer')
        check(page.query_selector(f'tr[data-cv="{cid2}"]') is None, f'{tag}: descartada sale de «Nuevas»')
        page.click('text=Deshacer'); page.wait_for_timeout(1500)
        est = sql(page, f"const r=await sb.from('convocatoria_seguimiento').select('estado').eq('convocatoria_id',{cid2});return r.data")
        check(est and est[0]['estado'] == 'nueva', f'{tag}: deshacer la regresa a «nueva» ({est})')
        # US-844: filtros guardados con vista previa
        page.click('text=Mis filtros')
        page.wait_for_selector('#mdlConv.ac >> text=Nuevo filtro')
        page.click('#mdlConv >> text=Nuevo filtro')
        page.fill('#cvfNombre', f'QA-G filtro {tag}')
        page.fill('#cvfClaves', 'pavimentación, escuela')
        page.wait_for_function("()=>/de [\\d,]+ convocatorias vigentes/.test(document.getElementById('cvfPrevia').textContent)", timeout=15000)
        prev = page.inner_text('#cvfPrevia')
        check('cumplen este filtro' in prev, f'{tag}: vista previa antes de guardar ({prev})')
        snap(page, f'convocatorias-filtro-{tag}.png')
        page.click('#cvFormFiltro button[type=submit]')
        page.wait_for_selector(f'#mdlConv >> text=QA-G filtro {tag}')
        fid = sql(page, f"const r=await sb.from('convocatoria_filtros').select('id,palabras_clave').eq('nombre','QA-G filtro {tag}');return r.data")
        check(fid and fid[0]['palabras_clave'] == ['pavimentación', 'escuela'], f'{tag}: filtro guardado {fid}')
        if fid: creados['filtro'].append(fid[0]['id'])
        page.click(f'#mdlConv li:has-text("QA-G filtro {tag}") >> text=Borrar')
        page.click('#dlgOk')
        page.wait_for_function(f"()=>!document.querySelector('#mdlConvC').textContent.includes('QA-G filtro {tag}')", timeout=15000)
        check(True, f'{tag}: filtro borrado con Dialog.confirm')
        page.click('#mdlConv button[aria-label=Cerrar]')
        # US-845: Participar (sólo en 1440, crea una licitación de prueba)
        if ancho >= 768:
            page.select_option('#cvEstado', 'nueva'); quieto(page); page.fill('#cvTexto', 'Cuauhtémoc'); page.press('#cvTexto', 'Enter'); quieto(page)
            cid3 = page.evaluate("()=>{const f=Convocatorias.estado.filas.find(c=>/Municipio de Cuauht/.test(c.dependencia||''));return f&&f.id}")
            if cid3:
                creados['conv'].add(cid3)
                page.click(f'tr[data-cv="{cid3}"] >> text=Participar')
                page.wait_for_selector('#cvFormPart')
                perfil = page.eval_on_selector('#cvpPerfil', 'e=>e.options[e.selectedIndex].text')
                check('Cuauhtémoc' in perfil and 'sugerido' in perfil, f'{tag}: perfil sugerido por la dependencia ({perfil})')
                check(page.input_value('#cvpPlaza') == 'cuauhtemoc', f'{tag}: plaza prellenada')
                check(page.input_value('#cvpNombre') != '' and page.input_value('#cvpCodigo') != '', f'{tag}: código y nombre prellenados')
                codigo = f'QA-G-{int(time.time())}'
                page.fill('#cvpCodigo', codigo)
                snap(page, f'convocatorias-participar-{tag}.png')
                page.click('#cvpGuardar')
                page.wait_for_function("()=>Licitaciones.ficha&&Licitaciones.ficha.lic", timeout=30000)
                lic = page.evaluate("()=>Licitaciones.ficha.lic.id")
                creados['lic'].append(lic)
                page.wait_for_selector('#lcFichaAvisos >> text=Viene de la convocatoria', timeout=15000)
                check(True, f'{tag}: la ficha dice de qué convocatoria viene')
                seg = sql(page, f"const r=await sb.from('convocatoria_seguimiento').select('estado,licitacion_id').eq('convocatoria_id',{cid3});return r.data")
                check(seg and seg[0]['estado'] == 'convertida' and seg[0]['licitacion_id'] == lic, f'{tag}: seguimiento «convertida» ligado ({seg})')
                ir_conv(page)
            else:
                check(False, f'{tag}: no hubo convocatoria del Municipio de Cuauhtémoc para probar «Participar»')
        # US-850: Buscar en los portales
        conector_on(page)
        try:
            page.fill('#cvTexto', ''); page.press('#cvTexto', 'Enter'); quieto(page)
            page.click('text=Buscar en los portales')
            page.wait_for_selector('#cvFormBus')
            opts = page.eval_on_selector_all('#cvbFiltro option', 'e=>e.length')
            check(opts >= 2, f'{tag}: «Usar un filtro guardado» ofrece los filtros ({opts - 1})')
            page.select_option('#cvbFiltro', index=1)
            check(page.is_checked('#cvbChih') or page.is_checked('#cvbFed'), f'{tag}: el filtro guardado llena el formulario')
            real = ancho >= 768 and not args.sin_portal
            casilla(page, '#cvbChih', real)
            casilla(page, '#cvbFed', True)
            page.fill('#cvbTexto', 'pavimentacion'); page.select_option('#cvbTipo', 'obra_publica'); page.fill('#cvbMax', '10')
            snap(page, f'convocatorias-buscar-{tag}.png')
            page.click('#cvFormBus button[type=submit]')
            page.wait_for_selector('section[aria-label="Búsqueda en los portales"]')
            check('buscando' in page.inner_text('section[aria-label="Búsqueda en los portales"]') or 'revisando' in page.inner_text('section[aria-label="Búsqueda en los portales"]'), f'{tag}: estado por fuente mientras busca')
            check(page.query_selector('text=Cancelar búsqueda') is not None, f'{tag}: botón para cancelar')
            page.wait_for_selector('text=Resultados de tu búsqueda', timeout=120000)
            res = page.inner_text('#cvPanel')
            check('ComprasMX:' in res and 'encontrada' in res, f'{tag}: resultado del conector (simulador; el resumen sale de su corrida en la BD) en pantalla')
            llamada = [c for c in SIM['llamadas'] if c[0] == '/comprasmx/buscar'][-1][1]
            check(llamada.get('texto') == 'pavimentacion' and llamada.get('tipos') == ['obra_publica'] and llamada.get('max_resultados') == 10, f'{tag}: filtros enviados al conector {llamada}')
            if real:
                check('Contrataciones Chihuahua' in res and 'encontrada' in res, f'{tag}: resultado de Chihuahua (portal real)')
                filasr = page.evaluate("()=>(Convocatorias.estado.resultados||[]).filter(r=>r.fuente==='chihuahua').flatMap(r=>r.filas||[]).length")
                check(0 < filasr <= 10, f'{tag}: sólo los resultados de esa búsqueda ({filasr})')
                pie = page.inner_text('#cvPanel footer')
                check('por ' in pie, f'{tag}: el pie dice quién lanzó la última búsqueda ({pie[:120]})')
            snap(page, f'convocatorias-resultados-{tag}.png')
            sin_desborde(page, tag + ' resultados')
            axe(page, '#cvPanel', tag + ' resultados')
            # Límite de 30 s en el cliente
            page.click('#cvPanel >> text=Buscar en los portales')
            page.wait_for_selector('#cvFormBus')
            casilla(page, '#cvbChih', False); casilla(page, '#cvbFed', True)
            page.click('#cvFormBus button[type=submit]')
            page.wait_for_selector('#toastContainer >> text=Espera', timeout=5000)
            check(True, f'{tag}: pausa de 30 s entre búsquedas a la misma fuente')
            page.click('#mdlConv button[aria-label=Cerrar]')
        finally:
            conector_off(page)
        # Conector apagado: aviso con enlace y la app sigue
        page.evaluate("()=>{localStorage.removeItem('conv_ultima:'+(currentUser.id||currentUser.user_id||'u')+':comprasmx')}")
        page.click('#cvPanel >> text=Buscar en los portales')
        page.wait_for_selector('#cvFormBus')
        casilla(page, '#cvbChih', False); casilla(page, '#cvbFed', True)
        page.click('#cvFormBus button[type=submit]')
        page.wait_for_selector('text=cómo abrir o instalar el conector', timeout=20000)
        href = page.get_attribute('a:has-text("cómo abrir o instalar el conector")', 'href')
        check(href and href.endswith('docs/licitaciones/conector-local.md'), f'{tag}: conector apagado → aviso con enlace a conector-local.md')
        snap(page, f'convocatorias-sin-conector-{tag}.png')
        page.click('text=Volver a la lista'); esperar_lista(page)
    except Exception as e:
        import traceback; traceback.print_exc(); fallos.append(f'{tag}: excepción {e}')
    finally:
        try: limpiar(page)
        except Exception as e: fallos.append(f'{tag}: limpieza {e}')
        ctx.close()

def limpiar(page):
    for lid in creados['lic']: sql(page, f"await sb.from('licitaciones').delete().eq('id',{lid});return 1")
    for cid in creados['conv']:
        if cid: sql(page, f"await sb.from('convocatoria_seguimiento').delete().eq('convocatoria_id',{cid});return 1")
    sql(page, "await sb.from('convocatoria_filtros').delete().like('nombre','QA-G filtro%');return 1")
    quedan = sql(page, "const a=await sb.from('licitaciones').select('id').like('codigo','QA-G-%');const b=await sb.from('convocatoria_filtros').select('id').like('nombre','QA-G%');return [(a.data||[]).length,(b.data||[]).length]")
    check(quedan == [0, 0], f'limpieza: sin licitaciones ni filtros QA-G ({quedan})')
    creados['lic'].clear(); creados['conv'].clear()

with sync_playwright() as pw:
    recorrido(pw, 1440, 900)
    recorrido(pw, 390, 844)

for e in errores: print('  ERROR', e)
print()
print(f'{len(fallos)} fallas, {len(errores)} errores de consola')
sys.exit(1 if fallos or errores else 0)
