# -*- coding: utf-8 -*-
"""
programa-fotos-smoke.py (11-sep-2026): Programa › Semanas — real ponderado en vivo y fotos por concepto.

Comprueba, contra el build local en dist/:
  1) Cada concepto de la tabla de semanas trae su boton de camara (.pg-cam) con data-cam.
  2) Al capturar un % en «Real %» los KPIs (Real ponderado, Desviacion, Completadas, En Progreso,
     Avance Prom.) se actualizan SIN repintar la tabla; el guardado se cancela para no tocar la BD.
  3) El modal de fotos del concepto abre, acepta una imagen, la sube ligada a la actividad
     (fotos_obra.actividad_id) y el contador del boton pasa a 1.
  4) El portal del cliente muestra esa foto agrupada bajo el nombre del concepto (#fot-<id> en
     la seccion Fotos) y NO la mete en Entregables (el concepto no tiene documentos ni es hito).
  5) axe (wcag2a/wcag2aa) sobre la tabla de semanas y sobre el modal de fotos.
  6) Limpieza: pgQuitarFoto borra la fila y el objeto del bucket se elimina.

Deja eventos «seccion» en control_obra.portal_eventos con sesion_llave 'token:<8 hex>': borrarlos al cerrar.

Uso (con OBRA_QA_TOKEN y PORTAL_QA_OBRA_TOKEN en el entorno):
  node scripts/serve-dist.mjs dist 8765 &
  PYTHONIOENCODING=utf-8 python scripts/qa/programa-fotos-smoke.py --out docs/qa/programa
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8765/index.html?app=1')
ap.add_argument('--portal', default='http://127.0.0.1:8765/portal.html')
ap.add_argument('--obra', type=int, default=20)   # Luminae Studio: 39 conceptos y enlace de portal activo
ap.add_argument('--actividad', type=int, default=0)  # 0 = el primer concepto sin documentos de la tabla
ap.add_argument('--out', default='')
args = ap.parse_args()

TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
PTOKEN = os.environ.get('PORTAL_QA_OBRA_TOKEN_20', '') or os.environ.get('PORTAL_QA_OBRA_TOKEN', '')
if not TOKEN:
    print('Falta OBRA_QA_TOKEN en el entorno'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)

errores, fallos = [], []
def check(cond, msg):
    if not cond: fallos.append(msg)

AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser"

with sync_playwright() as pw:
    nav = pw.chromium.launch()
    ctx = nav.new_context(viewport={'width': 1440, 'height': 900}, locale='es-MX')
    page = ctx.new_page()
    page.on('console', lambda m: errores.append('app console.error: ' + m.text) if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text else None)
    page.on('pageerror', lambda e: errores.append('app pageerror: ' + str(e)))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=90000)
    page.evaluate("o=>{seleccionarObraGlobal(o);pgTab='semanas';M='w';R();}", args.obra)
    page.wait_for_selector('.wk tr[data-act]', timeout=20000)

    # 1) un boton de camara por concepto
    conteo = page.evaluate("""()=>({filas:document.querySelectorAll('.wk tr[data-act]').length,
      camaras:document.querySelectorAll('.wk .pg-cam[data-cam]').length,
      sinAria:[...document.querySelectorAll('.wk .pg-cam')].filter(b=>!b.getAttribute('aria-label')).length})""")
    print('conceptos:', json.dumps(conteo))
    check(conteo['filas'] > 0, 'la tabla de semanas no pinto conceptos')
    check(conteo['filas'] == conteo['camaras'], 'faltan botones de camara: %s filas vs %s camaras' % (conteo['filas'], conteo['camaras']))
    check(conteo['sinAria'] == 0, 'hay botones de camara sin aria-label')

    # 2) real ponderado en vivo (sin guardar: se cancela el debounce y se restaura D)
    vivo = page.evaluate("""()=>{
      const inp=document.querySelector('.wk input.real');
      const id=Number(inp.closest('tr').dataset.act);
      const nuevo=Number(inp.value)>=100?50:100;   // un valor distinto al que ya tiene
      const a=D.ap.find(x=>x.id===id), prev=a.porcentaje_avance, prevEst=a.estatus;
      const antes={real:$('pgKpiReal').textContent,desv:$('pgKpiDesv').textContent,cls:$('pgKpiDesv').className,
        prom:$('pgKpiProm').textContent,comp:$('pgKpiComp').textContent};
      const filasAntes=document.querySelectorAll('.wk tr[data-act]').length;
      inp.value=String(nuevo); inp.dispatchEvent(new Event('input',{bubbles:true}));
      clearTimeout(_pgRealTimers[id]);   // nada se escribe en la base
      const despues={real:$('pgKpiReal').textContent,desv:$('pgKpiDesv').textContent,cls:$('pgKpiDesv').className,
        prom:$('pgKpiProm').textContent,comp:$('pgKpiComp').textContent};
      const esperado=Math.round(pgRealPonderado()*10)/10+' %';
      const filasDespues=document.querySelectorAll('.wk tr[data-act]').length;
      a.porcentaje_avance=prev; a.estatus=prevEst; pgRefrescarKpis(id); inp.value=prev;
      return {antes,despues,esperado,filasAntes,filasDespues,id,restaurado:$('pgKpiReal').textContent};}""")
    print('kpis en vivo:', json.dumps(vivo, ensure_ascii=False))
    check(vivo['antes']['real'] != vivo['despues']['real'], 'Real ponderado no cambio al capturar el %')
    check(vivo['despues']['real'] == vivo['esperado'], 'Real ponderado %s != %s' % (vivo['despues']['real'], vivo['esperado']))
    check(vivo['antes']['desv'] != vivo['despues']['desv'], 'la Desviacion no se movio')
    check(vivo['antes']['prom'] != vivo['despues']['prom'], 'Avance Prom. no se movio')
    check(vivo['filasAntes'] == vivo['filasDespues'], 'la tabla se repinto (deberia actualizarse en su lugar)')
    check(vivo['restaurado'] == vivo['antes']['real'], 'no se restauro el KPI tras la prueba')

    if args.out: page.screenshot(path=os.path.join(args.out, 'semanas-1440.png'))

    # 3) modal de fotos del concepto + subida real ligada a la actividad
    if not args.actividad:
        args.actividad = page.evaluate("""()=>{const ids=[...document.querySelectorAll('.wk tr[data-act]')].map(t=>Number(t.dataset.act));
          return ids.find(i=>!(D.doc||[]).some(d=>d.actividad_id===i)&&!(D.fot||[]).some(f=>f.actividad_id===i))||ids[0];}""")
        print('concepto elegido:', args.actividad)
    page.evaluate("a=>pgAbrirFotos(a)", args.actividad)
    page.wait_for_selector('#mdlFotoConcepto.ac', timeout=8000)
    ini = page.evaluate("""()=>({concepto:$('pgFotoConcepto').textContent,
      vacio:$('pgFotoGal').textContent.includes('Todavia no hay fotos')||$('pgFotoGal').textContent.includes('Todavía no hay fotos'),
      subirOff:$('pgFotoSubir').disabled, botones:document.querySelectorAll('#mdlFotoConcepto input[type=file]').length})""")
    print('modal:', json.dumps(ini, ensure_ascii=False))
    check(ini['concepto'], 'el modal no muestra el nombre del concepto')
    check(ini['vacio'], 'el modal deberia decir que aun no hay fotos')
    check(ini['subirOff'] is True, 'el boton Subir deberia empezar deshabilitado')
    check(ini['botones'] == 2, 'faltan los dos campos de archivo (camara y galeria)')

    page.evaluate("""async()=>{
      const c=document.createElement('canvas');c.width=c.height=120;
      const g=c.getContext('2d');g.fillStyle='#0369a1';g.fillRect(0,0,120,120);
      g.fillStyle='#fff';g.font='16px sans-serif';g.fillText('QA',40,64);
      const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.9));
      await pgAgregarFotos([new File([blob],'qa.jpg',{type:'image/jpeg'})]);}""")
    page.wait_for_function("()=>document.querySelectorAll('#pgFotoPend figure').length===1", timeout=8000)
    check(page.evaluate("()=>$('pgFotoSubir').disabled===false&&/Subir 1 foto/.test($('pgFotoSubir').textContent)"),
          'el boton Subir no se activo con la foto pendiente')
    if args.out: page.screenshot(path=os.path.join(args.out, 'modal-foto-1440.png'))

    page.evaluate("()=>{$('pgFotoNota').value='QA automatizado';return pgSubirFotos();}")
    page.wait_for_function("a=>(D.fot||[]).some(f=>f.actividad_id===a)", arg=args.actividad, timeout=30000)
    subida = page.evaluate("""a=>{const f=(D.fot||[]).filter(x=>x.actividad_id===a)[0];
      const b=document.querySelector('.pg-cam[data-cam="'+a+'"]');
      return {id:f.id,url:f.url_foto,cat:f.categoria,obra:f.obra_id,nota:f.descripcion,
        tiene:!!(b&&b.classList.contains('tiene')),texto:b?b.textContent.trim():''};}""", args.actividad)
    print('foto subida:', json.dumps(subida, ensure_ascii=False))
    check(subida['tiene'], 'el boton de camara no quedo marcado con foto')
    check(subida['texto'] == '1', 'el contador del boton deberia decir 1, dice ' + repr(subida['texto']))
    check(subida['cat'] == 'Avance', 'la foto deberia guardarse como categoria Avance')
    check(subida['obra'] == args.obra, 'la foto no quedo en la obra correcta')

    # 4) el portal del cliente la agrupa bajo el concepto
    if PTOKEN:
        pctx = nav.new_context(viewport={'width': 1440, 'height': 900}, locale='es-MX')
        ppage = pctx.new_page()
        ppage.on('console', lambda m: errores.append('portal console.error: ' + m.text) if m.type == 'error' and 'ERR_CONNECTION' not in m.text else None)
        ppage.on('pageerror', lambda e: errores.append('portal pageerror: ' + str(e)))
        ppage.goto(args.portal + '?t=' + PTOKEN + '#fotos', wait_until='domcontentloaded')
        ppage.wait_for_selector('#fot-%d' % args.actividad, timeout=30000)
        pdat = ppage.evaluate("""a=>{const s=document.getElementById('fot-'+a);
          return {titulo:s.querySelector('strong').textContent.trim(),
            meta:s.querySelector('.meta').textContent.trim(),
            fotos:s.querySelectorAll('.fotos a').length,
            grupos:document.querySelectorAll('[id^="fot-"]').length};}""", args.actividad)
        print('portal fotos:', json.dumps(pdat, ensure_ascii=False))
        check(pdat['fotos'] >= 1, 'el portal no muestra la foto del concepto')
        check(pdat['titulo'], 'el bloque del portal no trae el nombre del concepto')
        if args.out: ppage.screenshot(path=os.path.join(args.out, 'portal-fotos-1440.png'), full_page=True)
        ppage.evaluate("()=>irASeccion('entregables')")
        ppage.wait_for_timeout(400)
        ent = ppage.evaluate("a=>!!document.getElementById('ent-'+a)", args.actividad)
        check(ent is False, 'un concepto con fotos y sin documentos no deberia aparecer en Entregables')
        pctx.close()
    else:
        print('AVISO: sin PORTAL_QA_OBRA_TOKEN no se probo el portal del cliente')

    # 5) axe sobre la tabla de semanas y sobre el modal de fotos
    try:
        page.add_script_tag(url=AXE); page.wait_for_function("()=>typeof axe!=='undefined'", timeout=20000)
        for sel, nombre in [('.wk-wrap', 'tabla de semanas'), ('#mdlFotoConcepto .modal-content', 'modal de fotos')]:
            v = page.evaluate("async s=>{const r=await axe.run(document.querySelector(s),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return r.violations.map(x=>({id:x.id,n:x.nodes.length}));}", sel)
            print('axe', nombre, '->', v)
            check(not v, 'axe en ' + nombre + ': ' + str(v))
    except Exception as e:
        fallos.append('axe no cargo: ' + str(e))

    # 6) limpieza: la foto se quita desde la app y el archivo sale del bucket
    page.evaluate("""async(o)=>{
      const orig=Dialog.confirm; Dialog.confirm=async()=>true;
      await pgQuitarFoto(o.id); Dialog.confirm=orig;
      const path=String(o.url).split('/fotos/')[1];
      if(path)await sb.storage.from('fotos').remove([decodeURIComponent(path)]);}""", subida)
    page.wait_for_function("i=>!(D.fot||[]).some(f=>f.id===i)", arg=subida['id'], timeout=20000)
    limpio = page.evaluate("""a=>{const b=document.querySelector('.pg-cam[data-cam="'+a+'"]');
      return {tiene:!!(b&&b.classList.contains('tiene')),texto:b?b.textContent.trim():'?'};}""", args.actividad)
    check(limpio['tiene'] is False and limpio['texto'] == '', 'el boton no volvio a su estado sin fotos: ' + json.dumps(limpio))

    # 7) movil 390: la tabla no desborda la pantalla y el modal cabe
    mctx = nav.new_context(viewport={'width': 390, 'height': 844}, locale='es-MX', is_mobile=True, has_touch=True)
    mp = mctx.new_page()
    mp.on('pageerror', lambda e: errores.append('movil pageerror: ' + str(e)))
    mp.goto(args.app, wait_until='domcontentloaded')
    mp.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    mp.reload(wait_until='domcontentloaded')
    mp.wait_for_function(LISTO, timeout=90000)
    mp.evaluate("o=>{seleccionarObraGlobal(o);pgTab='semanas';M='w';R();}", args.obra)
    mp.wait_for_selector('.wk .pg-cam', timeout=20000)
    mp.evaluate("a=>pgAbrirFotos(a)", args.actividad)
    mp.wait_for_selector('#mdlFotoConcepto.ac', timeout=8000)
    mov = mp.evaluate("()=>({ancho:document.documentElement.scrollWidth,"
                      "modal:Math.round(document.querySelector('#mdlFotoConcepto .modal-content').getBoundingClientRect().width),"
                      "cam:Math.round(document.querySelector('.wk .pg-cam').getBoundingClientRect().height)})")
    print('movil 390:', json.dumps(mov))
    check(mov['ancho'] <= 390, 'la pagina desborda a lo ancho en 390: ' + str(mov['ancho']))
    check(mov['modal'] <= 390, 'el modal no cabe en 390: ' + str(mov['modal']))
    if args.out: mp.screenshot(path=os.path.join(args.out, 'modal-foto-390.png'))
    mctx.close()

    ctx.close(); nav.close()

print()
for e in errores: print('ERROR CONSOLA:', e)
for f in fallos: print('FALLO:', f)
print('RESULTADO:', 'OK' if not errores and not fallos else 'CON FALLOS')
sys.exit(0 if not errores and not fallos else 1)
