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
ESPERADOS = [0]   # respuestas 400/409 provocadas a propósito (RPC que deben fallar): no cuentan como error de consola
def check(cond, msg):
    if not cond: fallos.append(msg)
    print(('  ok  ' if cond else '  FALLA ') + msg)

LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&typeof NavShell==='object'&&document.querySelector('#nv .nvs')&&R._last!==undefined"

def abrir(pw, ancho, alto, tag):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768, accept_downloads=True)
    page = ctx.new_page()
    def on_console(m):
        if m.type != 'error' or 'ERR_CONNECTION' in m.text or 'Tailwind' in m.text: return
        if ESPERADOS[0] > 0 and ('status of 400' in m.text or 'status of 409' in m.text):
            ESPERADOS[0] -= 1; return
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
    ESPERADOS[0] += 1
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

TMP = tempfile.mkdtemp(prefix='lic-c-')
def pdf_falso(nombre, texto):
    """PDF mínimo válido para subir (el bucket valida el tipo por la extensión que manda el cliente)."""
    p = os.path.join(TMP, nombre)
    contenido = ('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n% ' + texto + '\ntrailer<</Root 1 0 R>>\n%%EOF\n').encode('utf-8')
    with open(p, 'wb') as f: f.write(contenido)
    return p

def abrir_ficha(page, lid, tab):
    page.evaluate("([id,t])=>Licitaciones.abrir(id,t)", [lid, tab])
    page.wait_for_function("id=>Licitaciones.ficha&&Licitaciones.ficha.lic.id===id&&document.getElementById('lcPanel')", arg=lid, timeout=15000)

def paso_815(page, tag, ancho):
    lid = lic_id(page, ancho)
    abrir_ficha(page, lid, 'archivos')
    a = pdf_falso(f'Bases {ancho}.pdf', f'bases {ancho}'); b = pdf_falso(f'Acta junta {ancho}.pdf', f'acta {ancho}')
    page.select_option('#lcArchCat', 'bases')
    page.set_input_files('#lcArchFiles', [a])
    page.click('#lcPanel form button[type=submit]')
    page.wait_for_function("()=>Licitaciones.ficha.archivos.length===1", timeout=20000)
    page.select_option('#lcArchCat', 'acta_junta')
    page.set_input_files('#lcArchFiles', [b, a])   # el segundo ya está: debe avisar y no subirlo
    page.click('#lcPanel form button[type=submit]')
    page.wait_for_function("()=>Licitaciones.ficha.archivos.length===2", timeout=20000)
    page.wait_for_timeout(400)
    toasts = page.inner_text('#toastContainer') if page.locator('#toastContainer').count() else ''
    check('ya está en esta licitación' in toasts, f'{tag} 815: avisa del archivo repetido (SHA-256)')
    filas = sql(page, f"const {{data}}=await sb.from('licitacion_archivos').select('categoria,hash_sha256,archivo_path,tamano').eq('licitacion_id',{lid});return data;")
    with open(a, 'rb') as f: h = hashlib.sha256(f.read()).hexdigest()
    check(len(filas) == 2 and any(x['hash_sha256'] == h for x in filas), f'{tag} 815: dos filas con hash SHA-256 correcto')
    check(all(x['archivo_path'].startswith(f"empresa/") and f'/licitaciones/{lid}/' in x['archivo_path'] for x in filas), f'{tag} 815: ruta empresa/<id>/licitaciones/<lic>/<categoria>/…')
    txt = page.inner_text('#lcPanel')
    check('Bases' in txt and 'Acta de junta' in txt and 'Descargar todo' in txt, f'{tag} 815: lista por categoría con tamaño y fecha')
    # ver: la URL firmada responde
    st = page.evaluate("async()=>{const a=Licitaciones.ficha.archivos[0];const {data}=await sb.storage.from('licitaciones').createSignedUrl(a.archivo_path,60);return (await fetch(data.signedUrl)).status;}")
    check(st == 200, f'{tag} 815: ver con URL firmada ({st})')
    with page.expect_popup() as pop:
        page.locator('#lcPanel button[aria-label^="Ver "]').first.click()
    pop.value.close()
    with page.expect_download(timeout=30000) as dl:
        page.click('#lcPanel button:has-text("Descargar todo")')
    ruta_zip = os.path.join(TMP, f'todo_{ancho}.zip'); dl.value.save_as(ruta_zip)
    import zipfile
    nombres = zipfile.ZipFile(ruta_zip).namelist()
    check(any(n.startswith('Bases/') for n in nombres) and any(n.startswith('Acta_de_junta/') for n in nombres), f'{tag} 815: ZIP por categoría {nombres}')
    snap(page, f'815_archivos_{ancho}.png')
    axe(page, '#c', f'{tag} 815')
    page.locator('#lcPanel button[aria-label^="Borrar Acta"]').first.click()
    page.wait_for_selector('dialog.dlg[open]', timeout=5000)
    check('btn-danger' in page.get_attribute('#dlgOk', 'class'), f'{tag} 815: borrar pide confirmación en tono peligro')
    page.click('#dlgOk')
    page.wait_for_function("()=>Licitaciones.ficha.archivos.length===1", timeout=15000)
    quedan = sql(page, f"const {{data}}=await sb.storage.from('licitaciones').list('empresa/'+currentUser.empresa_id+'/licitaciones/{lid}/acta_junta');return (data||[]).length;")
    check(quedan == 0, f'{tag} 815: borrar quita también el objeto del bucket')

