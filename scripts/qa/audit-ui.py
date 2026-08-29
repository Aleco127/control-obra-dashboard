"""
Auditoría automatizada de UI (US-028 fase 1, US-132 fase 2) para Control de Obra.

Recorre los módulos principales en dos viewports (1440x900 y 390x844), guarda capturas
en docs/qa/<fecha>/ y genera reporte.md con:
  - errores de consola y excepciones de página
  - desbordamiento horizontal del body (scrollWidth > clientWidth)
  - botones de solo icono sin aria-label e inputs sin etiqueta
  - violaciones axe-core WCAG 2 A/AA por módulo (se carga axe desde cdnjs)
  - montos con color de alerta fuera de un estado de alerta (kpi con text-danger/warn) y clases text-pink/rose
  - confirm( nativos presentes en el HTML

Uso:
  set OBRA_QA_TOKEN=<token de obra_sesiones>   (o OBRA_QA_EMAIL / OBRA_QA_PASSWORD)
  python scripts/qa/audit-ui.py [--url http://localhost:8765/index.html] [--out docs/qa] [--modules d,o,g,pc,so] [--no-axe]

Requiere: pip install playwright && playwright install chromium (o Chrome instalado: se usa channel="chrome").
"""
import argparse, datetime, json, os, re, sys, time
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Falta playwright: pip install playwright && playwright install chromium")
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[2]
MODULES = {
    'd': 'Dashboard', 'o': 'Obras', 'ficha': 'Ficha de obra', 'w': 'Programa', 'pc': 'Pagos', 'pagar': 'Pagos · Por pagar', 'flujo': 'Pagos · Flujo',
    'g': 'Compras y gastos', 'b': 'Bitácora', 'l': 'Clientes', 'k': 'Documentos', 'f': 'Fotos', 'v': 'Proveedores', 'n': 'Nómina',
    'cb': 'Panel fiscal', 'fc': 'Facturas', 'ci': 'Cierres', 'so': 'Socios', 'q': 'Reportes', 'z': 'Configuración', 'p': 'Presupuesto'
}
VIEWPORTS = {'desktop': (1440, 900), 'mobile': (390, 844)}
AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default=os.environ.get('OBRA_QA_URL', 'http://localhost:8765/index.html'))
    ap.add_argument('--out', default=str(ROOT / 'docs' / 'qa'))
    ap.add_argument('--modules', default='d,o,ficha,w,pc,pagar,flujo,g,b,l,v,n,cb,ci,so,q,z')
    ap.add_argument('--obra', default=os.environ.get('OBRA_QA_OBRA', '20'))
    ap.add_argument('--headed', action='store_true')
    ap.add_argument('--no-axe', action='store_true')
    args = ap.parse_args()

    token = os.environ.get('OBRA_QA_TOKEN')
    email, pwd = os.environ.get('OBRA_QA_EMAIL'), os.environ.get('OBRA_QA_PASSWORD')
    if not token and not (email and pwd):
        print('Define OBRA_QA_TOKEN o OBRA_QA_EMAIL/OBRA_QA_PASSWORD')
        sys.exit(1)

    fecha = datetime.date.today().isoformat()
    out = Path(args.out) / fecha
    out.mkdir(parents=True, exist_ok=True)
    mods = [m.strip() for m in args.modules.split(',') if m.strip()]

    html = (ROOT / 'src' / 'index.html').read_text(encoding='utf-8')
    static = {
        'confirm_nativos': len(re.findall(r'(?<![\w.$])confirm\(', html)),
        'aria_label': html.count('aria-label'),
        'label_for': len(re.findall(r'<label[^>]*\sfor=', html)),
        'onclick_inline': html.count('onclick='),
        'text_pink_rose': len(re.findall(r'text-(pink|rose)-\d00', html)),
        'auto_sync': html.count('Auto-sync 3s'),
    }
    report = {'fecha': fecha, 'url': args.url, 'static': static, 'runs': []}

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel='chrome', headless=not args.headed)
        except Exception:
            browser = p.chromium.launch(headless=not args.headed)
        for vp_name, (w, h) in VIEWPORTS.items():
            ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, locale='es-MX',
                                      is_mobile=(vp_name == 'mobile'), has_touch=(vp_name == 'mobile'))
            page = ctx.new_page()
            console = []
            page.on('console', lambda m: console.append({'type': m.type, 'text': m.text}) if m.type in ('error', 'warning') and 'ERR_CONNECTION' not in m.text and 'Tailwind' not in m.text and 'GoTrueClient' not in m.text else None)
            page.on('pageerror', lambda e: console.append({'type': 'pageerror', 'text': str(e)}))
            page.set_default_navigation_timeout(120000)
            page.goto(args.url, wait_until='domcontentloaded')
            if token:
                page.evaluate("t=>localStorage.setItem('obra_session',JSON.stringify({token:t}))", token)
                page.reload(wait_until='commit')
            else:
                page.fill('#loginEmail', email); page.fill('#loginPassword', pwd); page.click('#loginBtn')
            try:
                page.wait_for_function("()=>typeof R==='function'&&typeof abrirFichaObra==='function'&&typeof Compras!=='undefined'", timeout=90000)
                page.wait_for_selector('#appScreen', state='visible', timeout=60000)
                page.wait_for_function("()=>D&&D.g&&D.g.length>0&&D.catg&&D.catg.length>0", timeout=60000)
            except Exception as e:
                console.append({'type': 'pageerror', 'text': f'No cargó la app: {e}'})
            time.sleep(1.0)
            axe_ok = False
            if not args.no_axe:
                try:
                    page.add_script_tag(url=AXE_URL); page.wait_for_function("()=>typeof axe!=='undefined'", timeout=20000); axe_ok = True
                except Exception as e:
                    console.append({'type': 'warning', 'text': f'axe no cargó: {e}'})

            run = {'viewport': vp_name, 'modules': []}
            for m in mods:
                entry = {'module': m, 'label': MODULES.get(m, m)}
                console.clear()
                try:
                    if m == 'ficha':
                        page.evaluate(f"()=>abrirFichaObra({args.obra})")
                    elif m in ('w', 'p'):
                        page.evaluate(f"()=>irAModuloConObra('{m}',{args.obra})")
                    elif m in ('pagar', 'flujo'):
                        page.evaluate(f"()=>{{if(typeof fichaObraId!=='undefined'){{fichaObraId=null;}}M='pc';R();pcSetTab('{m}');}}")
                    else:
                        page.evaluate(f"()=>{{if(typeof fichaObraId!=='undefined'){{fichaObraId=null;}}M='{m}';R();}}")
                    time.sleep(2.0 if m in ('so', 'ci', 'n') else 1.2)
                    entry['overflow_x'] = page.evaluate("()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1")
                    entry['scroll_w'] = page.evaluate("()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]")
                    entry['icon_buttons_sin_label'] = page.evaluate("""()=>[...document.querySelectorAll('button')].filter(b=>{const t=(b.textContent||'').trim();const hasIcon=b.querySelector('i');return hasIcon&&!t&&!b.getAttribute('aria-label')&&!b.getAttribute('title')&&b.offsetParent!==null;}).map(b=>b.outerHTML.slice(0,120))""")
                    entry['inputs_sin_label'] = page.evaluate("""()=>[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(i=>i.offsetParent!==null&&!i.getAttribute('aria-label')&&!i.getAttribute('aria-labelledby')&&!(i.id&&document.querySelector('label[for="'+i.id+'"]'))&&!i.closest('label')).length""")
                    entry['montos_en_alerta_sin_motivo'] = page.evaluate("""()=>[...document.querySelectorAll('#c .kpi-v.text-danger, #c .kpi-v.text-warn')].filter(e=>!/vencid|pendiente|aprobar|factura|rechaz|-\\$|−/i.test(e.parentElement.textContent)).map(e=>e.parentElement.textContent.trim().slice(0,60))""")
                    entry['h1'] = page.evaluate("()=>(document.querySelector('main h1,main h2')||{}).textContent||''")
                    if axe_ok:
                        try:
                            res = page.evaluate("()=>axe.run(document.querySelector('#c')||document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}).then(r=>r.violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length,help:v.help,target:v.nodes[0]&&v.nodes[0].target&&v.nodes[0].target[0]})))")
                            entry['axe'] = res
                        except Exception as e:
                            entry['axe_error'] = str(e)[:200]
                    shot = out / f'{vp_name}_{m}.png'
                    page.screenshot(path=str(shot), full_page=False)
                    entry['screenshot'] = shot.name
                except Exception as e:
                    entry['error'] = str(e)
                entry['console'] = list(console)
                run['modules'].append(entry)
            report['runs'].append(run)
            ctx.close()
        browser.close()

    (out / 'reporte.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    md = [f'# Auditoría de UI · {fecha}', '', f'URL: {args.url}', '', '## Chequeos estáticos (src/index.html)', '',
          f"- `confirm(` nativos: **{static['confirm_nativos']}**", f"- `aria-label`: {static['aria_label']}", f"- `label[for]`: {static['label_for']}",
          f"- `onclick=` inline: {static['onclick_inline']}", f"- clases `text-pink/rose` (color sin semántica): **{static['text_pink_rose']}**", f"- píldoras `Auto-sync 3s`: **{static['auto_sync']}**", '']
    total_err = 0; total_axe = 0
    for run in report['runs']:
        md += [f"## Viewport {run['viewport']}", '', '| Módulo | Overflow X | Botones icono sin nombre | Inputs sin etiqueta | Errores consola | axe AA | Montos en alerta sin motivo | Captura |', '|---|---|---|---|---|---|---|---|']
        for e in run['modules']:
            errs = [c for c in e.get('console', []) if c['type'] in ('error', 'pageerror')]
            total_err += len(errs)
            axe_n = sum(v['n'] for v in e.get('axe', [])) if isinstance(e.get('axe'), list) else '-'
            if isinstance(axe_n, int): total_axe += axe_n
            md.append(f"| {e['label']} | {'SÍ ' + str(e.get('scroll_w')) if e.get('overflow_x') else 'no'} | {len(e.get('icon_buttons_sin_label', []))} | {e.get('inputs_sin_label', '-')} | {len(errs)} | {axe_n} | {len(e.get('montos_en_alerta_sin_motivo', []))} | {e.get('screenshot', e.get('error', ''))} |")
        md.append('')
        for e in run['modules']:
            errs = [c for c in e.get('console', []) if c['type'] in ('error', 'pageerror')]
            axe = e.get('axe') if isinstance(e.get('axe'), list) else []
            if errs or e.get('icon_buttons_sin_label') or axe or e.get('montos_en_alerta_sin_motivo'):
                md.append(f"### {run['viewport']} · {e['label']}")
                for c in errs: md.append(f"- [{c['type']}] {c['text'][:300]}")
                for b in e.get('icon_buttons_sin_label', [])[:10]: md.append(f"- botón sin nombre: `{b}`")
                for v in axe: md.append(f"- axe {v['impact']}: {v['id']} ({v['n']}) {v['help']} → `{v.get('target')}`")
                for t in e.get('montos_en_alerta_sin_motivo', []): md.append(f"- monto en color de alerta sin motivo visible: {t}")
                md.append('')
    md += ['## Resumen', '', f'- Errores de consola/página en total: **{total_err}**', f'- Violaciones axe WCAG 2 A/AA en total: **{total_axe}**', f"- confirm( nativos: **{static['confirm_nativos']}** (meta 0)", f"- Auto-sync: **{static['auto_sync']}** (meta 0)", '']
    (out / 'reporte.md').write_text('\n'.join(md), encoding='utf-8')
    print('\n'.join(md))
    print(f'\nReporte en {out}')


if __name__ == '__main__':
    main()
