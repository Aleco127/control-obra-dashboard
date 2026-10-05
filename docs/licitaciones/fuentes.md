# Fuentes de convocatorias (épica F)

Medido y probado el 4-oct-2026. Dos portales: **Contrataciones Chihuahua** (estatal) y **ComprasMX** (federal).
Las convocatorias son datos públicos y se guardan una sola vez en `control_obra.convocatorias` (migración 100).
Trato con los portales: sólo lectura, pocas peticiones, pausas de 2 a 5 s, nada de evadir controles.

## Resumen

| | Contrataciones Chihuahua | ComprasMX |
|---|---|---|
| Tecnología | Django, `POST /busqueda/` con CSRF | Angular + API `whitney/sitiopublico` firmada con reCAPTCHA v3 |
| ¿HTTP simple? | Sí (también desde Supabase) | No: la API responde **403** sin el token (probado desde la PC y desde el VPS) |
| Recolector | Función de borde `convocatorias-chihuahua` | `scripts/licitaciones/comprasmx-recolector.py` (Playwright + Chrome) → función `convocatorias-ingesta` |
| Dónde corre | Supabase (probado) | PC (probado). VPS: pendiente de instalar Chrome y probar (ver abajo) |
| Volumen | 968 procedimientos de obra y servicios relacionados, vigentes + en seguimiento | 8 de obra pública federal vigentes en Chihuahua (687 vigentes en todo el país, todas las materias) |
| Documentos | Enlaces públicos `contratosadm.chihuahua.gob.mx/descarga_portal.aspx?...` | Descarga pública sin sesión desde el detalle (probado: 5.0 MB) |

## Contrataciones Chihuahua (`https://contrataciones.chihuahua.gob.mx/`)

### Búsqueda que sí devuelve resultados
1. `GET /` → cookie `csrftoken` y el token del HTML (`csrfmiddlewaretoken: "…"` en el JS de la página).
2. `POST /busqueda/` (form-urlencoded) con cabeceras `X-Requested-With: XMLHttpRequest`, `Referer: https://contrataciones.chihuahua.gob.mx/`, `X-CSRFToken` y la cookie.

La clave: el navegador manda **`-1`** en los `<select>` que no se eligen. Con `Tipo_de_Licitaci_n=''` (lo que se probó al
principio) el servidor responde `[]`. Cuerpo que funciona:

```
Unidades_Responsables=        Tipo_de_Licitaci_n=-1   Estatus=0|2      TipoProc=3|1
num_pricedimineto=  num_contrato=  fechainicio=  fechafin=  nom_proveedor=  concepto_contratacion=
rdFechas=2  desc_procedimiento=  csrfmiddlewaretoken=<token>
```

Catálogos del formulario: `TipoProc` 3 obra pública, 1 servicios relacionados con obra pública, 2 adquisición,
4 arrendamiento, 5 servicios · `Estatus` 0 vigente, 2 en seguimiento, 1 terminado, 3 cancelado ·
`Tipo_de_Licitaci_n` 1 licitación pública, 2 invitación, 3 adjudicación directa · `Unidades_Responsables` = id del
ente (52 ICHIFE, 10 SCOP, 197 Municipio de Chihuahua…). La validación del JS exige al menos un filtro; `Estatus` basta.

Conteos del 4-oct-2026: obra/vigente 304, obra/en seguimiento 601, servicios/vigente 56, servicios/en seguimiento 7.
«Vigente» incluye adjudicaciones directas viejas (2022-2024) que el ente nunca cerró: por eso la app filtra por fecha de apertura.

### Campos de la respuesta (lista JSON, sin paginar)
`id_procedimiento` (entero, **id estable** → `id_externo`), `numero_procedimiento`, `descripcion_procedimiento`
(→ `titulo`), `unidad_compradora` (ente contratante → `dependencia`), `unidad_solicitante` (→ `unidad_compradora`),
`tipo_procedimiento`, `materia`, `concepto_contratacion`, `estatus`, `color_boton`, `link_detalle` (`/licitaciones/<id>/`).
**No trae fechas**: están en el detalle.

