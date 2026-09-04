# -*- coding: utf-8 -*-
"""
nav-empresa-smoke.py (US-614): la personalización de la barra por empresa sí se aplica (build local en dist/).
Comprueba con la empresa 6 (datos de prueba, 31 filas en empresa_modulos): la barra muestra los nombres propios
(«Fondo de Reserva», «Cuotas», «Residentes») y no muestra los módulos con enabled=false (Obras, Programa);
esos módulos tampoco aparecen en Ctrl+K ni en la barra inferior ni en la hoja; el orden de la empresa se respeta.
Con la empresa 1 (sin filas) la barra es la estándar. Cero errores de consola.

Uso: OBRA_QA_TOKEN (empresa 1) y OBRA_QA_TOKEN_EMP6 (admin de la empresa 6) en el entorno.
  PYTHONIOENCODING=utf-8 python scripts/qa/nav-empresa-smoke.py --app http://127.0.0.1:8765/index.html?app=1
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8765/index.html?app=1')
ap.add_argument('--out', default='')
args = ap.parse_args()
T1 = os.environ.get('OBRA_QA_TOKEN', '')
T6 = os.environ.get('OBRA_QA_TOKEN_EMP6', '')
if not T1 or not T6:
    print('Faltan OBRA_QA_TOKEN / OBRA_QA_TOKEN_EMP6 en el entorno'); sys.exit(2)
if args.out: os.makedirs(args.out, exist_ok=True)

errores, fallos = [], []
esperando_error = False   # la prueba del RPC provoca un 400 a propósito
def check(cond, msg):
    if not cond: fallos.append(msg)

LISTO = "()=>typeof D!=='undefined'&&currentUser&&document.querySelector('#nv .nvs')"

def abrir(pw, token, tag, ancho=1440, alto=900):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
    page = ctx.new_page()
    page.on('console', lambda m: errores.append(tag + ' console.error: ' + m.text) if m.type == 'error' and not esperando_error and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text else None)
    page.on('pageerror', lambda e: errores.append(tag + ' pageerror: ' + str(e)))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.clear();localStorage.setItem('obra_session',JSON.stringify({token:t}));}", token)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function(LISTO, timeout=90000)
    page.wait_for_timeout(2500)
    return ctx, page

with sync_playwright() as pw:
    # ---- Empresa 6: 31 filas de personalización ----
    ctx, page = abrir(pw, T6, 'emp6')
    e6 = page.evaluate("""()=>({empresa:currentUser.empresa_id,
      config:Object.keys(empresaModulosConfig||{}).length,
      barra:[...document.querySelectorAll('#nv .nvs-grupos .nvs-item')].map(b=>[b.dataset.k,b.querySelector('.nvs-tx').textContent]),
      p:getModuloLabel('p','Presupuesto'),pc:getModuloLabel('pc','Pagos'),l:getModuloLabel('l','Clientes'),
      oVisible:moduloVisibleParaUsuario('o'),wVisible:moduloVisibleParaUsuario('w')})""")
    print('empresa 6: config', e6['config'], 'módulos en la barra', len(e6['barra']))
    print('  nombres propios:', e6['p'], '·', e6['pc'], '·', e6['l'])
    check(e6['empresa'] == 6, 'la sesion no es de la empresa 6: ' + str(e6['empresa']))
    check(e6['config'] >= 30, 'no se cargo la configuracion de la empresa: ' + str(e6['config']))
    check(e6['p'] == 'Fondo de Reserva', 'p deberia llamarse Fondo de Reserva: ' + str(e6['p']))
    check(e6['pc'] == 'Cuotas', 'pc deberia llamarse Cuotas: ' + str(e6['pc']))
    check(e6['l'] == 'Residentes', 'l deberia llamarse Residentes: ' + str(e6['l']))
    etiquetas = [t for _, t in e6['barra']]
    check('Fondo de Reserva' in etiquetas and 'Cuotas' in etiquetas and 'Residentes' in etiquetas, 'la barra no usa los nombres de la empresa: ' + str(etiquetas))
    check(not e6['oVisible'] and not e6['wVisible'], 'Obras y Programa estan en enabled=false y deberian desaparecer')
    claves = [k for k, _ in e6['barra']]
    check('o' not in claves and 'w' not in claves, 'Obras/Programa siguen en la barra: ' + str(claves))

    # No aparecen en Ctrl+K ni en la barra inferior ni en la hoja
    otros = page.evaluate("""()=>{abrirCmdk();const cmdk=[...document.querySelectorAll('#cmdkList .cmdk-item')].map(e=>e.textContent);cerrarCmdk();
      updateMobileBottomNav();const bot=[...document.querySelectorAll('#mobileBottomNav .nvs-bottom-item[data-k]')].map(b=>b.dataset.k);
      abrirHojaModulos();const hoja=[...document.querySelectorAll('#navHoja .nvs-item')].map(b=>b.dataset.k);cerrarHojaModulos();
      return{cmdk:cmdk,bot:bot,hoja:hoja};}""")
    check('o' not in otros['bot'] and 'w' not in otros['bot'], 'la barra inferior muestra modulos ocultos: ' + str(otros['bot']))
    check('o' not in otros['hoja'] and 'w' not in otros['hoja'], 'la hoja muestra modulos ocultos: ' + str(otros['hoja']))
    check(not any('Obras' == t.strip() for t in otros['cmdk']), 'Ctrl+K muestra un modulo oculto: ' + str(otros['cmdk'][:8]))

    # El orden de la empresa manda dentro del grupo
    orden = page.evaluate("()=>({p:getModuloOrden('p'),g:getModuloOrden('g'),pc:getModuloOrden('pc')})")
    print('  orden por empresa:', orden)
    check(orden['p'] == 3 and orden['g'] == 5 and orden['pc'] == 6, 'no se leyo el orden de la empresa: ' + str(orden))
    if args.out: page.screenshot(path=os.path.join(args.out, 'us614-empresa6-1440.png'))

    # La pantalla Configuración › Barra de módulos lista los 34 módulos con switch, nombre y orden
    page.evaluate("()=>{M='z';R();}"); page.wait_for_timeout(1500)
    cfg = page.evaluate("()=>{const c=document.getElementById('cfgBarra');if(!c)return null;return{filas:c.querySelectorAll('tr[data-k]').length,switches:c.querySelectorAll('.zk-switch input').length,nombres:c.querySelectorAll('input.inp').length,guardar:!!c.querySelector('button.btn-p'),nativo:c.querySelectorAll('input[type=checkbox]:not(.zk-switch input)').length};}")
    print('  Configuracion > Barra de modulos:', cfg)
    check(cfg is not None, 'la pantalla de configuracion de la barra no aparecio')
    check(bool(cfg) and cfg['filas'] == 34, 'deberia listar los 34 modulos: ' + str(cfg))
    check(bool(cfg) and cfg['switches'] == 34 and cfg['nativo'] == 0, 'los interruptores deben ser .zk-switch: ' + str(cfg))
    check(bool(cfg) and cfg['guardar'], 'falta el boton de guardar')
    if args.out: page.screenshot(path=os.path.join(args.out, 'us614-config-1440.png'))

    # El RPC rechaza una clave que no existe (lista fija de modulos): el 400 es a proposito
    esperando_error = True
    malo = page.evaluate("async()=>{const{data,error}=await sb.rpc('guardar_empresa_modulos',{p_modulos:[{modulo_key:'zz',enabled:true}]});return error?error.message:JSON.stringify(data);}")
    print('  RPC con clave invalida ->', str(malo)[:90])
    check('desconocido' in str(malo).lower(), 'el RPC deberia rechazar una clave invalida: ' + str(malo))
    page.wait_for_timeout(300)
    esperando_error = False
    ctx.close()

    # ---- Empresa 1: sin filas, barra estándar ----
    ctx, page = abrir(pw, T1, 'emp1')
    e1 = page.evaluate("""()=>({empresa:currentUser.empresa_id,config:Object.keys(empresaModulosConfig||{}).length,
      o:getModuloLabel('o','Obras'),oVisible:moduloVisibleParaUsuario('o'),
      barra:[...document.querySelectorAll('#nv .nvs-grupos .nvs-item')].map(b=>b.dataset.k)})""")
    print('empresa 1: config', e1['config'], '· Obras =', e1['o'], '· visible', e1['oVisible'])
    check(e1['config'] == 0, 'la empresa 1 no deberia tener filas de personalizacion: ' + str(e1['config']))
    check(e1['o'] == 'Obras' and e1['oVisible'], 'la empresa 1 deberia ver la barra estandar')
    check('o' in e1['barra'] and 'w' in e1['barra'], 'faltan modulos estandar en la empresa 1: ' + str(e1['barra']))
    ctx.close()

print('')
print('== errores de consola ==')
for e in errores: print(' -', e)
print('== fallos ==')
for f in fallos: print(' -', f)
print('')
print('RESULTADO:', 'OK' if not errores and not fallos else 'FALLA')
sys.exit(0 if not errores and not fallos else 1)
