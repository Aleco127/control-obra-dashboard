# Control de Obra como producto: mercado y brecha para un MVP vendible

Fecha: 29 de agosto de 2026. Autor: análisis técnico y de mercado sobre `control-obra-dashboard` (estado tras la fase 2 de finanzas). Fuentes al final.

## 1. Veredicto en tres líneas

1. **Funcionalmente ya estás por encima del MVP de la categoría.** Los 29 módulos, y sobre todo lo de fase 2 (resultado por obra, reparto entre socios, cierre mensual para el contador, conciliación bancaria, lector CFDI), cubren más de lo que ofrecen Contractor Foreman o Constructora360 en sus planes base. Nadie en la tabla vende "cuánto ganaste en cada obra y cuánto le toca a cada socio".
2. **Lo que falta no es producto, es empresa de software:** marca y dominio propios, cobro recurrente con CFDI, aviso de privacidad y términos, seguridad de datos que resista a un cliente desconocido (hoy hay 7 vistas `SECURITY DEFINER` en error, 31 tablas con RLS sin políticas, 70 funciones ejecutables con la llave anónima, sin CSP ni recuperación de contraseña), rendimiento en celular (1.3 MB de HTML sin comprimir, sin PWA) y operación (monitoreo, respaldos verificados, soporte).
3. **Esfuerzo estimado:** 15 a 20 días de desarrollo para cerrar lo bloqueante y cobrar al primer cliente externo; 35 a 45 días para el MVP competitivo en México (emisión de CFDI, portal del cliente, notificaciones, exportación contable, captura offline). Al ritmo de la fase 2 (33 historias en una sesión) esto cabe en 10 semanas de calendario con validación en medio.

## 2. Cómo funcionan las plataformas similares

