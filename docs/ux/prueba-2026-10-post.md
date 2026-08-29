# Prueba de usabilidad · Post rediseño (octubre 2026)

Estado: **pendiente de ejecución**. Se corre 30 días después del último deploy de las épicas 2 a 7 (previsto para la primera semana de octubre de 2026), con los mismos 6 participantes de la línea base (o perfil equivalente) y las mismas 6 tareas del protocolo `protocolo-prueba-usabilidad.md`. Este documento ya trae la estructura, las metas y las consultas; sólo faltan los datos de sesión.

## 1. Versión evaluada

- Control de Obra con Épicas 0 a 8 desplegadas (commit y fecha por anotar).
- Datos: mismos proyectos (`LL-LS-01`, `ALTOZANO-PH`) restaurados al estado de la línea base antes de cada sesión (script de reinicio en `docs/qa/`).

## 2. Metas (del PRD) y comparación contra la línea base

| Métrica | Línea base | Meta | Post (por llenar) | Cumple |
|---|---|---|---|---|
| T1 tiempo de alta de proyecto completo (mediana) | ~45 min manual | ≤ 10 min |  |  |
| % obras nuevas con catálogo + programa + plan | 25 % (2 de 8) | ≥ 90 % |  |  |
| Cobros huérfanos después del deploy | 1 de 12 | 0 |  |  |
| T2 éxito "registrar anticipo y ver saldo" | por medir | ≥ 5 de 6 |  |  |
| SUS (mediana) | por medir | ≥ 72 |  |  |
| SEQ mediana T1..T6 | por medir | ≥ 5 |  |  |
| % bitácoras desde móvil (`ui_events`, viewport < 768) | 0 (sin telemetría) | ≥ 40 % |  |  |
| Lighthouse accesibilidad / `confirm()` nativos / botones de icono sin nombre | por medir / 64 / ~195 | ≥ 90 / 0 / 0 |  |  |

## 3. Resultados por tarea (por llenar)

| Tarea | Éxito base | Éxito post (n/6, IC Wald) | Mediana seg base | Mediana seg post | Δ | Errores post | SEQ post |
|---|---|---|---|---|---|---|---|
| T1 |  |  |  |  |  |  |  |
| T2 |  |  |  |  |  |  |  |
| T3 |  |  |  |  |  |  |  |
| T4 |  |  |  |  |  |  |  |
| T5 |  |  |  |  |  |  |  |
| T6 |  |  |  |  |  |  |  |

## 4. SUS por participante (por llenar)

| P1 | P2 | P3 | P4 | P5 | P6 | Mediana | vs base |
|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |

## 5. Adopción medida en la base de datos (correr el día de la prueba)

```sql
-- % obras creadas después del deploy que tienen catálogo + programa + plan
WITH nuevas AS (SELECT * FROM control_obra.obras WHERE created_at >= '2026-09-15')
SELECT count(*) FILTER (WHERE cc>0 AND ap>0 AND cxc>0) completas, count(*) total
FROM (SELECT o.id,
  (SELECT count(*) FROM control_obra.catalogo_conceptos c WHERE c.obra_id=o.id) cc,
  (SELECT count(*) FROM control_obra.actividades_programa a JOIN control_obra.programas_obra p ON p.id=a.programa_id WHERE p.obra_id=o.id) ap,
  (SELECT count(*) FROM control_obra.cuentas_por_cobrar x WHERE x.obra_id=o.id) cxc FROM nuevas o) t;

-- Cobros huérfanos creados después del deploy
SELECT count(*) FROM control_obra.pagos_recibidos WHERE cuenta_cobrar_id IS NULL AND created_at >= '2026-09-15';

-- Uso por módulo y % móvil
SELECT * FROM public.v_uso_modulos_30d ORDER BY eventos DESC;

-- Bitácoras desde móvil
SELECT round(100.0*count(*) FILTER (WHERE viewport_w<768)/nullif(count(*),0),1) pct_movil, count(*) total
FROM control_obra.ui_events WHERE evento='bitacora_guardada' AND created_at >= now()-interval '30 days';

-- Embudo del asistente (abandono por paso)
SELECT meta->>'paso' paso, count(*) FROM control_obra.ui_events WHERE evento='wizard_paso' AND created_at >= now()-interval '30 days' GROUP BY 1 ORDER BY 1;
```

## 6. Hallazgos priorizados (insumo del siguiente PRD)

| # | Observación (dato) | Interpretación | Impacto × frecuencia | Severidad | Recomendación | Métrica de verificación |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

## 7. Decisiones

- Si T1 ≤ 10 min y SUS ≥ 72: el wizard se mantiene como camino único de alta y se retira el botón "Nueva obra" del modal plano.
- Si T5 falla en ≥ 2 residentes: revisar la cola offline (`outbox.js`) y el flujo de cámara antes de cualquier otra mejora móvil.
- Si `v_uso_modulos_30d` muestra 0 eventos en Cotizaciones y Estimaciones durante 30 días: ocultarlos por defecto para empresas con plan de pagos por hitos (pregunta abierta del PRD).
