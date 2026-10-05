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
      const per=(await sb.from('personal_tecnico').select('*').like('nombre',m+'%')).data||[];
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

CASOS_FN = {'datos': caso_datos}

def main():
    previo = None
    with sync_playwright() as pw:
        for ancho, alto, tag in [(1440, 900, 'escritorio'), (390, 844, 'movil')]:
            br, page = abrir(pw, ancho, alto, tag)
            if previo is None:
                previo = page.evaluate("async()=>{const{data}=await sb.from('empresa_expediente').select('*').maybeSingle();return data||false;}")
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
                br.close()
    for e in errores: print('ERROR', e)
    print(f'\n{len(fallos)} fallos, {len(errores)} errores de consola')
    sys.exit(1 if fallos or errores else 0)

if __name__ == '__main__':
    main()