| Plataforma | Segmento | Precio (2026) | Modelo de cobro | Prueba y onboarding | Integraciones | Móvil / offline | Qué enseña |
|---|---|---|---|---|---|---|---|
| **Procore** (EUA) | Constructoras medianas y grandes, >10 M USD de obra anual | 4,500 a 60,000+ USD/año; típico 15 a 30 k | Por volumen anual de construcción (ACV), precio no público | Demo obligatoria; implementación 50 a 150 k USD; +10 a 14 % al renovar | QuickBooks, Sage, ERP, API abierta | App nativa con offline | Define el vocabulario (RFI, daily logs, submittals). No es competidor del segmento |
| **Buildertrend** | Constructores residenciales y remodelación | 339 / 499 / 829 USD/mes (otros sitios reportan 499 a 1,099) | Plano por empresa, usuarios ilimitados; onboarding 400 a 1,500 USD | Sin prueba self-service, demo con ventas; 30 días de garantía en algunos planes | QuickBooks, Xero; portal de cliente, selecciones, garantías | App nativa | Portal de cliente como diferenciador; castigado por precio opaco, curva de aprendizaje, +50 % al renovar y exportación difícil |
| **JobTread** | Remodeladores y contratistas generales pequeños | 159 USD/mes anual (199 mensual) + 18 USD por usuario | Plano + por usuario, todo incluido | Implementación, capacitación y soporte humano gratis | QuickBooks, firma electrónica, pagos | App | G2 4.9: el soporte con persona real es el diferenciador, no las funciones |
| **Contractor Foreman** | Contratistas pequeños | 49 / 105 / 166 / 221 / 332 USD/mes según usuarios (1, 3, 8, 15, ilimitados) | Escalera por usuarios | Prueba gratis + garantía de 100 días | QuickBooks, Google Calendar | App | "50+ funciones por menos"; quejas por módulos poco profundos y límites del directorio |
| **Fieldwire** (Hilti) | Campo: planos, tareas, punch list | Básico gratis; 39 a 89 USD/usuario/mes | Por usuario, freemium | Prueba gratis | Sin contabilidad nativa (API o Smartsheet) | Offline real, referencia de la categoría | Campo primero; el offline es el núcleo, no un extra |
| **Knowify** | Contratistas de oficio con job costing | 99 a 249 USD/mes | Por plan | Prueba | Sincronización bidireccional con QuickBooks (tiempo, nómina, facturas) | App | La contabilidad es el pegamento del producto |
| **Houzz Pro** | Diseño-construcción e interiorismo | 149 USD/mes (hasta 250 k de obra) / 249 (hasta 500 k) + 60 USD por usuario extra | Por volumen de obra en pequeño | 30 días gratis | QuickBooks, pagos en línea, marketing | App | Precio por volumen funciona también en despachos chicos |
| **Buildbite** (UE) | Campo y cuadrillas | 49 EUR base + 8 a 10 EUR/usuario | Base + por usuario activo | 14 días sin tarjeta | Básicas | App offline | Cobrar sólo por usuario activo reduce fricción |
| **Constructora360** (MX) | PyMEs 5 a 200 empleados | Gratis (3 proyectos, 1 usuario, 11 módulos) / 499 MXN (5 proyectos, 3 usuarios) / 999 MXN (ilimitado, 26 módulos, 10 usuarios) / 2,499+ MXN | Freemium + escalera por obras y usuarios; anual con 2 meses gratis | 30 días sin tarjeta; "implementación el mismo día"; soporte por WhatsApp; onboarding 2 semanas | Lector CFDI/XML en todos los planes, nómina IMSS/INFONAVIT, flujo de caja | PWA "100 % offline": bitácora, fotos georreferenciadas, checklist, firma | **Competidor directo.** Mismo rango de precio, hecho para la normativa mexicana |
| **Obra3D** (MX) | Constructoras 5 a 40 empleados | 35 a 70 k MXN inicial + 180 a 400 k MXN/año (dato de terceros) | Licencia + anualidad | Implementación asistida | CFDI 4.0 con complemento, retenciones automáticas | App con offline | El segmento paga por cumplimiento fiscal resuelto |
| **CONTPAQi Construcción** | Empresas que ya usan CONTPAQi | ~45 k MXN licencia + 18 % anual | Perpetua | Con distribuidor | Nativa con CONTPAQi; nómina como módulo aparte | App sin offline real | El contador manda: integrarse a CONTPAQi/Aspel abre puertas |
| **Neodata / OPUS** | Presupuestos y precios unitarios (obra pública) | OPUS 15,740 a 38,360 MXN licencia permanente; Neodata en renta de 1 a 24 meses | Licencia o renta | Distribuidores | Bases de datos de precios | Escritorio (Neodata tiene nube) | No controlan la operación diaria; hay que importar sus presupuestos, no competir con ellos |
| **Buildpeer** (MX, 2022) | Bitácora, evidencias y documentos | No público | SaaS | Demo | Básicas | App | 900+ proyectos en México: hay mercado para herramientas de campo simples |
| **Presupix / Joist / Jobber** | Contratistas independientes | Gratis / 30 USD / 49 USD | Plano | Self-service | QuickBooks (IVA mexicano manual) | App | El contratista chico quiere presupuesto, cobro y cliente; nada más |

### Seis patrones que se repiten

1. **Precio plano por empresa** (usuarios ilimitados o base + usuario), con escalones por obras activas y usuarios. El freemium ya existe en México (Constructora360) y en campo (Fieldwire).
2. **Prueba de 14 a 30 días sin tarjeta y onboarding humano** (WhatsApp, videollamada, "persona real en horario de oficina"). Los que obligan a la demo con ventas (Procore, Buildertrend) son los peor evaluados en precio y curva de aprendizaje.
3. **La contabilidad es el pegamento.** En EUA todo se sincroniza con QuickBooks; en México el equivalente es lector XML + CFDI 4.0 + exportación a CONTPAQi/Aspel + IMSS.
4. **Campo primero:** app instalable con offline real, fotos, bitácora y checklist. No es un extra del plan alto.
5. **Portal del cliente** (avance, fotos, pagos, selecciones) es lo que diferencia a los residenciales y de diseño-construcción.
6. **Salida de datos y renovaciones transparentes.** Las quejas más repetidas en G2 y Capterra: difícil exportar al cancelar, aumentos sorpresivos, lentitud, falta de vista multi-proyecto, base de precios incompleta.