### Detalle `/licitaciones/<id>/` (HTML)
Pares `<p class="bold">Etiqueta</p> … <p>Valor</p>`: ente contratante y solicitante, documento programado, materia, tipo de
contrato, concepto, descripción, **fecha de publicación, fecha y hora de junta de aclaraciones, de apertura y del fallo**,
lugares, costo de participación. Estatus en `<h4>Estatus del Procedimiento</h4><h4>…</h4>`. Tabla «Documentos»
(Convocatoria, Bases, oficios…) con fecha y enlace público a `contratosadm.chihuahua.gob.mx/descarga_portal.aspx?…`.
Las horas se guardan como UTC-6 (Chihuahua; Juárez usa horario de verano de EE. UU.: puede haber 1 h de diferencia en invierno).

### Recolector: función de borde `convocatorias-chihuahua`
- Código: `supabase/functions/convocatorias-chihuahua/` (`parse.mjs` puro, probado en `scripts/qa/convocatorias-chihuahua.test.mjs`).
- **Responde desde Supabase** (sin bloqueo por región ni TLS): corrida 1 del 4-oct-2026 → 968 encontradas, 968 nuevas,
  30 detalles, 100 s. No hizo falta el script de respaldo; si algún día el portal bloquea a Supabase, el mismo `parse.mjs`
  se puede correr con Node desde el VPS.
- 4 búsquedas (obra y servicios × vigente y en seguimiento) con 2 s de pausa, upsert de todo, y luego hasta
  `max_detalles` (30 por omisión, máx. 60) páginas de detalle con 2 s de pausa, priorizadas por
  `convocatorias_por_revisar` (migración 101): primero las que estaban vigentes y ya no salen (cambiaron de estatus),
  luego las que nunca se han leído (las más nuevas primero) y luego refrescos de vigentes con detalle de más de 72 h.
  La carga inicial completa toma unas semanas de corridas diarias de 30; las nuevas de cada día entran primero.
- Idempotente: único `(fuente, id_externo)`. Verificado: la segunda corrida dio 0 nuevas / 968 actualizadas; una
  convocatoria marcada a mano como `cancelado` volvió a `vigente`, y una que estaba «vigente» y ya no salía
  (ICHIFE-LP-014-2019) se releyó y quedó `terminado`.
- Autorización: cabecera `x-internal-key` (= `app_secrets.internal_key`, la de `jobs`) o `x-convocatorias-secret`.
  Sin llave: 401.

### Cómo conectarlo al job diario (para el coordinador; `jobs` es del agente B)
Agregar a `supabase/functions/jobs/index.ts` una acción `convocatorias` que corra una vez al día a las **7:00 de
Chihuahua (13:00 UTC)**. Hoy el cron del VPS llama a `jobs` a las 14:00 UTC con `action:"all"`; dos opciones:
(a) una entrada de cron aparte a las 13:00 UTC con `{"action":"convocatorias"}`, o (b) incluirla en `all` (correría a las 8:00).

```ts
async function jobConvocatorias(internalKey: string) {
  const r = await fetch(FN_URL + "/convocatorias-chihuahua", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": internalKey },
    body: JSON.stringify({ max_detalles: 30 }),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
// en Deno.serve:
if (action === "convocatorias" || action === "all") result.convocatorias = await jobConvocatorias(internalKey);
```
La propia función registra la corrida en `convocatoria_corridas` (con error si falla). Tarda ~100 s: si `all` se acerca al
límite de tiempo de la función `jobs`, usar la opción (a).

## ComprasMX (`https://comprasmx.buengobierno.gob.mx/sitiopublico/`)

### Arquitectura
Angular (PrimeNG). Llama a `https://upcp-cnetservicios.buengobierno.gob.mx/whitney/sitiopublico/…` con cabeceras
`grc`, `xgrc`, `igrc` derivadas de reCAPTCHA v3 (cambian en cada llamada). Sin ellas la API responde **403** (desde la PC
y desde el VPS). No se intenta generar ni reutilizar esos tokens: el recolector maneja un Chrome real y lee las
respuestas que el propio sitio recibe.

### Llamadas
| Llamada | Para qué |
|---|---|
| `POST catalogos` `{"catalogo": "leyes"/"tipocontratacion"/"entidadfederativa"/"estatus"/"caracter"/"medioparticipacion"/"clave", "ley_id", "filtro": null}` | Catálogos de los filtros |
| `POST expedientes?rows=100&page=N` | Búsqueda paginada (cuerpo abajo) |
| `GET expedientes/<uuid>?id_proceso=procedimiento` | Detalle completo |
| `GET expedientes/<uuid>/anexos?id_proceso=procedimiento&rows=10&page=1` | Anexos y sus archivos |
| `GET expedientes/<uuid>/reqeconomicos?…&grupo=1` | Partidas (CUCoP) |

