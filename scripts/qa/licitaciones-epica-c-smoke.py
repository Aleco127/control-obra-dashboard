# -*- coding: utf-8 -*-
"""
licitaciones-epica-c-smoke.py (PRD licitaciones, épica C: US-813 a US-821), contra el build local (dist/).

Recorre en 1440 y 390 px lo que el usuario hace en el módulo `lc` y verifica cada criterio que se puede ver en el
navegador. Cada historia es una función `paso_*`; --pasos elige cuáles correr (por omisión, todas).
Crea datos de prueba con códigos `QA-C-*` y los BORRA al final (filas y objetos del bucket), aunque algo falle.
No cambia nav_prefs (navega con irAModulo); aun así las compara al final y las restaura si cambiaron.

Uso (OBRA_QA_TOKEN en el entorno; dist servido con node scripts/serve-dist.mjs dist 8772):
  PYTHONIOENCODING=utf-8 python scripts/qa/licitaciones-epica-c-smoke.py --app http://127.0.0.1:8772/index.html?app=1 --out docs/qa/licitaciones-c
"""
import argparse, json, os, sys, hashlib, tempfile
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8772/index.html?app=1')
ap.add_argument('--out', default='')
ap.add_argument('--pasos', default='')
args = ap.parse_args()
TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
if not TOKEN:
    print('Falta OBRA_QA_TOKEN en el entorno'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)
AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
PASOS = [p for p in args.pasos.split(',') if p]

errores, fallos = [], []
def check(cond, msg):
    if not cond: fallos.append(msg)
    print(('  ok  ' if cond else '  FALLA ') + msg)

LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&typeof NavShell==='object'&&document.querySelector('#nv .nvs')&&R._last!==undefined"

def abrir(pw, ancho, alto, tag):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768, accept_downloads=True)
    page = ctx.new_page()
    def on_console(m):
        if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text and 'status of 409' not in m.text:
            errores.append(f'{tag} console.error: {m.text}')
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

def ir_lc(page):
    page.evaluate("()=>{Licitaciones.estado.ficha=null;irAModulo('lc')}")
    page.wait_for_function("()=>document.getElementById('lcCuerpo')&&!document.getElementById('lcCuerpo').hasAttribute('aria-busy')", timeout=30000)

def sql(page, js):
    """Corre JS con el cliente de Supabase de la página (sesión de QA) y devuelve el resultado."""
    return page.evaluate("async c=>{const f=new Function('sb','return (async()=>{'+c+'})()');return await f(sb);}", js)

def limpiar(page):
    r = sql(page, """
      const {data:ls}=await sb.from('licitaciones').select('id').like('codigo','QA-C-%');
      const ids=(ls||[]).map(x=>x.id); let objs=0;
      for(const id of ids){
        const pref='empresa/'+currentUser.empresa_id+'/licitaciones/'+id;
        for(const sub of ['bases','anexo','acta_junta','plano','catalogo','circular','fallo','otro','requisitos']){
          const {data:fs}=await sb.storage.from('licitaciones').list(pref+'/'+sub,{limit:1000});
          const paths=(fs||[]).map(f=>pref+'/'+sub+'/'+f.name);
          if(paths.length){await sb.storage.from('licitaciones').remove(paths);objs+=paths.length;}
        }
      }
      if(ids.length)await sb.from('licitaciones').delete().in('id',ids);
      const {data:ps}=await sb.from('perfiles_convocante').select('id').like('nombre','QA-C-%');
      if(ps&&ps.length)await sb.from('perfiles_convocante').delete().in('id',ps.map(p=>p.id));
      const {data:ds}=await sb.from('empresa_documentos').select('id').like('nombre','QA-C-%');
      if(ds&&ds.length){await sb.from('empresa_documentos').update({reemplaza_id:null}).in('id',ds.map(d=>d.id));await sb.from('empresa_documentos').delete().in('id',ds.map(d=>d.id));}
      return {licitaciones:ids.length,objetos:objs,perfiles:(ps||[]).length,documentos:(ds||[]).length};
    """)
    print('  limpieza:', r)