def paso_816(page, tag, ancho):
    lid = lic_id(page, ancho)
    abrir_ficha(page, lid, 'requisitos')
    page.evaluate("()=>Licitaciones.verSobre('tecnico')")
    page.locator('#lcPanel button:has-text("Agregar requisito")').first.click()
    page.wait_for_selector('#lcFormReq')
    page.fill('#lcRqAnexo', 'AT-01'); page.fill('#lcRqDesc', 'Designación del superintendente'); page.select_option('#lcRqOrigen', 'se_genera')
    page.fill('#lcRqResp', 'Ricardo'); page.check('#lcRqFirma')
    page.click('#lcFormReq button[type=submit]')
    page.wait_for_function("()=>Licitaciones.ficha.reqs.some(r=>r.anexo_id==='AT-01')", timeout=10000)
    for an, d in [('AT-02', 'Conocimiento del sitio'), ('AT-03', 'Conocimiento de las bases')]:
        sql(page, f"await sb.rpc('guardar_requisito',{{p_datos:{{licitacion_id:{lid},anexo_id:'{an}',sobre:'tecnico',descripcion:'{d}'}}}});")
    sql(page, f"await sb.rpc('guardar_requisito',{{p_datos:{{licitacion_id:{lid},anexo_id:'6.2',sobre:'legal',descripcion:'Escrito de facultades'}}}});")
    abrir_ficha(page, lid, 'requisitos')
    page.evaluate("()=>Licitaciones.verSobre('tecnico')")
    orden0 = page.eval_on_selector_all('#lcPanel tbody tr td[data-et=Anexo]', 'els=>els.map(e=>e.textContent.trim())')
    check(orden0 == ['AT-01', 'AT-02', 'AT-03'], f'{tag} 816: sobre técnico con sus requisitos en orden {orden0}')
    check(page.locator('#lcPanel [role=tablist] [role=tab]').count() == 3, f'{tag} 816: tres pestañas de sobre')
    page.locator('#lcPanel button[aria-label="Subir AT-03"]').click()
    page.wait_for_timeout(1200)
    orden_bd = sql(page, f"const {{data}}=await sb.from('licitacion_requisitos').select('anexo_id').eq('licitacion_id',{lid}).eq('sobre','tecnico').order('orden');return data.map(x=>x.anexo_id);")
    check(orden_bd == ['AT-01', 'AT-03', 'AT-02'], f'{tag} 816: orden editable y guardado {orden_bd}')
    # estado con nota e historial
    page.locator('#lcPanel button[aria-label^="Cambiar estado de AT-01"]').click()
    page.wait_for_selector('#lcFormEst')
    page.wait_for_function("()=>!document.getElementById('lcEstHist').hasAttribute('aria-busy')", timeout=10000)
    check(page.locator('#lcFormEst input[name=lcEst]').count() == 7, f'{tag} 816: los 7 estados de LicitaGen')
    page.locator('#lcFormEst label:has-text("En revisión")').click()
    page.fill('#lcEstNota', 'Falta la cédula')
    if ancho < 560:
        alto = page.evaluate("()=>document.querySelector('#lcFormEst .seg-btn').getBoundingClientRect().height")
        check(alto >= 44, f'{tag} 816: opción de estado táctil ({alto} px)')
        snap(page, f'816_estado_{ancho}.png')
    page.click('#lcFormEst button[type=submit]')
    page.wait_for_function("()=>Licitaciones.ficha.reqs.find(r=>r.anexo_id==='AT-01').estado==='en_revision'", timeout=10000)
    page.locator('#lcPanel button[aria-label^="Cambiar estado de AT-01"]').click()
    page.wait_for_function("()=>document.getElementById('lcEstHist')&&!document.getElementById('lcEstHist').hasAttribute('aria-busy')", timeout=10000)
    hist = page.inner_text('#lcEstHist')
    check('Falta la cédula' in hist and 'Pendiente → En revisión' in hist, f'{tag} 816: historial visible con la nota')
    axe(page, '#mdlLic', f'{tag} 816 modal estado')
    page.evaluate("()=>Licitaciones.cerrarModal()")
    # editar
    page.locator('#lcPanel button[aria-label="Editar AT-02"]').click()
    page.wait_for_selector('#lcFormReq'); page.fill('#lcRqDesc', 'Conocimiento del sitio y condiciones'); page.select_option('#lcRqOrigen', 'expediente')
    check(page.is_visible('#lcRqCat'), f'{tag} 816: con origen expediente se pide la categoría')
    page.select_option('#lcRqCat', 'curriculum')
    page.click('#lcFormReq button[type=submit]')
    page.wait_for_function("()=>Licitaciones.ficha.reqs.find(r=>r.anexo_id==='AT-02').categoria_expediente==='curriculum'", timeout=10000)
    # archivo final
    f = pdf_falso(f'AT-01 firmado {ancho}.pdf', f'firmado {ancho}')
    with page.expect_file_chooser() as fc:
        page.locator('#lcPanel button[aria-label="Adjuntar archivo final de AT-01"]').click()
    fc.value.set_files(f)
    page.wait_for_function("()=>!!Licitaciones.ficha.reqs.find(r=>r.anexo_id==='AT-01').archivo_path", timeout=20000)
    ruta = page.evaluate("()=>Licitaciones.ficha.reqs.find(r=>r.anexo_id==='AT-01').archivo_path")
    check(f'/licitaciones/{lid}/requisitos/' in ruta, f'{tag} 816: archivo final en …/requisitos/')
    check(page.locator('#lcPanel button[aria-label="Ver archivo final de AT-01"]').count() == 1, f'{tag} 816: botón para ver el archivo final')
    ovf = page.evaluate("()=>document.documentElement.scrollWidth-document.documentElement.clientWidth")
    check(ovf <= 0, f'{tag} 816: sin desborde horizontal ({ovf})')
    snap(page, f'816_requisitos_{ancho}.png')
    axe(page, '#c', f'{tag} 816')
    # el resumen refleja el avance
    page.evaluate("()=>Licitaciones.tabFicha('resumen')")
    check('0 de 3' in page.inner_text('#lcPanel'), f'{tag} 816: barra de avance por sobre en el resumen')

