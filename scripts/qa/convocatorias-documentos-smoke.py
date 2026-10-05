# -*- coding: utf-8 -*-
"""
convocatorias-documentos-smoke.py (PRD licitaciones: US-848 y US-849), contra el build local (dist/), el CONECTOR REAL
de esta PC (ComprasMX) y la función de borde convocatorias-documentos (Contrataciones Chihuahua).

Con DOS convocatorias reales y nada más (D14: nunca en lote):
  - ComprasMX (--federal, por omisión LO-67-021-908069995-N-11-2026): se abre su detalle (registra la visita), se marca
    «Me interesa» → la app pide los anexos al conector y los sube uno por uno al bucket con avance visible; se reabre el
    detalle: archivos con «Nuevo», ver (URL firmada), «Descargar todo (ZIP)», «Preparar para revisión» (PDF +
    convocatoria.json), notas de revisión, «Buscar documentos nuevos» (no duplica nada); «Participar» → los archivos pasan
    a licitacion_archivos con categoría y la misma ruta. Detalle revisado también en 390 px.
  - Contrataciones Chihuahua (--estatal, por omisión OP-174-2026): «Descargar documentos» desde su detalle.
Al final borra TODO lo de prueba: archivos del bucket, convocatoria_archivos, descargas, notas, visitas, la licitación
QA-K y el seguimiento (las convocatorias, públicas, se quedan).

Uso (OBRA_QA_TOKEN en el entorno; dist en 8777; conector instalado):
  PYTHONIOENCODING=utf-8 python scripts/qa/convocatorias-documentos-smoke.py --out <carpeta>
"""
import argparse, io, json, os, sys, time, zipfile
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8777/index.html?app=1')
ap.add_argument('--out', default='')
ap.add_argument('--federal', default='LO-67-021-908069995-N-11-2026')
ap.add_argument('--estatal', default='OP-174-2026')
ap.add_argument('--sin-estatal', action='store_true')
args = ap.parse_args()
TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
if not TOKEN:
    print('Falta OBRA_QA_TOKEN en el entorno'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)
ORIGEN = args.app.split('/index.html')[0]
AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
errores, fallos = [], []
def check(cond, msg):
    if not cond: fallos.append(msg)
    print(('  ok  ' if cond else '  FALLA ') + msg)
LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&typeof NavShell==='object'&&document.querySelector('#nv .nvs')&&R._last!==undefined"

