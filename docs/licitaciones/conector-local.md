# Conector local de ComprasMX (US-851)

## Qué es
Un programa pequeño (Python, `scripts/licitaciones/conector-local.py`) que corre en la computadora del usuario y
escucha **sólo** en `http://127.0.0.1:8879`. Cuando en Licitaciones › Convocatorias se pulsa «Buscar en los portales»
con la fuente ComprasMX, la app le manda los filtros; el conector abre Google Chrome sin cabeza (invisible), aplica
esos filtros en el sitio público de ComprasMX, lee los resultados, los guarda en Control de Obra y responde cuántas
encontró y cuántas son nuevas.

Mientras nadie pide una búsqueda no hace nada: no abre Chrome ni consulta el portal. Atiende una búsqueda a la vez.

## Por qué corre en la PC y no en el servidor
ComprasMX firma cada consulta de su API con reCAPTCHA v3: sólo responde a un navegador real (ver `fuentes.md`).
Correr Chrome en el servidor lo cargaría por cada cliente si el sistema se vende, y reCAPTCHA castiga a las IP de
centros de datos. En la PC del usuario la búsqueda se ve como lo que es: una persona consultando el portal (D12, D13).
Contrataciones Chihuahua no necesita navegador y se consulta desde una función de borde.

## Instalar
Requisitos: Windows 10/11, Python 3.10+ con `pythonw.exe` y Playwright (`python -m pip install playwright`),
Google Chrome, y el archivo del secreto de ingesta en `%USERPROFILE%\.config\control-obra\convocatorias.env`
(lo entrega el administrador; nunca va en el repo).

```powershell
cd <repo>\scripts\licitaciones
powershell -ExecutionPolicy Bypass -File .\Instalar-Conector.ps1            # red normal
powershell -ExecutionPolicy Bypass -File .\Instalar-Conector.ps1 -TlsInseguro   # red que inspecciona TLS (oficina)
```
El instalador, sin permisos de administrador y sin tareas programadas:
1. comprueba Python, `pythonw.exe` y Playwright (avisa si falta Chrome o el secreto);
2. copia `conector-local.py` y `comprasmx-recolector.py` a `%LOCALAPPDATA%\control-obra\conector\`
   (con `-TlsInseguro` escribe ahí `conector.env` con `CONVOCATORIAS_TLS_INSEGURO=1`);
3. crea `Conector Control de Obra.lnk` en la carpeta Inicio del usuario (`shell:startup`), que lo lanza con
   `pythonw.exe`: sin ventana de consola y sin abrir el navegador;
4. lo inicia en ese momento y comprueba que `GET /estado` responde.

Volver a ejecutarlo actualiza los archivos (detiene el anterior primero).

## Quitar
```powershell
powershell -ExecutionPolicy Bypass -File .\Quitar-Conector.ps1   # -ConservarBitacora para dejar conector.log
```
Detiene el proceso (y un Chrome sin cabeza de Playwright que hubiera quedado), borra el acceso de Inicio y la carpeta
`%LOCALAPPDATA%\control-obra\conector\`. No toca el secreto ni los datos de la app.

## ¿Está activo?
- Abrir `http://127.0.0.1:8879/estado` en el navegador: `{"ok": true, "version": "1.1.0", "ocupado": false, "chrome": true}`.
  `ocupado` es `true` mientras corre una búsqueda; `chrome: false` significa que falta Google Chrome.
- Bitácora: `%LOCALAPPDATA%\control-obra\conector.log` (arranque, filtros de cada búsqueda y resultado; nunca el secreto).
- La app muestra el estado del conector en el formulario de búsqueda y explica cómo instalarlo si no responde.

## Contrato HTTP (fijo)
| Petición | Respuesta |
|---|---|
| `GET /estado` | `{ok: true, version, ocupado, chrome}` |
| `POST /comprasmx/buscar` `{texto, tipos: ["obra_publica","servicios_obra"], entidades: ["Chihuahua"], desde: "AAAA-MM-DD", hasta: "AAAA-MM-DD", max_resultados, max_detalles}` | `{corrida_id, encontradas, nuevas, error, desde, hasta, detalles, sin_descripcion}` al terminar (30 s a 5 min). 409 si ya hay una en curso; 400 si los filtros no sirven |
| `POST /comprasmx/cancelar` | `{ok: true, cancelando}`; la búsqueda en curso termina en unos segundos con `error: "Cancelada: …"` |

