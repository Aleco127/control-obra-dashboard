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


def normalizar_filtros(d: dict | None) -> dict:
    """Valida los filtros de una búsqueda a petición (contrato del conector local). ValueError si no sirven."""
    from datetime import date
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
            fechas[k] = date.fromisoformat(str(v)).isoformat()
        except ValueError:
            raise ValueError(f"{k}: fecha con formato AAAA-MM-DD") from None
    if fechas["desde"] and fechas["hasta"] and fechas["desde"] > fechas["hasta"]:
        raise ValueError("desde no puede ser posterior a hasta")
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
    hay_filtro = bool(texto or entidades or fechas["desde"] or fechas["hasta"] or mx not in (None, ""))
    if not hay_filtro:
        raise ValueError("indica al menos un filtro (texto, entidades, desde, hasta) o max_resultados")
    return {"texto": texto or None, "tipos": list(dict.fromkeys(tipos)), "entidades": [e.strip() for e in entidades if e.strip()],
            "desde": fechas["desde"], "hasta": fechas["hasta"], "campo_fecha": campo,
            "max_resultados": min(TOPE_RESULTADOS, mx if isinstance(mx, int) else RESULTADOS_POR_OMISION)}


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


def buscar_convocatorias(filtros: dict, *, origen: str = "conector-pc", pausa: float = 3.0, max_detalles: int = 5,
                         headed: bool = False, seco: bool = False, cancelado=None, usuario: str | None = None,
                         log=print) -> dict:
    """Búsqueda a petición con filtros (D12/D13, US-851). Devuelve {corrida_id, encontradas, nuevas, actualizadas,
    error, detalle}. `filtros` ya pasó por `normalizar_filtros`. `cancelado()` se consulta durante la búsqueda.

    Qué filtra el portal y qué se filtra después:
      portal: tipo de contratación (uno por pasada), entidad federativa, texto (campo «Nombre» del panel Filtros),
              fechas de publicación o de apertura (panel Filtros), ley LOPSRM y pestaña «Anuncios vigentes».
      después: sólo lo que el cuerpo de la petición del sitio muestre que NO llegó (texto o fechas de apertura), y el
               recorte a `max_resultados`. La fecha de publicación no viene en el listado: si el portal no la aplicara
               se avisa en `detalle.avisos` en vez de filtrar a ciegas.
    """
    from playwright.sync_api import sync_playwright

    pausa = min(5.0, max(2.0, pausa))
    tope = int(filtros["max_resultados"])
    corrida = None
    tot = {"encontradas": 0, "nuevas": 0, "actualizadas": 0}
    detalle = {"filtros": filtros, "usuario": usuario, "busquedas": [], "detalles": 0, "avisos": [],
               "filtrado_en_portal": [], "filtrado_despues": []}
    error = None
    t0 = time.time()
    if not seco:
        r = ingesta({"accion": "iniciar", "fuente": "comprasmx", "origen": origen})
        if not r.get("ok"):
            return {"corrida_id": None, **tot, "error": "No se pudo registrar la corrida: " + str(r.get("error")), "detalle": detalle}
        corrida = r["corrida_id"]
    por_uuid: dict[str, dict] = {}
    try:
        with sync_playwright() as p:
            nav = Navegador(p, headed, cancelado)
            try:
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
                # Detalle (publicación y fallo) de unas pocas de ESTA búsqueda que la BD aún no tiene completas.
                if max_detalles > 0 and items and not seco:
                    r = ingesta({"accion": "por_revisar", "fuente": "comprasmx", "vistos": list(por_uuid), "limite": 30})
                    pend = [x for x in (r.get("pendientes") or []) if str(x.get("id_externo", "")).lower() in por_uuid][:max_detalles]
                    lote = []
                    for pnd in pend:
                        uuid = str(pnd["id_externo"]).lower()
                        nav.pausa(pausa + random.uniform(0, 2))
                        try:
                            det = leer_detalle(nav, uuid)
                        except Bloqueo as e:
                            detalle["avisos"].append(str(e)); break
                        if det:
                            lote.append({**por_uuid[uuid], "detalle": det}); detalle["detalles"] += 1
                    if lote:
                        r = ingesta({"accion": "lote", "corrida_id": corrida, "items": lote})
                        if not r.get("ok"):
                            detalle["avisos"].append("lote detalles: " + str(r.get("error")))
            finally:
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
