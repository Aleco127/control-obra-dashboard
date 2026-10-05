# -*- coding: utf-8 -*-
"""
licitacion-precios-smoke.py (PRD licitaciones, US-829 y US-833), contra el build local (dist/).

Crea una licitación de prueba «QA-H-…» (plaza Cd. Cuauhtémoc), recorre la pestaña Precios en 1440 y 390 px y la BORRA
al final con su lista (licitacion_precios cae en cascada), aunque algo falle. No toca insumos, precios ni conceptos
del banco ni cambia nav_prefs (navega con Licitaciones.abrir).

  US-829: buscar y agregar un insumo, importar el catálogo y agregar los insumos de sus matrices, ámbar por antigüedad
          u otra plaza, ajuste a mano y en lote (persisten), descarga del JSON opus-insumos/v1 y del Excel.
  US-833: el catálogo del concurso se empareja con conceptos_historicos (clave y descripción), muestra PU reciente,
          rango y costo de la matriz a precios vigentes, cuenta con antecedente / desde cero y exporta a Excel.

Uso (OBRA_QA_TOKEN en el entorno; dist servido con node scripts/serve-dist.mjs dist 8776):
  PYTHONIOENCODING=utf-8 python scripts/qa/licitacion-precios-smoke.py --catalogo <catálogo.xlsx> --out docs/qa/licitacion-precios --json <ruta del JSON para el bridge>
El catálogo de prueba real es el de BanRegio CR 152 (no va en el repo); sin él se arma uno con conceptos del banco.
"""
import argparse, json, os, sys, tempfile
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8776/index.html?app=1')
ap.add_argument('--catalogo', default='')
ap.add_argument('--out', default='')
ap.add_argument('--json', default='', help='dónde guardar el JSON opus-insumos/v1 descargado (para el dry run del bridge)')
ap.add_argument('--minimo', type=float, default=0.8, help='fracción mínima de conceptos con antecedente')
args = ap.parse_args()
TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
if not TOKEN:
    print('Falta OBRA_QA_TOKEN en el entorno'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)
AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
CODIGO = 'QA-H-PRECIOS-001'

errores, fallos = [], []
def check(cond, msg):
    if not cond: fallos.append(msg)
    print(('  ok  ' if cond else '  FALLA ') + msg)

LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&typeof NavShell==='object'&&document.querySelector('#nv .nvs')&&R._last!==undefined"

def abrir(pw, ancho, alto, tag):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768, accept_downloads=True)
    page = ctx.new_page()
    page.on('console', lambda m: errores.append(f'{tag} console.error: {m.text}') if m.type == 'error' and 'ERR_CONNECTION' not in m.text else None)
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

def js(page, code):
    return page.evaluate("async c=>{const f=new Function('sb','return (async()=>{'+c+'})()');return await f(sb);}", code)

def limpiar(page):
    return js(page, f"""
      const {{data:ls}}=await sb.from('licitaciones').select('id').like('codigo','QA-H-%');
      const ids=(ls||[]).map(x=>x.id);
      if(ids.length){{await sb.from('licitacion_precios').delete().in('licitacion_id',ids);await sb.from('licitaciones').delete().in('id',ids);}}
      return ids.length;""")

def abrir_precios(page, lic_id):
    page.evaluate("id=>Licitaciones.abrir(id,'precios')", lic_id)
    page.wait_for_function("()=>document.getElementById('lpCuerpo')&&LicitacionPrecios._estado()", timeout=60000)
    page.wait_for_timeout(300)

def descarga(page, accion):
    with page.expect_download(timeout=60000) as d:
        page.evaluate(accion)
    dl = d.value
    ruta = os.path.join(tempfile.gettempdir(), dl.suggested_filename)
    dl.save_as(ruta)
    return dl.suggested_filename, ruta

def catalogo_sintetico(page):
    """Sin el Excel real: arma un catálogo con 20 conceptos del banco (con PU) y 3 inventados, en formato OPUS."""
    filas = js(page, """
      const {data}=await sb.from('concepto_precios').select('concepto_id').order('id').limit(400);
      const ids=[...new Set((data||[]).map(x=>x.concepto_id))].slice(0,20);
      const {data:cs}=await sb.from('conceptos_historicos').select('clave,descripcion,unidad').in('id',ids);
      return cs;""")
    import openpyxl
    wb = openpyxl.Workbook(); ws = wb.active
    ws.append(['PROYECTO:', 'CATALOGO DE PRUEBA QA-H']); ws.append(['CLAVE', 'CONCEPTO', 'UNIDAD', 'CANT', 'P.U.', 'IMPORTE'])
    for i, c in enumerate(filas): ws.append([c['clave'] or f'QA-{i}', c['descripcion'], c['unidad'], 10, 0, 0])
    for i in range(3): ws.append([f'99-QAH-{i}', f'CONCEPTO INVENTADO SIN ANTECEDENTE NUMERO {i} XYZW', 'PZA', 1, 0, 0])
    ruta = os.path.join(tempfile.gettempdir(), 'catalogo-qa-h.xlsx'); wb.save(ruta)
    return ruta