Todos los campos son opcionales. **Siempre hay límite de fecha (US-852):** sin `hasta` se usa hoy (hora del centro) y
sin `desde`, 30 días antes de `hasta`; el rango no puede pasar de 90 días ni empezar en el futuro (400). `tipos` vacío =
los dos. `max_resultados` por omisión 100, **tope duro 200**. `max_detalles` (por omisión 30, máximo 60): cuántas fichas
de detalle se abren como máximo para leer la descripción. La respuesta agrega `desde`/`hasta` usados, `detalles` (fichas
abiertas) y `sin_descripcion` (de esta búsqueda, cuántas siguen sin descripción por el tope; otra búsqueda igual las
completa). Extensiones opcionales
que no rompen el contrato: `campo_fecha` (`"publicacion"`, por omisión, o `"apertura"`) y `usuario` (texto ≤ 80 que se
guarda en la corrida para el pie «quién la lanzó»; lo declara la app, el conector no autentica).

Cada búsqueda queda en `convocatoria_corridas` con `origen = 'conector-pc'` y en `detalle`: `filtros`, `usuario`,
`busquedas` (por tipo: páginas, totales del portal y `en_portal`, lo que el sitio realmente mandó a su API),
`filtrado_en_portal`, `filtrado_despues`, `avisos` y `segundos`.

## Qué filtra el portal y qué se filtra después
| Filtro | Dónde | Cómo |
|---|---|---|
| Ley (LOPSRM) y pestaña «Anuncios vigentes» | Portal | Fijos: sólo obra pública vigente |
| `tipos` | Portal | Desplegable «Tipo de contratación» (el sitio admite uno a la vez: una pasada por tipo) |
| `entidades` | Portal | Multiselección «Entidad Federativa» del panel Filtros (si alguna no existe en el catálogo del portal se avisa; si ninguna, error) |
| `texto` | Portal | Campo «Nombre» del panel Filtros (`nombre_procedimiento`: subcadena del nombre del procedimiento) |
| `desde` / `hasta` | Portal | «Fecha de publicación» (o «Fecha de presentación y apertura» con `campo_fecha: "apertura"`), escritas como dd/mm/aaaa |
| `max_resultados` | Conector | Sólo se piden las páginas necesarias (100 por página) y se recorta al tope |

El conector **comprueba en el cuerpo que el sitio manda a su API** si cada filtro llegó. Si el texto o las fechas de
apertura no llegaran (cambio del formulario), los filtra después sobre el listado y lo anota en `filtrado_despues`.
La fecha de publicación no viene en el listado: si el portal no la aplicara, se anota un aviso en vez de filtrar a
ciegas. En las pruebas del 5-oct-2026 los tres llegaron al portal.

## Descripción de cada convocatoria (US-852)
El listado del portal no trae la descripción (el objeto de la contratación), sólo el nombre del procedimiento. Tras
guardar el listado, el conector pregunta a `convocatorias-ingesta` (`accion: "sin_descripcion"`) cuáles de **esta
búsqueda** aún no la tienen y abre sólo esas fichas de detalle, una por una, con pausa de 2 a 5 s y tope `max_detalles`.
La ficha de detalle es la página pública del procedimiento: **no se descarga ningún anexo** en la búsqueda. Sólo se traen
«Anuncios vigentes» (pestaña fija del portal).

Probado el 5-oct-2026 desde la app (build local, conector real): Chihuahua + obra pública + últimos 30 días → 8 (ya
tenían descripción, 0 fichas abiertas, 37 s); Sonora + obra pública + últimos 15 días, tope 8 → 8 nuevas, 8 fichas
abiertas, 74 s, las 8 con descripción y publicación dentro del rango.

