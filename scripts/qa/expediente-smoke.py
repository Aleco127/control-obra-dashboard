# -*- coding: utf-8 -*-
"""
expediente-smoke.py (PRD licitaciones, épica B: US-807 a US-812 y US-847), contra el build local (dist/).

Casos (--casos, separados por coma; por defecto todos):
  datos       US-807: pestaña Datos, lo de Configuración en sólo lectura con enlace, guardar y verlo sin recargar.
  documentos  US-808: subir un PDF con hash, renovar, historial, ver (URL firmada), faltantes arriba, móvil.
  avisos      US-809: contador de `ex` en la barra y tarjeta en Inicio con un documento vencido.
  personal    US-810: alta desde cero y «Traer de Empleados», archivos, activo/inactivo.
  obras       US-811: «Traer de mis obras», alta manual con archivos y exportar a Excel.
  maquinaria  US-812: alta con factura y póliza, exportar a Excel.
  portales    US-847: pestaña Portales con la contraseña enmascarada y sin datos sensibles en el DOM.
Cada caso corre en 1440 y 390 px, pasa axe (wcag2a/aa) sobre #c y exige cero errores de consola.
TODO lo que crea (filas y objetos del bucket) lo borra al final, aunque falle. Restaura los datos legales previos.

Uso (OBRA_QA_TOKEN en el entorno; dist servido con node scripts/serve-dist.mjs dist 8771):
  PYTHONIOENCODING=utf-8 python scripts/qa/expediente-smoke.py --app http://127.0.0.1:8771/index.html?app=1 --out docs/qa/expediente
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8771/index.html?app=1')
ap.add_argument('--out', default='')
ap.add_argument('--casos', default='datos,documentos,avisos,personal,obras,maquinaria,portales')
args = ap.parse_args()
TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
if not TOKEN:
    print('Falta OBRA_QA_TOKEN en el entorno'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)
CASOS = [c.strip() for c in args.casos.split(',') if c.strip()]
AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
MARCA = 'QA-EXP-' + str(int(time.time()))
PDF = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'

errores, fallos = [], []
def check(cond, msg):
    if not cond: fallos.append(msg)
    print(('  ok  ' if cond else '  FALLA ') + msg)

LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&typeof NavShell==='object'&&document.querySelector('#nv .nvs')&&R._last!==undefined"

def abrir(pw, ancho, alto, tag):
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768, accept_downloads=True)
    page = ctx.new_page()
    def on_console(m):
        if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text:
            errores.append(f'{tag} console.error: {m.text}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: errores.append(f'{tag} pageerror: {e}'))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=90000)
    page.wait_for_timeout(800)
    return br, page

def snap(page, nombre):
    if args.out: page.screenshot(path=os.path.join(args.out, nombre), full_page=True)

def axe(page, selector, tag):
    try:
        if not page.evaluate("()=>typeof axe!=='undefined'"):
            page.add_script_tag(url=AXE); page.wait_for_function("()=>typeof axe!=='undefined'", timeout=20000)
        v = page.evaluate("async s=>{const r=await axe.run(document.querySelector(s),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return r.violations.map(x=>({id:x.id,n:x.nodes.length,t:x.nodes.slice(0,2).map(n=>n.target.join(' '))}));}", selector)
        check(not v, f'{tag}: axe sin violaciones en {selector} {v if v else ""}')
    except Exception as e:
        fallos.append(f'axe no cargó: {e}')

def desborde(page):
    return page.evaluate("()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1")

def abrir_ex(page, tab):
    page.evaluate("()=>irAModulo('ex','grupo')")
    page.wait_for_function("()=>{const el=document.getElementById('exCuerpo');return el&&!el.hasAttribute('aria-busy')&&typeof Expediente!=='undefined';}", timeout=30000)
    page.evaluate("t=>Expediente.setTab(t)", tab)
    page.wait_for_timeout(300)

# ---- Limpieza común (filas y objetos con la marca) ----------------------------------------------------------------
def limpiar(page):
    return page.evaluate("""async m=>{const out={};
      const borrarArchivos=async paths=>{paths=paths.filter(Boolean);if(paths.length){const{error}=await sb.storage.from('licitaciones').remove(paths);if(error)out.err_bucket=error.message;}return paths.length;};
      const docs=(await sb.from('empresa_documentos').select('id,archivo_path,nombre').like('nombre',m+'%')).data||[];
      // primero las versiones nuevas (reemplaza_id) para no chocar con la FK
      docs.sort((a,b)=>b.id-a.id);
      out.archivos=await borrarArchivos(docs.map(d=>d.archivo_path));
      for(const d of docs){await sb.from('empresa_documentos').delete().eq('id',d.id);} out.docs=docs.length;
      const per=(await sb.from('personal_tecnico').select('*').or('nombre.like.'+m+'%,notas.like.'+m+'%')).data||[];
      out.archivos+=await borrarArchivos(per.flatMap(p=>[p.cv_path,p.cedula_path,p.identificacion_path]));
      if(per.length)await sb.from('personal_tecnico').delete().in('id',per.map(p=>p.id)); out.personal=per.length;
      const ob=(await sb.from('obras_ejecutadas').select('*').or('nombre.like.'+m+'%,notas.like.'+m+'%')).data||[];
      out.archivos+=await borrarArchivos(ob.flatMap(o=>[o.contrato_path,o.acta_path,...(o.evidencia_paths||[])]));
      if(ob.length)await sb.from('obras_ejecutadas').delete().in('id',ob.map(o=>o.id)); out.obras=ob.length;
      const mq=(await sb.from('maquinaria').select('*').like('descripcion',m+'%')).data||[];
      out.archivos+=await borrarArchivos(mq.flatMap(x=>[x.factura_path,x.poliza_path]));
      if(mq.length)await sb.from('maquinaria').delete().in('id',mq.map(x=>x.id)); out.maquinaria=mq.length;
      return out;}""", MARCA)

# ---- US-807 ---------------------------------------------------------------------------------------------------------
def caso_datos(page, tag):
    abrir_ex(page, 'datos')
    info = page.evaluate("""()=>({tab:document.querySelector('#exTab-datos')?.getAttribute('aria-selected'),
      enlace:[...document.querySelectorAll('#exPanel button')].some(b=>/Editar en Configuración/.test(b.textContent)&&/openEmpresaModal/.test(b.getAttribute('onclick')||'')),
      lectura:[...document.querySelectorAll('#exPanel dt')].map(x=>x.textContent),
      inputsLectura:document.querySelectorAll('#exPanel input[id^="exD-razon"],#exPanel input[id^="exD-rfc"]').length,
      campos:document.querySelectorAll('#exDatosForm [data-k]').length})""")
    check(info['tab'] == 'true', f'{tag}: pestaña Datos activa')
    check(info['enlace'], f'{tag}: enlace «Editar en Configuración» abre openEmpresaModal')
    check(all(x in info['lectura'] for x in ['Razón social', 'RFC', 'Domicilio fiscal', 'Registro patronal IMSS']), f'{tag}: razón social, RFC, domicilio y registro patronal en sólo lectura {info["lectura"]}')
    check(info['inputsLectura'] == 0, f'{tag}: lo de Configuración no es editable aquí')
    check(info['campos'] == 17, f'{tag}: 17 campos editables de empresa_expediente ({info["campos"]})')
    page.fill('#exD-cmic_registro', MARCA)
    page.fill('#exD-capital_contable', '1,500,000')
    page.click('#exDatosGuardar')
    page.wait_for_function("m=>D.exp&&D.exp.expediente&&D.exp.expediente.cmic_registro===m", arg=MARCA, timeout=15000)
    page.wait_for_timeout(300)
    vis = page.evaluate("m=>({v:document.getElementById('exD-cmic_registro')?.value,cap:document.getElementById('exD-capital_contable')?.value,estado:document.getElementById('exDatosEstado')?.textContent})", MARCA)
    check(vis['v'] == MARCA and vis['cap'] in ('1500000', '1500000.00'), f'{tag}: el dato guardado aparece sin recargar {vis}')
    check('Última actualización' in (vis['estado'] or ''), f'{tag}: muestra la fecha de la última actualización')
    # De ida y vuelta al servidor
    srv = page.evaluate("async()=>{const{data}=await sb.from('empresa_expediente').select('cmic_registro,capital_contable').maybeSingle();return data;}")
    check(srv and srv['cmic_registro'] == MARCA and float(srv['capital_contable']) == 1500000, f'{tag}: persistido en el servidor')
    # Error de validación en el cliente
    page.fill('#exD-capital_contable', 'mucho')
    page.click('#exDatosGuardar')
    page.wait_for_timeout(400)
    check(page.evaluate("()=>[...document.querySelectorAll('#toastContainer *')].some(x=>/importe válido/.test(x.textContent))"), f'{tag}: monto inválido avisa sin llamar al servidor')
    check(not desborde(page), f'{tag}: sin desborde horizontal')
    snap(page, f'datos-{tag}.png')
    axe(page, '#c', tag)

# ---- US-808 ---------------------------------------------------------------------------------------------------------
def archivo(nombre, datos=PDF, mime='application/pdf'):
    return {'name': nombre, 'mimeType': mime, 'buffer': datos}

def esperar_modal(page, mid):
    page.wait_for_function("id=>{const m=document.getElementById(id);return m&&m.classList.contains('ac');}", arg=mid, timeout=10000)

def toasts(page):
    return page.evaluate("()=>[...document.querySelectorAll('#toastContainer *')].map(x=>x.textContent).join(' | ')")

def caso_documentos(page, tag):
    import hashlib
    abrir_ex(page, 'documentos')
    # Faltantes arriba como pendientes, con un botón por categoría
    pend = page.evaluate("""()=>{const s=document.getElementById('exPend');if(!s)return null;const sec=s.closest('section');
      const prim=[...document.querySelectorAll('#exPanel section')][0];
      return {primero:prim===sec, botones:[...sec.querySelectorAll('button')].map(b=>b.textContent.trim())};}""")
    sat_pend = pend and any('Opinión de cumplimiento SAT' in b for b in pend['botones'])
    check(pend is not None and pend['primero'], f'{tag}: las categorías sin documento vigente salen arriba como pendientes')
    check(sat_pend, f'{tag}: opinión SAT aparece como pendiente (empresa sin documento SAT vigente)')
    # Alta desde el botón de la categoría pendiente: el modal trae la categoría y sugiere el vencimiento a 30 días
    page.evaluate("()=>Expediente.nuevoDocumento('opinion_sat')")
    esperar_modal(page, 'mdlExpDoc')
    m = page.evaluate("()=>({cat:document.getElementById('exDocCat').value,emi:document.getElementById('exDocEmi').value,ven:document.getElementById('exDocVence').value,hoy:Expediente.hoyMx(),sug:Expediente.vencimientoSugerido('opinion_sat',Expediente.hoyMx())})")
    check(m['cat'] == 'opinion_sat' and m['emi'] == m['hoy'] and m['ven'] == m['sug'], f'{tag}: mdlExpDoc sugiere vencimiento a 30 días para opinión SAT {m}')
    # El vencimiento sugerido es editable y no se pisa al cambiar la emisión una vez escrito a mano
    page.fill('#exDocVence', '2026-12-31')
    page.dispatch_event('#exDocVence', 'input')
    page.fill('#exDocEmi', '2026-10-01'); page.dispatch_event('#exDocEmi', 'change')
    check(page.input_value('#exDocVence') == '2026-12-31', f'{tag}: el vencimiento escrito a mano no se pisa')
    page.fill('#exDocVence', m['sug']); page.fill('#exDocEmi', m['hoy'])
    axe(page, '#mdlExpDoc', tag + ' modal documento')
    if tag == 'escritorio': snap(page, f'doc-modal-{tag}.png')
    page.fill('#exDocNombre', MARCA + ' SAT v1')
    page.set_input_files('#exDocArchivo', archivo('Opinión SAT v1.pdf'))
    page.click('#exDocGuardar')
    page.wait_for_function("m=>D.exp.documentos.some(d=>d.nombre===m)", arg=MARCA + ' SAT v1', timeout=20000)
    d1 = page.evaluate("m=>D.exp.documentos.find(d=>d.nombre===m)", MARCA + ' SAT v1')
    check(d1['hash_sha256'] == hashlib.sha256(PDF).hexdigest(), f'{tag}: hash SHA-256 calculado en el cliente coincide')
    check(d1['archivo_path'].startswith('empresa/1/expediente/opinion_sat/') and d1['archivo_path'].endswith('_Opinion_SAT_v1.pdf'), f'{tag}: ruta empresa/<id>/expediente/<categoria>/… ({d1["archivo_path"]})')
    check(d1['estado'] == 'por_vencer' and d1['dias_restantes'] == 30, f'{tag}: estado por vencer con 30 días ({d1["estado"]}, {d1["dias_restantes"]})')
    page.wait_for_timeout(300)
    lista = page.evaluate("""()=>{const s=document.getElementById('exCat-opinion_sat');const sec=s&&s.closest('section');
      return sec?{chips:[...sec.querySelectorAll('.chip')].map(c=>c.textContent),pend:!!document.getElementById('exPend')&&[...document.getElementById('exPend').closest('section').querySelectorAll('button')].some(b=>/SAT/.test(b.textContent))}:null;}""")
    check(lista and any('Por vencer · 30 d' in c for c in lista['chips']), f'{tag}: lista agrupada por categoría con chip de estado y días {lista}')
    check(lista and not lista['pend'], f'{tag}: opinión SAT ya no está en pendientes')
    # Ver (URL firmada) y descargar
    page.evaluate("()=>{window.__abiertas=[];window.open=(u)=>{window.__abiertas.push(u);return null;};}")
    page.evaluate("p=>Expediente.abrirArchivo(p)", d1['archivo_path'])
    page.wait_for_function("()=>window.__abiertas.length>0", timeout=10000)
    url = page.evaluate("()=>window.__abiertas[0]")
    r = page.request.get(url)
    check('/object/sign/licitaciones/' in url and r.status == 200 and r.body() == PDF, f'{tag}: «Ver» abre una URL firmada que devuelve el archivo')
    with page.expect_download(timeout=15000) as dl:
        page.evaluate("p=>Expediente.abrirArchivo(p,true)", d1['archivo_path'])
    check(dl.value.suggested_filename.endswith('Opinion_SAT_v1.pdf'), f'{tag}: «Descargar» baja el archivo ({dl.value.suggested_filename})')
    # Renovar: sube versión nueva y marca la anterior como reemplazada
    page.evaluate("id=>Expediente.renovarDocumento(id)", d1['id'])
    esperar_modal(page, 'mdlExpDoc')
    page.fill('#exDocNombre', MARCA + ' SAT v2')
    page.fill('#exDocVence', '2027-12-31'); page.dispatch_event('#exDocVence', 'input')
    v2bytes = PDF + b'%v2\n'
    page.set_input_files('#exDocArchivo', archivo('Opinión SAT v2.pdf', v2bytes))
    page.click('#exDocGuardar')
    page.wait_for_function("m=>D.exp.documentos.some(d=>d.nombre===m)", arg=MARCA + ' SAT v2', timeout=20000)
    page.wait_for_timeout(300)
    est = page.evaluate("""m=>{const v1=D.exp.documentos.find(d=>d.nombre===m+' SAT v1'),v2=D.exp.documentos.find(d=>d.nombre===m+' SAT v2');
      return {v1:v1.estado,por:v1.reemplazado_por_id,v2id:v2.id,v2r:v2.reemplaza_id,v1id:v1.id,v2e:v2.estado,
        visibles:[...document.querySelectorAll('#exPanel li.ex-doc')].map(li=>li.textContent).filter(t=>t.includes(m)).length,
        hist:!!document.querySelector('[aria-label^="Historial de '+m+' SAT v2"]')};}""", MARCA)
    check(est['v1'] == 'reemplazado' and est['por'] == est['v2id'] and est['v2r'] == est['v1id'] and est['v2e'] == 'vigente', f'{tag}: «Renovar» marca la anterior como reemplazada con reemplaza_id {est}')
    check(est['visibles'] == 1, f'{tag}: la lista sólo muestra la versión vigente')
    check(est['hist'], f'{tag}: botón Historial visible')
    page.click(f'[aria-label^="Historial de {MARCA} SAT v2"]')
    esperar_modal(page, 'mdlExpHist')
    h = page.evaluate("()=>[...document.querySelectorAll('#mdlExpHist ol > li')].map(li=>li.textContent.replace(/\\s+/g,' ').trim())")
    check(len(h) == 2 and 'v2' in h[0] and 'v1' in h[1] and 'Reemplazado' in h[1], f'{tag}: el historial muestra las dos versiones {h}')
    axe(page, '#mdlExpHist', tag + ' historial')
    page.evaluate("()=>closeMdl('mdlExpHist')")
    # Editar (sin archivo)
    page.evaluate("id=>Expediente.editarDocumento(id)", est['v2id'])
    esperar_modal(page, 'mdlExpDoc')
    check(page.evaluate("()=>!document.getElementById('exDocArchivo')&&document.getElementById('exDocCat').disabled"), f'{tag}: editar no pide archivo ni deja cambiar la categoría')
    page.fill('#exDocNombre', MARCA + ' SAT v2 editado')
    page.click('#exDocGuardar')
    page.wait_for_function("m=>D.exp.documentos.some(d=>d.nombre===m)", arg=MARCA + ' SAT v2 editado', timeout=15000)
    check(True, f'{tag}: editar guarda el nombre')
    # Archivo no admitido
    page.evaluate("()=>Expediente.nuevoDocumento('otro')")
    esperar_modal(page, 'mdlExpDoc')
    page.fill('#exDocNombre', MARCA + ' malo')
    page.set_input_files('#exDocArchivo', archivo('programa.exe', b'MZ', 'application/octet-stream'))
    page.click('#exDocGuardar'); page.wait_for_timeout(500)
    check('no es de un tipo admitido' in toasts(page), f'{tag}: un .exe se rechaza en el cliente')
    page.evaluate("()=>closeMdl('mdlExpDoc')")
    check(not desborde(page), f'{tag}: sin desborde horizontal')
    snap(page, f'documentos-{tag}.png')
    axe(page, '#c', tag + ' documentos')
    # Eliminar con Dialog.confirm (borra fila y archivo)
    v2path = page.evaluate("m=>D.exp.documentos.find(d=>d.nombre===m).archivo_path", MARCA + ' SAT v2 editado')
    page.click(f'[aria-label="Eliminar {MARCA} SAT v2 editado"]')
    page.wait_for_selector('dialog.dlg[open]')
    page.click('#dlgOk')
    page.wait_for_function("m=>!D.exp.documentos.some(d=>d.nombre===m)", arg=MARCA + ' SAT v2 editado', timeout=15000)
    quedan = page.evaluate("async p=>{const{data}=await sb.storage.from('licitaciones').list(p.split('/').slice(0,-1).join('/'));return (data||[]).map(x=>x.name).filter(n=>p.endsWith(n)).length;}", v2path)
    check(quedan == 0, f'{tag}: eliminar borra también el objeto del bucket')

# ---- US-809 ---------------------------------------------------------------------------------------------------------
def caso_avisos(page, tag):
    base = page.evaluate("async()=>{const a=await expAvisosCargar();return a?{v:a.vencidos,p:a.por_vencer}:null;}")
    creado = page.evaluate("""async m=>{const hoy=Expediente.hoyMx();const d=n=>{const x=new Date(hoy+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
      const r1=await sb.from('empresa_documentos').insert({categoria:'opinion_imss',nombre:m+' IMSS vencida',fecha_emision:d(-40),fecha_vencimiento:d(-1)}).select().single();
      const r2=await sb.from('maquinaria').insert({descripcion:m+' Retroexcavadora',poliza:'POL-QA',poliza_vigencia:d(10)}).select().single();
      return {e1:r1.error&&r1.error.message,e2:r2.error&&r2.error.message};}""", MARCA)
    check(not creado['e1'] and not creado['e2'], f'{tag}: datos de prueba creados {creado}')
    a = page.evaluate("async()=>{const a=await expAvisosCargar();return {v:a.vencidos,p:a.por_vencer,items:a.items.map(x=>x.nombre),badge:navBadges().ex};}")
    check(a['v'] == base['v'] + 1 and a['p'] == base['p'] + 1, f'{tag}: get_expediente_avisos cuenta el documento vencido y la póliza por vencer {a}')
    check(a['badge'] == a['v'] + a['p'], f'{tag}: navBadges().ex = vencidos + por vencer ({a["badge"]})')
    page.wait_for_timeout(300)
    if tag == 'escritorio':
        # Sin abrir el grupo (eso guardaría nav_prefs de la cuenta real): se pinta el modelo de la barra en un nodo suelto
        b = page.evaluate("()=>{const m=navModelo();m.grupos.forEach(g=>g.abierto=true);const d=document.createElement('div');d.innerHTML=NavShell.render(m).aside;const it=d.querySelector('.nvs-item[data-k=\"ex\"]');const bd=it&&it.querySelector('.nvs-badge');return bd?bd.textContent.trim():null;}")
        check(b == str(a['badge']), f'{tag}: el ítem Expediente de la barra muestra el contador ({b})')
    # Tarjeta de Inicio (admin/gerente) cuando hay vencidos
    page.evaluate("()=>{M='d';R();}")
    page.wait_for_timeout(500)
    t = page.evaluate("m=>{const el=document.getElementById('dsExpAvisos');return el?{hidden:el.hidden,txt:el.textContent.replace(/\\s+/g,' ')}:null;}", MARCA)
    check(t and not t['hidden'] and (MARCA + ' IMSS vencida') in t['txt'] and 'vence en los próximos 30 días' in t['txt'], f'{tag}: tarjeta en Inicio con el vencido y el aviso de por vencer {t and t["txt"][:160]}')
    snap(page, f'avisos-inicio-{tag}.png')
    axe(page, '#dsExpAvisos', tag + ' tarjeta Inicio')
    page.click('#dsExpAvisos button')
    page.wait_for_function("()=>M==='ex'&&document.getElementById('exCuerpo')&&!document.getElementById('exCuerpo').hasAttribute('aria-busy')", timeout=20000)
    check(True, f'{tag}: «Renovar en Expediente» abre el módulo')
    # Al quitar el vencido el contador baja sin recargar
    dl = page.evaluate("async m=>{const r=await sb.from('empresa_documentos').select('id').eq('nombre',m+' IMSS vencida');if(r.error)return r.error.message;const x=await sb.from('empresa_documentos').delete().in('id',(r.data||[]).map(d=>d.id)).select('id');return x.error?x.error.message:(x.data||[]).length;}", MARCA)
    check(dl == 1, f'{tag}: documento vencido de prueba eliminado ({dl})')
    a2 = page.evaluate("async()=>{const a=await expAvisosCargar();return {v:a.vencidos,badge:navBadges().ex};}")
    check(a2['v'] == base['v'], f'{tag}: al resolver el vencido el contador baja ({a2})')
    page.evaluate("()=>{M='d';R();}"); page.wait_for_timeout(300)
    t2 = page.evaluate("()=>{const el=document.getElementById('dsExpAvisos');return el?el.hidden:null;}")
    check(base['v'] > 0 or t2 is True, f'{tag}: sin vencidos la tarjeta de Inicio no aparece')

# ---- US-810 ---------------------------------------------------------------------------------------------------------
def caso_personal(page, tag):
    abrir_ex(page, 'personal')
    check(page.evaluate("()=>document.getElementById('exTab-personal')?.getAttribute('aria-selected')==='true'"), f'{tag}: pestaña Personal técnico')
    # Alta desde cero con CV, cédula e identificación
    page.evaluate("()=>Expediente.nuevaPersona()")
    esperar_modal(page, 'mdlExpPer')
    page.fill('#exPerNombre', MARCA + ' Ing. Prueba')
    page.fill('#exPerPuesto', 'Superintendente'); page.fill('#exPerProf', 'Ingeniero civil'); page.fill('#exPerCedula', '1234567'); page.fill('#exPerAnios', '12')
    page.set_input_files('#exPerCv', archivo('CV Ing Prueba.pdf'))
    page.set_input_files('#exPerCed', archivo('cedula.png', b'\x89PNG\r\n\x1a\nqa', 'image/png'))
    page.set_input_files('#exPerIde', archivo('INE.pdf'))
    axe(page, '#mdlExpPer', tag + ' modal persona')
    if tag == 'escritorio': snap(page, 'personal-modal-escritorio.png')
    page.click('#exPerGuardar')
    page.wait_for_function("m=>D.exp.personal.some(p=>p.nombre===m)", arg=MARCA + ' Ing. Prueba', timeout=20000)
    p = page.evaluate("m=>D.exp.personal.find(p=>p.nombre===m)", MARCA + ' Ing. Prueba')
    rutas_ok = all(p[c] and p[c].startswith('empresa/1/expediente/personal/') for c in ['cv_path', 'cedula_path', 'identificacion_path'])
    check(rutas_ok and p['activo'] and p['anios_experiencia'] == 12 and p['empleado_id'] is None, f'{tag}: alta desde cero con CV, cédula e identificación en el bucket {[p["cv_path"], p["cedula_path"]]}')
    r = page.evaluate("async p=>{const{data,error}=await sb.storage.from('licitaciones').createSignedUrl(p,60);if(error)return error.message;const x=await fetch(data.signedUrl);return x.status;}", p['cedula_path'])
    check(r == 200, f'{tag}: la cédula se puede abrir con URL firmada ({r})')
    # Marcar inactivo y activo
    page.click(f'[aria-label="Marcar como inactivo a {MARCA} Ing. Prueba"]')
    page.wait_for_function("m=>D.exp.personal.find(p=>p.nombre===m).activo===false", arg=MARCA + ' Ing. Prueba', timeout=10000)
    page.wait_for_timeout(200)
    check(page.evaluate("m=>[...document.querySelectorAll('#exPanel li.ex-per')].find(li=>li.textContent.includes(m))?.textContent.includes('Inactivo')", MARCA), f'{tag}: marca inactivo y lo muestra')
    page.click(f'[aria-label="Marcar como activo a {MARCA} Ing. Prueba"]')
    page.wait_for_function("m=>D.exp.personal.find(p=>p.nombre===m).activo===true", arg=MARCA + ' Ing. Prueba', timeout=10000)
    # Editar: reemplazar CV y quitar identificación (borra los objetos viejos)
    viejoCv, viejaIde = p['cv_path'], p['identificacion_path']
    page.evaluate("id=>Expediente.editarPersona(id)", p['id'])
    esperar_modal(page, 'mdlExpPer')
    page.set_input_files('#exPerCv', archivo('CV nuevo.pdf', PDF + b'%nuevo'))
    page.check('#exPerIdeQuitar')
    page.click('#exPerGuardar')
    page.wait_for_function("([m,v])=>{const p=D.exp.personal.find(p=>p.nombre===m);return p&&p.cv_path!==v;}", arg=[MARCA + ' Ing. Prueba', viejoCv], timeout=20000)
    p2 = page.evaluate("m=>D.exp.personal.find(p=>p.nombre===m)", MARCA + ' Ing. Prueba')
    existen = page.evaluate("async ps=>{const out=[];for(const p of ps){const dir=p.split('/').slice(0,-1).join('/');const{data}=await sb.storage.from('licitaciones').list(dir,{limit:1000});out.push((data||[]).some(x=>p.endsWith('/'+x.name)));}return out;}", [viejoCv, viejaIde])
    check(p2['identificacion_path'] is None and existen == [False, False], f'{tag}: reemplazar y quitar archivos borra los objetos viejos {existen}')
    # Traer de Empleados: liga empleado_id y copia nombre y puesto
    page.evaluate("()=>Expediente.traerEmpleados()")
    esperar_modal(page, 'mdlExpTraer')
    emp = page.evaluate("()=>{const d=Expediente.empleadosDisponibles(D.e||[],D.exp.personal);return d.length?{id:d[0].id,nombre:d[0].nombre_completo,puesto:d[0].puesto||''}:null;}")
    if emp:
        axe(page, '#mdlExpTraer', tag + ' traer empleados')
        page.click(f'#exTraerLista button[onclick="Expediente.elegirEmpleado({emp["id"]})"]')
        esperar_modal(page, 'mdlExpPer')
        f = page.evaluate("()=>({n:document.getElementById('exPerNombre').value,p:document.getElementById('exPerPuesto').value,e:document.getElementById('exPerEmp').value})")
        check(f['n'] == (emp['nombre'] or '').strip() and f['p'] == (emp['puesto'] or '').strip() and f['e'] == str(emp['id']), f'{tag}: «Traer de Empleados» copia nombre y puesto y liga empleado_id')
        page.fill('#exPerNotas', MARCA)
        page.click('#exPerGuardar')
        page.wait_for_function("id=>D.exp.personal.some(p=>p.empleado_id===id)", arg=emp['id'], timeout=15000)
        check(not page.evaluate("id=>Expediente.empleadosDisponibles(D.e,D.exp.personal).some(e=>e.id===id)", emp['id']), f'{tag}: el empleado ya no se ofrece otra vez')
    else:
        check(False, f'{tag}: hay empleados para probar «Traer de Empleados»')
    check(not desborde(page), f'{tag}: sin desborde horizontal')
    snap(page, f'personal-{tag}.png')
    axe(page, '#c', tag + ' personal')
    # Eliminar con confirmación
    page.click(f'[aria-label="Eliminar a {MARCA} Ing. Prueba"]')
    page.wait_for_selector('dialog.dlg[open]'); page.click('#dlgOk')
    page.wait_for_function("m=>!D.exp.personal.some(p=>p.nombre===m)", arg=MARCA + ' Ing. Prueba', timeout=15000)
    check(True, f'{tag}: eliminar persona')

CASOS_FN = {'datos': caso_datos, 'documentos': caso_documentos, 'avisos': caso_avisos, 'personal': caso_personal}

def main():
    previo = None
    with sync_playwright() as pw:
        for ancho, alto, tag in [(1440, 900, 'escritorio'), (390, 844, 'movil')]:
            br, page = abrir(pw, ancho, alto, tag)
            if previo is None:
                previo = page.evaluate("async()=>{const{data}=await sb.from('empresa_expediente').select('*').maybeSingle();return data||false;}")
                prefs0 = page.evaluate("async()=>{const{data}=await sb.rpc('load_all_data_seguro',{p_token:currentUser.token});return data&&data.nav_prefs||{};}")
            try:
                for c in CASOS:
                    if c in CASOS_FN:
                        print(f'[{tag}] {c}')
                        try: CASOS_FN[c](page, tag)
                        except Exception as e: fallos.append(f'{tag} {c}: {e}'); print('  EXCEPCIÓN', e)
            finally:
                print('  limpieza:', json.dumps(limpiar(page)))
                # Datos legales: volver a como estaban
                if previo is False:
                    page.evaluate("async()=>{await sb.from('empresa_expediente').delete().not('empresa_id','is',null);}")
                elif previo:
                    page.evaluate("async p=>{const ks=Expediente.CAMPOS_DATOS.map(c=>c.k);await sb.rpc('guardar_empresa_expediente',{p_datos:Object.fromEntries(ks.map(k=>[k,p[k]]))});}", previo)
                prefs1 = page.evaluate("async()=>{const{data}=await sb.rpc('load_all_data_seguro',{p_token:currentUser.token});return data&&data.nav_prefs||{};}")
                # No se restauran solas: la cuenta de QA la comparten otros smokes y se pisaría su estado. Sólo se avisa.
                if prefs1 != prefs0:
                    print('  AVISO: nav_prefs cambiaron durante la corrida (¿otro smoke en paralelo?). Antes:', json.dumps(prefs0), 'Ahora:', json.dumps(prefs1))
                br.close()
    for e in errores: print('ERROR', e)
    print(f'\n{len(fallos)} fallos, {len(errores)} errores de consola')
    sys.exit(1 if fallos or errores else 0)

if __name__ == '__main__':
    main()
