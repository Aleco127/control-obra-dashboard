"""Exploración técnica de ComprasMX (US-841). Sólo lectura, pocas peticiones y con pausas.

Abre el sitio público con Chrome real (Playwright, channel="chrome"), captura las llamadas a
upcp-cnetservicios.buengobierno.gob.mx/whitney/sitiopublico/* y guarda request/response en --out (fuera del repo).

Uso:
  python scripts/licitaciones/comprasmx-explorar.py publico --out <dir> [--headed] [--esperar 20]
  python scripts/licitaciones/comprasmx-explorar.py login   --out <dir> [--headed]
      (lee COMPRASMX_USUARIO / COMPRASMX_PASSWORD SOLO del entorno del proceso; nunca los imprime ni los guarda;
       un solo intento; si aparece captcha, segundo factor o algo inesperado se detiene)

No guarda cookies ni estado de sesión: el contexto del navegador es efímero y se cierra al terminar.
"""
import argparse, json, os, sys, time, re
from pathlib import Path
from playwright.sync_api import sync_playwright

SITIO = "https://comprasmx.buengobierno.gob.mx/sitiopublico/"
API = "upcp-cnetservicios.buengobierno.gob.mx/whitney"


def capturador(out: Path, log: list):
    out.mkdir(parents=True, exist_ok=True)
    n = {"i": 0}

    def on_response(resp):
        url = resp.url
        if API not in url:
            return
        n["i"] += 1
        i = n["i"]  # body() procesa otros eventos: no releer n["i"] después
        req = resp.request
        item = {"i": i, "metodo": req.method, "url": url, "status": resp.status,
                "req_headers": {k: v for k, v in req.headers.items() if k.lower() not in ("cookie", "authorization")},
                "post": (req.post_data or "")[:4000]}
        try:
            body = resp.body()
            item["bytes"] = len(body)
            ct = resp.headers.get("content-type", "")
            item["content_type"] = ct
            if "json" in ct:
                (out / f"resp_{i:03d}.json").write_bytes(body)
            else:
                (out / f"resp_{i:03d}.bin").write_bytes(body[:200000])
        except Exception as e:  # noqa: BLE001
            item["error_body"] = str(e)
        log.append(item)
        print(f"[{item['i']}] {req.method} {resp.status} {url[:140]} ({item.get('bytes')} B)", flush=True)
    return on_response


def abrir(p, headed: bool):
    nav = p.chromium.launch(channel="chrome", headless=not headed, args=["--disable-blink-features=AutomationControlled"])
    ctx = nav.new_context(ignore_https_errors=True, locale="es-MX", viewport={"width": 1440, "height": 900})
    return nav, ctx


def publico(a):
    out = Path(a.out); log = []
    with sync_playwright() as p:
        nav, ctx = abrir(p, a.headed)
        page = ctx.new_page()
        page.on("response", capturador(out, log))
        page.goto(SITIO, wait_until="domcontentloaded", timeout=90000)
        time.sleep(a.esperar)
        page.screenshot(path=str(out / "portada.png"), full_page=True)
        (out / "portada.html").write_text(page.content(), encoding="utf-8")
        ctx.close(); nav.close()
    (out / "llamadas.json").write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(log)} llamadas capturadas en {out}")


def elegir(page, nombre, texto, out, paso):
    """Abre un p-dropdown por su atributo name y elige la opción que contiene `texto` (sin distinguir mayúsculas)."""
    page.locator(f'p-dropdown[name="{nombre}"]').click()
    time.sleep(1)
    opciones = page.locator("li.p-dropdown-item, li[role=option]")
    textos = opciones.all_inner_texts()
    (out / f"opciones_{nombre}.json").write_text(json.dumps(textos, ensure_ascii=False, indent=1), encoding="utf-8")
    for i, t in enumerate(textos):
        if texto.lower() in t.lower():
            opciones.nth(i).click()
            time.sleep(1.5)
            page.screenshot(path=str(out / f"paso_{paso}_{nombre}.png"))
            return t
    page.keyboard.press("Escape")
    raise RuntimeError(f"No hay opción con '{texto}' en {nombre}: {textos[:20]}")


def filtrar(a):
    """Filtra por ley de obras, tipo de contratación «Obra pública» y entidad, pulsa Buscar y abre el primer resultado."""
    out = Path(a.out); log = []
    try:
        _filtrar(a, out, log)
    finally:
        (out / "llamadas.json").write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")