### Requisitos "no negociables" que el mercado mexicano ya da por hecho

Según los comparativos locales (Constructora360, Magokoro) y las fichas de los ERP mexicanos: CFDI 4.0 nativo (emitir, no sólo leer), nómina de obra con IMSS/INFONAVIT/SUA o al menos exportación a Nómina Constructor/Aspel, app de campo offline, presupuesto por catálogo con control real contra lo gastado, estimaciones, retenciones (5 al millar en obra pública) y REPSE cuando hay subcontratación. Dato de contexto: más del 68 % de las constructoras pequeñas y medianas siguen en Excel, WhatsApp y carpetas, con ~15 % de sobrecosto por reprocesos.

## 3. Dónde está Control de Obra hoy

### Lo que ya existe y vale

- 29 módulos en 9 categorías; wizard de alta de obra en 5 pasos; ficha 360 de obra; programa con Semanas y curva S; cobros con CxC obligatoria; recibos y reportes PDF/Excel; roles con permisos por nivel; dashboard por rol.
- **Fase 2 (único en la tabla comparativa):** compras y gastos con destino obra/indirecto/socio y clasificación automática; ticket con foto y factura pedida por WhatsApp; pagos a proveedores en lote con CLABE; flujo de caja real; resultado por obra con semáforo de margen; estado de resultados; lector e importador CFDI 3.3/4.0; cierre mensual con ZIP para el contador; conciliación bancaria; socios con cuenta corriente y reparto de utilidades en 4 pasos con acta PDF.
- Multi-empresa desde el origen: registro self-service (`registrar_usuario` crea empresa o se une por código de invitación), panel de administración SaaS (`admin.html`) con empresas, usuarios, planes sembrados (Free 0 / Pro 799 / Enterprise 1,999 MXN) y monitoreo de errores; RLS por empresa en todo lo nuevo (fase 1 y 2); Storage privado con URLs firmadas.
- Calidad medible: 46 pruebas unitarias, auditoría Playwright + axe en 17 módulos y 2 viewports, tokens de diseño validados, manual de usuario de 71 páginas, protocolo de prueba de usabilidad.

### Datos duros (Supabase, 29-ago-2026)

4 empresas, 6 usuarios, 16 obras, 243 gastos, 2 suscripciones (plan Free), 193 eventos de UI en 30 días, 59 MB de base. En la práctica hay **un solo cliente real (Supernova)**; las otras empresas son pruebas. No hay evidencia de uso externo ni pruebas de usabilidad ejecutadas todavía.

### Lo que impide venderlo hoy (con evidencia)

