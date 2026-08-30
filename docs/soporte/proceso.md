# Proceso de soporte (US-223)

## Canales

| Canal | Para qué | Horario | Respuesta objetivo |
|---|---|---|---|
| WhatsApp +52 614 344 3936 | Dudas de uso, "no me carga", urgencias de captura en obra | Lunes a viernes, 9:00 a 18:00 (hora de Chihuahua) | 4 horas hábiles |
| soporte@supernovarquitectos.com | Facturas, datos fiscales, cambios de plan, solicitudes ARCO | Mismo horario | 1 día hábil |
| Centro de ayuda (`/ayuda/`) | Guías por módulo, rol y proceso; se genera desde `docs/manual-de-usuario.md` con `node scripts/build-ayuda.mjs` | 24/7 | Autoservicio |

El botón "Ayuda" de la app abre el buscador del centro de ayuda, el recorrido de 5 pasos y el enlace a WhatsApp con un mensaje prellenado.

## Qué incluye y qué no

Incluye: ayuda para usar la plataforma, aclaraciones de cobro, recuperar acceso, reportar errores. No incluye captura de datos por cuenta del cliente, configuración contable ni asesoría fiscal o legal (se canaliza al contador del cliente).

## Flujo de un ticket

1. Llega por WhatsApp o correo. Etiqueta en el correo: `soporte/abierto`.
2. Primera respuesta con: qué entendimos, qué vamos a hacer y cuándo.
3. Si es un error: reproducir con el usuario de QA (tokens en `scripts/qa/*.test.mjs`), registrar en `platform_errors` si no está, corregir, desplegar con `scripts/deploy.sh`, avisar al cliente.
4. Cerrar con una línea que el cliente pueda reutilizar ("para volver a hacerlo: Compras › Nuevo gasto › foto").
5. Registrar en la hoja de tickets (`docs/soporte/tickets.md`): fecha, empresa, canal, tipo (uso, error, cobro, datos), tiempo a primera respuesta, resuelto sí/no.

## Plantillas

- **Acuse:** "Hola [nombre], recibimos tu mensaje. Estamos revisando [tema] y te respondemos hoy antes de las [hora]."
- **Error corregido:** "Ya está corregido. Recarga la app (Ctrl+F5 o cerrar y abrir) y vuelve a intentar [acción]. Si sigue igual mándanos una captura."
- **Cobro:** "Tu cobro de [monto] del [fecha] aparece [estado]. Puedes descargar la factura en Configuración › Plan › Pagos y facturas."

## Métricas mensuales (van a `admin.html › Analytics`, US-246)

Tickets por empresa activa (meta < 2 al mes), tiempo a primera respuesta (meta < 4 h hábiles), porcentaje resuelto en el primer contacto, temas más frecuentes (alimentan el centro de ayuda y el tour).