# ---------------------------------------------------------------------------------------------------------------------
def paso_813(page, tag, ancho):
    ir_lc(page)
    check(page.locator('#c button:has-text("Nueva licitación")').count() >= 1, f'{tag} 813: botón «Nueva licitación»')
    page.locator('#c button:has-text("Nueva licitación")').first.click()
    page.wait_for_selector('#lcFormAlta', timeout=5000)
    check(page.locator('#lcPerfil option').count() >= 1, f'{tag} 813: alta con selector de perfil')
    cod = f'QA-C-{ancho}-1'
    page.fill('#lcCodigo', cod); page.fill('#lcNombre', 'Obra de prueba épica C'); page.fill('#lcConvocante', 'Municipio de Prueba')
    page.fill('#lcPresentacion', '2026-11-20T13:30')
    page.click('#lcFormAlta button[type=submit]')
    page.wait_for_function("c=>Licitaciones.ficha&&Licitaciones.ficha.lic.codigo===c", arg=cod, timeout=15000)
    check(page.evaluate("()=>Licitaciones.ficha.lic.presentacion").startswith('2026-11-20T19:30'), f'{tag} 813: presentación guardada en hora de México (13:30 → 19:30 UTC)')
    # una segunda, ganada el año pasado, para KPIs y filtros (por RPC)
    sql(page, f"await sb.rpc('guardar_licitacion',{{p_datos:{{codigo:'QA-C-{ancho}-2',nombre:'Ganada vieja',estatus:'ganada',presentacion:'2025-06-01T10:00:00-06:00',fallo:'2025-06-20T10:00:00-06:00'}}}});")
    page.evaluate("()=>Licitaciones.cargar(true)")
    ir_lc(page)
    txt = page.inner_text('#lcCuerpo')
    check('En preparación' in txt and 'Ganadas en el año' in txt and 'Éxito en el año' in txt and 'Presentadas' in txt, f'{tag} 813: KPIs visibles')
    check(cod in txt and 'Presentación' in txt and 'días' in txt, f'{tag} 813: fila con estatus, convocante, próxima fecha y días restantes')
    page.select_option('#lcFAnio', '2025')
    t2 = page.inner_text('#lcPanel')
    check(f'QA-C-{ancho}-2' in t2 and cod not in t2, f'{tag} 813: filtro por año')
    page.select_option('#lcFAnio', ''); page.select_option('#lcFEst', 'ganada')
    t3 = page.inner_text('#lcPanel')
    check(f'QA-C-{ancho}-2' in t3 and cod not in t3, f'{tag} 813: filtro por estatus')
    page.select_option('#lcFEst', '')
    if ancho < 560:
        disp = page.evaluate("()=>getComputedStyle(document.querySelector('.lc-tbl thead')).display")
        check(disp == 'none', f'{tag} 813: tabla apilada en móvil')
    ovf = page.evaluate("()=>document.documentElement.scrollWidth-document.documentElement.clientWidth")
    check(ovf <= 0, f'{tag} 813: sin desborde horizontal ({ovf})')
    snap(page, f'813_lista_{ancho}.png')
    axe(page, '#c', f'{tag} 813')
    # código duplicado: mensaje en español
    r = sql(page, f"const r=await sb.rpc('guardar_licitacion',{{p_datos:{{codigo:'{cod}',nombre:'x'}}}});return r.error&&r.error.message;")
    check(r and 'Ya existe otra licitación' in r, f'{tag} 813: RPC rechaza código duplicado con mensaje claro')

def lic_id(page, ancho, n=1):
    return sql(page, f"const {{data}}=await sb.from('licitaciones').select('id').eq('codigo','QA-C-{ancho}-{n}').maybeSingle();return data&&data.id;")

