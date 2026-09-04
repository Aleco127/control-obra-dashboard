# QA del portal del cliente (US-617 a US-622)

El portal vive en `src/portal.html`. No carga Tailwind, Remix Icon ni `ui-utils.js`: sus únicos archivos externos son
`css/nav-shell.css` y `js/nav-shell.js`, y los íconos de la barra van inlineados como SVG en `NavShell.ICONOS_CLIENTE`.

## Cómo se prueba

```bash
node scripts/build.mjs
node scripts/serve-dist.mjs dist 8765 &
export $(grep -E "^(PORTAL_QA_TOKEN|PORTAL_QA_OBRA_TOKEN)=" .env | xargs)
PYTHONIOENCODING=utf-8 python scripts/qa/portal-nav.py --out docs/qa/portal
```

`portal-nav.py` recorre **6 secciones × 2 viewports (1440 y 390) × 2 formas de entrar** (sesión de cuenta con
`PORTAL_QA_TOKEN` y enlace de obra con `PORTAL_QA_OBRA_TOKEN`) y comprueba, además de que cada vista pinte:

- que cambiar de sección **no vuelva a pedir `portal_datos`** (espía `window.fetch`),
- `document.title` = «Sección · Nombre de la obra» y un solo `aria-current` por barra,
- los avisos de US-620 (punto en Pagos, badge en Entregables y Fotos, y que se limpien al abrir la sección),
- el layout: aside de 240 px y contenido de 760 en escritorio; barra inferior de 5 secciones con 44 px en móvil,
- el menú de cuenta de la cabecera móvil (con Esc y clic fuera),
- **axe** sobre `#navCliente` (0 violaciones),
- que el enlace de token no ofrezca selector de obra, «Cambiar contraseña» ni «Salir».

## Las seis URLs (prueba manual)

Con enlace de obra, el hash va **después** de la query:

```
https://app.supernovarquitectos.com/portal.html?t=<48 hex>#inicio
https://app.supernovarquitectos.com/portal.html?t=<48 hex>#avance
https://app.supernovarquitectos.com/portal.html?t=<48 hex>#pagos
https://app.supernovarquitectos.com/portal.html?t=<48 hex>#entregables
https://app.supernovarquitectos.com/portal.html?t=<48 hex>#fotos
https://app.supernovarquitectos.com/portal.html?t=<48 hex>#contacto
```

Con cuenta (usuario y contraseña) es la misma dirección sin `?t=`. Un hash desconocido cae en `#inicio`.

Qué mirar en cada una:

| Sección | Debe verse |
|---|---|
| `#inicio` | 4 KPIs, «Cómo va tu obra» con la línea de actividades y el siguiente hito, siguiente pago resumido, últimas 3 fotos, último entregable |
| `#avance` | programa completo con barras por actividad y las estimaciones |
| `#pagos` | siguiente pago con datos bancarios y CLABE copiable, plan de pagos, pagos realizados, facturas |
| `#entregables` | bloques por hito con documentos y fotos de esa entrega, más «Otros documentos» |
| `#fotos` | galería por entrega y las fotos sueltas |
| `#contacto` | datos de la constructora, WhatsApp, cambiar contraseña y salir (sólo con cuenta) |

## Enlaces profundos desde WhatsApp (US-621)

En la app, **Obras › ficha › Acceso del cliente** muestra los enlaces listos para copiar de Pagos, Entregables,
Fotos y Avance (`portalUrlSeccion(url, seccion)`, que siempre pone el hash al final).

⚠️ **Los avisos automáticos por WhatsApp del job (`jobs`, acción `whatsapp`) no llevan estos enlaces, y es
correcto**: van a los **administradores de la constructora** con opt-in (`wa_destinatarios_alertas`), no a los
clientes, y sus variables son empresa, obra y monto. El portal es del cliente. Cuando la constructora quiera
mandarle al cliente un aviso de cobro o de documentos publicados, el enlace se copia del panel.

Estado de las plantillas de Twilio Content (`app_secrets.wa_tpl_estado`, lo refresca `notify-whatsapp` con
`action: "estado"`): **en revisión de Meta**. Las aprobadas hoy (`cobro_vencido`, `aprobacion`) sólo tienen tres
variables de texto y ninguna de enlace, así que no admiten el hash. Si más adelante se aprueba una plantilla con
variable de URL para el cliente, el enlace se arma igual: `<url del portal>?t=<token>#pagos`.