## Qué datos salen de la máquina
- Hacia **ComprasMX**: las consultas del sitio público que haría una persona con esos filtros (sin iniciar sesión).
- Hacia **Control de Obra** (función `convocatorias-ingesta`): sólo los resultados públicos de la búsqueda (listado y,
  para unas pocas de esa búsqueda que aún no lo tienen, el detalle público sin correos ni nombres de responsables), y el
  registro de la corrida con sus filtros. Autenticado con el secreto de servidor del `.env`, que nunca se imprime ni se
  devuelve por HTTP.
- Nada más: el conector no lee archivos del usuario ni manda telemetría.

## Seguridad del puerto local
- Escucha sólo en `127.0.0.1` (nunca `0.0.0.0`) y con `SO_EXCLUSIVEADDRUSE`, para que otro proceso no comparta el puerto.
- Rechaza (403) cabeceras `Host` distintas de `127.0.0.1:8879` / `localhost:8879` (DNS rebinding).
- CORS: sólo `https://app.supernovarquitectos.com`, `https://obra.srv1090924.hstgr.cloud` y `http://127.0.0.1:*` /
  `http://localhost:*` (pruebas). El preflight responde `Access-Control-Allow-Private-Network: true`.
- Los `POST` sin `Origin` o con otro origen reciben 403, y sin `Content-Type: application/json` reciben 415: una página
  ajena no puede disparar búsquedas ni con un formulario «simple».

## Pendiente del coordinador: CSP de producción
La app sólo podrá llamar al conector si la CSP de producción incluye el origen en `connect-src`:
```
connect-src … http://127.0.0.1:8879;
```
Sitio: la cabecera o `<meta http-equiv="Content-Security-Policy">` que sirve `app.supernovarquitectos.com` (y el alias).
Chrome además pide el permiso «Acceso a la red local» la primera vez (desde `https://…` hacia `127.0.0.1`): hay que
aceptarlo. Si se negó, la app lo distingue de un conector apagado (`navigator.permissions.query({name:
'local-network-access'})` = `denied`) y explica cómo darlo: candado de la barra de direcciones › «Acceso a la red local»
› Permitir, y recargar. En Playwright se concede con `ctx.grant_permissions(['local-network-access'], origin=<app>)`.
Desde `http://127.0.0.1:<puerto>` (pruebas locales) Chrome no lo pide: es loopback a loopback.

## Solución de problemas
| Síntoma | Causa y arreglo |
|---|---|
| `/estado` no responde | No está corriendo. Ejecutar el acceso «Conector Control de Obra» de `shell:startup` o reinstalar. Ver `conector.log`. |
| `conector.log`: «No se pudo escuchar en 127.0.0.1:8879» | Puerto ocupado. `Get-NetTCPConnection -LocalPort 8879` muestra el PID; si es otro conector, `Quitar-Conector.ps1` y reinstalar; si es otro programa, cerrarlo. |
| `chrome: false` o error «Google Chrome no está instalado» | Instalar Google Chrome (el conector usa el Chrome del sistema, no el de Playwright). |
| `error: "Bloqueo: sin respuesta de … (¿reCAPTCHA o sitio caído?)"` | El portal no entregó resultados: reCAPTCHA rechazó la sesión o el sitio está caído. **No se reintenta ni se evade.** Esperar y volver a buscar más tarde; si persiste, abrir el portal a mano en Chrome. |
| `error: "Bloqueo: el sitio ya no ofrece …"` / «no se encontró el campo …» | ComprasMX cambió el formulario: hay que ajustar `comprasmx-recolector.py`. |
| `error: "No se pudo registrar la corrida: …"` o `SSLError` | Sin conexión a Supabase o red con inspección TLS: reinstalar con `-TlsInseguro`. |
| «Falta el secreto de ingesta» | Falta `%USERPROFILE%\.config\control-obra\convocatorias.env`. |
| 409 | Ya hay una búsqueda en curso; esperar o `POST /comprasmx/cancelar`. |

## Depurar
```powershell
python scripts\licitaciones\conector-local.py --consola        # bitácora en pantalla (detener antes el instalado)
python scripts\licitaciones\comprasmx-recolector.py --seco --texto agua --entidades Chihuahua --max-resultados 20
node --test scripts/qa/conector-local.test.mjs                 # CORS/Host/validación, sin tocar el portal (puerto 18879)
```