| Área | Evidencia | Consecuencia |
|---|---|---|
| Marca | `configData` por defecto dice "SUPERNOVA ARQUITECTOS"; el respaldo se llama `supernova_backup_*.json`; la URL es `obra.srv1090924.hstgr.cloud` (subdominio del VPS); el nombre "Control de Obra" es genérico y `controljdaobra.com` ya lo usa otro producto | Un prospecto no puede confiar ni recomendar algo sin nombre ni dominio |
| Cobro | Existen `subscription_plans` y `empresa_subscriptions`, pero no hay pasarela, ni suscripción recurrente, ni CFDI del cobro, ni bloqueo por vencimiento; `check_plan_limit` existe pero no gobierna la UI | No se puede cobrar ni escalar |
| Legal | Sin aviso de privacidad (LFPDPPP), sin términos y condiciones, sin SLA, sin contrato de suscripción | Requisito legal para tratar datos de terceros en México |
| Seguridad | Advisors de Supabase: 7 ERROR (`security_definer_view`), 147 WARN (70 funciones `SECURITY DEFINER` ejecutables por `anon` y `authenticated`, 4 con `search_path` mutable, extensiones en `public`), 31 tablas con RLS sin políticas; REPSE/SUA con `USING (true)`; Caddy en vivo sin CSP ni HSTS (el Caddyfile con headers en `/docker/n8n-app` está huérfano desde enero: la configuración real se genera en el `docker-compose.yml`); auth propia sin recuperación de contraseña, sin verificación de correo, sin 2FA, sin límite de intentos; llave anónima embebida (normal) pero con superficie RPC amplia | Con un cliente ajeno en la misma base, esto es riesgo real de fuga entre empresas |
| Rendimiento y móvil | `index.html` de 1.3 MB + 440 KB de JS sin minificar; Tailwind por CDN; sin `manifest` ni service worker (no instalable, sin offline; `Outbox` sólo guarda borradores) | En celular con datos la carga es lenta y "se queda en Sincronizando" (ya pasó en iPhone) |
| Cumplimiento fiscal | Sólo lectura de XML; no emite CFDI 4.0 ni complementos; nómina sin IMSS/SUA (tablas de SUA existen pero sin producto); sin retenciones | Constructora360 y Obra3D lo incluyen; el contador lo pedirá en la primera semana |
| Cliente final | Sin portal del cliente (avance, fotos, estimaciones, pagos); sin notificaciones por correo/WhatsApp | El cliente de la obra sigue pidiendo todo por WhatsApp |
| Integraciones | Sin exportación a CONTPAQi/Aspel; importación de presupuesto sólo desde Excel (falta plantilla OPUS/Neodata documentada) | Fricción con el contador y con quien ya presupuesta en OPUS |
| Operación | Sin monitoreo de disponibilidad ni alertas; respaldos de Supabase no verificados; sin CI que corra las pruebas; despliegue por `scp` manual; un solo desarrollador | Un incidente a las 7 a.m. se descubre por el cliente |
| Soporte y ayuda | Manual en PDF; sin centro de ayuda, sin chat/WhatsApp de soporte formal, sin tour de primer uso | Onboarding depende de que tú estés presente |
| Validación | Cero pruebas de usabilidad ejecutadas; cero clientes externos; telemetría de UI sin análisis | No sabemos qué va a romperse con un usuario que no seas tú |

## 4. Brecha para el MVP vendible (priorizada)

Esfuerzo en días de desarrollo de una persona con el flujo actual (Claude Code + despliegue directo). "Bloqueante" = sin esto no se le cobra a un desconocido.

### Bloqueantes (15 a 20 días)