def paso_817(page, tag, ancho):
    perfil = sql(page, "const {data}=await sb.from('perfiles_convocante').select('id,empresa_id,es_fabrica,requisitos_json').eq('nombre','Municipio de Cuauhtémoc').single();return data;")
    check(perfil and perfil['empresa_id'] is None and perfil['es_fabrica'] and len(perfil['requisitos_json']) == 55, f'{tag} 817: perfil de fábrica Municipio de Cuauhtémoc (55, empresa NULL)')
    ich = sql(page, "const {data}=await sb.from('perfiles_convocante').select('requisitos_json,naming_pattern').eq('nombre','ICHIFE (Chihuahua)').single();return data;")
    check(ich and len(ich['requisitos_json']) == 45 and ich['naming_pattern'] == '{NN}_Anexo_{XX}.pdf', f'{tag} 817: perfil de fábrica ICHIFE (45, naming de licitagen)')
    cod = f'QA-C-{ancho}-3'
    lid = sql(page, f"const r=await sb.rpc('guardar_licitacion',{{p_datos:{{codigo:'{cod}',nombre:'Con perfil',convocante:'Municipio de Cuauhtémoc',perfil_id:{perfil['id']}}}}});return r.data.id;")
    sql(page, f"await sb.rpc('guardar_requisito',{{p_datos:{{licitacion_id:{lid},anexo_id:'7.1',sobre:'tecnico',descripcion:'Recibo de bases (editado a mano)'}}}});")
    abrir_ficha(page, lid, 'requisitos')
    page.locator('#lcPanel button:has-text("Generar requisitos del perfil")').click()
    page.wait_for_selector('#lcFormGen')
    check('54 se agregarían' in page.inner_text('#lcGenRes'), f'{tag} 817: el modal anticipa cuántos faltan')
    page.click('#lcFormGen button[type=submit]')
    page.wait_for_function("()=>Licitaciones.ficha.reqs.length===55", timeout=20000)
    d71 = page.evaluate("()=>Licitaciones.ficha.reqs.find(r=>r.anexo_id==='7.1').descripcion")
    check(d71 == 'Recibo de bases (editado a mano)', f'{tag} 817: no pisa lo ya editado')
    r2 = sql(page, f"const r=await sb.rpc('generar_requisitos_perfil',{{p_licitacion_id:{lid}}});return r.data;")
    check(r2['insertados'] == 0 and r2['ya_estaban'] == 55, f'{tag} 817: idempotente ({r2})')
    orden_tec = sql(page, f"const {{data}}=await sb.from('licitacion_requisitos').select('anexo_id,orden').eq('licitacion_id',{lid}).eq('sobre','tecnico').order('orden').limit(3);return data.map(x=>x.anexo_id);")
    check(orden_tec[0] == '7.1' and orden_tec[1] == '7.2', f'{tag} 817: el orden del perfil continúa después de lo capturado {orden_tec}')
    snap(page, f'817_generados_{ancho}.png')
    # guardar como perfil
    page.locator('#lcPanel button:has-text("Guardar como perfil")').click()
    page.wait_for_selector('#lcFormGp'); page.fill('#lcGpNombre', f'QA-C-perfil-{ancho}')
    page.click('#lcFormGp button[type=submit]')
    page.wait_for_timeout(1500)
    pf = sql(page, f"const {{data}}=await sb.from('perfiles_convocante').select('id,empresa_id,requisitos_json,naming_pattern').eq('nombre','QA-C-perfil-{ancho}').maybeSingle();return data;")
    check(pf and pf['empresa_id'] and len(pf['requisitos_json']) == 55 and pf['naming_pattern'] == '{NN}_{anexo}_{descripcion}.pdf', f'{tag} 817: «Guardar como perfil» crea el perfil de la empresa con su lista')
    # editor en Configuración (nivel 100)
    page.evaluate("()=>irAModulo('z')")
    page.wait_for_function("()=>document.querySelector('#cfgPerfilesLic #cfgPerfLista')&&!document.querySelector('#cfgPerfLista').hasAttribute('aria-busy')", timeout=20000)
    txt = page.inner_text('#cfgPerfilesLic')
    check('ICHIFE (Chihuahua)' in txt and 'De fábrica' in txt and f'QA-C-perfil-{ancho}' in txt, f'{tag} 817: editor de perfiles en Configuración')
    page.locator(f'#cfgPerfilesLic li:has-text("QA-C-perfil-{ancho}") button:has-text("Editar")').click()
    page.wait_for_selector('#lcFormPf')
    page.click('#lcFormPf button:has-text("Agregar renglón")')
    page.locator('#lcPfFilas tr:last-child [data-k=anexo_id]').fill('QA-99')
    page.locator('#lcPfFilas tr:last-child [data-k=descripcion]').fill('Renglón de prueba')
    page.click('#lcFormPf button[type=submit]')
    page.wait_for_timeout(1500)
    n = sql(page, f"const {{data}}=await sb.from('perfiles_convocante').select('requisitos_json').eq('nombre','QA-C-perfil-{ancho}').single();return data.requisitos_json.length;")
    check(n == 56, f'{tag} 817: el editor guarda la lista ({n})')
    page.locator('#cfgPerfilesLic li:has-text("ICHIFE") button:has-text("Ver")').click()
    page.wait_for_selector('#lcFormPf')
    check(page.locator('#lcPfNombre').is_disabled(), f'{tag} 817: el perfil de fábrica es de sólo lectura')
    axe(page, '#mdlLic', f'{tag} 817 editor')
    page.evaluate("()=>Licitaciones.cerrarModal()")
    ro = sql(page, f"const r=await sb.from('perfiles_convocante').update({{nombre:'x'}}).eq('id',{perfil['id']}).select();return (r.data||[]).length;")
    check(ro == 0, f'{tag} 817: la RLS no deja editar un perfil de fábrica')

