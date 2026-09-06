# -*- coding: utf-8 -*-
"""
logo-empresa-smoke.py: la subida de logotipos desde Configuración › Datos de la empresa.

Sube el logotipo (slot 'logo') y el ícono cuadrado (slot 'iso') con la Edge Function `subir-logo`,
guarda el formulario y comprueba que las dos URLs quedaron en el bucket `logos` y que las imágenes
cargan. Ojo: cambia de verdad el logotipo de la empresa del token que se use.

Uso: OBRA_QA_TOKEN en el entorno.
  PYTHONIOENCODING=utf-8 python scripts/qa/logo-empresa-smoke.py --app http://127.0.0.1:8765/
"""
import argparse, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--app', default='http://127.0.0.1:8765/')
args = ap.parse_args()
TOK = os.environ.get('OBRA_QA_TOKEN', '')
if not TOK:
    print('Falta OBRA_QA_TOKEN en el entorno'); sys.exit(2)
URL = args.app
REPO = str(Path(__file__).resolve().parents[2] / 'src' / 'img' / 'marca') + '/'
errs=[]; fallos=[]
def check(c,m):
    if not c: fallos.append(m)
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={'width':1440,'height':900},locale='es-MX'); p=ctx.new_page()
    p.on('console', lambda m: errs.append('console.error: '+m.text) if m.type=='error' else None)
    p.on('pageerror', lambda e: errs.append('pageerror: '+str(e)))
    p.goto(URL+'?app=1', wait_until='domcontentloaded')
    p.evaluate("t=>localStorage.setItem('obra_session',JSON.stringify({token:t}))", TOK)
    p.reload(wait_until='domcontentloaded')
    p.wait_for_function("()=>typeof D!=='undefined' && D.o.length>0", timeout=40000)
    p.evaluate("()=>openEmpresaModal()")
    p.wait_for_selector('#mdlEmpresa.ac', timeout=15000)
    p.wait_for_timeout(600)
    antes=p.evaluate("()=>[$('empLogoUrl').value,$('empIsoUrl').value]")
    print('antes:', antes)
    check(p.locator('#empLogoPreview img').count()==1, 'el logotipo no se previsualiza al abrir')
    check(p.locator('#empIsoPreview img').count()==1, 'el ícono no se previsualiza al abrir')
    p.set_input_files('#empLogoFile', REPO+'empresa-1-horizontal.png')
    p.set_input_files('#empIsoFile', REPO+'empresa-1.png')
    p.wait_for_timeout(400)
    check(p.locator('#empLogoPreview img').get_attribute('src').startswith('data:'), 'la vista previa local no cambió')
    p.locator('#frmEmpresa button[type=submit]').click()
    p.wait_for_function("()=>!document.getElementById('mdlEmpresa').classList.contains('ac')", timeout=30000)
    p.wait_for_timeout(1200)
    p.evaluate("()=>openEmpresaModal()")
    p.wait_for_selector('#mdlEmpresa.ac', timeout=15000); p.wait_for_timeout(600)
    despues=p.evaluate("()=>[$('empLogoUrl').value,$('empIsoUrl').value]")
    print('despues:', despues)
    check(despues[0].startswith('https://') and '/logos/empresa/1/logo-' in despues[0], 'logo_url no quedó en el bucket: '+str(despues[0]))
    check(despues[1].startswith('https://') and '/logos/empresa/1/iso-' in despues[1], 'logo_iso_url no quedó en el bucket: '+str(despues[1]))
    check(despues[0]!=antes[0] and despues[1]!=antes[1], 'las URLs no cambiaron (¿no subió?)')
    # las dos imágenes cargan de verdad
    for u in despues:
        ok=p.evaluate("""u=>new Promise(r=>{const i=new Image();i.onload=()=>r(i.naturalWidth>0);i.onerror=()=>r(false);i.src=u})""", u)
        check(ok, 'la imagen no carga: '+u)
    ctx.close(); b.close()
print('\n== errores de consola ==');  print('\n'.join(errs))
print('== fallos =='); print('\n'.join(fallos))
print('\nRESULTADO:', 'FALLA' if (errs or fallos) else 'OK')
sys.exit(1 if (errs or fallos) else 0)
