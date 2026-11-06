# -*- coding: utf-8 -*-
"""
portal-capturas.py (US-701A): capturas y HTML pintado de las seis secciones del portal, con sesión de cuenta y con
enlace de token, en 1440 y 390 px. Sirve para comparar antes y después de un cambio que no debe alterar el
comportamiento: corre una vez con --out antes, otra con --out despues y luego --comparar antes despues.

Uso: PORTAL_QA_TOKEN (sesión de cuenta) y PORTAL_QA_OBRA_TOKEN (enlace de obra, 48 hex) en el entorno.
  PYTHONIOENCODING=utf-8 python scripts/qa/portal-capturas.py --out docs/qa/us701a/antes
  PYTHONIOENCODING=utf-8 python scripts/qa/portal-capturas.py --comparar docs/qa/us701a/antes docs/qa/us701a/despues
"""
import argparse, json, os, sys

ap = argparse.ArgumentParser()
ap.add_argument('--portal', default='http://127.0.0.1:8765/portal.html')
ap.add_argument('--out', default='')
ap.add_argument('--comparar', nargs=2, metavar=('ANTES', 'DESPUES'))
args = ap.parse_args()

SECCIONES = ['inicio', 'avance', 'diario', 'pagos', 'entregables', 'fotos', 'contacto']

if args.comparar:
    import re
    # El HTML colapsa los espacios: la sangría de las plantillas no cuenta como diferencia
    plano = lambda d: {k: re.sub(r'\s+', ' ', v).replace('> <', '><') for k, v in d.items()}
    a, b = [plano(json.load(open(os.path.join(d, 'html.json'), encoding='utf-8'))) for d in args.comparar]
    distintos = [k for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)]
    print(f'{len(a)} vistas antes, {len(b)} después; distintas: {len(distintos)}')
    for k in distintos:
        x, y = a.get(k) or '', b.get(k) or ''
        i = next((n for n in range(min(len(x), len(y))) if x[n] != y[n]), min(len(x), len(y)))
        print(f'  {k}: difiere en el carácter {i}\n    antes:   {x[max(0, i - 60):i + 100]!r}\n    después: {y[max(0, i - 60):i + 100]!r}')
    # Capturas: pixel por pixel (si hay Pillow)
    pix = []
    try:
        from PIL import Image, ImageChops
        for f in sorted(x for x in os.listdir(args.comparar[0]) if x.endswith('.png')):
            x, y = [Image.open(os.path.join(d, f)).convert('RGB') for d in args.comparar]
            if x.size != y.size or ImageChops.difference(x, y).getbbox(): pix.append(f'{f} {x.size} → {y.size}')
        print(f'capturas distintas: {len(pix)}')
        for p in pix: print('  ' + p)
    except ImportError:
        print('Pillow no está instalado: sin comparación de pixeles')
    sys.exit(1 if distintos or pix else 0)

from playwright.sync_api import sync_playwright
TS = os.environ.get('PORTAL_QA_TOKEN', '')
TT = os.environ.get('PORTAL_QA_OBRA_TOKEN', '')
if not TS or not TT or not args.out:
    print('Faltan PORTAL_QA_TOKEN, PORTAL_QA_OBRA_TOKEN o --out'); sys.exit(2)
os.makedirs(args.out, exist_ok=True)
errores, html = [], {}

# Lo pintado, sin lo que cambia de una corrida a otra (ligas firmadas de fotos)
PINTADO = """() => {
  const limpia = s => s.replace(/(token|X-Amz-[A-Za-z-]+|Signature|Expires)=[^&"' ]+/g, '$1=…');
  return limpia(['#navCliente', '#app', '#pie', '#navClienteBottom'].map(s => { const e = document.querySelector(s); return s + '\\n' + (e ? e.innerHTML : '(no existe)'); }).join('\\n'))
    + '\\n[title] ' + document.title + '\\n[desborde] ' + (document.documentElement.scrollWidth > window.innerWidth);
}"""

with sync_playwright() as pw:
    nav = pw.chromium.launch()
    for modo in ('cuenta', 'token'):
        for ancho, alto in ((1440, 900), (390, 844)):
            tag = f'{modo}-{ancho}'
            c = nav.new_context(viewport={'width': ancho, 'height': alto}, locale='es-MX', is_mobile=ancho < 768, has_touch=ancho < 768)
            page = c.new_page()
            page.on('console', lambda m, tag=tag: errores.append(tag + ' console.error: ' + m.text) if m.type == 'error' else None)
            page.on('pageerror', lambda e, tag=tag: errores.append(tag + ' pageerror: ' + str(e)))
            url = args.portal + ('?t=' + TT if modo == 'token' else '')
            page.goto(url, wait_until='domcontentloaded')
            if modo == 'cuenta':
                page.evaluate("t=>localStorage.setItem('portal_sesion',t)", TS)
                page.goto(url, wait_until='domcontentloaded')
            page.wait_for_selector('#vista', timeout=20000)
            for s in SECCIONES:
                page.evaluate("s=>{location.hash='#'+s}", s)
                page.wait_for_function("s=>document.title.startsWith({inicio:'Inicio',avance:'Avance',diario:'Diario',pagos:'Pagos',entregables:'Entregables',fotos:'Fotos',contacto:'Contacto'}[s])", arg=s, timeout=10000)
                page.wait_for_load_state('networkidle')
                html[f'{tag}-{s}'] = page.evaluate(PINTADO)
                page.screenshot(path=os.path.join(args.out, f'{tag}-{s}.png'), full_page=True)
            # Menús de la cabecera móvil
            if ancho < 900:
                page.click('#btnCuenta')
                html[f'{tag}-menu-cuenta'] = page.evaluate("()=>document.querySelector('#menuPortal').innerHTML")
                page.screenshot(path=os.path.join(args.out, f'{tag}-menu-cuenta.png'))
                page.keyboard.press('Escape')
            c.close()
    # Pantalla de entrada (sin sesión ni token); no se envía nada
    c = nav.new_context(viewport={'width': 390, 'height': 844}, locale='es-MX')
    page = c.new_page()
    page.on('pageerror', lambda e: errores.append('login pageerror: ' + str(e)))
    page.goto(args.portal, wait_until='domcontentloaded')
    page.wait_for_selector('#formLogin', timeout=15000)
    html['login-390'] = page.evaluate("()=>document.querySelector('#app').innerHTML")
    page.screenshot(path=os.path.join(args.out, 'login-390.png'))
    c.close()
    nav.close()

json.dump(html, open(os.path.join(args.out, 'html.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
desbordes = [k for k, v in html.items() if v.endswith('[desborde] True')]
print(f'{len(html)} vistas guardadas en {args.out} · errores de consola: {len(errores)} · con desborde: {len(desbordes)}')
for e in errores: print('  ' + e)
for d in desbordes: print('  desborde: ' + d)
sys.exit(1 if errores or desbordes else 0)
