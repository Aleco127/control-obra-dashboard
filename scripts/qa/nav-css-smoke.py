# -*- coding: utf-8 -*-
"""
nav-css-smoke.py (US-604): comprueba en el navegador que nav-shell.css carga junto a styles.css (app) y en el portal,
y que los estados de la barra resuelven a los tokens esperados: activo (--accent sobre --accent-soft), badge (--danger),
foco (--ring), área táctil >= 44 px en 390 px, colapsado con flyout y prefers-reduced-motion sin transiciones.
No pinta nada en #nv: inyecta un contenedor temporal con NavShell.render() y lo borra al final. Cero errores de consola.

Uso (con los tokens de .env cargados):
  PYTHONIOENCODING=utf-8 python scripts/qa/nav-css-smoke.py --app http://127.0.0.1:8765/index.html?app=1 --portal http://127.0.0.1:8765/portal.html
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8765/index.html?app=1')
ap.add_argument('--portal', default='http://127.0.0.1:8765/portal.html')
ap.add_argument('--out', default='')
args = ap.parse_args()
TOKEN = os.environ.get('OBRA_QA_TOKEN', '')
PTOKEN = os.environ.get('PORTAL_QA_TOKEN', '')
if not TOKEN or not PTOKEN:
    print('Faltan OBRA_QA_TOKEN / PORTAL_QA_TOKEN en el entorno'); sys.exit(2)

MODELO = {
    'modo': 'constructora',
    'marca': {'nombre': 'QA RALPH Constructora de prueba', 'sub': 'Ricardo · Administrador'},
    'contexto': {'etiqueta': 'Obra activa', 'titulo': 'QA-01', 'sub': 'Obra de prueba', 'avance': 42, 'semaforo': 'warn', 'onClick': 'void 0', 'accion': 'Cambiar', 'onAccion': 'void 0'},
    'fijados': ['g', 'o'],
    'activo': 'g',
    'grupos': [
        {'k': 'inicio', 'items': [{'k': 'd', 't': 'Inicio', 'ic': 'ri-home-line'}]},
        {'k': 'obra', 't': 'Obra', 'ic': 'ri-building-line', 'items': [
            {'k': 'o', 't': 'Obras', 'ic': 'ri-building-2-line'},
            {'k': 'g', 't': 'Compras y gastos', 'ic': 'ri-shopping-cart-line', 'badge': 12},
            {'k': 'w', 't': 'Programa', 'ic': 'ri-calendar-line', 'badge': True},
            {'k': 'b', 't': 'Bitácora', 'ic': 'ri-book-line', 'secundario': True},
        ]},
        {'k': 'conta', 't': 'Contabilidad', 'ic': 'ri-calculator-line', 'abierto': False, 'items': [
            {'k': 'so', 't': 'Socios', 'ic': 'ri-group-line', 'candado': True},
            {'k': 'ci', 't': 'Cierres', 'ic': 'ri-lock-line', 'candado': True},
        ]},
        {'k': 'admin', 't': 'Administración', 'plano': True, 'separador': True, 'items': [
            {'k': 'q', 't': 'Reportes', 'ic': 'ri-file-chart-line'}, {'k': 'z', 't': 'Configuración', 'ic': 'ri-settings-3-line'}]},
    ],
    'acciones': [{'k': 'buscar', 't': 'Buscar', 'ic': 'ri-search-line', 'atajo': 'Ctrl+K'}, {'k': 'salir', 't': 'Cerrar sesión', 'ic': 'ri-logout-box-line', 'tono': 'danger'}],
    'inferior': {'items': ['b', 'o', 'g', 'w'], 'plus': {'t': 'Captura rápida'}, 'mas': {'t': 'Más'}},
    'onItem': 'void 0',
}
MODELO_CLIENTE = {
    'modo': 'cliente', 'marca': {'nombre': 'QA RALPH Constructora', 'sub': 'Cliente de prueba'}, 'activo': 'pagos',
    'grupos': [{'k': 'sec', 'plano': True, 'items': [
        {'k': 'inicio', 't': 'Inicio', 'ic': 'inicio'}, {'k': 'avance', 't': 'Avance', 'ic': 'avance'}, {'k': 'pagos', 't': 'Pagos', 'ic': 'pagos', 'badge': True},
        {'k': 'entregables', 't': 'Entregables', 'ic': 'entregables', 'badge': 2}, {'k': 'fotos', 't': 'Fotos', 'ic': 'fotos', 'badge': 5}, {'k': 'contacto', 't': 'Contacto', 'ic': 'contacto'}]}],
    'acciones': [{'k': 'pass', 't': 'Cambiar contraseña', 'ic': 'cuenta'}, {'k': 'salir', 't': 'Salir', 'ic': 'mas', 'tono': 'danger'}],
    'inferior': {'items': ['inicio', 'avance', 'pagos', 'entregables', 'fotos']}, 'onItem': 'void 0',
}

INYECTAR = """([modelo, colapsado]) => {
  document.getElementById('qaNvs')?.remove(); document.getElementById('qaNvsB')?.remove();
  const r = NavShell.render(Object.assign({}, modelo, { colapsado }));
  const d = document.createElement('div'); d.id = 'qaNvs'; d.style.cssText = 'position:fixed;left:0;top:0;width:' + (colapsado ? 64 : 224) + 'px;height:100vh;overflow:auto;background:var(--surface);z-index:2000';
  d.innerHTML = r.aside; document.body.appendChild(d);
  const b = document.createElement('div'); b.id = 'qaNvsB'; b.innerHTML = r.bottom; document.body.appendChild(b);
  return { aside: r.aside.length, bottom: r.bottom.length };
}"""

MEDIR = """() => {
  const cs = (el, p) => el ? getComputedStyle(el).getPropertyValue(p).trim() : null;
  const root = document.getElementById('qaNvs');
  const act = root.querySelector('.nvs-item.active');
  const item = root.querySelector('.nvs-grupo-items .nvs-item:not(.active)') || root.querySelector('.nvs-grupos .nvs-item:not(.active)');
  const badge = root.querySelector('.nvs-badge:not(.nvs-dot)');
  const dot = root.querySelector('.nvs-badge.nvs-dot');
  const lock = root.querySelector('.nvs-item.nvs-locked');
  const cab = root.querySelector('.nvs-grupo-h[aria-expanded="false"]');
  const chev = cab && cab.querySelector('.nvs-chev');
  const cerrado = root.querySelector('.nvs-grupo-h[aria-expanded="false"] + .nvs-grupo-items');
  const tx = root.querySelector('.nvs-grupos .nvs-tx');
  const fly = root.querySelector('.nvs-fly');
  const bottom = document.querySelector('#qaNvsB .nvs-bottom');
  const bItem = bottom && bottom.querySelector('.nvs-item');
  const plus = bottom && bottom.querySelector('.nvs-bottom-plus > span');
  const hojaCss = [...document.styleSheets].some(s => s.href && /nav-shell\\./.test(s.href));
  const alto = (el) => el ? Math.round(el.getBoundingClientRect().height) : null;
  const marcaNombre = root.querySelector('.nvs-marca-nombre');
  return {
    hojaCss,
    activoBg: cs(act, 'background-color'), activoColor: cs(act, 'color'), activoPeso: cs(act, 'font-weight'), activoCurrent: act && act.getAttribute('aria-current'),
    itemColor: cs(item, 'color'), itemAlto: alto(item), activoAlto: alto(act),
    badgeBg: cs(badge, 'background-color'), badgeColor: cs(badge, 'color'), dotBg: cs(dot, 'background-color'), dotAncho: alto(dot),
    lockColor: cs(lock, 'color'), chevTransform: cs(chev, 'transform'), cerradoDisplay: cs(cerrado, 'display'),
    txDisplay: cs(tx, 'display'), flyDisplay: cs(fly, 'display'), flyPos: cs(fly, 'position'),
    marcaLineas: alto(marcaNombre),
    bottomDisplay: cs(bottom, 'display'), bottomPos: cs(bottom, 'position'), bItemAlto: alto(bItem), bItemAncho: bItem ? Math.round(bItem.getBoundingClientRect().width) : null,
    plusBg: cs(plus, 'background-color'), plusAlto: alto(plus),
    transicion: cs(act, 'transition-duration'),
    tokens: { accentSoft: cs(document.documentElement, '--accent-soft'), ring: cs(document.documentElement, '--ring'), tap: cs(document.documentElement, '--tap'), sbw: cs(document.documentElement, '--sb-w') },
  };
}"""

def esperar(v, ok, nombre, fallas):
    if not ok: fallas.append(f'{nombre}: {v!r}')

def smoke_app(pw, ancho, alto, reduced, errores, fallas):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', reduced_motion='reduce' if reduced else 'no-preference', is_mobile=ancho < 768, has_touch=ancho < 768)
    page = ctx.new_page()
    page.on('console', lambda m: errores.append(f'app{ancho} console.error: {m.text}') if m.type == 'error' and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text else None)
    page.on('pageerror', lambda e: errores.append(f'app{ancho} pageerror: {e}'))
    page.goto(args.app, wait_until='domcontentloaded')
    page.evaluate("t=>{localStorage.setItem('obra_session',JSON.stringify({token:t}));Object.keys(localStorage).filter(k=>k.startsWith('obra_cache')).forEach(k=>localStorage.removeItem(k))}", TOKEN)
    page.reload(wait_until='commit')
    page.wait_for_function("()=>typeof D!=='undefined'&&D.o&&D.o.length>0&&typeof NavShell==='object'", timeout=90000)
    time.sleep(0.8)
    page.evaluate(INYECTAR, [MODELO, False])
    m = page.evaluate(MEDIR)
    pre = f'app {ancho}px{" reduced" if reduced else ""}'
    esperar(m['hojaCss'], m['hojaCss'] is True, pre + ' hoja nav-shell.css cargada', fallas)
    esperar(m['tokens'], m['tokens']['accentSoft'] and m['tokens']['ring'] and m['tokens']['sbw'] == '224px', pre + ' tokens de styles.css', fallas)
    esperar(m['activoBg'], m['activoBg'] == 'rgb(224, 242, 254)', pre + ' activo fondo --accent-soft', fallas)
    esperar(m['activoColor'], m['activoColor'] == 'rgb(3, 105, 161)', pre + ' activo color --accent', fallas)
    esperar(m['activoCurrent'], m['activoCurrent'] == 'page', pre + ' activo aria-current', fallas)
    esperar(m['itemColor'], m['itemColor'] == 'rgb(71, 85, 105)', pre + ' ítem reposo --ink-muted', fallas)
    esperar(m['badgeBg'], m['badgeBg'] == 'rgb(185, 28, 28)' and m['badgeColor'] == 'rgb(255, 255, 255)', pre + ' badge --danger / blanco', fallas)
    esperar(m['dotBg'], m['dotBg'] == 'rgb(185, 28, 28)' and m['dotAncho'] == 8, pre + ' punto 8 px --danger', fallas)
    esperar(m['lockColor'], m['lockColor'] == 'rgb(100, 116, 139)', pre + ' candado --ink-subtle', fallas)
    esperar(m['chevTransform'], m['chevTransform'] not in (None, 'none'), pre + ' chevrón girado en grupo cerrado', fallas)
    esperar(m['cerradoDisplay'], m['cerradoDisplay'] == 'none', pre + ' grupo cerrado oculto', fallas)
    esperar(m['plusBg'], m['plusBg'] == 'rgb(30, 58, 95)' and (ancho >= 768 or m['plusAlto'] == 52), pre + ' botón + --primary (52 px en móvil)', fallas)
    minimo = 44 if ancho < 768 else 36
    esperar((m['itemAlto'], m['activoAlto']), m['itemAlto'] >= minimo and m['activoAlto'] >= minimo, pre + f' alto de ítem >= {minimo}', fallas)
    if ancho < 768:
        esperar(m['bottomDisplay'], m['bottomDisplay'] == 'flex' and m['bottomPos'] == 'fixed', pre + ' barra inferior visible y fija', fallas)
        esperar((m['bItemAlto'], m['bItemAncho']), m['bItemAlto'] >= 44 and m['bItemAncho'] >= 44, pre + ' ítem inferior >= 44 px', fallas)
    else:
        esperar(m['bottomDisplay'], m['bottomDisplay'] == 'none', pre + ' barra inferior oculta en escritorio', fallas)
    if reduced:
        # styles.css pone transition-duration:.01ms en * (1e-05s); nav-shell.css pone transition:none (0s). Ambos anulan el movimiento.
        esperar(m['transicion'], all(float(x) < 0.001 for x in m['transicion'].replace('s', '').split(',')), pre + ' sin transiciones con movimiento reducido', fallas)
    else:
        esperar(m['transicion'], m['transicion'].startswith('0.15s'), pre + ' transición 150 ms', fallas)
    # Foco visible con --ring
    page.focus('#qaNvs .nvs-item.active')
    foco = page.evaluate("()=>{const e=document.activeElement;const c=getComputedStyle(e);return {outline:c.outlineColor,ancho:c.outlineWidth,estilo:c.outlineStyle}}")
    esperar(foco, foco['outline'] == 'rgb(2, 132, 199)' and foco['ancho'] == '2px' and foco['estilo'] == 'solid', pre + ' foco --ring 2 px', fallas)
    if ancho >= 768 and not reduced:
        # Colapsado: textos ocultos, flyout oculto hasta el cursor
        page.evaluate(INYECTAR, [MODELO, True])
        mc = page.evaluate(MEDIR)
        esperar(mc['txDisplay'], mc['txDisplay'] == 'none', pre + ' colapsado oculta .nvs-tx', fallas)
        esperar(mc['flyDisplay'], mc['flyDisplay'] == 'none' and mc['flyPos'] == 'absolute', pre + ' flyout oculto y absoluto', fallas)
        esperar(mc['activoAlto'], mc['activoAlto'] >= 44, pre + ' colapsado ítem >= 44', fallas)
        page.hover('#qaNvs .nvs-grupo[data-grupo="obra"] .nvs-grupo-h')
        fd = page.evaluate("()=>{const f=document.querySelector('#qaNvs .nvs-grupo[data-grupo=\"obra\"] .nvs-fly');const c=getComputedStyle(f);return {display:c.display,ancho:Math.round(f.getBoundingClientRect().width),tx:getComputedStyle(f.querySelector('.nvs-tx')).display}}")
        esperar(fd, fd['display'] == 'flex' and fd['ancho'] >= 200 and fd['tx'] == 'block', pre + ' flyout abre al pasar el cursor con nombres', fallas)
        page.mouse.move(600, 600)
        page.focus('#qaNvs .nvs-grupo[data-grupo="conta"] .nvs-grupo-h')
        ff = page.evaluate("()=>getComputedStyle(document.querySelector('#qaNvs .nvs-grupo[data-grupo=\"conta\"] .nvs-fly')).display")
        esperar(ff, ff == 'flex', pre + ' flyout abre con el foco (focus-within)', fallas)
    shot = ''
    if args.out:
        os.makedirs(args.out, exist_ok=True)
        page.evaluate(INYECTAR, [MODELO, False])
        shot = os.path.join(args.out, f'us604-app-{ancho}{"-reduced" if reduced else ""}.png'); page.screenshot(path=shot)
    page.evaluate("()=>{document.getElementById('qaNvs')?.remove();document.getElementById('qaNvsB')?.remove()}")
    ctx.close()
    return m, shot

def smoke_portal(pw, ancho, alto, errores, fallas):
    ctx = pw.chromium.launch().new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
    page = ctx.new_page()
    page.on('console', lambda m: errores.append(f'portal{ancho} console.error: {m.text}') if m.type == 'error' and 'ERR_CONNECTION' not in m.text else None)
    page.on('pageerror', lambda e: errores.append(f'portal{ancho} pageerror: {e}'))
    page.goto(args.portal, wait_until='domcontentloaded')
    page.evaluate("t=>localStorage.setItem('portal_sesion',t)", PTOKEN)
    page.reload(wait_until='commit')
    page.wait_for_function("()=>typeof NavShell==='object'&&document.querySelector('#app')&&!/Cargando/.test(document.querySelector('#app').textContent)", timeout=60000)
    time.sleep(0.5)
    page.evaluate(INYECTAR, [MODELO_CLIENTE, False])
    m = page.evaluate(MEDIR)
    pre = f'portal {ancho}px'
    esperar(m['hojaCss'], m['hojaCss'] is True, pre + ' hoja nav-shell.css cargada', fallas)
    esperar(m['tokens'], m['tokens']['accentSoft'] == '#e0f2fe' and m['tokens']['ring'] == '#0284c7' and m['tokens']['tap'] == '44px' and m['tokens']['sbw'] == '240px', pre + ' tokens definidos en :root del portal', fallas)
    esperar(m['activoBg'], m['activoBg'] == 'rgb(224, 242, 254)' and m['activoColor'] == 'rgb(3, 105, 161)', pre + ' activo --accent sobre --accent-soft', fallas)
    esperar(m['itemColor'], m['itemColor'] == 'rgb(85, 103, 122)', pre + ' ítem reposo --ink-muted (= --muted del portal)', fallas)
    esperar(m['badgeBg'], m['badgeBg'] == 'rgb(185, 28, 28)' and m['badgeColor'] == 'rgb(255, 255, 255)', pre + ' badge --danger', fallas)
    svg = page.evaluate("()=>{const s=document.querySelector('#qaNvs .nvs-item.active .nvs-ic svg');return s?Math.round(s.getBoundingClientRect().width):null}")
    esperar(svg, svg == 20, pre + ' ícono SVG inlineado a 20 px', fallas)
    if ancho < 900:
        esperar(m['bottomDisplay'], m['bottomDisplay'] == 'flex' and m['bItemAlto'] >= 44, pre + ' barra inferior del cliente visible >= 44', fallas)
    else:
        esperar(m['bottomDisplay'], m['bottomDisplay'] == 'none', pre + ' barra inferior del cliente oculta >= 900', fallas)
    page.focus('#qaNvs .nvs-item.active')
    foco = page.evaluate("()=>{const c=getComputedStyle(document.activeElement);return c.outlineColor+' '+c.outlineWidth}")
    esperar(foco, foco == 'rgb(2, 132, 199) 2px', pre + ' foco --ring', fallas)
    shot = ''
    if args.out:
        shot = os.path.join(args.out, f'us604-portal-{ancho}.png'); page.screenshot(path=shot)
    page.evaluate("()=>{document.getElementById('qaNvs')?.remove();document.getElementById('qaNvsB')?.remove()}")
    ctx.close()
    return m, shot

errores, fallas, resumen = [], [], {}
with sync_playwright() as pw:
    resumen['app1440'] = smoke_app(pw, 1440, 900, False, errores, fallas)[0]
    resumen['app390'] = smoke_app(pw, 390, 844, False, errores, fallas)[0]
    resumen['app1440reduced'] = smoke_app(pw, 1440, 900, True, errores, fallas)[0]
    resumen['portal1440'] = smoke_portal(pw, 1440, 900, errores, fallas)[0]
    resumen['portal390'] = smoke_portal(pw, 390, 844, errores, fallas)[0]

print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != 'tokens'} for k, v in resumen.items()}, ensure_ascii=False, indent=1))
print('\nErrores de consola:', len(errores)); [print(' -', e) for e in errores]
print('Comprobaciones fallidas:', len(fallas)); [print(' -', f) for f in fallas]
sys.exit(1 if errores or fallas else 0)