Cuerpo de la búsqueda (lo que manda el sitio al elegir LOPSRM + Obra pública + Chihuahua):
```json
{"id_ley":2,"id_tipo_procedimiento":null,"id_tipo_contratacion":4,"fecha_apertura_inicio":null,"fecha_apertura_fin":null,
 "fecha_publicacion_inicio":null,"fecha_publicacion_fin":null,"id_tipo_dependencia":[],"numero_procedimiento":null,
 "nombre_procedimiento":null,"credito_externo":null,"exclusivo_mipymes":null,"id_forma_participacion":null,
 "id_entidad_federativa":[6],"id_p_especifica":[],"id_caracter_procedimiento":null,"id_estatus":0,"id_proceso":0,
 "codigo_expediente":null,"codigo_procedimiento":null,"estatus_alterno":[],"compra_consolidada":false}
```
Catálogos útiles: ley 1 LAASSP, **2 LOPSRM**, 21 APP, 3 crédito externo · tipo de contratación (ley 2) **4 obra pública,
5 servicios relacionados con la obra** (el sitio la marca obligatoria) · entidad federativa 1-32 (Chihuahua = **6**) ·
`id_estatus` 0 = pestaña «Anuncios vigentes» (1 en seguimiento, 2 concluidos).

### Campos y paginación
Respuesta `{"success":true,"data":[{"registros":[…],"paginacion":[{"pagina_actual","registros_pagina","total_paginas",
"total_registros","registro_inicial","registro_final"}]}]}`. Cada registro: `id_procedimiento`, **`uuid_procedimiento`**
(32 hex, el que usa la URL del detalle → `id_externo`), `numero_procedimiento`, `cod_expediente`, `nombre_procedimiento`,
`siglas`, `estatus` (p. ej. «VIGENTE PAP», «VIGENTE JA»), `estatus_alterno` («VIGENTE»), `tipo_procedimiento`,
`caracter`, `fecha_aclaraciones`, `fecha_apertura`, `entidad_federativa_contratacion`, `unidad_compradora`,
`tipo_contratacion`. Fechas sin zona en hora del centro (se guardan con `-06:00`).

El detalle añade `nombre_dependencia`, `ramo`, `descripcion`, `fecha_publicacion`, `fecha_junta_aclaracion`,
`fecha_acto_fallo`, lugares, visita, anticipo, plazo de ejecución, condiciones de pago, garantías… y la lista de anexos.
El recolector descarta `email_uc` y `responsable` (datos de personas).

URL pública de un procedimiento: `https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/<uuid>/procedimiento`.

### Anexos y descarga
`anexos` devuelve por anexo (Invitación, Anexo técnico, Modelo de contrato, Anexos, Actas…) la lista `documentos` con
`nombre`, `uuid_pa`, `original_size`, fechas. En el detalle público, el icono de acciones abre un diálogo con un botón
de descarga por archivo. **La descarga funciona sin sesión**: el 4-oct-2026 se bajó `BASES IO N36 26.pdf`
(5,030,641 bytes) de IO-67-010-908029999-N-36-2026 con Chrome sin cabeza y sin iniciar sesión (carpeta temporal fuera
del repo). Implicación para US-848: para ComprasMX probablemente **no hace falta la cuenta de la empresa** para bajar
bases y anexos; conviene construir la descarga por la vía pública y dejar el inicio de sesión sólo si algún
procedimiento lo exige.

### reCAPTCHA y navegador automatizado
- **PC (Windows, red con inspección TLS)**: Chrome real (`channel="chrome"`) **sin cabeza** pasó en todas las pruebas
  (8 sesiones de navegador entre exploración y recolector, ~80 llamadas a la API, búsquedas filtradas y 11 detalles). No apareció ningún reto visible.
- **VPS**: no se probó con navegador porque no tiene Chrome ni Playwright y la regla de esta épica prohíbe instalar nada
  en él. Desde el VPS el sitio responde 200 y la API sin token 403, igual que desde la PC. reCAPTCHA v3 puntúa peor a las
  IP de centros de datos: es el riesgo a comprobar. Procedimiento de prueba propuesto abajo.