def _filtrar(a, out, log):
    with sync_playwright() as p:
        nav, ctx = abrir(p, a.headed)
        page = ctx.new_page()
        page.on("response", capturador(out, log))
        page.goto(SITIO, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_selector('p-dropdown[name="ley"]', timeout=60000)
        time.sleep(4)
        notas = {}
        notas["ley"] = elegir(page, "ley", a.ley, out, 1)
        time.sleep(2)
        notas["contratacion"] = elegir(page, "contratacion", a.tipo, out, 2)
        time.sleep(2)
        # Filtros adicionales (entidad federativa)
        page.get_by_role("button", name=re.compile("Filtros", re.I)).click()
        time.sleep(2)
        page.screenshot(path=str(out / "paso_3_filtros.png"), full_page=True)
        (out / "filtros.html").write_text(page.content(), encoding="utf-8")
        if a.entidad:
            ms = page.locator('p-multiselect').filter(has_text=re.compile("", re.I))
            (out / "multiselects.json").write_text(json.dumps(
                [page.locator('p-multiselect').nth(i).get_attribute("name") for i in range(page.locator('p-multiselect').count())]),
                encoding="utf-8")
            loc = page.locator('p-multiselect[name*="entidad" i], p-multiselect[formcontrolname*="entidad" i]')
            if loc.count() == 0:
                raise RuntimeError("No encontré el selector de entidad (ver filtros.html)")
            loc.first.click(); time.sleep(1)
            filtro = page.locator(".p-multiselect-filter")
            if filtro.count():
                filtro.first.fill(a.entidad); time.sleep(1)
            page.locator("li.p-multiselect-item, li[role=option]").filter(has_text=re.compile(a.entidad, re.I)).first.click()
            time.sleep(1); page.keyboard.press("Escape"); time.sleep(1)
            notas["entidad"] = a.entidad
            page.screenshot(path=str(out / "paso_4_entidad.png"), full_page=True)
        # Buscar (puede estar dentro del panel de filtros o en la barra lateral)
        boton = page.locator('button[type="submit"]').filter(has_text=re.compile("Buscar", re.I)).first
        boton.scroll_into_view_if_needed()
        boton.click()
        time.sleep(a.esperar)
        page.screenshot(path=str(out / "paso_5_resultados.png"), full_page=True)
        # Abre el primer procedimiento de la tabla
        (out / "resultados.html").write_text(page.content(), encoding="utf-8")
        if a.detalle:
            enlace = page.get_by_text(re.compile(r"^\s*[A-Z]{2}-\d{2}-")).first
            notas["primer_procedimiento"] = enlace.inner_text()
            enlace.click()
            time.sleep(a.esperar)
            page.screenshot(path=str(out / "paso_6_detalle.png"), full_page=True)
            (out / "detalle.html").write_text(page.content(), encoding="utf-8")
            notas["url_detalle"] = page.url
            if a.anexo:
                # Abre la lista de archivos del primer anexo y, si hay botón de descarga, baja UNO (sin sesión).
                acciones = page.locator("table").filter(has_text=re.compile("Tipo de documento", re.I)).locator("tbody tr").first.locator("i, button, span.pi, svg").last
                acciones.click(); time.sleep(4)
                page.screenshot(path=str(out / "paso_7_anexo.png"), full_page=True)
                (out / "anexo.html").write_text(page.content(), encoding="utf-8")
                desc = page.locator(".p-dialog button, .p-dialog a, .p-dialog i").filter(has_text=re.compile("", re.I))
                notas["controles_dialogo"] = [ (desc.nth(k).get_attribute("class") or "")[:80] for k in range(min(desc.count(), 15)) ]
                boton = page.locator(".p-dialog").locator("i.pi-download, i.pi-cloud-download, button:has(i.pi-download), [ptooltip*='escarg' i], button:has-text('Descargar')").first
                if boton.count():
                    try:
                        with page.expect_download(timeout=60000) as dl:
                            boton.click()
                        d = dl.value
                        destino = out / ("descarga_" + re.sub(r"[^\w.\-]+", "_", d.suggested_filename))
                        d.save_as(str(destino))
                        notas["descarga_publica"] = {"archivo": destino.name, "bytes": destino.stat().st_size}
                    except Exception as e:  # noqa: BLE001
                        notas["descarga_publica"] = {"error": str(e)[:300]}
                    time.sleep(3)
                    page.screenshot(path=str(out / "paso_8_descarga.png"), full_page=True)
                else:
                    notas["descarga_publica"] = "sin botón de descarga visible"
        ctx.close(); nav.close()
    (out / "notas.json").write_text(json.dumps(notas, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(notas, ensure_ascii=False))


def ver_login(a):
    """Sin credenciales: sólo abre la pantalla de inicio de sesión y la documenta (campos, captcha, enlaces)."""
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True); notas = {}
    with sync_playwright() as p:
        nav, ctx = abrir(p, a.headed)
        page = ctx.new_page()
        page.goto("https://comprasmx.buengobierno.gob.mx/", wait_until="domcontentloaded", timeout=90000)
        time.sleep(8)
        page.screenshot(path=str(out / "inicio.png"), full_page=True)
        (out / "inicio.html").write_text(page.content(), encoding="utf-8")
        notas["url_inicio"] = page.url
        enlaces = page.locator("a, button")
        notas["controles"] = [t.strip()[:60] for t in enlaces.all_inner_texts() if t.strip()][:60]
        ctx.close(); nav.close()
    (out / "notas_login.json").write_text(json.dumps(notas, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(notas, ensure_ascii=False)[:3000])


PANEL = "https://comprasmx.buengobierno.gob.mx/panel/"


def login(a):
    """UN solo intento de inicio de sesión con la cuenta de la empresa (Keycloak, realm `procura`).

    Las credenciales llegan SOLO por el entorno del proceso (COMPRASMX_USUARIO / COMPRASMX_PASSWORD) y se borran del
    entorno en cuanto se leen. No se imprimen, no se guardan, no se reintenta. Si aparece captcha, segundo factor o
    cualquier pantalla inesperada, se detiene y lo documenta. Si entra: abre el detalle público del procedimiento
    `--uuid` (si se da) con la sesión, baja UN archivo a --out y cierra sesión. No guarda cookies ni estado.
    """
    usuario = os.environ.pop("COMPRASMX_USUARIO", "")
    clave = os.environ.pop("COMPRASMX_PASSWORD", "")
    if not usuario or not clave:
        raise SystemExit("Faltan COMPRASMX_USUARIO / COMPRASMX_PASSWORD en el entorno")
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    notas = {"intentos": 0}
    red = []

    def on_resp(r):
        u = r.url
        if "comprasmx.buengobierno.gob.mx" not in u and "buengobierno" not in u:
            return
        item = {"m": r.request.method, "u": u.split("?")[0][:160], "s": r.status}
        # Del token sólo interesan las duraciones; los tokens NO se guardan.
        if "/openid-connect/token" in u and r.status == 200:
            try:
                j = r.json()
                notas["token"] = {k: j.get(k) for k in ("expires_in", "refresh_expires_in", "token_type", "not-before-policy", "scope")}
            except Exception:  # noqa: BLE001
                pass
        red.append(item)

    try:
        with sync_playwright() as p:
            nav, ctx = abrir(p, a.headed)
            page = ctx.new_page()
            page.on("response", on_resp)
            page.goto(PANEL, wait_until="domcontentloaded", timeout=90000)
            page.wait_for_selector("input[name=username]", timeout=60000)
            time.sleep(2)
            notas["form"] = {"url": page.url.split("?")[0],
                             "campos": [i.get_attribute("name") for i in page.locator("form input").all()],
                             "captcha_visible": page.locator("iframe[src*='recaptcha'], .g-recaptcha, [data-sitekey]").count() > 0}
            if notas["form"]["captcha_visible"]:
                notas["resultado"] = "detenido: el formulario muestra captcha antes de intentar"
                return
            page.locator("input[name=username]").fill(usuario)
            page.locator("input[name=password]").fill(clave)
            usuario = clave = ""  # noqa: F841 — fuera de memoria útil
            notas["intentos"] = 1
            t0 = time.time()
            page.locator("input[name=login], button[type=submit]").first.click()
            try:
                page.wait_for_url(re.compile(r"/panel/"), timeout=45000)
            except Exception:  # noqa: BLE001
                pass
            time.sleep(8)
            url = page.url
            notas["tras_enviar"] = {"url": url.split("?")[0].split("#")[0], "segundos": round(time.time() - t0, 1)}
            if "/auth/" in url:
                err = page.locator("#input-error, .alert-error, .kc-feedback-text, .pf-c-alert__title, span.error, .alert")
                notas["resultado"] = "no entró"
                notas["mensaje_portal"] = [t.strip()[:200] for t in err.all_inner_texts() if t.strip()][:5]
                notas["otp_o_captcha"] = page.locator("input[name=otp], input[name=totp], iframe[src*='recaptcha']").count() > 0
                page.screenshot(path=str(out / "login_resultado.png"))
                return
            notas["resultado"] = "entró"
            page.screenshot(path=str(out / "panel_dentro.png"))
            notas["panel_textos"] = [t.strip()[:60] for t in page.locator("a, button, h1, h2, h3, li").all_inner_texts() if t.strip()][:80]
            # Con sesión: detalle del procedimiento y descarga de UN archivo.
            if a.uuid:
                page.goto(f"{SITIO}#/sitiopublico/detalle/{a.uuid}/procedimiento", wait_until="domcontentloaded", timeout=90000)
                time.sleep(10)
                fila = page.locator("table").filter(has_text=re.compile("Tipo de documento", re.I)).locator("tbody tr").first
                fila.locator("i, button, span.pi, svg").last.click(); time.sleep(4)
                boton = page.locator(".p-dialog").locator("i.pi-download").first
                if boton.count():
                    with page.expect_download(timeout=60000) as dl:
                        boton.click()
                    d = dl.value
                    destino = out / ("con_sesion_" + re.sub(r"[^A-Za-z0-9_.-]+", "_", d.suggested_filename))
                    d.save_as(str(destino))
                    notas["descarga_con_sesion"] = {"archivo": destino.name, "bytes": destino.stat().st_size}
                else:
                    notas["descarga_con_sesion"] = "sin botón de descarga"
                page.keyboard.press("Escape"); time.sleep(2)
            # Cerrar sesión: botón del panel o endpoint de Keycloak.
            page.goto(PANEL, wait_until="domcontentloaded", timeout=90000); time.sleep(8)
            salir = page.get_by_text(re.compile(r"Cerrar sesi[oó]n|Salir", re.I))
            cerrado = False
            if salir.count():
                try:
                    salir.first.click(); time.sleep(6); cerrado = True
                except Exception:  # noqa: BLE001
                    cerrado = False
            if not cerrado:
                page.goto("https://comprasmx.buengobierno.gob.mx/auth/realms/procura/protocol/openid-connect/logout",
                          wait_until="domcontentloaded", timeout=60000)
                time.sleep(3)
                conf = page.locator("input[type=submit], button[type=submit]")
                if conf.count():
                    conf.first.click(); time.sleep(4)
            page.goto(PANEL, wait_until="domcontentloaded", timeout=90000); time.sleep(6)
            notas["sesion_cerrada"] = "/auth/" in page.url
            ctx.close(); nav.close()
    except Exception as e:  # noqa: BLE001
        notas["excepcion"] = type(e).__name__ + ": " + str(e).splitlines()[0][:200] if str(e) else ""
    finally:
        (out / "notas_login.json").write_text(json.dumps(notas, ensure_ascii=False, indent=1), encoding="utf-8")
        (out / "red_login.json").write_text(json.dumps(red, ensure_ascii=False, indent=1), encoding="utf-8")
        print(json.dumps(notas, ensure_ascii=False)[:4000])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("modo", choices=["publico", "filtrar", "ver-login", "login"])
    ap.add_argument("--ley", default="Obras")
    ap.add_argument("--tipo", default="OBRA")
    ap.add_argument("--entidad", default="CHIHUAHUA")
    ap.add_argument("--detalle", action="store_true")
    ap.add_argument("--anexo", action="store_true")
    ap.add_argument("--uuid", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--esperar", type=int, default=15)
    a = ap.parse_args()
    if a.modo == "publico":
        publico(a)
    elif a.modo == "filtrar":
        filtrar(a)
    elif a.modo == "ver-login":
        ver_login(a)
    elif a.modo == "login":
        login(a)


if __name__ == "__main__":
    main()
