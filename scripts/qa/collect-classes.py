"""Recolecta las clases de Tailwind que la app usa en tiempo de ejecución (producción con JIT por CDN o build local)
recorriendo 34 módulos en escritorio y móvil, más los diálogos principales. Escribe tailwind.safelist.json, que
tailwind.config.js incluye como safelist exacto: así el CSS compilado cubre también las clases armadas con variables.
Uso: python scripts/qa/collect-classes.py [--url https://app.supernovarquitectos.com]
"""
import argparse, json, os, time, re
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser(); ap.add_argument('--url', default='https://app.supernovarquitectos.com'); ap.add_argument('--token', default=os.environ.get('OBRA_QA_TOKEN'), help='sesión de QA (o variable OBRA_QA_TOKEN); nunca pegarla en el código')
args = ap.parse_args()
if not args.token:
    raise SystemExit('Falta --token o la variable OBRA_QA_TOKEN')
MODULOS = ['d','o','p','w','g','pc','ct','es','cb','fc','ce','rt','dc','rp','su','ci','so','s','m','b','c','r','u','y','k','f','e','n','t','v','l','q','z','h']
ACCIONES = ["typeof newGasto==='function'&&newGasto()", "typeof WizardObra!=='undefined'&&WizardObra.open({})", "typeof Compras!=='undefined'&&Compras.rapido&&Compras.rapido()", "typeof Socios!=='undefined'&&Socios.nuevoReparto&&Socios.nuevoReparto()", "typeof PagosProv!=='undefined'&&PagosProv.abrir&&PagosProv.abrir({})", "typeof Ayuda!=='undefined'&&Ayuda.abrir()", "typeof Suscripcion!=='undefined'&&Suscripcion.irAPlan()"]
clases = set()
JS = "()=>{const s=new Set();document.querySelectorAll('*').forEach(e=>{(e.getAttribute('class')||'').split(/\\s+/).forEach(c=>c&&s.add(c));});return [...s];}"
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    for vp, mobile in [({'width': 1440, 'height': 900}, False), ({'width': 390, 'height': 844}, True)]:
        ctx = b.new_context(viewport=vp, is_mobile=mobile, locale='es-MX'); page = ctx.new_page()
        page.goto(args.url + '/?v=' + str(int(time.time())), wait_until='domcontentloaded')
        clases.update(page.evaluate(JS))  # login
        page.evaluate("()=>switchAuthTab('registro')"); clases.update(page.evaluate(JS))
        page.evaluate("t=>localStorage.setItem('obra_session',JSON.stringify({token:t}))", args.token)
        page.reload(wait_until='domcontentloaded')
        page.wait_for_function("()=>typeof Compras!=='undefined'&&currentUser&&D.g&&D.g.length&&D.soc", timeout=90000); time.sleep(1.5)
        for m in MODULOS:
            try: page.evaluate(f"()=>{{M='{m}';R();}}"); time.sleep(0.5); clases.update(page.evaluate(JS))
            except Exception: pass
        for a in ACCIONES:
            try: page.evaluate('()=>{' + a + '}'); time.sleep(0.8); clases.update(page.evaluate(JS)); page.evaluate("()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close())")
            except Exception: pass
        ctx.close()
    b.close()
# Sólo clases con pinta de Tailwind (evita ids/estados propios); las propias viven en styles.css
tw = sorted(c for c in clases if re.match(r'^(-?[a-z0-9]+:)*-?[a-z][a-z0-9-]*(\[[^\]]+\])?(/[0-9]+)?$', c) and len(c) < 60)
json.dump(tw, open('tailwind.safelist.json', 'w', encoding='utf-8'), indent=0)
print(f'{len(clases)} clases vistas, {len(tw)} candidatas de Tailwind en tailwind.safelist.json')
