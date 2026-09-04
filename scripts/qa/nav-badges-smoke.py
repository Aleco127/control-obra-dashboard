# -*- coding: utf-8 -*-
"""
nav-badges-smoke.py (US-610): contadores y candados de plan de la barra (build local en dist/).
Comprueba: navBadges() es la única fuente (aside y barra inferior pintan los mismos números para g/pc/w/ci y coinciden
con los datos de D); el aria-label incluye «(N pendientes)» con singular y plural; con el plan restringido los ítems
so/ci salen con .nvs-locked, data-candado y title «Disponible en Estudio y Constructora» sin desaparecer de la barra,
y el clic sigue llevando al aviso de plan. Cero errores de consola.

Uso (con OBRA_QA_TOKEN en el entorno):
  PYTHONIOENCODING=utf-8 python scripts/qa/nav-badges-smoke.py --app http://127.0.0.1:8765/index.html?app=1 --out docs/qa/nav
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8765/index.html?app=1')
ap.add_argument('--out', default='')
args = ap.parse_args()
TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
if not TOKEN:
    print('Falta OBRA_QA_TOKEN en el entorno'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)

errores, fallos = [], []
def check(cond, msg):
    if not cond: fallos.append(msg)

LISTO = "()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&currentUser&&document.querySelector('#nv .nvs')"

def abrir(pw, ancho, alto, tag):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
    page = ctx.new_page()
    page.on('console', lambda m: errores.append(tag + ' console.error: ' + m.text) if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text else None)
    page.on('pageerror', lambda e: errores.append(tag + ' pageerror: ' + str(e)))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", TOKEN)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=90000)
    page.wait_for_timeout(2500)
    return ctx, page

def snap(page, nombre):
    if args.out: page.screenshot(path=os.path.join(args.out, nombre), full_page=False)

with sync_playwright() as pw:
    ctx, page = abrir(pw, 1440, 900, 'app1440')

    # 1) navBadges: cuatro claves, números coherentes con D y sin undefined
    b = page.evaluate("""()=>{const b=navBadges();
      const hoy=new Date().toISOString().slice(0,10);
      const obras=getObrasPermitidas().map(o=>o.id);
      return {badges:b,
        gEsperado:(D.g||[]).filter(x=>x.empresa_id===currentUser.empresa_id&&!x.aprobado_at&&x.estatus_pago!=='Rechazado').length,
        pcEsperado:(D.cxc||[]).filter(x=>obras.includes(x.obra_id)&&(parseFloat(x.monto_pendiente)||0)>0.009&&x.fecha_vencimiento&&x.fecha_vencimiento<hoy).length,
        cierresCargados:Array.isArray(D.cierres),nivel:currentUser.nivel};}""")
    print('navBadges:', json.dumps(b, ensure_ascii=False))
    check(sorted(b['badges'].keys()) == ['ci', 'g', 'pc', 'w'], 'navBadges deberia devolver g/pc/w/ci: ' + str(b['badges']))
    check(all(isinstance(v, int) for v in b['badges'].values()), 'hay contadores que no son numeros: ' + str(b['badges']))
    check(b['badges']['g'] == b['gEsperado'], 'g: ' + str(b['badges']['g']) + ' != ' + str(b['gEsperado']))
    check(b['badges']['pc'] == b['pcEsperado'], 'pc: ' + str(b['badges']['pc']) + ' != ' + str(b['pcEsperado']))
    check(b['cierresCargados'] or b['nivel'] < 45, 'con nivel >= 45 D.cierres deberia cargarse solo para el badge de ci')

    # 2) El aside pinta exactamente esos números, con el aria-label accesible
    dom = page.evaluate("""()=>{const o={};for(const k of ['g','pc','w','ci']){const el=document.querySelector('#nv .nvs-grupos [data-k="'+k+'"]');
      o[k]=el?{badge:(el.querySelector('.nvs-badge')||{}).textContent||'',aria:el.getAttribute('aria-label')}:null;}return o;}""")
    print('aside:', json.dumps(dom, ensure_ascii=False))
    for k, n in b['badges'].items():
        d = dom.get(k)
        if not d: continue
        check((d['badge'] or '0') == (str(n) if n else '0'), 'badge de ' + k + ' en el aside: ' + str(d['badge']) + ' != ' + str(n))
        if n:
            palabra = ' pendiente)' if n == 1 else ' pendientes)'
            check(d['aria'].endswith('(' + str(n) + palabra), 'aria-label de ' + k + ': ' + str(d['aria']))

    # 3) La barra inferior usa los mismos contadores (nada de cálculos duplicados)
    # US-613: la barra inferior la pinta NavShell (.nvs-bottom-item con data-k)
    inf = page.evaluate("""()=>{updateMobileBottomNav();const o={};
      for(const el of document.querySelectorAll('#mobileBottomNav .nvs-bottom-item[data-k]')){
        const m=(el.getAttribute('aria-label')||'').match(/[(](\d+) pendientes?[)]/);
        o[el.dataset.k]=m?parseInt(m[1]):0;}return o;}""")
    print('barra inferior:', inf)
    for k, n in inf.items():
        check(n == b['badges'].get(k, 0), 'la barra inferior pinta ' + str(n) + ' en ' + k + ' y el aside ' + str(b['badges'].get(k, 0)))

    # 4) Candado de plan: so y ci se quedan en la barra pero bloqueados
    # Contabilidad viene cerrada por omisión: hay que abrirla para poder tocar sus ítems
    page.evaluate("()=>{const s=document.querySelector('#nv .nvs-grupo[data-grupo=\"contabilidad\"]');if(s)NavShell.alternarGrupo(s,true);}")
    page.wait_for_timeout(300)
    page.evaluate("""()=>{window.__mp=Suscripcion.moduloPermitido;Suscripcion.moduloPermitido=k=>!['so','ci'].includes(k);N.dirty=true;N();}""")
    page.wait_for_timeout(500)
    lock = page.evaluate("""()=>{const o={};for(const k of ['so','ci','g']){const el=document.querySelector('#nv .nvs-grupos [data-k="'+k+'"]');
      o[k]=el?{locked:el.classList.contains('nvs-locked'),cand:el.getAttribute('data-candado'),title:el.getAttribute('title'),aria:el.getAttribute('aria-label'),icono:!!el.querySelector('.nvs-lock')}:null;}return o;}""")
    print('candados:', json.dumps(lock, ensure_ascii=False))
    for k in ('so', 'ci'):
        d = lock.get(k)
        check(d is not None, k + ' desaparecio de la barra al bloquearlo (debe verse con candado)')
        if d:
            check(d['locked'] and d['cand'] == '1' and d['icono'], k + ' sin marca de candado: ' + str(d))
            check(d['title'] == 'Disponible en Estudio y Constructora', k + ' title: ' + str(d['title']))
            check('Disponible en Estudio y Constructora' in (d['aria'] or ''), k + ' aria-label: ' + str(d['aria']))
    check(lock['g'] and not lock['g']['locked'] and not lock['g']['title'], 'un modulo del plan no debe llevar candado: ' + str(lock['g']))
    snap(page, 'us610-candados-1440.png')

    # 5) El clic sigue abriendo el aviso de plan (mismo flujo de antes)
    page.click('#nv .nvs-grupos [data-k="so"]'); page.wait_for_timeout(900)
    plan = page.evaluate("()=>({m:M,txt:document.querySelector('#c')?.innerText.slice(0,160)||''})")
    print('clic en so:', plan)
    check(plan['m'] == 'so', 'el clic deberia navegar a so aunque este bloqueado')
    check('plan' in plan['txt'].lower(), 'no salio el aviso de plan: ' + plan['txt'])
    page.evaluate("()=>{Suscripcion.moduloPermitido=window.__mp;M='d';N.dirty=true;R();}")
    ctx.close()

print('')
print('== errores de consola ==')
for e in errores: print(' -', e)
print('== fallos ==')
for f in fallos: print(' -', f)
print('')
print('RESULTADO:', 'OK' if not errores and not fallos else 'FALLA')
sys.exit(0 if not errores and not fallos else 1)
