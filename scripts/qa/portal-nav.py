# -*- coding: utf-8 -*-
"""
portal-nav.py (US-617, US-622): el portal del cliente en 6 secciones con ruta (build local en dist/).
Comprueba, con sesión de cuenta y con enlace de token: las 6 rutas (#inicio #avance #pagos #entregables #fotos
#contacto) pintan contenido, el hash desconocido cae en #inicio, cambiar de sección NO vuelve a pedir portal_datos,
document.title lleva la sección y el nombre de la obra, «Ver entregables» desde Avance salta a #entregables con
scroll, y el enlace de token no muestra selector de obra ni acciones de cuenta. Cero errores de consola.

Uso: PORTAL_QA_TOKEN (sesión de cuenta, 64 hex) y PORTAL_QA_OBRA_TOKEN (enlace de obra, 48 hex) en el entorno.
  PYTHONIOENCODING=utf-8 python scripts/qa/portal-nav.py --portal http://127.0.0.1:8765/portal.html
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--portal', default='http://127.0.0.1:8765/portal.html')
ap.add_argument('--out', default='')
args = ap.parse_args()
TS = os.environ.get('PORTAL_QA_TOKEN', '')
TT = os.environ.get('PORTAL_QA_OBRA_TOKEN', '')
if not TS and not TT:
    print('Faltan PORTAL_QA_TOKEN / PORTAL_QA_OBRA_TOKEN en el entorno'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)

SECCIONES = ['inicio', 'avance', 'pagos', 'entregables', 'fotos', 'contacto']
errores, fallos = [], []
def check(cond, msg):
    if not cond: fallos.append(msg)

def abrir(pw, modo, ancho, alto):
    tag = modo + str(ancho)
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
    page = ctx.new_page()
    page.on('console', lambda m: errores.append(tag + ' console.error: ' + m.text) if m.type == 'error' and 'ERR_CONNECTION' not in m.text else None)
    page.on('pageerror', lambda e: errores.append(tag + ' pageerror: ' + str(e)))
    url = args.portal + ('?t=' + TT if modo == 'token' else '')
    page.goto(url, wait_until='domcontentloaded')
    if modo == 'cuenta':
        page.evaluate("t=>localStorage.setItem('portal_sesion',t)", TS)
        page.goto(url, wait_until='domcontentloaded')
    page.wait_for_function("()=>document.querySelector('#vista')&&document.querySelector('#vista').children.length>0", timeout=60000)
    page.wait_for_timeout(600)
    return ctx, page

with sync_playwright() as pw:
    for modo, token in (('cuenta', TS), ('token', TT)):
        if not token:
            print('(sin token para el modo ' + modo + ', se omite)'); continue
        for ancho, alto in ((1440, 900), (390, 844)):
            ctx, page = abrir(pw, modo, ancho, alto)
            tag = modo + ' ' + str(ancho)

            # Contar llamadas a portal_datos: cambiar de sección no debe pedir datos otra vez
            page.evaluate("()=>{window.__rpc=[];const of=window.fetch;window.fetch=(u,o)=>{try{const b=JSON.parse((o&&o.body)||'{}');if(String(u).includes('/rpc/'))window.__rpc.push(String(u).split('/rpc/')[1]);}catch(e){}return of(u,o);};}")

            vistas = {}
            for s in SECCIONES:
                page.evaluate("s=>{location.hash='#'+s;}", s)
                page.wait_for_timeout(450)
                v = page.evaluate("""()=>({sec:seccion,hash:location.hash,titulo:document.title,
                  hijos:document.querySelector('#vista').children.length,
                  texto:document.querySelector('#vista').innerText.trim().length,
                  cur:[...document.querySelectorAll('#navCliente [aria-current="page"]')].map(b=>b.dataset.k),
                  curBottom:[...document.querySelectorAll('#navClienteBottom [aria-current="page"]')].map(b=>b.dataset.k),
                  items:[...document.querySelectorAll('#navCliente .nvs-item')].map(b=>b.dataset.k)})""")
                vistas[s] = v
                check(v['sec'] == s, tag + ': #' + s + ' no cambio de seccion: ' + str(v))
                check(v['hijos'] > 0 and v['texto'] > 40, tag + ': la seccion ' + s + ' quedo vacia: ' + str(v))
                check(v['cur'] == [s], tag + ': la barra deberia marcar ' + s + ' y marca ' + str(v['cur']))
                check(len(v['curBottom']) <= 1, tag + ': la barra inferior deberia tener un solo aria-current (' + s + ')')
                check(v['items'] == SECCIONES, tag + ': la barra del cliente deberia listar las 6 secciones: ' + str(v['items']))
                check(v['titulo'].split(' · ')[0].lower().startswith(s[:4]) or s == 'entregables' and 'Entregables' in v['titulo'],
                      tag + ': document.title de ' + s + ' = ' + str(v['titulo']))
            print(tag, '| titulos:', [vistas[s]['titulo'] for s in ('inicio', 'pagos')])

            # Hash desconocido cae en inicio
            page.evaluate("()=>{location.hash='#loquesea';}")
            page.wait_for_timeout(450)
            check(page.evaluate("()=>seccion") == 'inicio', tag + ': un hash desconocido deberia caer en inicio')

            # Ninguna de esas navegaciones pidió portal_datos otra vez
            rpcs = page.evaluate("()=>window.__rpc")
            datos = [r for r in rpcs if 'portal_datos' in r or 'portal_payload' in r]
            print(tag, '| rpc durante la navegacion:', sorted(set(rpcs)))
            check(not datos, tag + ': cambiar de seccion volvio a pedir datos: ' + str(datos))

            # Desde Avance, «ver entregables» salta a #entregables
            page.evaluate("()=>{location.hash='#avance';}")
            page.wait_for_timeout(450)
            tiene = page.evaluate("()=>!!document.querySelector('#vista .ver')")
            if tiene:
                page.evaluate("()=>document.querySelector('#vista .ver').click()")
                page.wait_for_timeout(700)
                check(page.evaluate("()=>seccion") == 'entregables', tag + ': el boton de entregables no cambio de seccion')
                check(page.evaluate("()=>!!document.querySelector('#vista .grupo')"), tag + ': no se pinto ningun bloque de entrega')
            else:
                print(tag, '| (esta obra no tiene entregables ligados a actividades)')

            # Enlace de token: sin selector de obra ni acciones de cuenta
            if modo == 'token':
                page.evaluate("()=>{location.hash='#contacto';}")
                page.wait_for_timeout(450)
                t = page.evaluate("""()=>({sel:!!document.querySelector('#selObra'),
                  pass:document.body.innerText.includes('Cambiar mi contraseña'),
                  salir:!!document.querySelector('header .txt'),
                  privado:document.body.innerText.includes('enlace es privado')})""")
                print(tag, '| token:', t)
                check(not t['sel'], tag + ': el enlace de token no deberia traer selector de obra')
                check(not t['pass'] and not t['salir'], tag + ': el enlace de token no deberia ofrecer cuenta: ' + str(t))
                check(t['privado'], tag + ': falta el aviso de enlace privado en Contacto')

            # US-620: avisos de la barra. Los datos de QA vienen en cero, así que se simulan sobre el payload
            # ya cargado (novedades es sólo lectura para la vista) y se comprueba lo que pinta la barra.
            av = page.evaluate("""()=>{const orig=JSON.parse(JSON.stringify(datos.novedades||{}));
              datos.novedades={fotos:3,documentos:2,pagos_vencidos:1,proximo_pago_dias:2,ultimo_visto_at:'2000-01-01T00:00:00+00:00'};
              novedadesVistas.clear();seccion='inicio';pintarSeccion();
              const b=k=>{const el=document.querySelector('#navCliente [data-k="'+k+'"]')||document.querySelector('#navClienteBottom [data-k="'+k+'"]');
                return el?{badge:(el.querySelector('.nvs-badge')||{}).textContent||'',punto:!!el.querySelector('.nvs-badge.nvs-dot'),aria:el.getAttribute('aria-label')}:null;};
              const r={pagos:b('pagos'),entregables:b('entregables'),fotos:b('fotos'),
                       avisoInicio:document.body.innerText.includes('vence en 2 días'),
                       hayProximo:!!ctx.proximo,
                       nuevos:document.querySelectorAll('.chip.nuevo').length};
              seccion='fotos';pintarSeccion();
              r.fotosTrasVer=b('fotos');
              r.nuevosEnFotos=document.querySelectorAll('#vista .chip.nuevo').length;
              seccion='entregables';pintarSeccion();
              r.entregablesTrasVer=b('entregables');
              datos.novedades=orig;novedadesVistas.clear();seccion='inicio';pintarSeccion();
              return r;}""")
            print(tag, '| avisos:', json.dumps(av, ensure_ascii=False))
            check(av['pagos'] and av['pagos']['punto'], tag + ': Pagos deberia llevar punto rojo: ' + str(av['pagos']))
            check(av['pagos'] and '1 pago vencido' in (av['pagos']['aria'] or ''), tag + ': aria-label de Pagos: ' + str(av['pagos']))
            check(av['entregables'] and av['entregables']['badge'] == '2', tag + ': Entregables deberia marcar 2: ' + str(av['entregables']))
            check(av['fotos'] and av['fotos']['badge'] == '3', tag + ': Fotos deberia marcar 3: ' + str(av['fotos']))
            if av['hayProximo']:
                check(av['avisoInicio'], tag + ': falta la tarjeta «vence en 2 días» en Inicio')
            else:
                print(tag, '| (esta obra no tiene un siguiente pago pendiente: sin tarjeta de aviso)')
                check(not av['avisoInicio'], tag + ': no deberia avisar de un pago que no existe')
            check(av['fotosTrasVer'] and not av['fotosTrasVer']['badge'], tag + ': el badge de Fotos deberia limpiarse al abrirla: ' + str(av['fotosTrasVer']))
            check(av['entregablesTrasVer'] and not av['entregablesTrasVer']['badge'], tag + ': el badge de Entregables deberia limpiarse: ' + str(av['entregablesTrasVer']))

            # US-618/US-619: layout de dos columnas en escritorio, barra inferior en móvil
            lay = page.evaluate("""()=>{const a=document.getElementById('navCliente'),b=document.getElementById('navClienteBottom');
              const w=document.querySelector('.wrap');
              return{aside:getComputedStyle(a).display,anchoAside:Math.round(a.getBoundingClientRect().width),
                bottom:getComputedStyle(b).display,items:[...b.querySelectorAll('.nvs-bottom-item')].map(x=>x.dataset.k),
                altos:[...b.querySelectorAll('button')].map(x=>Math.round(x.getBoundingClientRect().height)),
                cols:getComputedStyle(document.querySelector('.shell')).gridTemplateColumns,
                anchoMain:Math.round(w.getBoundingClientRect().width),
                overflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth+1};}""")
            print(tag, '| layout:', lay)
            check(lay['overflow'], tag + ': desborde horizontal')
            if ancho >= 900:
                check(lay['aside'] != 'none' and lay['anchoAside'] == 240, tag + ': el aside deberia medir 240 px: ' + str(lay))
                check(lay['bottom'] == 'none', tag + ': en escritorio no va la barra inferior')
                check(len(lay['cols'].split(' ')) == 2, tag + ': el layout deberia ser de dos columnas: ' + str(lay['cols']))
                check(lay['anchoMain'] <= 780, tag + ': el contenido deberia quedarse en 760 px: ' + str(lay['anchoMain']))
            else:
                check(lay['aside'] == 'none', tag + ': en movil el aside no se pinta')
                check(lay['bottom'] != 'none' and len(lay['items']) == 5, tag + ': la barra inferior deberia traer 5 secciones: ' + str(lay['items']))
                check(all(h >= 44 for h in lay['altos'] if h > 0), tag + ': objetivos chicos en la barra inferior: ' + str(lay['altos']))

            if ancho >= 900:
                try:
                    page.add_script_tag(url='https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js')
                    page.wait_for_function("()=>typeof axe!=='undefined'", timeout=20000)
                    v = page.evaluate("async()=>{const r=await axe.run(document.getElementById('navCliente'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return r.violations.map(x=>({id:x.id,n:x.nodes.length}));}")
                    print(tag, '| axe aside ->', v)
                    check(not v, tag + ': axe en la barra del cliente: ' + str(v))
                except Exception as ex:
                    fallos.append(tag + ': axe no cargo: ' + str(ex))

            # US-619: menú de cuenta y chip de obra en la cabecera móvil
            if ancho < 900:
                page.evaluate("()=>{location.hash='#inicio';}"); page.wait_for_timeout(450)
                cab = page.evaluate("""()=>({cuenta:!!document.getElementById('btnCuenta'),chip:!!document.getElementById('chipObra'),
                  texto:(document.getElementById('btnCuenta')||{}).textContent||''})""")
                check(cab['cuenta'], tag + ': falta el boton de cuenta en la cabecera movil')
                page.click('#btnCuenta'); page.wait_for_timeout(400)
                menu = page.evaluate("""()=>{const m=document.getElementById('menuPortal');
                  return{abierto:!m.hidden,rol:m.getAttribute('role'),exp:document.getElementById('btnCuenta').getAttribute('aria-expanded'),
                    items:[...m.querySelectorAll('.menu-item')].map(x=>x.textContent.trim()),
                    altos:[...m.querySelectorAll('.menu-item')].map(x=>Math.round(x.getBoundingClientRect().height))};}""")
                print(tag, '| menu de cuenta:', menu['items'])
                check(menu['abierto'] and menu['exp'] == 'true' and menu['rol'] == 'menu', tag + ': el menu de cuenta no abrio: ' + str(menu))
                check(all(h >= 44 for h in menu['altos']), tag + ': opciones chicas en el menu: ' + str(menu['altos']))
                esperados = ['Contacto'] + (['Cambiar contraseña', 'Salir'] if modo == 'cuenta' else [])
                for it in esperados:
                    check(any(it in x for x in menu['items']), tag + ': falta «' + it + '» en el menu: ' + str(menu['items']))
                if modo == 'token':
                    check(not any('contraseña' in x.lower() or x == 'Salir' for x in menu['items']), tag + ': el enlace de token no deberia ofrecer cuenta: ' + str(menu['items']))
                if args.out: page.screenshot(path=os.path.join(args.out, 'portal-' + modo + '-menu-390.png'))
                page.keyboard.press('Escape'); page.wait_for_timeout(300)
                check(page.evaluate("()=>document.getElementById('menuPortal').hidden"), tag + ': Esc no cerro el menu')
                # El chip de obra sólo aparece con sesión y más de una obra
                nobras = page.evaluate("()=>obras.length")
                check(cab['chip'] == (modo == 'cuenta' and nobras > 1), tag + ': chip de obra=' + str(cab['chip']) + ' con ' + str(nobras) + ' obras en modo ' + modo)
                # La barra inferior no tapa el contenido
                hueco = page.evaluate("()=>{const w=document.querySelector('.wrap');const cs=getComputedStyle(w);return parseInt(cs.paddingBottom);}")
                check(hueco >= 80, tag + ': el contenido necesita hueco para la barra inferior: ' + str(hueco))
                page.evaluate("()=>{location.hash='#pagos';}"); page.wait_for_timeout(450)
                if args.out: page.screenshot(path=os.path.join(args.out, 'portal-' + modo + '-pagos-390.png'))

            # US-622: con enlace de token las novedades vienen en cero, pero el pago vencido se calcula del plan
            if modo == 'token':
                venc = page.evaluate("""()=>{const orig=JSON.parse(JSON.stringify(datos.novedades||{}));
                  datos.novedades={fotos:0,documentos:0,pagos_vencidos:0,proximo_pago_dias:null,ultimo_visto_at:null};
                  novedadesVistas.clear();seccion='inicio';pintarSeccion();
                  const delPlan=ctx.plan.filter(x=>x.vence&&x.vence<ctx.hoy&&Number(x.monto)-Number(x.cobrado||0)>0.5).length;
                  const el=document.querySelector('#navCliente [data-k="pagos"]')||document.querySelector('#navClienteBottom [data-k="pagos"]');
                  const r={delPlan:delPlan,calculado:pagosVencidos(),punto:!!(el&&el.querySelector('.nvs-badge')),
                           nuevos:document.querySelectorAll('.chip.nuevo').length};
                  datos.novedades=orig;novedadesVistas.clear();seccion='inicio';pintarSeccion();return r;}""")
                print(tag, '| token sin novedades:', venc)
                check(venc['calculado'] == venc['delPlan'], tag + ': los vencidos deberian salir del plan: ' + str(venc))
                check(venc['punto'] == (venc['delPlan'] > 0), tag + ': el punto de Pagos no coincide con el plan: ' + str(venc))
                check(venc['nuevos'] == 0, tag + ': sin ultimo_visto_at no deberia haber etiquetas «Nuevo»: ' + str(venc))

            if args.out:
                page.evaluate("()=>{location.hash='#inicio';}"); page.wait_for_timeout(400)
                page.screenshot(path=os.path.join(args.out, 'portal-' + modo + '-' + str(ancho) + '.png'))
            ctx.close()

    # US-622: los enlaces de obra reales de la empresa 1 (uno activo y dos revocados)
    extra = [t for t in (os.environ.get('PORTAL_QA_TOKENS_EMP1', '') or '').split(',') if t.strip()]
    for i, tk in enumerate(extra):
        tk = tk.strip()
        ctx = pw.chromium.launch().new_context(viewport={'width': 1440, 'height': 900}, locale='es-MX')
        page = ctx.new_page()
        tag = 'emp1#' + str(i + 1)
        page.on('console', lambda m, tg=tag: errores.append(tg + ' console.error: ' + m.text) if m.type == 'error' and 'ERR_CONNECTION' not in m.text else None)
        page.on('pageerror', lambda e, tg=tag: errores.append(tg + ' pageerror: ' + str(e)))
        page.goto(args.portal + '?t=' + tk, wait_until='domcontentloaded')
        page.wait_for_timeout(3500)
        r = page.evaluate("""()=>({vista:!!document.querySelector('#vista .card'),
          barra:[...document.querySelectorAll('#navCliente .nvs-item')].map(b=>b.dataset.k),
          error:(document.querySelector('#app')||{}).innerText||'',
          texto:document.body.innerText.slice(0,80)})""")
        print(tag, '->', 'portal abierto' if r['vista'] else 'sin portal', '|', r['texto'].replace(chr(10), ' ')[:60])
        if r['vista']:
            check(r['barra'] == SECCIONES, tag + ': el enlace activo deberia traer las 6 secciones: ' + str(r['barra']))
        else:
            check(len(r['error'].strip()) > 20, tag + ': un enlace revocado deberia explicar el problema, no quedarse en blanco: ' + repr(r['error'][:60]))
        ctx.close()

print('')
print('== errores de consola ==')
for e in errores: print(' -', e)
print('== fallos ==')
for f in fallos: print(' -', f)
print('')
print('RESULTADO:', 'OK' if not errores and not fallos else 'FALLA')
sys.exit(0 if not errores and not fallos else 1)