def paso_814(page, tag, ancho):
    lid = lic_id(page, ancho)
    page.evaluate("id=>Licitaciones.abrir(id)", lid)
    page.wait_for_selector('#lcPanel', timeout=15000)
    tabs = page.eval_on_selector_all('#c [role=tab]', 'els=>els.map(e=>e.textContent.trim())')
    check(tabs == ['Resumen', 'Bases', 'Archivos', 'Requisitos', 'Precios', 'Cierre'], f'{tag} 814: pestañas {tabs}')
    check(page.locator('#lcPanel').inner_text().find('Avance de requisitos por sobre') >= 0, f'{tag} 814: resumen con avance por sobre')
    page.evaluate("()=>Licitaciones.tabFicha('bases')")
    secciones = page.eval_on_selector_all('#lcPanel details summary', 'els=>els.map(e=>e.textContent.trim())')
    check(all(any(s in x for x in secciones) for s in ['Objeto', 'Plazo', 'Anticipo', 'Garantías', 'Fechas', 'Criterios de evaluación', 'Causas de desechamiento']), f'{tag} 814: secciones de Bases {secciones}')
    page.fill('#lcB-objeto-0', 'Construcción de prueba'); page.click('#lcPanel details:first-of-type button[type=submit]')
    page.wait_for_function("()=>Licitaciones.ficha.lic.bases.concurso&&Licitaciones.ficha.lic.bases.concurso.objeto==='Construcción de prueba'", timeout=10000)
    page.locator('#lcPanel summary:has-text("Garantías")').click()
    page.fill('#lcB-garantias-0', '5 % del monto sin IVA')
    page.locator('#lcPanel details:has(summary:has-text("Garantías")) button[type=submit]').click()
    page.wait_for_function("()=>(Licitaciones.ficha.lic.bases.economicos||{}).garantias&&Licitaciones.ficha.lic.bases.economicos.garantias.seriedad_propuesta", timeout=10000)
    page.locator('#lcPanel summary:has-text("Fechas")').click()
    page.fill('#lcB-fechas-1', '2026-11-05T10:00')
    page.locator('#lcPanel details:has(summary:has-text("Fechas")) button[type=submit]').click()
    page.wait_for_function("()=>Licitaciones.ficha.lic.visita", timeout=10000)
    page.locator('#lcPanel summary:has-text("Causas de desechamiento")').click()
    page.fill('#lcB-desechamiento-0', 'No presentar la garantía\nNo firmar las formas')
    page.locator('#lcPanel details:has(summary:has-text("Causas")) button[type=submit]').click()
    page.wait_for_function("()=>(Licitaciones.ficha.lic.bases.causas_desechamiento||[]).length===2", timeout=10000)
    guard = sql(page, f"const {{data}}=await sb.from('licitaciones').select('bases,visita').eq('id',{lid}).single();return data;")
    check(guard['bases'].get('concurso', {}).get('objeto') == 'Construcción de prueba' and guard['visita'].startswith('2026-11-05T16:00'), f'{tag} 814: Bases guardadas en la BD')
    snap(page, f'814_bases_{ancho}.png')
    axe(page, '#c', f'{tag} 814 bases')
    # Calendario: visita y presentación con tipo propio
    page.evaluate("()=>{delete D.licCal;calFilter.mes=10;calFilter.anio=2026;irAModulo('c')}")
    page.wait_for_function("()=>Array.isArray(D.licCal)&&D.licCal.length>0", timeout=20000)
    page.wait_for_timeout(500)
    txt = page.inner_text('#c')
    check('Visita de obra · QA-C' in txt and 'Presentación · QA-C' in txt, f'{tag} 814: visita y presentación en el Calendario')
    check(page.locator('#calTipoFilter option[value="Licitación"]').count() == 1, f'{tag} 814: tipo «Licitación» en el filtro del Calendario')
    page.select_option('#calTipoFilter', 'Licitación')
    page.wait_for_timeout(300)
    check('Presentación · QA-C' in page.inner_text('#c'), f'{tag} 814: filtro por tipo Licitación')
    ev = page.evaluate("()=>D.licCal.find(e=>e._lic&&e.titulo.startsWith('Presentación · QA-C'))")
    page.evaluate("id=>viewEvento(id)", ev['id'])
    page.wait_for_function("()=>M==='lc'&&document.getElementById('lcPanel')", timeout=15000)
    check(page.evaluate("()=>Licitaciones.ficha&&Licitaciones.ficha.lic.id") == ev['_lic'], f'{tag} 814: el evento abre la ficha de la licitación')
    page.evaluate("()=>{calFilter.tipo='';calFilter.mes=new Date().getMonth();calFilter.anio=new Date().getFullYear();}")

PASO_FN = {'813': paso_813, '814': paso_814}

def main():
    with sync_playwright() as pw:
        for ancho, alto in [(1440, 900), (390, 844)]:
            tag = f'[{ancho}]'
            print(f'== {tag}')
            ctx, page = abrir(pw, ancho, alto, tag)
            prefs0 = sql(page, "const {data}=await sb.from('obra_usuarios').select('nav_prefs').eq('id',currentUser.id).single();return data.nav_prefs;")
            try:
                limpiar(page)
                for k, fn in PASO_FN.items():
                    if PASOS and k not in PASOS: continue
                    try: fn(page, tag, ancho)
                    except Exception as e: check(False, f'{tag} {k}: excepción {e}')
            finally:
                limpiar(page)
                prefs1 = sql(page, "const {data}=await sb.from('obra_usuarios').select('nav_prefs').eq('id',currentUser.id).single();return data.nav_prefs;")
                if prefs1 != prefs0:
                    sql(page, f"await sb.rpc('guardar_nav_prefs',{{p_prefs:{json.dumps(prefs0)}}});")
                    print('  nav_prefs restauradas')
                ctx.close()
    check(not errores, f'cero errores de consola {errores[:5]}')
    print(f'\n{len(fallos)} fallas')
    sys.exit(1 if fallos else 0)

main()
