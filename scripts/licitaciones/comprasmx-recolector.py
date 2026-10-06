"""Recolector diario de ComprasMX (US-842). Sólo lectura del sitio público; nunca inicia sesión.

ComprasMX (https://comprasmx.buengobierno.gob.mx/sitiopublico/) firma cada llamada a su API con un token de
reCAPTCHA v3, así que no se puede consultar con HTTP simple: este script maneja Chrome real (Playwright,
channel="chrome", sin cabeza) como lo haría una persona: elige la Ley de Obras Públicas, el tipo de contratación
(«Obra pública» y «Servicios relacionados con la obra») y las entidades de los filtros activos, pulsa «Buscar»,
recorre las páginas (con pausa y tope) y lee las respuestas JSON que el propio sitio recibe. Luego abre el detalle
de unas cuantas convocatorias (nuevas, desaparecidas o viejas) para tener publicación y fallo. Todo se manda por
lotes a la función de borde `convocatorias-ingesta` con el secreto de servidor.

No evade reCAPTCHA: si el sitio deja de responder o rechaza las llamadas, la corrida se registra con error y se
avisa por Telegram (el mismo canal del monitoreo del VPS), y no se reintenta.

Variables (de --env y del entorno; nunca en el repo):
  CONVOCATORIAS_INGESTA_SECRET   secreto de servidor (obligatorio)
  SUPABASE_URL                   por omisión el proyecto de Control de Obra
  TELEGRAM_BOT, TELEGRAM_CHAT    opcionales: avisos de error y del vigilante de 48 h

Uso:
  python comprasmx-recolector.py [--env ARCHIVO] [--max-paginas 3] [--pausa 3] [--max-detalles 10] [--origen script-pc]
  python comprasmx-recolector.py --vigilar [--horas 48]     # alerta si alguna fuente lleva > 48 h sin corrida correcta
  python comprasmx-recolector.py --seco ...                 # recorre el portal pero no manda nada (prueba)

Búsqueda a petición con filtros (la misma que usa el conector local, US-851; también importable con
`buscar_convocatorias(filtros, ...)`):
  python comprasmx-recolector.py --texto agua --entidades Chihuahua [--tipos obra_publica servicios_obra]
                                 [--desde 2026-09-01] [--hasta 2026-10-05] [--campo-fecha publicacion|apertura]
                                 [--max-resultados 100] [--seco]
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import ssl
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SITIO = "https://comprasmx.buengobierno.gob.mx/sitiopublico/"
API = "upcp-cnetservicios.buengobierno.gob.mx/whitney/sitiopublico/"
SUPABASE_URL = "https://cpjdlaiarmxojiyhhpxt.supabase.co"
LEY = "OBRAS PÚBLICAS"
TIPOS = ["OBRA PÚBLICA", "SERVICIOS RELACIONADOS CON LA OBRA"]
ENV_POR_OMISION = [Path.home() / ".config" / "control-obra" / "convocatorias.env", Path("/root/.obra_convocatorias.env")]
TELEGRAM_ENV = [Path("/root/.obra_telegram.env")]
# Claves del catálogo de la app → texto del portal (ley 2, LOPSRM).
TIPO_CLAVE = {"obra_publica": "OBRA PÚBLICA", "servicios_obra": "SERVICIOS RELACIONADOS CON LA OBRA"}
TOPE_RESULTADOS = 200          # tope duro por búsqueda a petición
RESULTADOS_POR_OMISION = 100
# Campos de fecha del panel «Filtros» del portal (formato dd/mm/aaaa).
CAMPOS_FECHA = {"publicacion": ("fechaDesdeP", "fechaHastaP", "fecha_publicacion_inicio", "fecha_publicacion_fin"),
                "apertura": ("fechaDesde", "fechaHasta", "fecha_apertura_inicio", "fecha_apertura_fin")}


class Bloqueo(Exception):
    """El portal no entregó resultados (posible reCAPTCHA o cambio del sitio). No se reintenta."""


class Cancelado(Exception):
    """El usuario canceló la búsqueda desde la app."""


DIAS_POR_OMISION = 30          # US-852: por omisión, publicadas en los últimos 30 días
DIAS_MAXIMOS = 90              # nunca sin límite de fecha: rango máximo de 90 días
DETALLES_POR_OMISION = 30      # detalles (para la descripción) que se abren por búsqueda
DETALLES_MAXIMOS = 60


def hoy_mx():
    """Fecha civil de hoy en el centro de México (UTC-6 todo el año desde 2022)."""
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(hours=6)).date()


def normalizar_filtros(d: dict | None) -> dict:
    """Valida los filtros de una búsqueda a petición (contrato del conector local). ValueError si no sirven.

    US-852: la búsqueda SIEMPRE va acotada por fecha: sin `desde` se buscan los últimos 30 días hasta `hasta` (por
    omisión hoy); el rango no puede pasar de 90 días ni empezar en el futuro."""
    from datetime import date, timedelta
    d = d or {}
    if not isinstance(d, dict):
        raise ValueError("el cuerpo debe ser un objeto JSON")
    texto = str(d.get("texto") or "").strip()
    if len(texto) > 120:
        raise ValueError("texto: máximo 120 caracteres")
    tipos = d.get("tipos")
    if tipos in (None, []):
        tipos = list(TIPO_CLAVE)
    if not isinstance(tipos, list) or any(t not in TIPO_CLAVE for t in tipos):
        raise ValueError(f"tipos: valores permitidos {list(TIPO_CLAVE)}")
    entidades = d.get("entidades") or []
    if not isinstance(entidades, list) or len(entidades) > 32 or any(not isinstance(e, str) or len(e) > 60 for e in entidades):
        raise ValueError("entidades: lista de nombres de entidad federativa")
    fechas = {}
    for k in ("desde", "hasta"):
        v = d.get(k)
        if v in (None, ""):
            fechas[k] = None; continue
        try:
            fechas[k] = date.fromisoformat(str(v))
        except ValueError:
            raise ValueError(f"{k}: fecha con formato AAAA-MM-DD") from None
    hoy = hoy_mx()
    hasta = fechas["hasta"] or hoy
    desde = fechas["desde"] or (hasta - timedelta(days=DIAS_POR_OMISION))
    if desde > hasta:
        raise ValueError("desde no puede ser posterior a hasta")
    if desde > hoy:
        raise ValueError("desde no puede estar en el futuro")
    if (hasta - desde).days > DIAS_MAXIMOS:
        raise ValueError(f"el rango de fechas no puede pasar de {DIAS_MAXIMOS} días")
    campo = str(d.get("campo_fecha") or "publicacion")
    if campo not in CAMPOS_FECHA:
        raise ValueError(f"campo_fecha: {list(CAMPOS_FECHA)}")
    mx = d.get("max_resultados")
    if mx not in (None, ""):
        try:
            mx = int(mx)
        except (TypeError, ValueError):
            raise ValueError("max_resultados debe ser un entero") from None
        if mx < 1:
            raise ValueError("max_resultados debe ser 1 o más")
    md = d.get("max_detalles")
    if md in (None, ""):
        md = DETALLES_POR_OMISION
    else:
        try:
            md = int(md)
        except (TypeError, ValueError):
            raise ValueError("max_detalles debe ser un entero") from None
    return {"texto": texto or None, "tipos": list(dict.fromkeys(tipos)), "entidades": [e.strip() for e in entidades if e.strip()],
            "desde": desde.isoformat(), "hasta": hasta.isoformat(), "campo_fecha": campo,
            "max_resultados": min(TOPE_RESULTADOS, mx if isinstance(mx, int) else RESULTADOS_POR_OMISION),
            "max_detalles": max(0, min(DETALLES_MAXIMOS, md))}


def cumple_post(reg: dict, texto: str | None, desde: str | None, hasta: str | None, campo: str) -> bool:
    """Filtro posterior para lo que el portal no aplicó (texto en el nombre; fechas de apertura del listado)."""
    if texto and norm(texto) not in norm(reg.get("nombre_procedimiento")):
        return False
    if (desde or hasta) and campo == "apertura":
        f = str(reg.get("fecha_apertura") or "")[:10]
        m = re.match(r"(\d{2})/(\d{2})/(\d{4})", f)
        if m:
            f = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
        if not re.match(r"\d{4}-\d{2}-\d{2}", f):
            return False
        if (desde and f < desde) or (hasta and f > hasta):
            return False
    return True


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def cargar_env(rutas: list[Path]) -> None:
    for r in rutas:
        try:
            if not r.is_file():
                continue
            for linea in r.read_text(encoding="utf-8").splitlines():
                linea = linea.strip()
                if not linea or linea.startswith("#") or "=" not in linea:
                    continue
                k, v = linea.split("=", 1)
                os.environ.setdefault(k.strip().removeprefix("export ").strip(), v.strip().strip('"').strip("'"))
        except OSError:
            pass


def _ctx_ssl():
    # La red de la oficina intercepta TLS; en el VPS la verificación normal funciona.
    if os.environ.get("CONVOCATORIAS_TLS_INSEGURO") == "1":
        c = ssl.create_default_context(); c.check_hostname = False; c.verify_mode = ssl.CERT_NONE
        return c
    return None


def ingesta(cuerpo: dict) -> dict:
    url = os.environ.get("SUPABASE_URL", SUPABASE_URL).rstrip("/") + "/functions/v1/convocatorias-ingesta"
    req = urllib.request.Request(url, data=json.dumps(cuerpo).encode(), method="POST", headers={
        "Content-Type": "application/json", "x-convocatorias-secret": os.environ["CONVOCATORIAS_INGESTA_SECRET"]})
    try:
        with urllib.request.urlopen(req, timeout=60, context=_ctx_ssl()) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:  # noqa: BLE001
            return {"ok": False, "error": f"HTTP {e.code}"}


def avisar(texto: str) -> None:
    bot, chat = os.environ.get("TELEGRAM_BOT"), os.environ.get("TELEGRAM_CHAT")
    print("AVISO:", texto, flush=True)
    if not bot or not chat:
        return
    try:
        data = urllib.parse.urlencode({"chat_id": chat, "text": texto}).encode()
        urllib.request.urlopen(f"https://api.telegram.org/bot{bot}/sendMessage", data=data, timeout=15, context=_ctx_ssl())
    except Exception as e:  # noqa: BLE001
        print("No se pudo avisar por Telegram:", type(e).__name__, flush=True)


# ---- Cuenta de la empresa (US-854, US-855, D15) ----------------------------------------------------------------
# La credencial NUNCA viene de la app: la app entrega un boleto de un solo uso y aquí se canjea en la función de borde
# `portal-credencial` con el secreto de ingesta. La credencial vive sólo en variables locales durante la llamada.
# UN intento de inicio de sesión por petición; si el portal lo rechaza se informa «fallo» y no se reintenta.
PANEL = os.environ.get("COMPRASMX_PANEL_URL") or "https://comprasmx.buengobierno.gob.mx/panel/"
LOGOUT = os.environ.get("COMPRASMX_LOGOUT_URL") or \
    "https://comprasmx.buengobierno.gob.mx/auth/realms/procura/protocol/openid-connect/logout"
BOLETO_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")


class SesionFallida(Exception):
    """El portal rechazó el inicio de sesión (o pidió captcha / segundo factor). `informar` = se cuenta como intento."""

    def __init__(self, mensaje: str, informar: bool = True, causa: str = "rechazo"):
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.informar = informar
        self.causa = causa


def portal_credencial(accion: str, cuerpo: dict) -> tuple[int, dict]:
    """Llama a la función de borde portal-credencial con el secreto de ingesta. Nunca registra el cuerpo."""
    url = os.environ.get("SUPABASE_URL", SUPABASE_URL).rstrip("/") + "/functions/v1/portal-credencial"
    req = urllib.request.Request(url, data=json.dumps({"accion": accion, **cuerpo}).encode(), method="POST", headers={
        "Content-Type": "application/json", "x-convocatorias-secret": os.environ.get("CONVOCATORIAS_INGESTA_SECRET", "")})
    try:
        with urllib.request.urlopen(req, timeout=30, context=_ctx_ssl()) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:  # noqa: BLE001
            return e.code, {"ok": False, "error": f"HTTP {e.code}"}


def canjear_boleto(boleto: str) -> dict | None:
    """{usuario, password, empresa_id, portal, proposito} o None (boleto usado, vencido o desconocido)."""
    if not BOLETO_RE.match(str(boleto or "")):
        return None
    st, j = portal_credencial("canjear", {"boleto": boleto})
    if st != 200 or not j.get("ok") or not j.get("usuario") or not j.get("password"):
        return None
    return j


def informar_resultado(boleto: str, estado: str, mensaje: str | None = None) -> dict:
    st, j = portal_credencial("resultado", {"boleto": boleto, "estado": estado, "mensaje": mensaje})
    return j if st == 200 else {"ok": False, "error": j.get("error") or f"HTTP {st}"}


SEL_ERROR_LOGIN = "#input-error, .kc-feedback-text, .alert-error, .pf-c-alert__title, .pf-m-danger, span.error, .alert"
SEL_CAPTCHA = "iframe[src*='recaptcha'], iframe[src*='hcaptcha'], .g-recaptcha, .h-captcha, [data-sitekey]"
SEL_OTP = "input[name=otp], input[name=totp], input#otp, input[autocomplete=one-time-code]"


def iniciar_sesion(nav: "Navegador", cred: dict, log=print) -> dict:
    """UN intento de inicio de sesión en el panel del licitante (Keycloak, realm `procura`, campos username/password).

    Devuelve {segundos, url, token:{expires_in, refresh_expires_in}} si entró. Lanza SesionFallida si el portal lo
    rechaza o pide captcha / segundo factor (no se evade nada). Si el formulario no aparece, lanza SesionFallida con
    informar=False (no hubo intento). Borra la credencial del diccionario en cuanto la escribe en el formulario."""
    page = nav.page
    info: dict = {}

    def on_resp(r):
        if "/openid-connect/token" in r.url and r.status == 200:
            try:
                j = r.json()   # del token sólo se guardan las duraciones; el token NO
                info["token"] = {k: j.get(k) for k in ("expires_in", "refresh_expires_in")}
            except Exception:  # noqa: BLE001
                pass
    page.on("response", on_resp)
    try:
        try:
            page.goto(PANEL, wait_until="domcontentloaded", timeout=90000)
            page.wait_for_selector("input[name=username]", timeout=60000)
        except Exception as e:  # noqa: BLE001
            raise SesionFallida("No apareció el formulario de inicio de sesión de ComprasMX (¿portal caído?): "
                                + type(e).__name__, informar=False, causa="sin_formulario") from None
        page.wait_for_timeout(1500)
        if page.locator(SEL_CAPTCHA).count() > 0:
            raise SesionFallida("El portal muestra un captcha en el inicio de sesión; no se intentó entrar.",
                                informar=False, causa="captcha")
        page.locator("input[name=username]").first.fill(str(cred.get("usuario") or "").strip())
        page.locator("input[name=password]").first.fill(str(cred.get("password") or ""))
        cred.pop("password", None)
        t0 = time.time()
        page.locator("input[name=login], button[type=submit]").first.click()
        log("comprasmx: formulario de inicio de sesión enviado (un intento)")
        return _leer_respuesta_login(page, info, t0)
    finally:
        try:
            page.remove_listener("response", on_resp)
        except Exception:  # noqa: BLE001
            pass


def _leer_respuesta_login(page, info: dict, t0: float) -> dict:
    """Lo que pasó tras enviar el formulario. Cualquier error inesperado aquí CUENTA como intento (ya se envió)."""
    try:
        fin = time.time() + 45
        while time.time() < fin:
            page.wait_for_timeout(500)
            if "/auth/" not in page.url and "openid-connect" not in page.url:
                break
            if page.locator(SEL_ERROR_LOGIN).count() and any(t.strip() for t in page.locator(SEL_ERROR_LOGIN).all_inner_texts()):
                break
            if page.locator(SEL_OTP).count() or page.locator(SEL_CAPTCHA).count():
                break
        page.wait_for_timeout(2500)
        url = page.url
        info["segundos"] = round(time.time() - t0, 1)
        info["url"] = url.split("?")[0].split("#")[0]
        if page.locator(SEL_OTP).count():
            raise SesionFallida("El portal pidió un segundo factor (código); el conector no lo resuelve.", causa="otp")
        if page.locator(SEL_CAPTCHA).count():
            raise SesionFallida("El portal pidió un captcha después de enviar el usuario; no se evade.", causa="captcha")
        if "/auth/" in url or "openid-connect" in url:
            msgs = [t.strip()[:200] for t in page.locator(SEL_ERROR_LOGIN).all_inner_texts() if t.strip()]
            raise SesionFallida(msgs[0] if msgs else "El portal no aceptó el acceso (no mostró mensaje).")
        return info
    except SesionFallida:
        raise
    except Exception as e:  # noqa: BLE001
        raise SesionFallida("No se pudo leer la respuesta del portal tras enviar el acceso (" + type(e).__name__ + ").",
                            causa="desconocido") from None


def leer_panel(nav: "Navegador") -> dict:
    """Sólo lectura: qué muestra el panel del licitante (textos y rutas de su menú), para documentarlo. No pulsa nada."""
    page = nav.page
    try:
        page.wait_for_timeout(4000)
        enlaces = []
        for a in page.locator("a[href], [routerlink]").all()[:120]:
            try:
                t = (a.inner_text() or "").strip().replace("\n", " ")[:60]
                h = a.get_attribute("href") or a.get_attribute("routerlink") or ""
                if t or h:
                    enlaces.append({"texto": t, "ruta": h[:160]})
            except Exception:  # noqa: BLE001
                continue
        titulos = [t.strip()[:80] for t in page.locator("h1, h2, h3").all_inner_texts() if t.strip()][:20]
        return {"url": page.url.split("?")[0], "titulos": titulos, "enlaces": enlaces[:80]}
    except Exception as e:  # noqa: BLE001
        return {"error": type(e).__name__}


RE_INVITACION = re.compile(r"invitaci", re.I)


def _registros_json(j, out: list, prof: int = 0) -> None:
    """Registros de procedimiento en cualquier JSON del portal (los que traen uuid_procedimiento)."""
    if prof > 6:
        return
    if isinstance(j, dict):
        if j.get("uuid_procedimiento"):
            out.append(j)
            return
        for v in j.values():
            _registros_json(v, out, prof + 1)
    elif isinstance(j, list):
        for v in j:
            _registros_json(v, out, prof + 1)


def _fecha_iso(v) -> str | None:
    s = str(v or "")
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    m = re.match(r"(\d{4}-\d{2}-\d{2})", s)
    return m.group(1) if m else None


def leer_invitaciones(nav: "Navegador", filtros: dict, log=print) -> tuple[list, str | None]:
    """Procedimientos dirigidos a la empresa (invitaciones) en la aplicación «Procedimientos de Contratación» del panel
    del licitante (`/contrataciones/`), publicados en el rango.

    El panel (`/panel/`) es sólo un lanzador de aplicaciones (prueba real del 5-oct-2026): «Procedimientos de
    Contratación», «Formalización de Instrumentos Jurídicos» (firma: NUNCA se abre), «Tienda Digital» y «Términos».
    Sólo lectura: abre `/contrataciones/`, anota su menú y las llamadas JSON que recibe (rutas y conteos, sin cuerpos)
    para la bitácora, y si hay una opción de menú o enlace que diga «Invitación…» navega a ella y lee los registros de
    procedimiento (con `uuid_procedimiento`) de las respuestas JSON del propio sitio. Nunca pulsa botones."""
    page = nav.page
    capt: list = []
    rutas: list = []
    base = urllib.parse.urlparse(PANEL).netloc

    def on_resp(r):
        if ("buengobierno.gob.mx" in r.url or base in r.url) and "json" in (r.headers.get("content-type") or ""):
            try:
                j = r.json()
            except Exception:  # noqa: BLE001
                return
            capt.append(j)
            regs: list = []
            _registros_json(j, regs)
            rutas.append(f"{r.request.method} {urllib.parse.urlparse(r.url).path[:120]} → {r.status} ({len(regs)} proc.)")
    page.on("response", on_resp)
    try:
        app = urllib.parse.urljoin(PANEL, "../contrataciones/")
        page.goto(app, wait_until="domcontentloaded", timeout=90000)
        nav.pausa(8)
        menu = []
        for el in page.locator("a[href], [routerlink], .p-menuitem-link, .p-menuitem-text, li[role=menuitem]").all()[:200]:
            try:
                t = " ".join((el.inner_text() or "").split())[:60]
                if t:
                    menu.append(t)
            except Exception:  # noqa: BLE001
                continue
        menu = list(dict.fromkeys(menu))[:60]
        log("comprasmx: /contrataciones/ url=" + page.url.split("?")[0] + " menú=" + json.dumps(menu, ensure_ascii=False))
        log("comprasmx: /contrataciones/ llamadas=" + json.dumps(rutas[:40], ensure_ascii=False))
        destino = None
        for el in page.locator("a[href], [routerlink], .p-menuitem-link, li[role=menuitem]").all()[:200]:
            try:
                if RE_INVITACION.search(el.inner_text() or ""):
                    destino = el; break
            except Exception:  # noqa: BLE001
                continue
        if destino is None:
            return [], "la aplicación «Procedimientos de Contratación» no muestra una sección de invitaciones"
        capt.clear(); rutas.clear()
        href = destino.get_attribute("href")
        if href and not href.startswith("javascript"):
            page.goto(urllib.parse.urljoin(page.url, href), wait_until="domcontentloaded", timeout=90000)
        else:
            destino.click()   # opción de menú de navegación con el texto «Invitación…» (no es un botón de acción)
        nav.pausa(8)
        log("comprasmx: invitaciones url=" + page.url.split("?")[0] + " llamadas=" + json.dumps(rutas[:40], ensure_ascii=False))
        regs: list = []
        for j in capt:
            _registros_json(j, regs)
        d, h = filtros.get("desde"), filtros.get("hasta")
        vistos, dentro = set(), []
        for x in regs:
            u = str(x.get("uuid_procedimiento") or "").lower()
            if not u or u in vistos:
                continue
            vistos.add(u)
            f = _fecha_iso(x.get("fecha_publicacion") or x.get("fecha_publicacion_inicio") or x.get("fecha_creacion"))
            if f and ((d and f < d) or (h and f > h)):
                continue
            dentro.append(x)
        log(f"comprasmx: invitaciones en el panel {len(vistos)}, dentro del rango {len(dentro)}")
        return dentro[: int(filtros.get("max_resultados") or 100)], None
    except Cancelado:
        raise
    except Exception as e:  # noqa: BLE001
        return [], f"no se pudieron leer las invitaciones del panel ({type(e).__name__})"
    finally:
        try:
            page.remove_listener("response", on_resp)
        except Exception:  # noqa: BLE001
            pass


def cerrar_sesion(nav: "Navegador") -> bool:
    """Cierra la sesión del portal con el endpoint de cierre de Keycloak (no pulsa nada del panel salvo su
    confirmación de cierre). Devuelve True si el panel vuelve a pedir usuario."""
    page = nav.page
    try:
        page.goto(LOGOUT, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(1500)
        conf = page.locator("#kc-logout, input[name=confirmLogout], button[name=confirmLogout]")
        if conf.count():
            conf.first.click(); page.wait_for_timeout(2500)
        page.goto(PANEL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        return page.locator("input[name=username]").count() > 0 or "/auth/" in page.url
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------------------------------------------------------
class Navegador:
    """Chrome real con captura de las respuestas JSON de la API del sitio público."""

    def __init__(self, p, headed: bool, cancelado=None):
        self.cancelado = cancelado or (lambda: False)
        self.nav = p.chromium.launch(channel="chrome", headless=not headed,
                                     args=["--disable-blink-features=AutomationControlled"])
        # Contexto efímero: no se guardan cookies ni estado en disco.
        self.ctx = self.nav.new_context(ignore_https_errors=True, locale="es-MX", viewport={"width": 1440, "height": 900})
        self.page = self.ctx.new_page()
        self.respuestas: list[dict] = []
        self.page.on("response", self._on_response)

    def _on_response(self, resp):
        if API not in resp.url:
            return
        item = {"url": resp.url, "status": resp.status, "metodo": resp.request.method, "post": resp.request.post_data or ""}
        try:
            item["json"] = resp.json()
        except Exception:  # noqa: BLE001
            item["json"] = None
        self.respuestas.append(item)

    def esperar(self, pred, segundos: float, que: str) -> dict:
        fin = time.time() + segundos
        while time.time() < fin:
            self.revisar()
            for r in reversed(self.respuestas):
                if pred(r):
                    return r
            self.page.wait_for_timeout(250)
        raise Bloqueo(f"sin respuesta de {que} en {int(segundos)} s (¿reCAPTCHA o sitio caído?)")

    def revisar(self):
        if self.cancelado():
            raise Cancelado("búsqueda cancelada por el usuario")

    def pausa(self, segundos: float):
        """Pausa entre páginas que sigue atendiendo la cancelación."""
        fin = time.time() + segundos
        while time.time() < fin:
            self.revisar()
            self.page.wait_for_timeout(min(250, max(1, int((fin - time.time()) * 1000))))

    def cerrar(self):
        try:
            self.ctx.close(); self.nav.close()
        except Exception:  # noqa: BLE001
            pass


def elegir_dropdown(page, nombre: str, texto: str, intentos: int = 4) -> str:
    # Las opciones de «contratacion» dependen de la ley elegida y llegan por un catálogo: se reabre unas veces
    # (sin tocar la API más de lo que lo haría el propio sitio) antes de concluir que el formulario cambió.
    for _ in range(intentos):
        page.locator(f'p-dropdown[name="{nombre}"]').click()
        page.wait_for_timeout(800)
        ops = page.locator("li.p-dropdown-item, li[role=option]")
        for i, t in enumerate(ops.all_inner_texts()):
            if norm(texto) in norm(t):
                ops.nth(i).click(); page.wait_for_timeout(1200)
                return t
        page.keyboard.press("Escape")
        page.wait_for_timeout(1500)
    raise Bloqueo(f"el sitio ya no ofrece «{texto}» en {nombre} (¿cambió el formulario?)")


def abrir_filtros(page) -> None:
    """Abre el panel «Filtros» del portal (el botón alterna: sólo se pulsa si está cerrado)."""
    campo = page.locator('input[name="nombreProcedimiento"]')
    if campo.count() and campo.first.is_visible():
        return
    page.get_by_role("button", name=re.compile("Filtros", re.I)).click()
    page.wait_for_timeout(1500)
    if not (campo.count() and campo.first.is_visible()):
        raise Bloqueo("no se abrió el panel de filtros del portal (¿cambió el formulario?)")


def escribir_campo(page, nombre: str, valor: str) -> None:
    inp = page.locator(f'input[name="{nombre}"]')
    if inp.count() == 0:
        raise Bloqueo(f"no se encontró el campo {nombre} del portal (¿cambió el formulario?)")
    # Los campos de fecha son p-calendar de PrimeNG: al enfocarlos abren un calendario, y Escape DESPUÉS de escribir
    # borra lo escrito. Se abre y se cierra el calendario primero, se escribe dd/mm/aaaa y se quita el foco con un
    # clic en la cabecera (así el sitio toma el valor; comprobado en el cuerpo que manda a su API).
    inp.first.click(); page.wait_for_timeout(400)
    page.keyboard.press("Escape"); page.wait_for_timeout(300)
    inp.first.fill(valor)
    page.wait_for_timeout(300)
    page.mouse.click(700, 40)
    page.wait_for_timeout(400)
    if inp.first.input_value().strip() != valor:
        raise Bloqueo(f"el portal no aceptó «{valor}» en {nombre} (¿cambió el formulario?)")


def elegir_entidades(page, entidades: list[str]) -> list[str]:
    abrir_filtros(page)
    ms = page.locator('p-multiselect[name="entidades"]')
    if ms.count() == 0:
        raise Bloqueo("no se encontró el selector de entidad federativa (¿cambió el formulario?)")
    ms.first.click(); page.wait_for_timeout(1000)
    ops = page.locator("li.p-multiselect-item, li[role=option]")
    textos = ops.all_inner_texts()
    quiero = {norm(e) for e in entidades}
    # Alias comunes entre nuestro catálogo y el del portal
    alias = {"estado de mexico": "mexico", "ciudad de mexico": "ciudad de mexico", "coahuila": "coahuila de zaragoza",
             "michoacan": "michoacan de ocampo", "veracruz": "veracruz de ignacio de la llave"}
    quiero |= {alias[q] for q in list(quiero) if q in alias}
    elegidas = []
    for i, t in enumerate(textos):
        if norm(t) in quiero:
            ops.nth(i).click(); page.wait_for_timeout(500); elegidas.append(t.strip())
    page.keyboard.press("Escape"); page.wait_for_timeout(800)
    return elegidas


def _ddmmaaaa(iso: str) -> str:
    a, m, d = iso.split("-")
    return f"{d}/{m}/{a}"


def buscar_tipo(nav: Navegador, tipo: str, entidades: list[str] | None, max_paginas: int, pausa: float,
                texto: str | None = None, desde: str | None = None, hasta: str | None = None,
                campo_fecha: str = "publicacion", max_registros: int | None = None) -> tuple[list, dict]:
    """Una búsqueda en el portal para un tipo de contratación. Texto y fechas se escriben en el panel «Filtros»
    del propio sitio; `info["en_portal"]` dice qué filtros llegaron de verdad en la petición del sitio (se lee del
    cuerpo que mandó) para que quien llama filtre después lo que no llegó. Recorre sólo las páginas necesarias
    hasta `max_registros`."""
    page = nav.page
    nav.respuestas.clear()
    nav.revisar()
    page.goto(SITIO, wait_until="domcontentloaded", timeout=90000)
    page.wait_for_selector('p-dropdown[name="ley"]', timeout=60000)
    nav.esperar(lambda r: "/expedientes" in r["url"] and r["metodo"] == "POST", 60, "la lista inicial")
    nav.pausa(pausa)
    elegir_dropdown(page, "ley", LEY)
    elegir_dropdown(page, "contratacion", tipo)
    nav.revisar()
    elegidas = elegir_entidades(page, entidades) if entidades else []
    if entidades and not elegidas:
        raise Bloqueo(f"ninguna entidad de los filtros coincide con el catálogo del portal: {entidades}")
    if texto or desde or hasta:
        abrir_filtros(page)
        c_desde, c_hasta, _, _ = CAMPOS_FECHA[campo_fecha]
        if desde:
            escribir_campo(page, c_desde, _ddmmaaaa(desde))
        if hasta:
            escribir_campo(page, c_hasta, _ddmmaaaa(hasta))
        if texto:
            escribir_campo(page, "nombreProcedimiento", texto)
    nav.revisar()
    antes = len(nav.respuestas)
    boton = page.locator('button[type="submit"]').filter(has_text=re.compile("Buscar", re.I)).first
    boton.scroll_into_view_if_needed(); boton.click()

    def es_busqueda(r):
        if "/expedientes" not in r["url"] or r["metodo"] != "POST" or nav.respuestas.index(r) < antes:
            return False
        try:
            return json.loads(r["post"] or "{}").get("id_ley") == 2
        except ValueError:
            return False

    registros, info = [], {"tipo": tipo, "entidades": elegidas, "paginas": 0}
    for pagina in range(1, max_paginas + 1):
        r = nav.esperar(lambda x: es_busqueda(x) and f"page={pagina}" in x["url"], 60, f"la página {pagina}")
        j = r.get("json") or {}
        if r["status"] != 200 or not j.get("success"):
            raise Bloqueo(f"el portal respondió {r['status']} success={j.get('success')} msg={str(j.get('msg'))[:120]}")
        if pagina == 1:
            try:
                cuerpo = json.loads(r["post"] or "{}")
            except ValueError:
                cuerpo = {}
            _, _, k_ini, k_fin = CAMPOS_FECHA[campo_fecha]
            info["en_portal"] = {"texto": bool(texto) and norm(cuerpo.get("nombre_procedimiento")) == norm(texto),
                                 "desde": bool(desde) and cuerpo.get(k_ini) == desde,
                                 "hasta": bool(hasta) and cuerpo.get(k_fin) == hasta,
                                 "fechas_enviadas": [cuerpo.get(k_ini), cuerpo.get(k_fin)],
                                 "entidades": cuerpo.get("id_entidad_federativa") or [],
                                 "id_tipo_contratacion": cuerpo.get("id_tipo_contratacion")}
        bloque = (j.get("data") or [{}])[0]
        registros += bloque.get("registros") or []
        pag = (bloque.get("paginacion") or [{}])[0]
        info.update(paginas=pagina, total_registros=pag.get("total_registros"), total_paginas=pag.get("total_paginas"))
        if pagina >= int(pag.get("total_paginas") or 1):
            break
        if max_registros and len(registros) >= max_registros:
            break
        nav.pausa(pausa + random.uniform(0, 2))
        sig = page.locator("button.p-paginator-next")
        if sig.count() == 0 or sig.first.is_disabled():
            break
        sig.first.click()
    info["leidos"] = len(registros)
    return registros, info


def leer_detalle(nav: Navegador, uuid: str) -> dict | None:
    nav.respuestas.clear()
    # Angular reutiliza el componente si sólo cambia el hash: sin recarga completa no vuelve a pedir el detalle.
    nav.page.goto("about:blank")
    nav.page.goto(f"{SITIO}#/sitiopublico/detalle/{uuid}/procedimiento", wait_until="domcontentloaded", timeout=90000)
    r = nav.esperar(lambda x: f"/expedientes/{uuid}?" in x["url"] and x["metodo"] == "GET", 45, f"el detalle {uuid[:8]}")
    j = r.get("json") or {}
    if r["status"] != 200 or not j.get("success"):
        return None
    reg = ((j.get("data") or {}).get("registro") or [None])[0]
    if reg:
        reg = dict(reg)
        for k in ("email_uc", "responsable"):  # datos de personas: no hacen falta
            reg.pop(k, None)
        anexos = (j.get("data") or {}).get("anexos") or []
        reg["anexos_resumen"] = [{"numero": a.get("numero"), "descripcion": a.get("descripcion"),
                                  "tipo": a.get("tipodoc_descripcion"), "modificado": a.get("fecha_modificacion")} for a in anexos]
    return reg


# ---------------------------------------------------------------------------------------------------------------
def recolectar(a) -> int:
    from playwright.sync_api import sync_playwright

    seco = a.seco
    corrida = None
    if not seco:
        r = ingesta({"accion": "iniciar", "fuente": "comprasmx", "origen": a.origen})
        if not r.get("ok"):
            print("No se pudo iniciar la corrida:", r.get("error"), flush=True); return 2
        corrida = r["corrida_id"]
    tot = {"encontradas": 0, "nuevas": 0, "actualizadas": 0}
    detalle = {"busquedas": [], "detalles": 0, "avisos": []}
    error = None
    t0 = time.time()
    try:
        if seco:
            cfg = {"entidades": a.entidades or ["Chihuahua"], "todas_las_entidades": False}
        else:
            cfg = ingesta({"accion": "config"})
            if not cfg.get("ok"):
                raise RuntimeError("config: " + str(cfg.get("error")))
        entidades = None if cfg.get("todas_las_entidades") else list(cfg.get("entidades") or [])
        if entidades == []:
            detalle["avisos"].append("ningún filtro activo pide ComprasMX: no se busca nada")
        por_uuid: dict[str, dict] = {}
        with sync_playwright() as p:
            nav = Navegador(p, a.headed)
            try:
                if entidades != []:
                    for tipo in TIPOS:
                        regs, info = buscar_tipo(nav, tipo, entidades, a.max_paginas, a.pausa)
                        detalle["busquedas"].append(info)
                        for x in regs:
                            if x.get("uuid_procedimiento"):
                                por_uuid[str(x["uuid_procedimiento"]).lower()] = x
                        nav.page.wait_for_timeout(int(a.pausa * 1000))
                # Primero el listado: así un fallo en los detalles no pierde lo ya leído.
                items = list(por_uuid.values())
                if not seco:
                    for i in range(0, len(items), 200):
                        r = ingesta({"accion": "lote", "corrida_id": corrida, "items": items[i:i + 200]})
                        if not r.get("ok"):
                            raise RuntimeError("lote: " + str(r.get("error")))
                        for k in tot:
                            tot[k] += int(r.get(k) or 0)
                # Detalles priorizados por la BD (desaparecidas, sin detalle, refrescos)
                pend = []
                if a.max_detalles > 0 and not seco:
                    r = ingesta({"accion": "por_revisar", "fuente": "comprasmx", "vistos": list(por_uuid.keys()),
                                 "limite": a.max_detalles})
                    pend = (r.get("pendientes") or []) if r.get("ok") else []
                    if not r.get("ok"):
                        detalle["avisos"].append("por_revisar: " + str(r.get("error")))
                elif seco:
                    pend = [{"id_externo": u, "motivo": "seco"} for u in list(por_uuid)[: a.max_detalles]]
                lote = []
                for pnd in pend:
                    uuid = pnd["id_externo"]
                    nav.page.wait_for_timeout(int((a.pausa + random.uniform(0, 2)) * 1000))
                    try:
                        det = leer_detalle(nav, uuid)
                    except Bloqueo as e:
                        detalle["avisos"].append(str(e)); break
                    if not det:
                        detalle["avisos"].append(f"detalle {uuid[:8]} sin datos"); continue
                    base = por_uuid.get(uuid) or det
                    lote.append({**base, "detalle": det})
                    detalle["detalles"] += 1
                if lote and not seco:
                    r = ingesta({"accion": "lote", "corrida_id": corrida, "items": lote})
                    if not r.get("ok"):
                        detalle["avisos"].append("lote detalles: " + str(r.get("error")))
                if seco:
                    print(json.dumps({"leidos": len(items), "detalles": len(lote),
                                      "ejemplo": (lote or items or [None])[0]}, ensure_ascii=False, default=str)[:3000])
                    tot["encontradas"] = len(items)
            finally:
                nav.cerrar()
    except Bloqueo as e:
        error = "Bloqueo: " + str(e)
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {str(e).splitlines()[0][:300] if str(e) else ''}"
    detalle["segundos"] = round(time.time() - t0)
    if not seco:
        ingesta({"accion": "cerrar", "corrida_id": corrida, **tot, "error": error, "detalle": detalle})
    print(json.dumps({"corrida_id": corrida, **tot, "error": error, "detalle": detalle}, ensure_ascii=False), flush=True)
    if error:
        avisar(f"🔴 Convocatorias ComprasMX: la corrida falló ({error[:300]}). No se reintenta; revisar a mano.")
        return 1
    return 0


def buscar_convocatorias(filtros: dict, *, origen: str = "conector-pc", pausa: float = 3.0, max_detalles: int | None = None,
                         headed: bool = False, seco: bool = False, cancelado=None, usuario: str | None = None,
                         log=print, sesion: dict | None = None) -> dict:
    """Búsqueda a petición con filtros (D12/D13, US-851). Devuelve {corrida_id, encontradas, nuevas, actualizadas,
    error, detalle}. `filtros` ya pasó por `normalizar_filtros`. `cancelado()` se consulta durante la búsqueda.

    Qué filtra el portal y qué se filtra después:
      portal: tipo de contratación (uno por pasada), entidad federativa, texto (campo «Nombre» del panel Filtros),
              fechas de publicación o de apertura (panel Filtros), ley LOPSRM y pestaña «Anuncios vigentes».
      después: sólo lo que el cuerpo de la petición del sitio muestre que NO llegó (texto o fechas de apertura), y el
               recorte a `max_resultados`. La fecha de publicación no viene en el listado: si el portal no la aplicara
               se avisa en `detalle.avisos` en vez de filtrar a ciegas.

    US-855 · `sesion` = {"cred": {usuario, password, empresa_id}, "boleto": str}: antes de buscar inicia sesión UNA vez
    con la cuenta de la empresa (si falla: informa «fallo», NO busca, NO crea corrida y devuelve `error_sesion`), hace
    la misma búsqueda dentro de esa sesión, trae las invitaciones del panel del licitante publicadas en el rango
    (`origen_detalle = 'invitacion'`) y al final cierra la sesión del portal y el contexto.
    """
    from playwright.sync_api import sync_playwright

    pausa = min(5.0, max(2.0, pausa))
    tope = int(filtros["max_resultados"])
    if max_detalles is None:
        max_detalles = int(filtros.get("max_detalles", DETALLES_POR_OMISION))
    corrida = None
    tot = {"encontradas": 0, "nuevas": 0, "actualizadas": 0}
    detalle = {"filtros": filtros, "usuario": usuario, "busquedas": [], "detalles": 0, "avisos": [],
               "filtrado_en_portal": [], "filtrado_despues": [], "sin_descripcion": 0}
    con_sesion = bool(sesion)
    if con_sesion:
        detalle["con_sesion"] = True
    error = None
    t0 = time.time()
    por_uuid: dict[str, dict] = {}
    try:
        with sync_playwright() as p:
            nav = Navegador(p, headed, cancelado)
            entro = False
            try:
                if con_sesion:
                    cred, boleto = sesion["cred"], sesion["boleto"]
                    try:
                        info = iniciar_sesion(nav, cred, log)
                    except SesionFallida as e:
                        if e.informar:
                            informar_resultado(boleto, "fallo", e.mensaje)
                        return {"corrida_id": None, **tot, "error": "sesion", "error_sesion": e.mensaje,
                                "causa_sesion": e.causa, "detalle": detalle}
                    finally:
                        cred.pop("password", None)
                    entro = True
                    informar_resultado(boleto, "correcto")
                    detalle["sesion"] = {"segundos_login": info.get("segundos"), "token": info.get("token")}
                    log("comprasmx: sesión iniciada con la cuenta de la empresa")
                if not seco:
                    r = ingesta({"accion": "iniciar", "fuente": "comprasmx", "origen": origen, "con_sesion": con_sesion,
                                 "empresa_id": (sesion or {}).get("cred", {}).get("empresa_id")})
                    if not r.get("ok"):
                        raise RuntimeError("No se pudo registrar la corrida: " + str(r.get("error")))
                    corrida = r["corrida_id"]
                for clave in filtros["tipos"]:
                    falta = tope - len(por_uuid)
                    if falta <= 0:
                        break
                    paginas = max(1, min(10, -(-falta // 100)))
                    regs, info = buscar_tipo(nav, TIPO_CLAVE[clave], filtros["entidades"] or None, paginas, pausa,
                                             texto=filtros["texto"], desde=filtros["desde"], hasta=filtros["hasta"],
                                             campo_fecha=filtros["campo_fecha"], max_registros=falta)
                    enp = info.get("en_portal") or {}
                    post_texto = filtros["texto"] if filtros["texto"] and not enp.get("texto") else None
                    post_desde = filtros["desde"] if filtros["desde"] and not enp.get("desde") else None
                    post_hasta = filtros["hasta"] if filtros["hasta"] and not enp.get("hasta") else None
                    if (post_desde or post_hasta) and filtros["campo_fecha"] == "publicacion":
                        detalle["avisos"].append("el portal no aplicó la fecha de publicación y el listado no la trae: "
                                                 "no se pudo filtrar por ella")
                        post_desde = post_hasta = None
                    antes_post = len(regs)
                    regs = [x for x in regs if cumple_post(x, post_texto, post_desde, post_hasta, filtros["campo_fecha"])]
                    info["descartados_despues"] = antes_post - len(regs)
                    for nombre, en_portal, pedido in (("texto", enp.get("texto"), filtros["texto"]),
                                                      ("desde", enp.get("desde"), filtros["desde"]),
                                                      ("hasta", enp.get("hasta"), filtros["hasta"])):
                        if pedido:
                            (detalle["filtrado_en_portal"] if en_portal else detalle["filtrado_despues"]).append(f"{clave}:{nombre}")
                    if filtros["entidades"] and len(info.get("entidades") or []) < len(filtros["entidades"]):
                        detalle["avisos"].append(f"entidades sin equivalente en el portal: pedidas {filtros['entidades']}, "
                                                 f"elegidas {info.get('entidades')}")
                    detalle["busquedas"].append(info)
                    for x in regs:
                        if x.get("uuid_procedimiento") and len(por_uuid) < tope:
                            por_uuid[str(x["uuid_procedimiento"]).lower()] = x
                    log(f"[{clave}] leídos {info.get('leidos')} de {info.get('total_registros')}, acumulados {len(por_uuid)}")
                if entro:
                    # US-855: lo dirigido a la empresa en el panel del licitante (sólo lectura, dentro del rango).
                    nav.revisar()
                    inv, aviso = leer_invitaciones(nav, filtros, log)
                    detalle["invitaciones"] = len(inv)
                    if aviso:
                        detalle["avisos"].append(aviso)
                    for x in inv:
                        u = str(x.get("uuid_procedimiento") or "").lower()
                        if u:
                            por_uuid[u] = {**por_uuid.get(u, {}), **x, "origen_detalle": "invitacion"}
                    for x in por_uuid.values():
                        x["con_sesion"] = True
                items = list(por_uuid.values())
                tot["encontradas"] = len(items)
                if not seco:
                    tot["encontradas"] = 0
                    for i in range(0, len(items), 200):
                        r = ingesta({"accion": "lote", "corrida_id": corrida, "items": items[i:i + 200]})
                        if not r.get("ok"):
                            raise RuntimeError("lote: " + str(r.get("error")))
                        for k in tot:
                            tot[k] += int(r.get(k) or 0)
                # US-852: la descripción sólo viene en el detalle. Se abre el detalle SÓLO de las convocatorias de ESTA
                # búsqueda que aún no la tienen (en el orden del portal), con pausa de 2 a 5 s y tope por búsqueda.
                # El detalle no descarga ningún anexo: sólo lee la ficha pública.
                if items and not seco:
                    r = ingesta({"accion": "sin_descripcion", "fuente": "comprasmx", "ids": list(por_uuid), "limite": 200})
                    pend = [str(x.get("id_externo", "")).lower() for x in (r.get("pendientes") or [])
                            if str(x.get("id_externo", "")).lower() in por_uuid] if r.get("ok") else []
                    if not r.get("ok"):
                        detalle["avisos"].append("sin_descripcion: " + str(r.get("error")))
                    detalle["sin_descripcion_antes"] = len(pend)
                    lote = []
                    for uuid in pend[:max_detalles]:
                        nav.pausa(min(5.0, pausa + random.uniform(0, 2)))
                        try:
                            det = leer_detalle(nav, uuid)
                        except Bloqueo as e:
                            detalle["avisos"].append(str(e)); break
                        if det:
                            lote.append({**por_uuid[uuid], "detalle": det}); detalle["detalles"] += 1
                            if len(lote) >= 20:   # se manda por tandas: si algo falla después, lo leído ya quedó
                                r2 = ingesta({"accion": "lote", "corrida_id": corrida, "items": lote}); lote = []
                                if not r2.get("ok"):
                                    detalle["avisos"].append("lote detalles: " + str(r2.get("error")))
                    if lote:
                        r2 = ingesta({"accion": "lote", "corrida_id": corrida, "items": lote})
                        if not r2.get("ok"):
                            detalle["avisos"].append("lote detalles: " + str(r2.get("error")))
                    detalle["sin_descripcion"] = max(0, len(pend) - detalle["detalles"])
            finally:
                if entro:
                    detalle.setdefault("sesion", {})["cerrada"] = cerrar_sesion(nav)
                    log(f"comprasmx: sesión del portal cerrada={detalle['sesion']['cerrada']}")
                nav.cerrar()
    except Cancelado as e:
        error = "Cancelada: " + str(e)
    except Bloqueo as e:
        error = "Bloqueo: " + str(e)
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {str(e).splitlines()[0][:300] if str(e) else ''}"
    detalle["segundos"] = round(time.time() - t0)
    detalle["filtrado_en_portal"] = sorted(set(detalle["filtrado_en_portal"]))
    detalle["filtrado_despues"] = sorted(set(detalle["filtrado_despues"]))
    if not seco and corrida:
        ingesta({"accion": "cerrar", "corrida_id": corrida, **tot, "error": error, "detalle": detalle})
    return {"corrida_id": corrida, **tot, "error": error, "detalle": detalle}


def vigilar(a) -> int:
    r = ingesta({"accion": "estado"})
    if not r.get("ok"):
        avisar(f"🔴 Convocatorias: no se pudo consultar el estado ({r.get('error')})"); return 2
    malas = []
    for f in r.get("fuentes") or []:
        h = f.get("horas_sin_ok")
        if h is None or float(h) > a.horas:
            malas.append(f"{f['fuente']}: {'nunca' if h is None else f'{h} h'} sin corrida correcta"
                         + (f" (último error: {str(f.get('ultima_error'))[:120]})" if f.get("ultima_error") else ""))
    print(json.dumps(r, ensure_ascii=False))
    if malas:
        avisar("🔴 Convocatorias: " + "; ".join(malas))
        return 1
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--env", action="append", default=[], help="archivo .env con CONVOCATORIAS_INGESTA_SECRET")
    ap.add_argument("--max-paginas", type=int, default=3, help="tope de páginas de 100 por tipo de contratación")
    ap.add_argument("--max-detalles", type=int, default=10)
    ap.add_argument("--pausa", type=float, default=3.0, help="segundos entre páginas (2 a 5)")
    ap.add_argument("--origen", default="script-pc")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--seco", action="store_true", help="no manda nada a la BD")
    ap.add_argument("--entidades", nargs="*", help="con --seco o en la búsqueda con filtros")
    ap.add_argument("--vigilar", action="store_true")
    ap.add_argument("--horas", type=float, default=48)
    g = ap.add_argument_group("búsqueda a petición con filtros (US-851)")
    g.add_argument("--texto"); g.add_argument("--desde"); g.add_argument("--hasta")
    g.add_argument("--tipos", nargs="*", choices=list(TIPO_CLAVE))
    g.add_argument("--campo-fecha", choices=list(CAMPOS_FECHA), default="publicacion")
    g.add_argument("--max-resultados", type=int)
    a = ap.parse_args()
    if any(v is not None for v in (a.texto, a.desde, a.hasta, a.tipos, a.max_resultados)):
        try:
            filtros = normalizar_filtros({"texto": a.texto, "tipos": a.tipos, "entidades": a.entidades or [],
                                         "desde": a.desde, "hasta": a.hasta, "campo_fecha": a.campo_fecha,
                                         "max_resultados": a.max_resultados})
        except ValueError as e:
            print("Filtros no válidos:", e, file=sys.stderr); return 2
        cargar_env([Path(x) for x in a.env] + ENV_POR_OMISION)
        if not a.seco and not os.environ.get("CONVOCATORIAS_INGESTA_SECRET"):
            print("Falta CONVOCATORIAS_INGESTA_SECRET (usa --env)", file=sys.stderr); return 2
        r = buscar_convocatorias(filtros, origen=a.origen, pausa=a.pausa, headed=a.headed, seco=a.seco,
                                 max_detalles=min(30, max(0, a.max_detalles)))
        print(json.dumps(r, ensure_ascii=False, default=str), flush=True)
        return 1 if r["error"] else 0
    a.pausa = min(5.0, max(2.0, a.pausa))
    a.max_paginas = min(10, max(1, a.max_paginas))
    a.max_detalles = min(30, max(0, a.max_detalles))
    cargar_env([Path(x) for x in a.env] + ENV_POR_OMISION + TELEGRAM_ENV)
    if not a.seco and not os.environ.get("CONVOCATORIAS_INGESTA_SECRET"):
        print("Falta CONVOCATORIAS_INGESTA_SECRET (usa --env)", file=sys.stderr); return 2
    return vigilar(a) if a.vigilar else recolectar(a)


if __name__ == "__main__":
    sys.exit(main())
