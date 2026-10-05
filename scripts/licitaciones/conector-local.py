"""Conector local de ComprasMX (US-851): un servidor HTTP pequeño que corre en la PC del usuario.

La app web (https://app.supernovarquitectos.com) le pide una búsqueda; el conector abre Chrome real sin cabeza,
aplica los filtros en el sitio público de ComprasMX (que exige reCAPTCHA v3, por eso no corre en el servidor; D13),
manda los resultados a la función de borde `convocatorias-ingesta` y responde cuántas encontró y cuántas son nuevas.

Contrato (fijo; la interfaz se construye contra él):
  Base  http://127.0.0.1:8879  (sólo loopback)
  GET   /estado              → {ok:true, version, ocupado, chrome}
  POST  /comprasmx/buscar    {texto, tipos[], entidades[], desde, hasta, max_resultados}
                             → {corrida_id, encontradas, nuevas, error}   (409 si ya hay una búsqueda en curso)
  POST  /comprasmx/cancelar  → {ok, cancelando}

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
import importlib.util
import json
import os
import re
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "1.1.0"
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
            if ESTADO.ocupado:
                ESTADO.cancelar.set()
                log("cancelación pedida")
                return self._json(200, {"ok": True, "cancelando": True})
            return self._json(200, {"ok": True, "cancelando": False})
        if ruta == "/comprasmx/buscar":
            return self._buscar(cuerpo)
        self._json(404, {"ok": False, "error": "No encontrado"})

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
