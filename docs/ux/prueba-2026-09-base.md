# Prueba de usabilidad · Línea base (versión previa al rediseño)

Estado: **parcial**. Las métricas objetivas de la línea base ya están tomadas (sección 2); las sesiones con participantes (sección 3) quedan **pendientes de agendar** antes del 15 de septiembre de 2026 y deben correrse sobre la versión previa al rediseño, disponible como etiqueta `pre-ux-2026` en el repositorio (commit anterior a la Épica 0). Este documento se completa con las hojas de registro del protocolo `protocolo-prueba-usabilidad.md`.

## 1. Alcance y versión evaluada

- Versión: Control de Obra v2.6, `index.html` previo al 28 de agosto de 2026 (sin wizard, sin ficha de obra, sin cobro guiado).
- Datos: empresa Supernova Arquitectos (empresa_id 1), obras reales `ALTOZANO-PH` y `LL-LS-01`.
- Método: protocolo v1.0, 6 tareas, 6 participantes (2 gerentes, 2 residentes, 2 contadores).

## 2. Métricas objetivas de línea base (tomadas el 28 de agosto de 2026)

Estas mediciones no requieren participantes: provienen de la base de datos y del alta real de dos proyectos hecha ese día.

| Métrica | Valor de línea base | Cómo se obtuvo |
|---|---|---|
| Tiempo de alta de un proyecto completo (obra + cliente + catálogo + programa + plan de pagos) | ~45 min por proyecto | Alta manual de `ALTOZANO-PH` y `LL-LS-01` el 28-ago: 6 inserciones en 5 tablas, con 3 intentos fallidos por columnas generadas (`importe`, `duracion_dias`, `monto_pendiente`) |
| Obras activas con catálogo, programa con actividades y plan de pagos | 2 de 8 (25 %) | SQL sobre `obras`, `catalogo_conceptos`, `actividades_programa`, `cuentas_por_cobrar` |
| Programas de obra con 0 actividades | 3 de 5 | `SELECT p.id, count(a.id) FROM programas_obra p LEFT JOIN actividades_programa a ...` |
| Cobros huérfanos (`cuenta_cobrar_id IS NULL`) | 1 de 12 (8 %), PR-00014 | `SELECT count(*) FROM pagos_recibidos WHERE cuenta_cobrar_id IS NULL` |
| Clientes en catálogo vs obras con cliente en texto | 0 clientes (antes del alta) / 8 obras con texto libre | `clientes` vacía; `obras.cliente` con nombres sueltos |
| Módulos: uso real | sin dato (no existía telemetría) | Se instrumenta con `ui_events` a partir del deploy |
| Accesibilidad estática | 0 `aria-*`, 64 `confirm()` nativos, 618 `onclick` inline, 3 `@media` (todas `print`) | `grep` sobre `index.html` |
| Contraste de texto secundario | `text-slate-400` (#94a3b8) sobre blanco = 2.9 : 1 (falla AA) | Fórmula de luminancia relativa |
| Carga de documentos, fotos, facturas, RFIs | fallaba siempre (HTTP 400) | La RPC `load_secondary_data_seguro` ordenaba por una columna inexistente; corregido en la migración 013 |

## 3. Sesiones con participantes (pendientes)

| Participante | Rol | Fecha | Dispositivo | Estado |
|---|---|---|---|---|
| P1 | Gerente | por agendar | laptop + celular | pendiente |
| P2 | Gerente | por agendar | laptop + celular | pendiente |
| P3 | Residente | por agendar | celular | pendiente |
| P4 | Residente | por agendar | celular | pendiente |
| P5 | Contador | por agendar | laptop | pendiente |
| P6 | Contador | por agendar | laptop | pendiente |

Cómo reproducir la versión de línea base para las sesiones: `git checkout pre-ux-2026 -- src/index.html src/css src/js` en una copia local servida con `python -m http.server 8765` (o desplegar esa versión en un subdominio de prueba). No mezclar con la versión nueva dentro de la misma sesión.

### 3.1 Resultados por tarea (por llenar)

| Tarea | Éxito (n/6) | p̃ e IC Wald 95 % | Mediana seg | Rango | Errores | SEQ mediana |
|---|---|---|---|---|---|---|
| T1 Alta de proyecto |  |  |  |  |  |  |
| T2 Registrar anticipo y saldo |  |  |  |  |  |  |
| T3 Avance semana 3 (celular) |  |  |  |  |  |  |
| T4 Saldo de Pedro Hernández |  |  |  |  |  |  |
| T5 Bitácora con foto sin señal |  |  |  |  |  |  |
| T6 Fecha de la Mesa Directiva |  |  |  |  |  |  |

Hipótesis a contrastar (derivadas de la auditoría de código, no de observación; se marcan como tales): en la versión base T1 no es completable en 10 min (no existe flujo), T2 produce cobros huérfanos cuando el participante no elige CxC, T5 falla sin señal (no hay cola local) y T6 no tiene dónde consultarse (los hitos externos no se distinguen).

### 3.2 SUS (por llenar)

| P1 | P2 | P3 | P4 | P5 | P6 | Mediana |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

### 3.3 Hallazgos (por llenar)

| # | Observación (dato) | Interpretación | Severidad | Participantes | Recomendación | Métrica de verificación |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

## 4. Consulta SQL de adopción (repetir en la prueba post)

```sql
-- Obras activas con catálogo + programa con actividades + plan de pagos
SELECT count(*) FILTER (WHERE cc>0 AND ap>0 AND cxc>0) AS completas, count(*) AS activas
FROM (
  SELECT o.id,
    (SELECT count(*) FROM control_obra.catalogo_conceptos c WHERE c.obra_id=o.id) cc,
    (SELECT count(*) FROM control_obra.actividades_programa a JOIN control_obra.programas_obra p ON p.id=a.programa_id WHERE p.obra_id=o.id) ap,
    (SELECT count(*) FROM control_obra.cuentas_por_cobrar x WHERE x.obra_id=o.id) cxc
  FROM control_obra.obras o WHERE o.estatus NOT IN ('Archivada','Cancelada')
) t;
-- Cobros huérfanos
SELECT count(*) FILTER (WHERE cuenta_cobrar_id IS NULL) huerfanos, count(*) total FROM control_obra.pagos_recibidos;
-- Uso por módulo (30 días)
SELECT * FROM public.v_uso_modulos_30d ORDER BY eventos DESC;
```
