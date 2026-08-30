# Respaldos (US-229, decisión Q5: en el VPS)

Supabase conserva sus propios respaldos del proyecto. Además, cada día a las 03:30 UTC el VPS corre `scripts/vps/backup-db.sh` (`/docker/control-obra-dashboard/backup-db.sh`):

1. Exporta en JSON, vía PostgREST con la service key, 65 tablas de `control_obra` y 20 tablas propias de `public` (planes, suscripciones, pagos, correos, plataforma, REPSE, SUA). `app_secrets` sólo se respalda por nombre de clave.
2. Empaqueta (`tar.gz`) y cifra con `gpg` AES-256 usando la passphrase de `/root/.obra_backup_pass` (600). **Esa passphrase debe guardarse también fuera del VPS** (gestor de contraseñas de Ricardo): sin ella el respaldo no se puede abrir.
3. Guarda en `/docker/control-obra-dashboard/backups/obra_AAAAMMDD.json.gz.gpg`; conserva 14 diarios y, en `semanal/`, 8 semanales (domingos).
4. El monitor marca `respaldo_diario` en rojo si el último archivo tiene más de 30 horas.

Primera corrida (30-ago-2026 01:49 UTC): 85 tablas, 0 fallas, 152 KB.

## Prueba de restauración

`scripts/vps/restore-test.sh` (cron el primer lunes de cada mes a las 04:00 UTC, y a mano cuando se quiera) descifra el último respaldo y cuenta filas de 10 tablas clave; anota el resultado en `backups/restore-test.log`.

Resultado del 30-ago-2026: empresas 5, obras 16, gastos 245, pagos_recibidos 12, cuentas_por_cobrar 5, catalogo_conceptos 51, socios 2, obra_usuarios 7, empresa_subscriptions 5, subscription_payments 0.

## Restaurar de verdad

Los JSON tienen la forma exacta de cada tabla, así que se reinsertan con PostgREST (`POST /rest/v1/<tabla>` con `Prefer: resolution=merge-duplicates`, en orden padres → hijos: empresas, obra_usuarios, clientes, proveedores, obras, catalogo_conceptos, programas_obra, actividades_programa, cuentas_por_cobrar, pagos_recibidos, gastos, pagos_proveedores, socios, movimientos_socio, repartos, reparto_detalle, …) o con `psql \copy` si se cuenta con la contraseña de la base. Los archivos de Storage (comprobantes, fotos, logos) no van en este respaldo: dependen del respaldo de Supabase y del ZIP que cada empresa puede bajar desde Configuración › Respaldo.
