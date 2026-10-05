# -*- coding: utf-8 -*-
"""
convocatorias-filtros-smoke.py (PRD licitaciones: US-853), contra el build local (dist/).

En 1440 y 390 px, con la sesión de QA (cuenta real de Ricardo, empresa 1): barra de filtros de Licitaciones ›
Convocatorias (texto con «-palabra», fuente, entidad, municipio, dependencia con autocompletar, tipo, procedimiento,
estatus, seguimiento, apertura y publicación con rango, orden), fichas que se quitan una por una, «Quitar filtros»,
contador, tiempo de cada consulta (< 400 ms), «Guardar esta búsqueda» y elegir el filtro guardado, filtros que
sobreviven a salir y volver al módulo, panel «Filtros (N)» en 390 px, y la lista de Licitaciones con texto,
convocante y resultado. axe sin violaciones, sin desborde, sin errores de consola.

Sólo lee convocatorias; crea y borra el filtro «QA-K …». No consulta los portales. No toca nav_prefs.

Uso (OBRA_QA_TOKEN en el entorno; dist servido con node scripts/serve-dist.mjs dist 8777):
  PYTHONIOENCODING=utf-8 python scripts/qa/convocatorias-filtros-smoke.py --app http://127.0.0.1:8777/index.html?app=1 --out <carpeta>
"""
import argparse, os, sys
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8777/index.html?app=1')
ap.add_argument('--out', default='')
args = ap.parse_args()
TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
if not TOKEN:
    print('Falta OBRA_QA_TOKEN en el entorno'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)
AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
errores, fallos, tiempos = [], [], []
def check(cond, msg):
    if not cond: fallos.append(msg)
    print(('  ok  ' if cond else '  FALLA ') + msg)

LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&typeof NavShell==='object'&&document.querySelector('#nv .nvs')&&R._last!==undefined"
def abrir(pw, ancho, alto, tag):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
    page = ctx.new_page()
    def on_console(m):
        if m.type != 'error' or 'Tailwind' in m.text or '127.0.0.1:8879' in m.text: return
        if 'status of 400' in m.text: return   # «orden no válido» no se provoca aquí, pero el patrón es el de las otras pruebas
        errores.append(f'{tag} console.error: {m.text}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: errores.append(f'{tag} pageerror: {e}'))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
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
def sin_desborde(page, tag):
    w = page.evaluate("()=>[document.documentElement.scrollWidth, window.innerWidth]")
    check(w[0] <= w[1] + 1, f'{tag}: sin desborde horizontal ({w[0]} <= {w[1]})')
def quieto(page):
    page.wait_for_function("()=>!Convocatorias.estado.ocupado", timeout=30000)
    page.wait_for_timeout(250)
def esperar_lista(page):
    page.wait_for_function("()=>{const p=document.getElementById('cvPanel');return p&&!p.querySelector('[aria-busy]')&&(p.querySelector('table')||p.querySelector('.empty'))}", timeout=30000)
def ir_conv(page):
    page.evaluate("()=>{if(typeof Licitaciones!=='undefined'&&Licitaciones.ficha)Licitaciones.volver();irAModulo('lc')}")
    page.wait_for_function("()=>typeof Convocatorias!=='undefined'&&document.getElementById('lcTab-convocatorias')", timeout=30000)
    page.click('#lcTab-convocatorias')
    esperar_lista(page)
def fichas(page):
    return page.eval_on_selector_all('#cvFichas li.cv-ficha span', 'xs=>xs.map(x=>x.textContent)')
def total(page):
    return page.evaluate('()=>Convocatorias.estado.total')
def medir(page, tag, que):
    quieto(page)
    ms = page.evaluate('()=>Convocatorias.estado.ms')
    tiempos.append(ms)
    print(f'  ..  {tag}: «{que}» respondió en {ms} ms')
def abrir_panel(page):
    if not page.evaluate("()=>document.getElementById('cvFiltrosPanel').open"):
        page.click('#cvFiltrosPanel > summary')
        page.wait_for_timeout(200)

def recorrido(pw, ancho, alto):
    tag = str(ancho)
    ctx, page = abrir(pw, ancho, alto, tag)
    filtro_id = None
    try:
        ir_conv(page)
        movil = ancho < 640
        abierto = page.evaluate("()=>document.getElementById('cvFiltrosPanel').open")
        if movil:
            check(not abierto, f'{tag}: en el teléfono la barra entra plegada en «Filtros (N)»')
            n = page.inner_text('#cvFiltrosPanel > summary')
            check('Filtros (' in n, f'{tag}: el botón dice cuántos filtros hay puestos ({n.strip()})')
            snap(page, f'filtros-{tag}-plegado.png')
            abrir_panel(page)
        else:
            check(abierto and not page.is_visible('#cvFiltrosPanel > summary'), f'{tag}: en escritorio la barra se ve abierta, sin el botón «Filtros»')
        # Vista por omisión: fichas de «mis filtros» + «Nuevas»
        f0 = fichas(page)
        check(any('Seguimiento: Nuevas' in x for x in f0), f'{tag}: la vista por omisión se ve como fichas ({f0})')
        # Quitar filtros
        page.click('#cvFichas button:has-text("Quitar filtros")'); medir(page, tag, 'Quitar filtros')
        t_todo = total(page)
        check(fichas(page) == [] and t_todo > 300, f'{tag}: «Quitar filtros» deja todas las vigentes ({t_todo}) y sin fichas')
        check(page.inner_text('#cvConteo').startswith(f'{t_todo:,}'.replace(',', ',')) or str(t_todo) in page.inner_text('#cvConteo').replace(',', ''), f'{tag}: el contador dice el total ({page.inner_text("#cvConteo")})')
        abrir_panel(page)
        # Texto con exclusión (se filtra al escribir, sin perder el foco)
        page.fill('#cvTexto', 'construccion -pavimentacion')
        page.wait_for_timeout(450); medir(page, tag, 'texto')
        f1 = fichas(page)
        check('Texto: construccion' in f1 and 'Sin «pavimentacion»' in f1, f'{tag}: fichas de texto y exclusión ({f1})')
        check(page.evaluate("()=>document.activeElement&&document.activeElement.id")=='cvTexto', f'{tag}: el foco sigue en el buscador')
        t1 = total(page)
        ok_txt = page.evaluate("()=>Convocatorias.estado.filas.every(c=>Convocatorias.cumpleTextoBarra(c,'construccion -pavimentacion'))")
        check(0 < t1 < t_todo and ok_txt, f'{tag}: el texto filtra en el servidor con la regla de la barra ({t1} de {t_todo})')
        # Fuente, municipio (autocompletar), dependencia (autocompletar)
        page.select_option('#cvFuente', 'chihuahua'); medir(page, tag, 'fuente')
        deps = page.evaluate("()=>document.querySelectorAll('#cvDepLista option').length")
        check(deps > 5, f'{tag}: la dependencia autocompleta con las existentes ({deps} sugerencias)')
        page.fill('#cvDependencia', 'Obras Públicas'); page.press('#cvDependencia', 'Enter'); page.dispatch_event('#cvDependencia', 'change'); medir(page, tag, 'dependencia')
        ok_dep = page.evaluate("()=>Convocatorias.estado.filas.every(c=>Convocatorias.norm((c.dependencia||'')+' '+(c.unidad_compradora||'')).includes('obras publicas'))")
        check(ok_dep, f'{tag}: dependencia filtra (sin acentos) ({total(page)})')
        page.select_option('#cvTipo', 'obra_publica'); medir(page, tag, 'tipo')
        page.select_option('#cvProc', 'licitacion_publica'); medir(page, tag, 'procedimiento')
        page.select_option('#cvEstado', 'nueva'); medir(page, tag, 'seguimiento')
        page.select_option('#cvAbren', 'rango'); quieto(page)
        check(page.is_visible('#cvAbrenD') and page.is_visible('#cvAbrenH'), f'{tag}: «Rango de fechas…» muestra desde/hasta')
        page.fill('#cvAbrenD', '2026-10-01'); page.dispatch_event('#cvAbrenD', 'change'); medir(page, tag, 'abren desde')
        page.fill('#cvAbrenH', '2026-12-31'); page.dispatch_event('#cvAbrenH', 'change'); medir(page, tag, 'abren hasta')
        page.select_option('#cvOrden', 'dependencia'); medir(page, tag, 'orden')
        f2 = fichas(page)
        check(len(f2) == 8 and any(x.startswith('Abren 1/10/2026 a 31/12/2026') for x in f2), f'{tag}: una ficha por filtro puesto ({len(f2)}: {f2})')
        n_tot = total(page)
        if movil:
            check(f'Filtros ({len(f2)})' in ' '.join(page.inner_text('#cvFiltrosPanel > summary').split()).replace('( ', '(').replace(' )', ')'), f'{tag}: «Filtros (N)» cuenta los filtros activos')
        # Quitar una ficha
        page.click('#cvFichas li.cv-ficha:has-text("Licitación pública") button'); medir(page, tag, 'quitar ficha')
        f3 = fichas(page)
        check(len(f3) == 7 and not any('Licitación pública' in x for x in f3) and page.input_value('#cvProc') == '', f'{tag}: la ficha se quita sola y la barra la refleja')
        check(total(page) >= n_tot, f'{tag}: el contador se actualiza al quitar ({total(page)} >= {n_tot})')
        # Publicación: últimos 90 días
        abrir_panel(page)
        page.select_option('#cvPub', '90'); medir(page, tag, 'publicación 90 días')
        check(any('Publicadas en los últimos 90 días' in x for x in fichas(page)), f'{tag}: ficha de publicación')
        snap(page, f'filtros-{tag}-puestos.png')
        axe(page, '#cvPanel', tag)
        sin_desborde(page, tag)
        # Guardar esta búsqueda
        abrir_panel(page)
        estado_antes = page.evaluate("()=>JSON.stringify(Object.assign({},Convocatorias.estado.st,{pagina:0,filtro:''}))")
        page.click('button:has-text("Guardar esta búsqueda")')
        page.wait_for_selector('#cvFormFiltro', timeout=10000)
        check(page.input_value('#cvfClaves') == 'construccion' and page.input_value('#cvfExcluir') == 'pavimentacion', f'{tag}: el filtro nuevo trae palabras clave y a excluir de la barra')
        check(page.is_checked('#cvfFChih') and page.is_checked('#cvfT-obra_publica'), f'{tag}: y la fuente y el tipo')
        page.fill('#cvfNombre', f'QA-K barra {tag}')
        page.click('#cvFormFiltro button[type=submit]')
        page.wait_for_function("()=>!!Convocatorias.estado.st.filtro", timeout=15000)
        quieto(page)
        filtro_id = page.evaluate("()=>Convocatorias.estado.st.filtro")
        check(bool(filtro_id) and any(x.startswith('Filtro guardado: QA-K barra') for x in fichas(page)), f'{tag}: la búsqueda queda guardada y elegida ({filtro_id})')
        # Quitar todo y volver a elegir el filtro guardado
        page.click('#cvFichas button:has-text("Quitar filtros")'); quieto(page)
        abrir_panel(page)
        page.select_option('#cvFiltroG', str(filtro_id)); medir(page, tag, 'filtro guardado')
        estado_despues = page.evaluate("()=>JSON.stringify(Object.assign({},Convocatorias.estado.st,{pagina:0,filtro:''}))")
        import json as _j
        a, b = _j.loads(estado_antes), _j.loads(estado_despues)
        a['mis'] = b['mis']
        check(a == b, f'{tag}: elegir el filtro guardado vuelve a poner toda la barra')
        # Sobrevive a salir y volver
        page.evaluate("()=>irAModulo('dash')")
        page.wait_for_timeout(1200)
        ir_conv(page); quieto(page)
        estado_vuelta = page.evaluate("()=>JSON.stringify(Object.assign({},Convocatorias.estado.st,{pagina:0,filtro:''}))")
        check(estado_vuelta == estado_despues and page.input_value('#cvMunicipio') == '' and page.input_value('#cvTexto') == 'construccion -pavimentacion',
              f'{tag}: los filtros sobreviven a salir y volver al módulo')
        # Lista de Licitaciones
        page.click('#lcTab-licitaciones')
        page.wait_for_selector('#lcTbody', timeout=20000)
        n_lic = page.evaluate("()=>(D.lic||[]).length")
        if n_lic:
            primera = page.evaluate("()=>D.lic[0]")
            palabra = (primera.get('codigo') or '').split('-')[0] or (primera.get('nombre') or 'a').split(' ')[0]
            page.fill('#lcFTexto', palabra); page.wait_for_timeout(200)
            check(any(x.startswith('Texto:') for x in page.eval_on_selector_all('#lcFichas .cv-ficha span', 'xs=>xs.map(x=>x.textContent)')), f'{tag}: Licitaciones: ficha del texto')
            convs = page.eval_on_selector_all('#lcFConv option', 'xs=>xs.map(x=>x.value).filter(Boolean)')
            if convs:
                page.select_option('#lcFConv', convs[0]); page.wait_for_timeout(200)
            page.select_option('#lcFRes', 'sin_fallo'); page.wait_for_timeout(200)
            fl = page.eval_on_selector_all('#lcFichas .cv-ficha span', 'xs=>xs.map(x=>x.textContent)')
            check(any(x.startswith('Resultado:') for x in fl) and (not convs or any(x.startswith('Convocante:') for x in fl)), f'{tag}: Licitaciones: fichas de convocante y resultado ({fl})')
            check('de ' in page.inner_text('#lcConteo'), f'{tag}: Licitaciones: contador ({page.inner_text("#lcConteo")})')
            axe(page, '#lcPanel', tag + ' licitaciones')
            snap(page, f'licitaciones-{tag}-filtros.png')
            page.click('#lcFichas button:has-text("Quitar filtros")'); page.wait_for_timeout(200)
            check(page.eval_on_selector_all('#lcFichas .cv-ficha', 'xs=>xs.length') == 0 and page.input_value('#lcFTexto') == '', f'{tag}: Licitaciones: «Quitar filtros» limpia todo')
        else:
            check(False, f'{tag}: no hay licitaciones para probar los filtros de la lista')
        sin_desborde(page, tag)
    finally:
        page.evaluate("async()=>{await sb.from('convocatoria_filtros').delete().like('nombre','QA-K %')}")
        page.evaluate("()=>{try{sessionStorage.clear()}catch(e){}}")
        ctx.close()

with sync_playwright() as pw:
    recorrido(pw, 1440, 900)
    recorrido(pw, 390, 844)
print('tiempos (ms):', tiempos)
# Ida y vuelta medida en el navegador (incluye la red de esta PC a Supabase, que varía); el servidor tarda 3-20 ms.
ordenados = sorted(tiempos)
mediana = ordenados[len(ordenados) // 2]
p90 = ordenados[int(len(ordenados) * 0.9) - 1]
check(mediana < 400 and p90 < 400, f'cambios de filtro: mediana {mediana} ms y p90 {p90} ms (< 400); máximo {ordenados[-1]} ms')
for e in errores: print('  ERROR', e)
print(f'\n{len(fallos)} fallas, {len(errores)} errores de consola')
sys.exit(1 if fallos or errores else 0)
