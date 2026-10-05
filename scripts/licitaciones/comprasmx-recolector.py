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


class Bloqueo(Exception):
    """El portal no entregó resultados (posible reCAPTCHA o cambio del sitio). No se reintenta."""


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

    def __init__(self, p, headed: bool):
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
            for r in reversed(self.respuestas):
                if pred(r):
                    return r
            self.page.wait_for_timeout(250)
        raise Bloqueo(f"sin respuesta de {que} en {int(segundos)} s (¿reCAPTCHA o sitio caído?)")

    def cerrar(self):
        try:
            self.ctx.close(); self.nav.close()
        except Exception:  # noqa: BLE001
            pass


def elegir_dropdown(page, nombre: str, texto: str) -> str:
    page.locator(f'p-dropdown[name="{nombre}"]').click()
    page.wait_for_timeout(800)
    ops = page.locator("li.p-dropdown-item, li[role=option]")
    for i, t in enumerate(ops.all_inner_texts()):
        if norm(texto) in norm(t):
            ops.nth(i).click(); page.wait_for_timeout(1200)
            return t
    page.keyboard.press("Escape")
    raise Bloqueo(f"el sitio ya no ofrece «{texto}» en {nombre} (¿cambió el formulario?)")


def elegir_entidades(page, entidades: list[str]) -> list[str]:
    page.get_by_role("button", name=re.compile("Filtros", re.I)).click()
    page.wait_for_timeout(1500)
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


def buscar_tipo(nav: Navegador, tipo: str, entidades: list[str] | None, max_paginas: int, pausa: float) -> tuple[list, dict]:
    page = nav.page
    nav.respuestas.clear()
    page.goto(SITIO, wait_until="domcontentloaded", timeout=90000)
    page.wait_for_selector('p-dropdown[name="ley"]', timeout=60000)
    nav.esperar(lambda r: "/expedientes" in r["url"] and r["metodo"] == "POST", 60, "la lista inicial")
    page.wait_for_timeout(int(pausa * 1000))
    elegir_dropdown(page, "ley", LEY)
    elegir_dropdown(page, "contratacion", tipo)
    elegidas = elegir_entidades(page, entidades) if entidades else []
    if entidades and not elegidas:
        raise Bloqueo(f"ninguna entidad de los filtros coincide con el catálogo del portal: {entidades}")
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
        bloque = (j.get("data") or [{}])[0]
        registros += bloque.get("registros") or []
        pag = (bloque.get("paginacion") or [{}])[0]
        info.update(paginas=pagina, total_registros=pag.get("total_registros"), total_paginas=pag.get("total_paginas"))
        if pagina >= int(pag.get("total_paginas") or 1):
            break
        page.wait_for_timeout(int((pausa + random.uniform(0, 2)) * 1000))
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
    ap.add_argument("--entidades", nargs="*", help="sólo con --seco")
    ap.add_argument("--vigilar", action="store_true")
    ap.add_argument("--horas", type=float, default=48)
    a = ap.parse_args()
    a.pausa = min(5.0, max(2.0, a.pausa))
    a.max_paginas = min(10, max(1, a.max_paginas))
    a.max_detalles = min(30, max(0, a.max_detalles))
    cargar_env([Path(x) for x in a.env] + ENV_POR_OMISION + TELEGRAM_ENV)
    if not a.seco and not os.environ.get("CONVOCATORIAS_INGESTA_SECRET"):
        print("Falta CONVOCATORIAS_INGESTA_SECRET (usa --env)", file=sys.stderr); return 2
    return vigilar(a) if a.vigilar else recolectar(a)


if __name__ == "__main__":
    sys.exit(main())