| # | Qué | Detalle | Días |
|---|---|---|---|
| B1 | Marca, dominio y correo | Nombre propio (no "Control de Obra"), logo, dominio .mx, correo transaccional (Resend o el mailserver de Zook), quitar todo "Supernova" hardcodeado, pantalla de login con marca, favicon/manifest | 2 a 3 |
| B2 | Legal | Aviso de privacidad LFPDPPP, términos y condiciones con SLA y límites de responsabilidad, contrato de suscripción, consentimiento en el registro, política de eliminación de datos | 1 a 2 (+ revisión de abogado) |
| B3 | Cobro y planes | Pasarela recurrente (Openpay ya está en producción en Zook; alternativa Stripe MX o Conekta), prueba de 30 días sin tarjeta, aplicar límites de plan en UI y RPC (`check_plan_limit`), estado "vencido" con gracia de 7 días, CFDI automático por cada cobro (Facturama o gigstack), historial de facturas en Configuración | 5 a 7 |
| B4 | Seguridad mínima para multi-tenant real | Corregir las 7 vistas `SECURITY DEFINER`; políticas RLS por `empresa_id` en las 31 tablas sin política y quitar `USING (true)` de REPSE/SUA; revocar `EXECUTE` a `anon` en funciones que no sean login/registro; `search_path` fijo en triggers; CSP (incluyendo cdnjs y jsdelivr), HSTS y `X-Frame-Options` en el bloque de Caddy real (`/docker/clientes-caddy/*.caddy`); recuperación de contraseña y verificación de correo; límite de intentos de login; rotación de sesiones; correr de nuevo los advisors hasta 0 ERROR | 5 a 7 |
| B5 | Salida de datos y borrado | Verificar que el respaldo JSON + Excel exporte TODO (fase 2 incluida); botón "Eliminar mi empresa" con periodo de gracia; declarar en los términos que los datos son del cliente | 1 |
| B6 | Onboarding self-service | Registro → empresa → primera obra en menos de 10 minutos; datos de ejemplo opcionales; checklist de activación (obra, catálogo, 5 gastos, 1 cobro); correo de bienvenida y 3 correos de la prueba; tour de 5 pasos en el primer ingreso | 3 a 4 |
| B7 | Rendimiento y PWA | Tailwind compilado (no CDN), minificar y servir con brotli/gzip y cache headers desde nginx, partir `index.html` en módulos cargados bajo demanda (empezar por los que ya son archivos), `manifest.json` + service worker para instalar y abrir offline en lectura | 4 a 6 |
| B8 | Operación | Uptime Kuma o similar con alerta a Telegram, alertas de `log_client_error` agrupadas, respaldo diario de Supabase verificado (PITR del plan Pro o `pg_dump` al VPS), CI en GitHub que corra las 46 pruebas + tokens + auditoría antes de desplegar, despliegue por script | 2 a 3 |
| B9 | Soporte | WhatsApp y correo de soporte con horario, centro de ayuda a partir del manual (una página por módulo), botón "Ayuda" dentro de la app | 1 a 2 |

### Necesarios para competir en México (20 a 25 días, primeros 3 meses)

| # | Qué | Detalle | Días |
|---|---|---|---|
| N1 | Emisión de CFDI 4.0 | Timbrar estimaciones y facturas a clientes vía PAC (Facturama/SW), catálogo de productos SAT, uso CFDI, complemento de pago, cancelación; complemento de servicios parciales de construcción cuando aplique; timbres como consumo aparte | 8 a 10 |
| N2 | Exportación contable | Pólizas y auxiliares en formato CONTPAQi/Aspel (xlsx/CSV), y el ZIP del cierre ya existente como paquete estándar del contador | 2 a 3 |
| N3 | Portal del cliente | Enlace seguro por obra: avance, fotos, estimaciones, pagos pendientes y realizados, comprobantes, link de pago; sin login pesado | 4 a 6 |
| N4 | Notificaciones | Correo y WhatsApp (reusar infraestructura de Zook) para aprobaciones pendientes, cobros vencidos, cierre de mes, actividad del cliente | 3 a 4 |
| N5 | Importar presupuestos de OPUS/Neodata | Plantilla y mapeo documentado desde el Excel que exportan ambos; validación de partidas y claves | 2 |
| N6 | Captura offline en campo | Extender `Outbox` a bitácora, fotos y gastos con cola de sincronización visible; envolver con Capacitor si se quiere tienda (ya hay patrón en Zook Mensajes) | 5 a 8 |

### Diferenciadores que ya existen (empaquetar, no construir)

Resultado por obra con semáforo de margen; reparto de utilidades entre socios con acta; cierre mensual con ZIP para el contador; conciliación bancaria; clasificación automática de gastos; ticket con foto y factura por WhatsApp; honorarios sin IVA para despachos de arquitectura. El mensaje de venta sale de aquí: **"Sabe cuánto ganaste en cada obra y cuánto le toca a cada socio, sin esperar al contador."**