### Inicio de sesión (prueba única)
- Flujo: «Iniciar sesión» → `https://comprasmx.buengobierno.gob.mx/panel/` → Keycloak (realm `procura`, cliente `hanna`,
  `/auth/realms/procura/protocol/openid-connect/auth`). Formulario simple: `username`, `password`, `credentialId`
  (oculto) y botón `login`. **Sin captcha visible** antes de enviar.
- Resultado del único intento (4-oct-2026, cuenta `portal:1:comprasmx` leída de Vault y pasada sólo por el entorno del
  proceso): **«Usuario o contraseña incorrectos.»** El portal tardó 53 s en responder; no pidió captcha ni segundo factor.
  **No se reintentó.** Por lo tanto no se pudo documentar el panel, la duración de la sesión ni la descarga con sesión.
- Qué falta: que Ricardo confirme el usuario guardado (quizá el portal espera otro identificador, p. ej. un correo
  o el RFC del representante) y la contraseña (el PRD ya recomienda cambiarla), y la actualice en Vault/Expediente ›
  Portales (US-847). Con eso, una prueba con `python scripts/licitaciones/comprasmx-explorar.py login --uuid <uuid> --out <tmp>`
  documenta el panel y lee `expires_in`/`refresh_expires_in` del token de Keycloak (sin guardar el token).
- Dado que la descarga es pública, la cuenta sólo haría falta para lo que el sitio público no muestre.

### Conclusión: dónde corre el recolector de ComprasMX
**Hoy: en la PC** (único lugar probado), con el Programador de tareas de Windows una vez al día. **Objetivo: el VPS**
si pasa la prueba de reCAPTCHA (siempre encendido, misma red que el monitoreo). Las credenciales del portal no hacen
falta para buscar; para descargar tampoco, según la prueba de hoy.

### Recolector `scripts/licitaciones/comprasmx-recolector.py`
- Pide a `convocatorias-ingesta` (`config`) las entidades de los filtros activos que incluyen ComprasMX (hoy: Chihuahua).
- Por cada tipo («Obra pública», «Servicios relacionados con la obra»): abre el sitio, elige LOPSRM, el tipo y las
  entidades, «Buscar», y recorre las páginas con 3 s (+0-2 s) de pausa y **tope de 3 páginas de 100** por tipo.
- Manda el listado en lotes de ≤ 200 (`lote`), pide a la BD qué detalles leer (`por_revisar`, tope 10) y los abre uno por
  uno con pausa (recarga completa: Angular no vuelve a pedir el detalle si sólo cambia el hash).
- Registra la corrida (`iniciar`/`cerrar`) en `convocatoria_corridas` con origen (`script-pc` / `script-vps`).
- Si el sitio no responde o rechaza (posible reCAPTCHA), la corrida se cierra con `error = "Bloqueo: …"`, avisa por
  Telegram (`TELEGRAM_BOT`/`TELEGRAM_CHAT`, el canal del monitoreo del VPS) y **no reintenta**.
- `--vigilar [--horas 48]`: consulta `estado` y avisa si alguna fuente lleva más de 48 h sin corrida correcta (código 1).
- `--seco`: recorre el portal sin escribir nada.
- Prueba real acotada (PC, 4-oct-2026): corrida 3 → 8 encontradas/8 nuevas; corrida 4 → 0 nuevas/8 actualizadas,
  7 detalles, 77 s. Las 8 quedaron con publicación, junta, apertura y fallo.

### Búsqueda a petición con filtros (D12, D13, US-851)
Sustituye a la corrida diaria: `buscar_convocatorias(filtros)` en el recolector (también por línea de comandos con
`--texto/--entidades/--tipos/--desde/--hasta/--max-resultados`) y el **conector local** que la expone a la app en
`127.0.0.1:8879` (ver `conector-local.md`). Filtros del panel «Filtros» del portal comprobados el 5-oct-2026 en el
cuerpo que el sitio manda a su API: «Nombre» → `nombre_procedimiento` (subcadena), «Fecha de publicación» →
`fecha_publicacion_inicio/fin`, «Fecha de presentación y apertura» → `fecha_apertura_inicio/fin` (se escriben
dd/mm/aaaa; Escape después de escribir borra el valor del `p-calendar`). Ejemplo: Chihuahua + obra pública +
publicación 28-sep a 5-oct → 5 de 8; + «agua» → 2.

