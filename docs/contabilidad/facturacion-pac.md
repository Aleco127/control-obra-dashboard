# Facturación electrónica: cómo queda montada y qué falta para encenderla

US-231 (configuración fiscal y CSD) y US-232 (emisión de CFDI 4.0 de ingreso), 30 de agosto de 2026.

## Cómo funciona

El PAC es **Facturama en modo multiemisor**: una sola cuenta de la plataforma timbra a nombre de cada
empresa cliente, siempre que el sello digital (CSD) de esa empresa esté dado de alta en la cuenta.

```
Navegador  ──datos de negocio──►  Edge Function          ──►  Facturama          ──►  SAT
(facturacion.js)                 pac-config / cfdi-emitir      /api/csds
                                                               /api-lite/3/cfdis
```

El navegador nunca ve la cuenta del PAC ni arma el comprobante: manda receptor, conceptos y forma de
pago, y la Edge Function los traduce a la estructura del SAT (`cfdi-payload.js`).

### Piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| Migración `049_facturacion_cfdi.sql` | `migrations/` | Quita los secretos de `config_pac`, agrega la vigencia del CSD, el folio consecutivo (`reservar_folio_cfdi`) y el aviso de vencimiento (`notificar_csd_por_vencer`) |
| `pac-config` | `supabase/functions/` | Datos fiscales, alta y baja del CSD, prueba de conexión |
| `cfdi-emitir` | `supabase/functions/` | Estado de la facturación y timbrado; guarda XML y PDF en el bucket `comprobantes` |
| `cfdi-payload.js` | junto a `cfdi-emitir` | Reglas del SAT: validación del receptor, impuestos, redondeo y traducción de errores |
| `certificado.js` | junto a `pac-config` | Lee del `.cer` el número de serie, la vigencia y el RFC |
| `facturacion.js` | `src/js/` | Modales de configuración y de factura; prellenado desde estimación o cobro |

### Qué NO se guarda

El `.key` y su contraseña **nunca** tocan la base: viajan por TLS hasta el PAC y se descartan. En
`config_pac` sólo quedan el número de serie del certificado y su vigencia.

Antes de esta entrega, `config_pac` guardaba el `.cer`, el `.key`, la contraseña del CSD y la contraseña
de la cuenta del PAC en texto plano, y la vista `public.config_pac` los exponía con `GRANT` a `anon`:
cualquier usuario de la empresa (incluido el rol `contador_externo`, que es de sólo lectura) podía leer la
llave privada del sello digital. La migración 049 borra esos valores y quita las columnas.

## Qué falta para encenderla

**Una cuenta de Facturama.** Se contrata en https://www.facturama.mx (el plan de API multiemisor sirve
para las dos modalidades sin costo extra). Con el usuario y la contraseña de la cuenta:

```sql
insert into public.app_secrets(key, value) values
  ('facturama_usuario', '...'),
  ('facturama_password', '...')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

Y, si se quiere una cuenta distinta para el ambiente de pruebas (`apisandbox.facturama.mx`):

```sql
insert into public.app_secrets(key, value) values
  ('facturama_usuario_sandbox', '...'),
  ('facturama_password_sandbox', '...');
```

Mientras esos secretos no existan, la app lo dice con todas sus letras ("La facturación todavía no está
habilitada en tu cuenta") y no deja timbrar. Todo lo demás (captura fiscal, lectura del certificado,
validaciones del SAT, cálculo de impuestos, folio consecutivo) ya funciona.

`facturama_base_url` existe para apuntar el cliente a otro host; se usó una sola vez, el 30 de agosto de
2026, para probar el circuito completo contra un doble. **No debe quedar puesto en producción.**

## Cómo se probó

- 14 pruebas en `scripts/qa/cfdi-emitir.test.mjs`: armado del comprobante (16 %, tasa 0 %, exento,
  retenciones, redondeo por concepto), validación del receptor contra el catálogo del SAT, traducción de
  errores, lectura de un `.cer` y prellenado desde estimación y desde cobro.
- De extremo a extremo contra un doble del PAC: alta del CSD, cuatro facturas timbradas (PUE 16 %, PPD
  exenta y una con retenciones de persona física), XML y PDF guardados en el bucket, y el XML resultante
  leído de vuelta con `CFDI.parse`, el mismo lector que la app usa para las facturas recibidas.
- En el navegador: modales de configuración y de factura, totales en vivo, PPD forzando forma de pago 99 y
  el botón "Facturar" en la lista de cobros. Sin errores de consola.

Falta la prueba contra el SAT real, que sólo se puede hacer con la cuenta del PAC y un CSD verdadero.

## Lo que sigue (US-233 a US-236)

Complemento de pago (REP) al cobrar una factura PPD, cancelación con motivo del SAT y sustitución, envío
del PDF y el XML al cliente, y complemento de servicios parciales de construcción. Los tres primeros ya
tienen dónde apoyarse: `cfdis_emitidos` guarda `pac_cfdi_id`, `uuid` y el vínculo con la estimación o el
cobro que los originó.