def abrir(pw, ancho, alto, tag):
    nav = pw.chromium.launch(channel='chrome')
    ctx = nav.new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', accept_downloads=True,
                          is_mobile=ancho < 768, has_touch=ancho < 768)
    ctx.grant_permissions(['local-network-access'], origin=ORIGEN)
    page = ctx.new_page()
    def on_console(m):
        if m.type != 'error' or 'Tailwind' in m.text: return
        errores.append(f'{tag} console.error: {m.text}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: errores.append(f'{tag} pageerror: {e}'))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=90000)
    return nav, ctx, page
def ir_conv(page):
    page.evaluate("()=>{if(typeof Licitaciones!=='undefined'&&Licitaciones.ficha)Licitaciones.volver();irAModulo('lc')}")
    page.wait_for_function("()=>typeof Convocatorias!=='undefined'&&document.getElementById('lcTab-convocatorias')", timeout=30000)
    page.click('#lcTab-convocatorias')
    page.wait_for_function("()=>{const p=document.getElementById('cvPanel');return p&&!p.querySelector('[aria-busy]')&&document.getElementById('cvFiltrosPanel')}", timeout=30000)
def quieto(page):
    page.wait_for_function("()=>!Convocatorias.estado.ocupado", timeout=30000); page.wait_for_timeout(300)
def buscar_en_lista(page, numero):
    if page.query_selector('#cvFichas button:has-text("Quitar filtros")'): page.click('#cvFichas button:has-text("Quitar filtros")'); quieto(page)
    if not page.evaluate("()=>document.getElementById('cvFiltrosPanel').open"): page.click('#cvFiltrosPanel > summary')
    page.fill('#cvTexto', numero); page.wait_for_timeout(450); quieto(page)
    f = page.evaluate("n=>Convocatorias.estado.filas.find(c=>c.numero_procedimiento===n)||null", numero)
    return f
def snap(page, nombre):
    if args.out: page.screenshot(path=os.path.join(args.out, nombre), full_page=False)
def axe(page, sel, tag):
    page.add_script_tag(url=AXE)
    v = page.evaluate("async s=>{const r=await axe.run(document.querySelector(s),{runOnly:['wcag2a','wcag2aa']});return r.violations.map(x=>x.id+': '+x.nodes.length+' '+(x.nodes[0]&&x.nodes[0].target.join(' ')))}", sel)
    check(not v, f'{tag}: axe sin violaciones en {sel} {v}')
def sql(page, js, arg=None):
    return page.evaluate("async ([c,a])=>{const f=new Function('sb','a','return (async()=>{'+c+'})()');return await f(sb,a);}", [js, arg])
def abrir_detalle(page, cid):
    page.click(f'tr[data-cv="{cid}"] button.font-medium')
    page.wait_for_function("()=>{const d=document.getElementById('cvDet');return d&&!d.hasAttribute('aria-busy')}", timeout=30000)
def cerrar_modal(page):
    page.evaluate("()=>Convocatorias.cerrarModal()"); page.wait_for_timeout(300)
def esperar_descarga(page, minutos=8):
    page.wait_for_function("()=>Convocatorias.descarga&&Convocatorias.descarga.fin", timeout=minutos * 60000)
    return page.evaluate("()=>{const d=Convocatorias.descarga;return {fase:d.fase,items:d.items.map(x=>({nombre:x.nombre,estado:x.estado,nota:x.nota||null}))}}")

ids = {'fed': None, 'est': None, 'lic': None}
with sync_playwright() as pw:
    nav, ctx, page = abrir(pw, 1440, 900, '1440')
    try:
        ir_conv(page)
        fed = buscar_en_lista(page, args.federal)
        check(fed is not None, f'la convocatoria federal {args.federal} está en la lista')
        if not fed: raise SystemExit
        ids['fed'] = fed['id']
        check(fed.get('seguimiento_estado') == 'nueva' and not fed.get('descarga_estado'), 'empieza sin seguimiento ni descarga')
        # 1) Primera visita al detalle (sin archivos)
        abrir_detalle(page, fed['id'])
        t = page.inner_text('#cvDet')
        check('Todavía no se han bajado documentos' in t and 'Descargar documentos' in t, 'el detalle dice que no hay documentos y ofrece «Descargar documentos»')
        check((fed.get('descripcion') or '')[:30] in t, 'el detalle muestra la descripción completa')
        cerrar_modal(page)
        # 2) «Me interesa» → baja SÓLO esta convocatoria
        page.click(f'tr[data-cv="{fed["id"]}"] button:has-text("Me interesa")')
        page.wait_for_selector('section[aria-label="Descarga de documentos"]', timeout=20000)
        page.wait_for_function("()=>Convocatorias.descarga&&Convocatorias.descarga.items.some(x=>x.estado==='bajando'||x.estado==='listo')", timeout=180000)
        prog = page.inner_text('section[aria-label="Descarga de documentos"]')
        check('bajando' in prog and page.query_selector('section[aria-label="Descarga de documentos"] [role=progressbar]') is not None, 'avance visible por archivo mientras baja')
        snap(page, 'docs-1440-bajando.png')
        r = esperar_descarga(page)
        print('    fase:', r['fase']); [print('     ', x) for x in r['items']]
        listos = [x for x in r['items'] if x['estado'] == 'listo']
        check(len(listos) >= 1 and all(x['estado'] in ('listo', 'ya') for x in r['items']), f'los documentos de ESA convocatoria quedaron guardados ({len(listos)} de {len(r["items"])})')
        filas = sql(page, "const {data}=await sb.from('convocatoria_archivos').select('id,nombre,hash_sha256,archivo_path,tamano,origen_id,convocatoria_id');return data", None)
        check(len(filas) == len(listos) and all(f['convocatoria_id'] == fed['id'] for f in filas), f'sólo hay archivos de esta convocatoria en toda la empresa ({len(filas)})')
        check(len({f['hash_sha256'] for f in filas}) == len(filas) and all(f['archivo_path'].startswith(f'empresa/1/convocatorias/{fed["id"]}/') for f in filas), 'sin duplicados por hash y en empresa/<id>/convocatorias/<convocatoria>/')
        d = sql(page, "const {data}=await sb.from('convocatoria_descargas').select('estado,bajados,omitidos,motivo,total');return data", None)
        check(len(d) == 1 and d[0]['estado'] == 'lista' and d[0]['motivo'] == 'interesa' and d[0]['bajados'] == len(listos), f'la cola registra UNA descarga, motivo «interesa» ({d})')
        estado_con = page.evaluate("async()=>{try{return await (await fetch('http://127.0.0.1:8879/estado')).json()}catch(e){return null}}")
        check(estado_con and not estado_con['ocupado'], 'el conector cerró la sesión de anexos al terminar')
        # 3) Detalle con archivos «Nuevo», ver, ZIP, revisión, notas
        abrir_detalle(page, fed['id'])
        nuevos = page.eval_on_selector_all('#cvDet tbody tr', "rs=>rs.filter(r=>/Nuevo/.test(r.innerText)).length")
        check(nuevos == len(filas), f'«Nuevo» en los archivos llegados desde la visita anterior ({nuevos})')
        check('Documentos listos' in page.inner_text('#cvDet') and 'Buscar documentos nuevos' in page.inner_text('#cvDet'), 'estado de la descarga y «Buscar documentos nuevos»')
        with ctx.expect_page() as pop:
            page.click('#cvDet tbody tr:first-child button[title="Ver"]')
        p2 = pop.value
        try: p2.wait_for_url('**/storage/v1/object/sign/licitaciones/**', timeout=30000)
        except Exception: pass
        check('/storage/v1/object/sign/licitaciones/' in p2.url, f'ver abre una URL firmada del bucket ({p2.url[:80]})')
        p2.close()
        with page.expect_download(timeout=120000) as dl:
            page.click('button:has-text("Descargar todo (ZIP)")')
        z = zipfile.ZipFile(io.BytesIO(open(dl.value.path(), 'rb').read()))
        check(len(z.namelist()) == len(filas), f'«Descargar todo» trae los {len(filas)} archivos ({z.namelist()})')
        page.fill('#cvNota', 'QA-K: revisar fianza y experiencia en agua potable')
        page.click('button:has-text("Agregar nota")')
        page.wait_for_function("()=>/QA-K: revisar fianza/.test(document.getElementById('cvDet').innerText)", timeout=20000)
        check('Ricardo' in page.inner_text('#cvDet'), 'la nota muestra autor y fecha')
        with page.expect_download(timeout=120000) as dl:
            page.click('button:has-text("Preparar para revisión")')
        z = zipfile.ZipFile(io.BytesIO(open(dl.value.path(), 'rb').read()))
        nombres = z.namelist()
        cj = json.loads(z.read('convocatoria.json'))
        check('convocatoria.json' in nombres and all(n.lower().endswith('.pdf') for n in nombres if n != 'convocatoria.json'), f'«Preparar para revisión»: sólo PDF + convocatoria.json ({nombres})')
        check(cj['formato'] == 'convocatoria-revision/v1' and cj['convocatoria']['numero_procedimiento'] == args.federal and cj['notas'] and all(a['en_zip'] in nombres for a in cj['archivos']),
              'convocatoria.json con datos, archivos (con su nombre en el ZIP) y notas')
        snap(page, 'docs-1440-detalle.png')
        axe(page, '#mdlConvC', '1440 detalle')
        # 4) «Buscar documentos nuevos»: vuelve a revisar a petición, no duplica
        page.click('#cvDet button:has-text("Buscar documentos nuevos")')
        r2 = esperar_descarga(page)
        print('    nuevos:', r2['fase'])
        filas2 = sql(page, "const {data}=await sb.from('convocatoria_archivos').select('id');return data", None)
        check(len(filas2) == len(filas) and all(x['estado'] in ('ya',) for x in r2['items']), f'«Buscar documentos nuevos» no baja otra vez lo que ya está ({len(filas2)})')
        dd = sql(page, "const {data}=await sb.from('convocatoria_descargas').select('motivo,revisado_at');return data", None)
        check(dd[0]['motivo'] == 'nuevos' and dd[0]['revisado_at'], 'queda registrada la revisión a petición')
        cerrar_modal(page)
        # 5) Participar → archivos a la licitación sin volver a subirlos
        page.click(f'tr[data-cv="{fed["id"]}"] button:has-text("Participar")')
        page.wait_for_selector('#cvFormPart', timeout=15000)
        page.fill('#cvpCodigo', f'QA-K-{int(time.time())}')
        page.click('#cvpGuardar')
        page.wait_for_function("()=>typeof Licitaciones!=='undefined'&&Licitaciones.ficha&&Licitaciones.ficha.lic", timeout=30000)
        lic = page.evaluate("()=>Licitaciones.ficha.lic.id"); ids['lic'] = lic
        la = sql(page, "const {data}=await sb.from('licitacion_archivos').select('categoria,archivo_path,hash_sha256').eq('licitacion_id',a);return data", lic)
        rutas = {f['archivo_path'] for f in filas}
        check(len(la) == len(filas) and {x['archivo_path'] for x in la} == rutas, f'«Participar»: los {len(la)} archivos pasan a la licitación con la misma ruta (sin volver a subirlos)')
        print('    categorías:', sorted({x['categoria'] for x in la}))
        check('bases' in {x['categoria'] for x in la} and len({x['categoria'] for x in la}) > 1, 'cada uno con su categoría')
        n_obj = sql(page, "const r=await sb.storage.from('licitaciones').list(a,{limit:100});return (r.data||[]).length", f'empresa/1/convocatorias/{fed["id"]}')
        check(n_obj == len(filas), f'en el bucket siguen {len(filas)} objetos (no se duplicaron)')
        # 6) Chihuahua: «Descargar documentos» desde su detalle (función de borde)
        if not args.sin_estatal:
            ir_conv(page)
            est = buscar_en_lista(page, args.estatal)
            check(est is not None, f'la convocatoria estatal {args.estatal} está en la lista')
            if est:
                ids['est'] = est['id']
                abrir_detalle(page, est['id'])
                page.click('#cvDet button:has-text("Descargar documentos")')
                r3 = esperar_descarga(page)
                print('    chihuahua:', r3['fase']); [print('     ', x) for x in r3['items']]
                fe = sql(page, "const {data}=await sb.from('convocatoria_archivos').select('nombre,mime,tamano').eq('convocatoria_id',a);return data", est['id'])
                check(len(fe) >= 1 and all(x['estado'] in ('listo', 'ya') for x in r3['items']), f'Chihuahua: documentos públicos del detalle guardados ({[x["nombre"] for x in fe]})')
                page.wait_for_function("()=>document.querySelectorAll('#cvDet tbody tr').length>0", timeout=20000)
                snap(page, 'docs-1440-chihuahua.png')
                cerrar_modal(page)
    finally:
        ctx.close(); nav.close()

    # 390: el detalle con documentos
    nav, ctx, page = abrir(pw, 390, 844, '390')
    try:
        ir_conv(page)
        page.click('#cvFiltrosPanel > summary')
        fed = buscar_en_lista(page, args.federal)
        if fed:
            abrir_detalle(page, fed['id'])
            check(page.eval_on_selector_all('#cvDet tbody tr', 'r=>r.length') > 0, '390: el detalle lista los documentos')
            w = page.evaluate("()=>[document.documentElement.scrollWidth, window.innerWidth]")
            check(w[0] <= w[1] + 1, f'390: sin desborde horizontal ({w})')
            snap(page, 'docs-390-detalle.png')
            axe(page, '#mdlConvC', '390 detalle')
    finally:
        # Limpieza: todo lo de prueba (las convocatorias se quedan)
        try:
            cids = [x for x in (ids['fed'], ids['est']) if x]
            res = sql(page, """
              const out={};
              if(a.lic){ await sb.from('licitacion_archivos').delete().eq('licitacion_id',a.lic); const r=await sb.from('licitaciones').delete().eq('id',a.lic); out.lic=r.error?r.error.message:'ok'; }
              for(const c of a.cids){
                const {data}=await sb.from('convocatoria_archivos').select('archivo_path').eq('convocatoria_id',c);
                const paths=(data||[]).map(x=>x.archivo_path);
                if(paths.length){ const r=await sb.storage.from('licitaciones').remove(paths); out['bucket_'+c]=r.error?r.error.message:paths.length; }
                await sb.from('convocatoria_archivos').delete().eq('convocatoria_id',c);
                await sb.from('convocatoria_descargas').delete().eq('convocatoria_id',c);
                await sb.from('convocatoria_notas').delete().eq('convocatoria_id',c);
                await sb.from('convocatoria_seguimiento').delete().eq('convocatoria_id',c);
              }
              return out;""", {'lic': ids['lic'], 'cids': cids})
            print('    limpieza:', res)
        except Exception as e:  # noqa: BLE001
            print('    limpieza falló:', e)
        ctx.close(); nav.close()
for e in errores: print('  ERROR', e)
print(f'\n{len(fallos)} fallas, {len(errores)} errores de consola')
print('IDS', json.dumps(ids))
sys.exit(1 if fallos or errores else 0)