### Secreto de servidor
- `CONVOCATORIAS_INGESTA_SECRET` (64 hex) generado el 4-oct-2026. Vive **sólo** en
  `C:\Users\aleja\.config\control-obra\convocatorias.env` (fuera del repo; ACL sólo para el usuario `aleja`; equivale a
  permisos 600). En la BD se guarda únicamente su SHA-256 en `public.app_secrets` (`convocatorias_ingesta_sha256`);
  las funciones comparan el hash. No hizo falta CLI ni secretos de función.
- Para el VPS: copiar el archivo a `/root/.obra_convocatorias.env` con `chmod 600` (el script lo busca ahí).
- Rotarlo: generar uno nuevo, actualizar el hash en `app_secrets` y el `.env`.
- Las credenciales del portal **no** van en este `.env`: viven en Vault y sólo las pediría US-848 si hicieran falta.

### Instalación propuesta (NO ejecutada)
**PC (Windows)**, tarea diaria 6:30 Chihuahua:
```
schtasks /Create /TN "ControlObra\ConvocatoriasComprasMX" /SC DAILY /ST 06:30 /RL LIMITED ^
  /TR "cmd /c set CONVOCATORIAS_TLS_INSEGURO=1&& python C:\dev\control-obra\scripts\licitaciones\comprasmx-recolector.py --origen script-pc >> %LOCALAPPDATA%\control-obra\comprasmx.log 2>&1"
schtasks /Create /TN "ControlObra\ConvocatoriasVigilar" /SC DAILY /ST 12:00 ^
  /TR "python C:\dev\control-obra\scripts\licitaciones\comprasmx-recolector.py --vigilar"
```
(`CONVOCATORIAS_TLS_INSEGURO=1` sólo porque la red de la oficina intercepta TLS; en el VPS no se usa. En la PC no hay
Telegram configurado: copiar `TELEGRAM_BOT`/`TELEGRAM_CHAT` al `.env` si se quieren avisos desde ahí.)

**VPS** (cuando se autorice instalar), con la imagen oficial de Playwright para no tocar el sistema:
1. Prueba de reCAPTCHA (una sola vez, en seco):
   `docker run --rm -v /docker/control-obra-dashboard/scripts:/s mcr.microsoft.com/playwright/python:v1.48.0-jammy bash -c "pip install -q playwright==1.48.0 && playwright install chrome && python /s/licitaciones/comprasmx-recolector.py --seco --entidades Chihuahua --max-paginas 1 --max-detalles 1"`
   Si imprime `"leidos": N` con N > 0, pasa; si sale `Bloqueo`, se queda en la PC.
2. Si pasa: `/root/.obra_convocatorias.env` (600) y en crontab de root:
   ```
   30 12 * * * docker run --rm --env-file /root/.obra_convocatorias.env --env-file /root/.obra_telegram.env -v /docker/control-obra-dashboard/scripts:/s <imagen-con-chrome> python /s/licitaciones/comprasmx-recolector.py --origen script-vps >> /var/log/comprasmx.log 2>&1
   0 18 * * * docker run --rm --env-file /root/.obra_convocatorias.env --env-file /root/.obra_telegram.env -v /docker/control-obra-dashboard/scripts:/s <imagen-con-chrome> python /s/licitaciones/comprasmx-recolector.py --vigilar
   ```
   (12:30 UTC = 6:30 Chihuahua; el vigilante también cubre a Chihuahua.)

## Filtros: regla «cumple el filtro»
Igual en SQL (`control_obra.convocatoria_cumple_filtro`, migración 100) y en `cumpleFiltro()` de US-844:
palabras clave = basta una (texto sin acentos ni mayúsculas, como subcadena de número + título + dependencia + unidad +
municipio); palabras a excluir = ninguna; fuentes, entidades y tipos vacíos = todos; entidad comparada normalizada.
Filtros de fábrica de la empresa 1: «Obra pública en Chihuahua (estatal)» (fuente chihuahua, obra y servicios) y
«Obra pública federal en Chihuahua» (comprasmx, entidad Chihuahua, obra y servicios).