### Para después (no MVP)

Nómina completa con IMSS/SUA/INFONAVIT (mientras tanto exportar a Nómina Constructor), REPSE, inventario y almacén, subcontratos avanzados, BIM/planos con marcado, API pública, integración nativa con CONTPAQi, multi-moneda.

## 5. Posicionamiento y precio propuestos

**Cliente inicial:** despachos de arquitectura y constructoras pequeñas de 2 a 15 personas con 2 a 8 obras al año y dos o más socios que se reparten utilidades. Es el perfil de Supernova, es donde el producto ya está probado y es el ángulo que ningún competidor toma.

**Precio (MXN/mes, IVA aparte), ajustando los planes sembrados:**

| Plan | Precio | Incluye | Referencia competitiva |
|---|---|---|---|
| Gratis | 0 | 1 obra activa, 2 usuarios, sin CFDI ni socios | Constructora360 gratis (3 proyectos, 1 usuario) |
| Estudio | 599 | 5 obras, 5 usuarios, resultado por obra, socios y reparto, cierre mensual | Constructora360 499; Contractor Foreman ~900 |
| Constructora | 1,299 | Obras ilimitadas, 15 usuarios, portal del cliente, 50 timbres CFDI/mes, conciliación, exportación contable | Constructora360 999; Buildertrend ~6,000+ |
| Anual | 10 meses | Dos meses gratis | Igual que Constructora360 |

Los planes actuales (Pro 799 / Enterprise 1,999) están razonables pero sin el escalón bajo que abre la puerta; el gratis con 1 obra convierte al arquitecto independiente en vendedor del producto.

## 6. Plan de 10 semanas

| Semanas | Entrega | Bloques |
|---|---|---|
| 1 a 2 | Marca, dominio, legal, seguridad multi-tenant a 0 errores en advisors | B1, B2, B4 |
| 3 a 4 | Cobro recurrente con CFDI, límites de plan, onboarding self-service, PWA y rendimiento | B3, B6, B7 |
| 5 | Operación, soporte, salida de datos. **Beta privada con 5 despachos** (gratis 3 meses a cambio de sesiones de usabilidad) | B5, B8, B9 |
| 6 a 8 | Emisión de CFDI, portal del cliente, notificaciones | N1, N3, N4 |
| 9 a 10 | Exportación contable, importación OPUS/Neodata, captura offline. **Lanzamiento público** | N2, N5, N6 |

En paralelo: la prueba de usabilidad base (antes del 15 de septiembre) y la de fase 2 (26 al 30 de octubre) ya planeadas en `docs/ux/`.

## 7. Cómo saber si el MVP funciona

| Métrica | Meta a 90 días del lanzamiento |
|---|---|
| Activación (empresa con obra + catálogo + 5 gastos + 1 cobro en 7 días) | ≥ 40 % de los registros |
| Tiempo al primer valor (ver el resultado de una obra) | < 30 minutos |
| Conversión prueba → pago | ≥ 15 % |
| Retención semana 4 (empresa que entra al menos 2 veces por semana) | ≥ 50 % |
| Cancelación mensual | < 5 % |
| SUS en prueba de usabilidad | ≥ 75 |
| Tickets de soporte por empresa activa | < 2 al mes |
| Ingreso recurrente mensual | 10 clientes de pago (~9,000 MXN) para validar; 50 (~45,000 MXN) para sostener |

## 8. Riesgos

- **Constructora360** juega freemium en el mismo precio con CFDI y nómina nativos y app offline. La defensa es el ángulo de socios y resultado por obra, y el soporte cercano; no ganarás por número de módulos.
- **Arquitectura de un solo archivo y auth propia sobre RPC anónimo.** Funciona, pero cada cliente nuevo aumenta el costo de una fuga. B4 es obligatorio antes del primer cliente externo; a mediano plazo conviene evaluar Supabase Auth o un backend delgado.
- **Un solo desarrollador.** Lo compensa el flujo actual, pero el soporte y el onboarding consumen horas que no son de desarrollo; definir horario de soporte desde el día uno.
- **Cambios fiscales** (CFDI, complementos) exigen mantenimiento continuo; usar PAC con API y no timbrar por cuenta propia.
- **Nombre genérico.** Registrar marca y dominio antes de gastar en marketing.