with sync_playwright() as pw:
    ctx, page = abrir(pw, 1440, 900, '1440')
    lic_id = None
    try:
        limpiar(page)
        lic_id = js(page, f"""const {{data,error}}=await sb.rpc('guardar_licitacion',{{p_datos:{{codigo:'{CODIGO}',nombre:'QA-H Lista de precios (prueba, se borra)',plaza:'cuauhtemoc'}}}});
          if(error)throw error;return data.id;""")
        check(bool(lic_id), f'licitación de prueba creada ({lic_id})')
        abrir_precios(page, lic_id)
        check(page.locator('#lcTab-precios[aria-selected="true"]').count() == 1, 'pestaña Precios activa en la ficha')
        check('La lista de precios está vacía' in page.inner_text('#lpCuerpo'), 'estado vacío con buscar e importar')
        check(page.evaluate("typeof LicitacionPrecios==='object'&&typeof BancoPrecios==='object'"), 'módulos lcp y bp cargados bajo demanda')

        # US-829: buscar y agregar
        page.fill('#lpBuscar', 'cemento')
        page.wait_for_selector('#lpResultados li', timeout=20000)
        page.locator('#lpResultados li button:not([disabled])').first.click()
        page.wait_for_function("()=>LicitacionPrecios._estado().filas.length===1", timeout=20000)
        check(page.locator('#lpCuerpo tbody tr').count() == 1, 'buscar → Agregar deja un renglón con su precio vigente')
        f0 = page.evaluate("()=>LicitacionPrecios._estado().filas[0]")
        check(f0['precio_banco'] is not None and abs(float(f0['precio']) - round(float(f0['precio_banco']), 2)) < 0.005, f"propone el precio vigente del banco ({f0['precio_banco']}, {f0['fecha_banco']}, {f0['plaza_banco']})")

        # US-833 + US-829: catálogo del concurso
        cat = args.catalogo or catalogo_sintetico(page)
        page.set_input_files('#lpCatFile', cat)
        page.wait_for_function("()=>{const c=LicitacionPrecios._estado().cat;return c&&!c.cargando}", timeout=120000)
        c = page.evaluate("()=>{const c=LicitacionPrecios._estado().cat;return {error:c.error||null,resumen:c.resumen,insumos:Object.keys(c.insumos||{}).length,ejemplo:(c.filas||[]).find(f=>f.antecedente&&f.cd_vigente!==null)}}")
        check(not c['error'], f"catálogo analizado sin error {c['error'] or ''}")
        r = c['resumen'] or {}
        print(f"  catálogo: {r}")
        pct = (r.get('con_antecedente', 0) / r['total']) if r.get('total') else 0
        check(pct >= args.minimo, f"{r.get('con_antecedente')} de {r.get('total')} conceptos con antecedente ({pct:.0%}, mínimo {args.minimo:.0%})")
        txt = page.inner_text('#lpCuerpo')
        check('Con antecedente' in txt and 'Hay que analizar desde cero' in txt, 'indica cuántos tienen antecedente y cuántos van desde cero')
        e = c['ejemplo'] or {}
        check(bool(e) and e.get('pu_reciente') and e.get('pu_min') is not None and e.get('cd_vigente'), f"por concepto: PU reciente {e.get('pu_reciente')}, rango {e.get('pu_min')}–{e.get('pu_max')}, costo de la matriz hoy {e.get('cd_vigente')}")
        snap(page, 'catalogo-1440.png')
        axe(page, '#lcPanel', '1440 catálogo')
        nombre, ruta = descarga(page, "()=>LicitacionPrecios.exportarSugerencias()")
        check(nombre.startswith('PU_sugeridos_') and nombre.endswith('.xlsx') and os.path.getsize(ruta) > 2000, f'exporta las sugerencias a Excel ({nombre})')
        check(c['insumos'] > 10, f"el catálogo propone {c['insumos']} insumos de sus matrices")
        page.locator('button', has_text='a la lista').last.click()
        page.wait_for_function("()=>LicitacionPrecios._estado().vista==='insumos'&&LicitacionPrecios._estado().filas.length>1", timeout=60000)
        n = page.evaluate("()=>LicitacionPrecios._estado().filas.length")
        check(n >= c['insumos'], f'agregar del catálogo deja {n} insumos en la lista')
        amb = page.locator('#lpCuerpo tr.lp-ambar').count()
        check(amb > 0, f'{amb} renglones en ámbar (más de 180 días u otra plaza)')
        check(page.locator('#lpCuerpo .lp-inp-ambar').count() > 0, 'el precio en ámbar se distingue en el campo')
        snap(page, 'insumos-1440.png')

        # Ajuste a mano y en lote (persisten)
        fid = page.evaluate("()=>{const f=LicitacionPrecios._estado().filas.find(x=>x.precio_banco>0&&!/\\(%\\)/.test((LicitacionPrecios._estado().info[x.insumo_id]||{}).unidad||''));return f.id}")
        page.evaluate("id=>LicitacionPrecios.cambiarPrecio(id,'1234.5')", fid)
        page.wait_for_timeout(1500)
        g = js(page, f"const {{data}}=await sb.from('licitacion_precios').select('precio,manual').eq('id',{fid}).single();return data;")
        check(abs(float(g['precio']) - 1234.5) < 0.001 and g['manual'] is True, 'el ajuste a mano se guarda (precio y marca «a mano»)')
        page.fill('#lpPct', '5')
        page.click('button:has-text("Aplicar el porcentaje")')
        page.wait_for_selector('#dlgOk', state='visible', timeout=10000)
        page.click('#dlgOk')
        page.wait_for_function("()=>LicitacionPrecios._estado().filas.every(f=>f.ajuste_pct!==null||/\\(%\\)/.test((LicitacionPrecios._estado().info[f.insumo_id]||{}).unidad||''))", timeout=120000)
        mal = js(page, f"""const {{data}}=await sb.from('licitacion_precios').select('precio,precio_banco,ajuste_pct').eq('licitacion_id',{lic_id});
          return (data||[]).filter(f=>f.ajuste_pct!==null&&Math.abs(Number(f.precio)-Math.round((Number(f.precio_banco??f.precio)*1.05+Number.EPSILON)*100)/100)>0.011&&f.precio_banco!==null).length;""")
        check(mal == 0, 'el ajuste en lote de 5 % se guarda sobre el precio del banco en todos los renglones')

        # Descargas
        nombre, ruta = descarga(page, "()=>LicitacionPrecios.descargarOpus()")
        doc = json.load(open(ruta, encoding='utf-8'))
        check(nombre.startswith('opus-insumos_') and doc.get('formato') == 'opus-insumos/v1' and len(doc.get('recursos', [])) > 10, f"descarga el JSON opus-insumos/v1 ({len(doc.get('recursos', []))} recursos)")
        val = page.evaluate("d=>BancoPrecios.validarOpusInsumos(d)", doc)
        check(val == [], f'el JSON pasa el validador del banco {val}')
        tipos = sorted({x['tipo'] for x in doc['recursos']})
        check(set(tipos) <= {'material', 'mano_obra', 'herramienta', 'equipo', 'flete'}, f'tipos del bridge: {tipos}')
        mo = [x for x in doc['recursos'] if x['tipo'] == 'mano_obra' and x.get('mano_obra')]
        check(all(abs(round(x['mano_obra']['salario_base'] * x['mano_obra']['fsr'], 2) - x['precio']) < 0.011 for x in mo), f'{len(mo)} de mano de obra con SB × FSR = precio')
        if args.json:
            os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
            json.dump(doc, open(args.json, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        nombre, ruta = descarga(page, "()=>LicitacionPrecios.descargarExcel()")
        check(nombre.startswith('Precios_') and os.path.getsize(ruta) > 2000, f'descarga el Excel legible ({nombre})')
        axe(page, '#lcPanel', '1440 insumos')

        # La lista se guarda con la licitación
        antes = page.evaluate("()=>LicitacionPrecios._estado().filas.length")
        page.evaluate("()=>Licitaciones.volver()")
        page.wait_for_timeout(500)
        page.evaluate("()=>{LicitacionPrecios._estado().lic={id:-1}}")   # fuerza a releer de la BD
        abrir_precios(page, lic_id)
        page.wait_for_function("()=>LicitacionPrecios._estado().filas.length>0", timeout=30000)
        check(page.evaluate("()=>LicitacionPrecios._estado().filas.length") == antes, f'al volver a abrir la licitación la lista sigue ({antes} renglones)')
        ctx.close()

        ctx, page = abrir(pw, 390, 844, '390')
        abrir_precios(page, lic_id)
        page.wait_for_function("()=>LicitacionPrecios._estado().filas.length>0", timeout=30000)
        ov = page.evaluate("()=>document.documentElement.scrollWidth-document.documentElement.clientWidth")
        check(ov <= 1, f'390 px sin desborde horizontal ({ov})')
        check(page.evaluate("()=>getComputedStyle(document.querySelector('#lpCuerpo thead')).display")=='none', 'tabla apilada en < 560 px')
        snap(page, 'insumos-390.png')
        axe(page, '#lcPanel', '390 insumos')
        page.evaluate("()=>LicitacionPrecios.verVista('catalogo')")
        page.wait_for_timeout(300)
        axe(page, '#lcPanel', '390 catálogo (vacío)')
    finally:
        n = limpiar(page)
        quedan = js(page, f"const {{count}}=await sb.from('licitacion_precios').select('id',{{count:'exact',head:true}}).eq('licitacion_id',{lic_id or -1});return count;")
        check(n >= 1 and quedan == 0, f'limpieza: {n} licitación de prueba borrada, {quedan} renglones de precios restantes')
        ctx.close()

for e in errores: print('  ERROR', e)
print(f"\n{len(fallos)} fallas, {len(errores)} errores de consola")
sys.exit(1 if fallos or errores else 0)