def paso_818(page, tag, ancho):
    perfil = sql(page, "const {data}=await sb.from('perfiles_convocante').select('id').eq('nombre','Municipio de Cuauhtémoc').single();return data.id;")
    lid = sql(page, f"const r=await sb.rpc('guardar_licitacion',{{p_datos:{{codigo:'QA-C-{ancho}-4',nombre:'Expediente',perfil_id:{perfil},presentacion:'2026-11-20T13:30:00-06:00'}}}});return r.data.id;")
    sql(page, f"await sb.rpc('generar_requisitos_perfil',{{p_licitacion_id:{lid}}});")
    docs = sql(page, """
      const ins=async(o)=>{const {data,error}=await sb.from('empresa_documentos').insert(o).select('id').single();if(error)throw error;return data.id;};
      return {sat:await ins({categoria:'opinion_sat',nombre:'QA-C-opinión SAT',fecha_emision:'2026-10-01',fecha_vencimiento:'2026-12-31'}),
              imss:await ins({categoria:'opinion_imss',nombre:'QA-C-opinión IMSS',fecha_emision:'2026-10-01',fecha_vencimiento:'2026-11-10'}),
              acta:await ins({categoria:'acta_constitutiva',nombre:'QA-C-acta constitutiva',fecha_emision:'2025-02-13'})};
    """)
    abrir_ficha(page, lid, 'requisitos')
    page.evaluate("()=>Licitaciones.verSobre('tecnico')")
    page.locator('#lcPanel button:has-text("Llenar desde el expediente")').click()
    page.wait_for_function("()=>Licitaciones.ficha.reqs.find(r=>r.anexo_id==='7.20').empresa_documento_id", timeout=15000)
    lig = page.evaluate("()=>Object.fromEntries(Licitaciones.ficha.reqs.filter(r=>['7.20','7.21','7.22'].includes(r.anexo_id)).map(r=>[r.anexo_id,r.empresa_documento_id]))")
    check(lig == {'7.20': docs['sat'], '7.21': docs['imss'], '7.22': docs['acta']}, f'{tag} 818: «Llenar desde el expediente» liga en lote por categoría {lig}')
    page.evaluate("()=>Licitaciones.verSobre('tecnico')")
    rid = page.evaluate("()=>Licitaciones.ficha.reqs.find(r=>r.anexo_id==='7.21').id")
    cls = page.get_attribute(f'#lcReq-{rid}', 'class') or ''
    check('lc-fila-vence' in cls and 'antes de la presentación' in page.inner_text(f'#lcReq-{rid}'), f'{tag} 818: el requisito con documento que vence antes se marca en rojo')
    snap(page, f'818_vence_{ancho}.png')
    page.locator('#lcPanel button[aria-label^="Cambiar estado de 7.21"]').click()
    page.wait_for_selector('#lcFormEst')
    check(page.locator('#lcFormEst input[value=listo]').is_disabled() and page.locator('#lcFormEst [role=alert]').count() == 1, f'{tag} 818: «Listo» deshabilitado con aviso')
    page.evaluate("()=>Licitaciones.cerrarModal()")
    ESPERADOS[0] += 1
    msg = sql(page, f"const r=await sb.rpc('cambiar_estado_requisito',{{p_id:{rid},p_estado:'listo'}});return r.error&&r.error.message;")
    check(msg and 'vence el 10/11/2026' in msg, f'{tag} 818: el servidor tampoco deja pasar a «Listo» ({msg})')
    # editar: ofrece los documentos vigentes de la categoría
    page.locator('#lcPanel button[aria-label="Editar 7.20"]').click()
    page.wait_for_selector('#lcRqDoc')
    opts = page.eval_on_selector_all('#lcRqDoc option', 'els=>els.map(e=>e.textContent)')
    check(any('QA-C-opinión SAT' in o for o in opts) and not any('IMSS' in o for o in opts), f'{tag} 818: el modal ofrece los documentos vigentes de la categoría')
    axe(page, '#mdlLic', f'{tag} 818 modal')
    page.evaluate("()=>Licitaciones.cerrarModal()")
    # renovar el IMSS: el requisito apunta a la versión nueva
    nuevo = sql(page, f"const {{data,error}}=await sb.from('empresa_documentos').insert({{categoria:'opinion_imss',nombre:'QA-C-opinión IMSS renovada',fecha_emision:'2026-11-05',fecha_vencimiento:'2027-01-31',reemplaza_id:{docs['imss']}}}).select('id').single();if(error)throw error;return data.id;")
    ahora = sql(page, f"const {{data}}=await sb.from('licitacion_requisitos').select('empresa_documento_id').eq('id',{rid}).single();return data.empresa_documento_id;")
    check(ahora == nuevo, f'{tag} 818: al renovar, el requisito apunta a la versión nueva ({ahora} = {nuevo})')
    abrir_ficha(page, lid, 'requisitos')
    page.evaluate("()=>Licitaciones.verSobre('tecnico')")
    check('lc-fila-vence' not in (page.get_attribute(f'#lcReq-{rid}', 'class') or ''), f'{tag} 818: ya no se marca en rojo')
    ok = sql(page, f"const r=await sb.rpc('cambiar_estado_requisito',{{p_id:{rid},p_estado:'listo'}});return !r.error;")
    check(ok, f'{tag} 818: ahora sí puede pasar a «Listo»')

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
def paso_819(page, tag, ancho):
    lid = sql(page, f"const r=await sb.rpc('guardar_licitacion',{{p_datos:{{codigo:'QA-C-{ancho}-5',nombre:'Importar bases',bases:{{concurso:{{objeto:'Objeto capturado a mano'}}}}}}}});return r.data.id;")
    sql(page, f"await sb.rpc('guardar_requisito',{{p_datos:{{licitacion_id:{lid},anexo_id:'L-1',sobre:'legal',descripcion:'Editado a mano'}}}});")
    ejemplo = json.load(open(os.path.join(RAIZ, 'docs', 'licitaciones', 'ejemplo-licitacion-bases.json'), encoding='utf-8'))
    malo = json.loads(json.dumps(ejemplo)); malo['economicos']['anticipo_pct'] = 130; malo['fechas']['fallo'] = '12 de mayo'
    pm = os.path.join(TMP, 'malo.json'); json.dump(malo, open(pm, 'w', encoding='utf-8'), ensure_ascii=False)
    pb = os.path.join(TMP, 'bueno.json'); json.dump(ejemplo, open(pb, 'w', encoding='utf-8'), ensure_ascii=False)
    abrir_ficha(page, lid, 'bases')
    page.click('#lcPanel button:has-text("Importar bases")')
    page.wait_for_selector('#lcImpFile')
    page.set_input_files('#lcImpFile', pm)
    page.wait_for_selector('#lcImpErr li', timeout=5000)
    err = page.inner_text('#lcImpErr')
    check('anticipo_pct' in err and 'menor o igual a 100' in err and 'fechas.fallo' in err, f'{tag} 819: valida contra el esquema y muestra los errores en español')
    page.set_input_files('#lcImpFile', pb)
    page.wait_for_selector('#mdlLic table caption', timeout=5000)
    txt = page.inner_text('#mdlLic')
    check('Objeto capturado a mano' in txt and 'actual' in txt.lower() and 'propuesto' in txt.lower(), f'{tag} 819: revisión campo por campo (actual contra propuesto)')
    check('Agregar 3 requisitos nuevos' in txt and '1 anexo ya está' in txt, f'{tag} 819: los requisitos ya editados no se pisan')
    antes = sql(page, f"const {{data}}=await sb.from('licitaciones').select('anticipo_pct').eq('id',{lid}).single();return data.anticipo_pct;")
    check(antes is None, f'{tag} 819: nada se guarda antes de «Aplicar»')
    snap(page, f'819_revision_{ancho}.png')
    axe(page, '#mdlLic', f'{tag} 819 revisión')
    # desmarcar el objeto para conservar lo capturado
    fila = page.locator('#mdlLic tbody tr:has-text("Objeto")')
    fila.locator('input[type=checkbox]').uncheck()
    page.click('#mdlLic button:has-text("Aplicar")')
    page.wait_for_function("()=>Licitaciones.ficha.reqs.length===4", timeout=15000)
    d = sql(page, f"const {{data}}=await sb.from('licitaciones').select('anticipo_pct,fallo,modalidad,bases').eq('id',{lid}).single();return data;")
    check(d['anticipo_pct'] == 30 and d['fallo'].startswith('2026-05-12T18:00') and d['modalidad'] == 'licitacion_publica', f'{tag} 819: «Aplicar» guarda los datos marcados')
    check(d['bases']['concurso']['objeto'] == 'Objeto capturado a mano' and d['bases'].get('paginas', {}).get('fechas.fallo') == 3, f'{tag} 819: lo desmarcado se conserva y se guarda la página de origen')
    l1 = page.evaluate("()=>Licitaciones.ficha.reqs.find(r=>r.anexo_id==='L-1').descripcion")
    check(l1 == 'Editado a mano', f'{tag} 819: el requisito existente quedó igual')

PASO_FN = {'813': paso_813, '814': paso_814, '815': paso_815, '816': paso_816, '817': paso_817, '818': paso_818, '819': paso_819}

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
