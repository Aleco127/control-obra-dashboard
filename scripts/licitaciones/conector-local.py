"""Conector local de ComprasMX (US-851): un servidor HTTP pequeño que corre en la PC del usuario.

La app web (https://app.supernovarquitectos.com) le pide una búsqueda; el conector abre Chrome real sin cabeza,
aplica los filtros en el sitio público de ComprasMX (que exige reCAPTCHA v3, por eso no corre en el servidor; D13),
manda los resultados a la función de borde `convocatorias-ingesta` y responde cuántas encontró y cuántas son nuevas.

Contrato (la interfaz se construye contra él; ver docs/licitaciones/conector-local.md):
  Base  http://127.0.0.1:8879  (sólo loopback)
  GET   /estado              → {ok:true, version, ocupado, chrome}
  POST  /comprasmx/buscar    {texto, tipos[], entidades[], desde, hasta, max_resultados, max_detalles}
                             → {corrida_id, encontradas, nuevas, error, desde, hasta, detalles, sin_descripcion}
                               (409 si ya hay una búsqueda o una descarga en curso)
  POST  /comprasmx/cancelar  → {ok, cancelando}   (también cierra una sesión de anexos abierta)
  US-848 (anexos de UN procedimiento, sólo lectura, sin iniciar sesión en el portal):
  POST  /comprasmx/anexos          {uuid}          → {ok, sesion, uuid, archivos:[{id, nombre, tamano, anexo, tipo,
                                                      numero, publicado}], total, truncado, error}
  POST  /comprasmx/anexos/archivo  {sesion, id}    → el archivo (application/octet-stream, X-Archivo-Nombre,
                                                      X-Archivo-Sha256, Content-Length) o JSON de error
  POST  /comprasmx/anexos/cerrar   {sesion}        → {ok, cerrada}

Seguridad:
  - Escucha sólo en 127.0.0.1 y rechaza cabeceras Host que no sean 127.0.0.1/localhost (contra DNS rebinding).
  - CORS estricto: sólo los orígenes de la app y http://127.0.0.1:* / http://localhost:* (pruebas). Preflight con
    Access-Control-Allow-Private-Network. Los POST sin Origin o con otro Origin reciben 403, y deben ser
    Content-Type: application/json (415 si no), así una página ajena no puede disparar búsquedas.
  - El secreto de la ingesta se lee de ~/.config/control-obra/convocatorias.env y nunca se imprime ni se devuelve.
  - No abre Chrome ni toca el portal hasta recibir una búsqueda; una a la vez. Sin reintentos si reCAPTCHA bloquea.

Uso:
  pythonw conector-local.py            # como lo lanza el acceso de Inicio (sin consola; bitácora en conector.log)
  python  conector-local.py --consola  # para depurar, con la bitácora en pantalla
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import queue
import random
import re
import secrets
import shutil
import socket
import sys
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "1.2.0"
HOST = "127.0.0.1"
# 8879 es el contrato; CONECTOR_PUERTO sólo existe para que las pruebas no choquen con el conector instalado.
PUERTO = int(os.environ.get("CONECTOR_PUERTO") or 8879)
AQUI = Path(__file__).resolve().parent
ORIGENES = {"https://app.supernovarquitectos.com", "https://obra.srv1090924.hstgr.cloud"}
ORIGEN_LOCAL = re.compile(r"^http://(127\.0\.0\.1|localhost)(:\d{1,5})?$")
HOSTS_OK = {f"127.0.0.1:{PUERTO}", f"localhost:{PUERTO}"}
MAX_CUERPO = 16 * 1024
CARPETA_DATOS = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "control-obra"
LOG = CARPETA_DATOS / "conector.log"
CARPETA_TMP = CARPETA_DATOS / "tmp"


def _cargar_recolector():
    spec = importlib.util.spec_from_file_location("comprasmx_recolector", AQUI / "comprasmx-recolector.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


rec = _cargar_recolector()


def log(*partes) -> None:
    linea = time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(p) for p in partes)
    try:
        print(linea, flush=True)
    except Exception:  # noqa: BLE001  (pythonw: sin consola)
        pass


def hay_chrome() -> bool:
    """¿Está Google Chrome instalado? Sólo revisa rutas; no lo abre."""
    candidatos = []
    for var in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        base = os.environ.get(var)
        if base:
            candidatos.append(Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe")
    candidatos += [Path("/usr/bin/google-chrome"), Path("/opt/google/chrome/chrome"),
                   Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
    return any(c.is_file() for c in candidatos)


class Estado:
    def __init__(self):
        self.candado = threading.Lock()
        self.cancelar = threading.Event()
        self.ocupado = False


ESTADO = Estado()

# ---- Anexos de UN procedimiento (US-848, D14) ---------------------------------------------------------------------------
# Sólo cuando la app lo pide para la convocatoria que el usuario marcó «Me interesa» o en la que pulsó «Descargar
# documentos». Una sesión = un Chrome sin cabeza abierto en el detalle público de ESE procedimiento; la app pide los
# archivos de uno en uno y el conector los baja con el botón de descarga del propio sitio (sin iniciar sesión), los deja
# en una carpeta temporal y los entrega en flujo (sin cargarlos en memoria). Playwright síncrono no se puede usar desde
# varios hilos: la sesión vive en su propio hilo y recibe órdenes por una cola.
MAX_ARCHIVOS = 60                      # tope por convocatoria
MAX_BYTES_ARCHIVO = 50 * 1024 * 1024   # límite por archivo del bucket `licitaciones`
MAX_BYTES_TOTAL = 300 * 1024 * 1024    # tope por convocatoria
INACTIVA_S = 300                       # una sesión sin órdenes se cierra sola a los 5 min
PAUSA_DESCARGAS = (2.0, 4.0)           # segundos entre descargas
UUID_RE = re.compile(r"^[0-9a-fA-F]{32}$")


class SesionAnexos:
    def __init__(self, uuid: str):
        self.id = secrets.token_urlsafe(18)
        self.uuid = uuid.lower()
        self.cola: queue.Queue = queue.Queue()
        self.listo = threading.Event()
        self.resultado: dict = {}
        self.archivos: dict[str, dict] = {}
        self.ultimo = time.time()
        self.ultima_descarga = 0.0
        self.cerrada = threading.Event()
        self.carpeta = Path(tempfile.mkdtemp(prefix="anexos-", dir=str(CARPETA_TMP)))
        self.pagina = 1
        self.hilo = threading.Thread(target=self._correr, daemon=True, name="anexos-" + self.uuid[:8])

    # -- hilo de Playwright --------------------------------------------------------------------------------------------
    def _correr(self):
        from playwright.sync_api import sync_playwright
        try:
            with sync_playwright() as p:
                nav = rec.Navegador(p, False, lambda: self.cerrada.is_set())
                try:
                    self._listar(nav)
                    self.listo.set()
                    while not self.cerrada.is_set():
                        try:
                            orden = self.cola.get(timeout=2)
                        except queue.Empty:
                            if time.time() - self.ultimo > INACTIVA_S:
                                log(f"anexos {self.uuid[:8]}: sesión inactiva, se cierra")
                                break
                            continue
                        if orden[0] == "cerrar":
                            break
                        if orden[0] == "archivo":
                            _, aid, resp = orden
                            try:
                                resp.put(self._bajar(nav, aid))
                            except Exception as e:  # noqa: BLE001
                                resp.put({"codigo": 502, "error": f"{type(e).__name__}: {str(e).splitlines()[0][:300] if str(e) else ''}"})
                            self.ultimo = time.time()
                finally:
                    nav.cerrar()
        except rec.Bloqueo as e:
            self.resultado = {"ok": False, "error": "Bloqueo: " + str(e)}
        except Exception as e:  # noqa: BLE001
            self.resultado = self.resultado or {"ok": False, "error": f"{type(e).__name__}: {str(e).splitlines()[0][:300] if str(e) else ''}"}
        finally:
            self.cerrada.set()
            self.listo.set()
            shutil.rmtree(self.carpeta, ignore_errors=True)
            _terminar_sesion(self)

    def _componente(self, page):
        return page.locator("app-sitiopublico-detalle-anexos").first

    def _esperar_anexos(self, nav, pagina: int, antes: int):
        return nav.esperar(lambda r: f"/expedientes/{self.uuid}/anexos" in r["url"] and f"page={pagina}" in r["url"]
                           and nav.respuestas.index(r) >= antes, 60, f"los anexos (página {pagina})")

    def _listar(self, nav):
        page = nav.page
        nav.respuestas.clear()
        page.goto("about:blank")
        page.goto(f"{rec.SITIO}#/sitiopublico/detalle/{self.uuid}/procedimiento", wait_until="domcontentloaded", timeout=90000)
        r = self._esperar_anexos(nav, 1, 0)
        det = next((x for x in reversed(nav.respuestas) if f"/expedientes/{self.uuid}?" in x["url"] and x["metodo"] == "GET"), None)
        numero = None
        try:
            numero = (((det or {}).get("json") or {}).get("data") or {}).get("registro", [{}])[0].get("numero_procedimiento")
        except Exception:  # noqa: BLE001
            pass
        paginas = [r]
        j = r.get("json") or {}
        if r["status"] != 200 or not j.get("success"):
            raise rec.Bloqueo(f"el portal respondió {r['status']} a los anexos")
        pag = ((j.get("data") or [{}])[0].get("paginacion") or [{}])[0]
        total_pag = int(pag.get("total_paginas") or 1)
        for pg in range(2, min(total_pag, 6) + 1):        # 10 anexos por página; tope 6 páginas
            nav.pausa(2.0)
            antes = len(nav.respuestas)
            sig = self._componente(page).locator("button.p-paginator-next")
            if sig.count() == 0 or sig.first.is_disabled():
                break
            sig.first.click()
            paginas.append(self._esperar_anexos(nav, pg, antes))
            self.pagina = pg
        archivos, total_bytes, truncado = [], 0, total_pag > 6
        for pg, resp in enumerate(paginas, start=1):
            regs = (((resp.get("json") or {}).get("data") or [{}])[0].get("registros")) or []
            for i, a in enumerate(regs):
                for d in a.get("documentos") or []:
                    aid = str(d.get("uuid_pa") or "")
                    if not aid or aid in self.archivos:
                        continue
                    if len(archivos) >= MAX_ARCHIVOS:
                        truncado = True; continue
                    x = {"id": aid, "nombre": str(d.get("nombre") or "archivo"), "tamano": int(d.get("original_size") or 0),
                         "anexo": a.get("descripcion"), "tipo": a.get("tipodoc_descripcion"), "numero": a.get("numero"),
                         "publicado": d.get("pa_fecha_modificacion") or d.get("pa_fecha_creacion"), "_pag": pg, "_fila": i}
                    archivos.append(x); self.archivos[aid] = x; total_bytes += x["tamano"]
        self.resultado = {"ok": True, "sesion": self.id, "uuid": self.uuid, "numero_procedimiento": numero,
                          "archivos": [{k: v for k, v in x.items() if not k.startswith("_")} for x in archivos],
                          "total": len(archivos), "bytes": total_bytes, "truncado": truncado, "error": None}
        log(f"anexos {self.uuid[:8]}: {len(archivos)} archivos en {len(paginas)} página(s){' (truncado)' if truncado else ''}")

    def _ir_a_pagina(self, nav, pg: int):
        if self.pagina == pg:
            return
        page = nav.page
        antes = len(nav.respuestas)
        boton = self._componente(page).locator(f'button.p-paginator-page[aria-label="{pg}"]')
        if boton.count() == 0:
            raise rec.Bloqueo(f"no se encontró la página {pg} de anexos (¿cambió el sitio?)")
        boton.first.click()
        self._esperar_anexos(nav, pg, antes)
        self.pagina = pg

    def _bajar(self, nav, aid: str) -> dict:
        x = self.archivos.get(aid)
        if not x:
            return {"codigo": 400, "error": "Ese archivo no está en la lista de este procedimiento."}
        if x["tamano"] > MAX_BYTES_ARCHIVO:
            return {"codigo": 413, "error": f"«{x['nombre']}» pesa {x['tamano'] / 1048576:.1f} MB: más de 50 MB, bájalo del portal."}
        espera = self.ultima_descarga + random.uniform(*PAUSA_DESCARGAS) - time.time()
        if espera > 0:
            nav.pausa(espera)
        page = nav.page
        self._ir_a_pagina(nav, x["_pag"])
        filas = self._componente(page).locator("tbody tr")
        if filas.count() <= x["_fila"]:
            raise rec.Bloqueo("la tabla de anexos no tiene la fila esperada (¿cambió el sitio?)")
        filas.nth(x["_fila"]).locator("i.pi-list").first.click()
        dialogo = page.locator(".p-dialog:visible").last
        dialogo.wait_for(state="visible", timeout=20000)
        filas_d = dialogo.locator("tbody tr")
        destino = None
        for i in range(filas_d.count()):
            celdas = filas_d.nth(i).locator("td")
            if celdas.count() >= 2 and celdas.nth(1).inner_text().strip() == x["nombre"]:
                destino = filas_d.nth(i); break
        if destino is None:
            self._cerrar_dialogo(page)
            raise rec.Bloqueo(f"no apareció «{x['nombre']}» en la lista del anexo (¿cambió el sitio?)")
        with page.expect_download(timeout=180000) as dl:
            destino.locator("i.pi-download").first.click()
        d = dl.value
        ruta = self.carpeta / ("a-" + secrets.token_hex(6))
        d.save_as(str(ruta))
        self._cerrar_dialogo(page)
        self.ultima_descarga = time.time()
        h = hashlib.sha256(); n = 0
        with open(ruta, "rb") as f:
            for bloque in iter(lambda: f.read(1024 * 1024), b""):
                h.update(bloque); n += len(bloque)
        if n > MAX_BYTES_ARCHIVO:
            ruta.unlink(missing_ok=True)
            return {"codigo": 413, "error": f"«{x['nombre']}» pesa {n / 1048576:.1f} MB: más de 50 MB, bájalo del portal."}
        log(f"anexos {self.uuid[:8]}: bajado {x['nombre']} ({n} bytes)")
        return {"codigo": 200, "ruta": str(ruta), "nombre": x["nombre"], "tamano": n, "sha256": h.hexdigest()}

    @staticmethod
    def _cerrar_dialogo(page):
        try:
            page.locator(".p-dialog:visible .p-dialog-header-close").last.click(timeout=5000)
            page.wait_for_timeout(400)
        except Exception:  # noqa: BLE001
            page.keyboard.press("Escape")

    # -- desde los hilos HTTP -------------------------------------------------------------------------------------------
    def pedir_archivo(self, aid: str) -> dict:
        if self.cerrada.is_set():
            return {"codigo": 404, "error": "La sesión de anexos ya se cerró; vuelve a pedir la lista."}
        self.ultimo = time.time()
        resp: queue.Queue = queue.Queue()
        self.cola.put(("archivo", aid, resp))
        try:
            return resp.get(timeout=240)
        except queue.Empty:
            return {"codigo": 504, "error": "El portal tardó demasiado en entregar el archivo."}

    def cerrar(self):
        self.cerrada.set()
        self.cola.put(("cerrar",))


SESION = {"actual": None}


def _terminar_sesion(s: SesionAnexos):
    if SESION.get("actual") is s:
        SESION["actual"] = None
        ESTADO.ocupado = False
        try:
            ESTADO.candado.release()
        except RuntimeError:
            pass


def origen_permitido(origen: str | None) -> bool:
    return bool(origen) and (origen in ORIGENES or bool(ORIGEN_LOCAL.match(origen)))


class Manejador(BaseHTTPRequestHandler):
    server_version = "ConectorControlObra/" + VERSION
    sys_version = ""
    protocol_version = "HTTP/1.0"  # una petición por conexión: un cuerpo no leído (403/415) no contamina la siguiente

    def log_message(self, fmt, *args):  # bitácora sin cuerpos ni cabeceras
        log(self.address_string(), fmt % args)

    # -- utilidades -------------------------------------------------------------------------------------------
    def _cors(self):
        origen = self.headers.get("Origin")
        if origen_permitido(origen):
            self.send_header("Access-Control-Allow-Origin", origen)
            self.send_header("Access-Control-Expose-Headers", "X-Archivo-Nombre, X-Archivo-Sha256, Content-Length")
            self.send_header("Vary", "Origin")

    def _json(self, codigo: int, cuerpo: dict):
        datos = json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(datos)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(datos)

    def _host_ok(self) -> bool:
        return (self.headers.get("Host") or "").lower() in HOSTS_OK

    def _origen_ok(self, exigir: bool) -> bool:
        origen = self.headers.get("Origin")
        if origen is None:
            return not exigir
        return origen_permitido(origen)

    def _leer_json(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n < 0 or n > MAX_CUERPO:
            return None, "cuerpo demasiado grande o sin longitud"
        crudo = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(crudo.decode("utf-8") or "{}"), None
        except (ValueError, UnicodeDecodeError):
            return None, "JSON inválido"

    def _filtro_comun(self, metodo: str) -> bool:
        """Host, Origin y Content-Type. Devuelve False si ya respondió con error."""
        if not self._host_ok():
            self._json(403, {"ok": False, "error": "Host no permitido"}); return False
        if not self._origen_ok(exigir=(metodo == "POST")):
            self._json(403, {"ok": False, "error": "Origen no permitido"}); return False
        if metodo == "POST":
            ct = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if ct != "application/json":
                self._json(415, {"ok": False, "error": "Se requiere Content-Type: application/json"}); return False
        return True

    # -- verbos -----------------------------------------------------------------------------------------------
    def do_OPTIONS(self):
        origen = self.headers.get("Origin")
        if not self._host_ok() or not origen_permitido(origen):
            self.send_response(403)
            self.send_header("Content-Length", "0")
            self.end_headers(); return
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self._filtro_comun("GET"):
            return
        if self.path.split("?")[0] == "/estado":
            return self._json(200, {"ok": True, "version": VERSION, "ocupado": ESTADO.ocupado, "chrome": hay_chrome()})
        self._json(404, {"ok": False, "error": "No encontrado"})

    def do_POST(self):
        if not self._filtro_comun("POST"):
            return
        ruta = self.path.split("?")[0]
        cuerpo, err = self._leer_json()
        if err:
            return self._json(400, {"ok": False, "error": err})
        if ruta == "/comprasmx/cancelar":
            s = SESION.get("actual")
            if s:
                s.cerrar()
                log("sesión de anexos cerrada por cancelación")
                return self._json(200, {"ok": True, "cancelando": True})
            if ESTADO.ocupado:
                ESTADO.cancelar.set()
                log("cancelación pedida")
                return self._json(200, {"ok": True, "cancelando": True})
            return self._json(200, {"ok": True, "cancelando": False})
        if ruta == "/comprasmx/buscar":
            return self._buscar(cuerpo)
        if ruta == "/comprasmx/anexos":
            return self._anexos(cuerpo)
        if ruta == "/comprasmx/anexos/archivo":
            return self._archivo(cuerpo)
        if ruta == "/comprasmx/anexos/cerrar":
            s = SESION.get("actual")
            if s and s.id == str(cuerpo.get("sesion") or ""):
                s.cerrar()
                return self._json(200, {"ok": True, "cerrada": True})
            return self._json(200, {"ok": True, "cerrada": False})
        self._json(404, {"ok": False, "error": "No encontrado"})

    # -- anexos (US-848) --------------------------------------------------------------------------------------------
    def _anexos(self, cuerpo):
        uuid = str(cuerpo.get("uuid") or "").strip()
        if not UUID_RE.match(uuid):
            return self._json(400, {"ok": False, "error": "uuid: el id del procedimiento de ComprasMX (32 caracteres hexadecimales)"})
        if not hay_chrome():
            return self._json(503, {"ok": False, "error": "Google Chrome no está instalado en esta computadora."})
        if not ESTADO.candado.acquire(blocking=False):
            return self._json(409, {"ok": False, "error": "El conector está ocupado con otra búsqueda o descarga; espera a que termine."})
        CARPETA_TMP.mkdir(parents=True, exist_ok=True)
        s = SesionAnexos(uuid)
        SESION["actual"] = s
        ESTADO.ocupado = True
        log(f"anexos {uuid[:8]}: abriendo el detalle público")
        s.hilo.start()               # el hilo suelta el candado al terminar (_terminar_sesion)
        if not s.listo.wait(150):
            s.cerrar()
            return self._json(504, {"ok": False, "error": "El portal tardó demasiado en mostrar los anexos."})
        r = s.resultado or {"ok": False, "error": "La sesión terminó sin respuesta."}
        if not r.get("ok"):
            s.cerrar()
            return self._json(502, r)
        return self._json(200, r)

    def _archivo(self, cuerpo):
        s = SESION.get("actual")
        if not s or s.id != str(cuerpo.get("sesion") or ""):
            return self._json(404, {"ok": False, "error": "La sesión de anexos no existe o ya se cerró; vuelve a pedir la lista."})
        r = s.pedir_archivo(str(cuerpo.get("id") or ""))
        if r.get("codigo") != 200:
            return self._json(int(r.get("codigo") or 500), {"ok": False, "error": r.get("error")})
        ruta = Path(r["ruta"])
        try:
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(r["tamano"]))
            self.send_header("X-Archivo-Nombre", urllib.parse.quote(r["nombre"]))
            self.send_header("X-Archivo-Sha256", r["sha256"])
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            with open(ruta, "rb") as f:
                shutil.copyfileobj(f, self.wfile, 256 * 1024)
        finally:
            ruta.unlink(missing_ok=True)

    def _buscar(self, cuerpo):
        try:
            filtros = rec.normalizar_filtros(cuerpo)
        except ValueError as e:
            return self._json(400, {"corrida_id": None, "encontradas": 0, "nuevas": 0, "error": f"Filtros no válidos: {e}"})
        if not ESTADO.candado.acquire(blocking=False):
            return self._json(409, {"corrida_id": None, "encontradas": 0, "nuevas": 0,
                                    "error": "Ya hay una búsqueda en curso; espera a que termine o cancélala."})
        try:
            ESTADO.ocupado = True
            ESTADO.cancelar.clear()
            if not os.environ.get("CONVOCATORIAS_INGESTA_SECRET"):
                return self._json(500, {"corrida_id": None, "encontradas": 0, "nuevas": 0,
                                        "error": "Falta el secreto de ingesta en ~/.config/control-obra/convocatorias.env"})
            if not hay_chrome():
                return self._json(503, {"corrida_id": None, "encontradas": 0, "nuevas": 0,
                                        "error": "Google Chrome no está instalado en esta computadora."})
            usuario = cuerpo.get("usuario") if isinstance(cuerpo.get("usuario"), str) else None
            log("búsqueda", json.dumps(filtros, ensure_ascii=False))
            r = rec.buscar_convocatorias(filtros, origen="conector-pc", cancelado=ESTADO.cancelar.is_set,
                                         usuario=(usuario or "")[:80] or None, log=log)
            det = r.get("detalle") or {}
            res = {"corrida_id": r["corrida_id"], "encontradas": r["encontradas"], "nuevas": r["nuevas"], "error": r["error"],
                   # US-852 (extensión del contrato): detalles abiertos para la descripción y cuántas siguen sin ella.
                   "desde": filtros["desde"], "hasta": filtros["hasta"],
                   "detalles": int(det.get("detalles") or 0), "sin_descripcion": int(det.get("sin_descripcion") or 0)}
            log("resultado", json.dumps(res, ensure_ascii=False))
            self._json(200, res)
        finally:
            ESTADO.ocupado = False
            ESTADO.cancelar.clear()
            ESTADO.candado.release()


class Servidor(ThreadingHTTPServer):
    allow_reuse_address = False   # en Windows SO_REUSEADDR permitiría a dos procesos compartir el puerto
    daemon_threads = True

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main() -> int:
    ap = argparse.ArgumentParser(description="Conector local de ComprasMX para Control de Obra")
    ap.add_argument("--consola", action="store_true", help="bitácora en pantalla en vez de conector.log")
    ap.add_argument("--env", action="append", default=[], help="archivo .env adicional")
    a = ap.parse_args()
    CARPETA_DATOS.mkdir(parents=True, exist_ok=True)
    if not a.consola or sys.stdout is None:
        # pythonw no tiene consola: todo a la bitácora (nunca se escribe el secreto).
        f = open(LOG, "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = f
    # conector.env junto al script (lo escribe el instalador; p. ej. CONVOCATORIAS_TLS_INSEGURO=1) + el del secreto
    rec.cargar_env([Path(x) for x in a.env] + [AQUI / "conector.env"] + rec.ENV_POR_OMISION)
    try:
        srv = Servidor((HOST, PUERTO), Manejador)
    except OSError as e:
        log(f"No se pudo escuchar en {HOST}:{PUERTO} ({e}). ¿Ya hay otro conector abierto o el puerto está ocupado?")
        return 1
    log(f"Conector {VERSION} escuchando en http://{HOST}:{PUERTO} · chrome={hay_chrome()} · "
        f"secreto={'sí' if os.environ.get('CONVOCATORIAS_INGESTA_SECRET') else 'NO'} · "
        f"tls_inseguro={os.environ.get('CONVOCATORIAS_TLS_INSEGURO') == '1'}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