## 9. Fuentes

- Procore: [projul.com](https://projul.com/blog/procore-pricing-analysis-2026/), [scanmanifold.com](https://www.scanmanifold.com/blog-posts/procore-pricing-2026-contractors), [costbench.com](https://costbench.com/software/construction-management/procore/)
- Buildertrend: [costbench.com](https://costbench.com/software/construction-management/buildertrend/), [getonecrew.com](https://www.getonecrew.com/post/buildertrend-pricing), [downtobid.com](https://downtobid.com/blog/buildertrend-pricing), [roofingsoftwareguide.com](https://roofingsoftwareguide.com/reviews/buildertrend-review-roofing-contractors/), [buildertrendpricing.com](https://buildertrendpricing.com/)
- JobTread: [getapp.com](https://www.getapp.com/construction-software/a/jobtread/), [stackvett.com](https://stackvett.com/jobtread-review/)
- Contractor Foreman: [capterra.com](https://www.capterra.com/p/166113/Contractor-Foreman/pricing/), [g2.com](https://www.g2.com/products/contractor-foreman/pricing), [stackvett.com](https://stackvett.com/contractor-foreman-review/)
- Fieldwire: [projul.com](https://projul.com/blog/fieldwire-pricing-breakdown/), [buildbite.com](https://buildbite.com/insights/fieldwire-pricing-review), [scanmanifold.com](https://www.scanmanifold.com/blog-posts/fieldwire-pricing-2026-comparison)
- Knowify: [knowify.com/pricing](https://knowify.com/pricing/), [g2.com](https://www.g2.com/products/knowify/pricing)
- Houzz Pro: [g2.com](https://www.g2.com/products/houzz-pro/pricing), [stackvett.com](https://stackvett.com/houzz-pro-review/)
- Buildbite: [buildbite.com/pricing](https://buildbite.com/pricing)
- Constructora360: [constructora360.app](https://www.constructora360.app/), [comparativa 2026](https://www.constructora360.app/blog/software-para-constructora-en-mexico-top-5-sistemas-comparados-2026)
- Obra3D, Aspel, SAP, requisitos fiscales: [magokoro.mx](https://www.magokoro.mx/blog/software-constructoras-mexico-erp)
- Neodata / OPUS: [neodata.mx](https://neodata.mx/pu-nube), [opus-planet.mx](https://opus-planet.mx/precios/)
- Buildpeer: [pronetwork.mx](https://www.pronetwork.mx/buildpeer-y-el-futuro-digital-de-la-construccion-en-mexico-y-latam/)
- Contratistas independientes MX: [presupix.com](https://presupix.com/mx/blog/software-gestion-obras-independientes)
- Quejas de usuarios: [capterra.com small business](https://www.capterra.com/construction-management-software/s/small-businesses/), [selecthub.com](https://www.selecthub.com/construction-management-software/fieldwire-vs-contractor-foreman/)
- SaaS en México (LFPDPPP, CFDI por cobro recurrente): [magokoro.mx](https://www.magokoro.mx/blog/como-desarrollar-saas-mexico-guia-tecnica-negocio), [gigstack.pro](https://blog.gigstack.pro/post/facturacion-automatica-saas-mexico-cfdi-stripe-suscripciones)
- Estado técnico: advisors de seguridad de Supabase (proyecto `cpjdlaiarmxojiyhhpxt`, 29-ago-2026), `src/index.html`, `src/admin.html`, `migrations/`, `nginx` del VPS.
