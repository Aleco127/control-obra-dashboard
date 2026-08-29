# Prueba de usabilidad · Fase 2 (compras, pagos, contabilidad y reparto)

Protocolo (cap. 3 a 6 de Albert y Tullis, 2013). Se corre 60 días después del deploy de la fase 2 (desplegada el 29 de agosto de 2026): **entre el 26 y el 30 de octubre de 2026**, sobre producción (`obra.srv1090924.hstgr.cloud`) con datos reales y una obra de prueba.

## Participantes (4)

| # | Rol | Persona | Dispositivo |
|---|---|---|---|
| P1 | Socio director | Ricardo | Laptop + iPhone |
| P2 | Socio | Daniel | iPhone |
| P3 | Contador externo | Despacho contable (usuario `contador_externo`) | Laptop |
| P4 | Residente | Carlos | Android |

Con n = 4 no se reportan porcentajes de éxito como estimación poblacional: se reporta frecuencia absoluta (k de 4) con intervalo de confianza Wald ajustado al 95 % y mediana de tiempos.

## Tareas

| Tarea | Quién | Instrucción al participante | Éxito |
|---|---|---|---|
| T1 | P4, P1 | "Compraste tornillos en Home Depot por $345.50 con tu tarjeta. Regístralo desde el celular con la foto del ticket para la obra Luminae." | Gasto con foto, obra correcta, categoría Materiales, en ≤ 45 s |
| T2 | P3, P1 | "Paga los tres gastos pendientes de Home Depot con una sola transferencia (referencia 123456)." | Un pago PP-xxxxx cubriendo los tres gastos; saldo del proveedor en $0 |
| T3 | P1, P2 | "Dime cuánto hemos ganado o perdido en ICHIFE 035 hasta hoy y por qué." | Llega a la ficha, lee la utilidad devengada y la causa del semáforo en ≤ 30 s |
| T4 | P3 | "Importa este XML (factura de Home Depot) y verifica que quedó ligado al gasto." | Importación con emparejamiento correcto; el gasto cambia a Facturado |
| T5 | P1, P2, P3 | "Cierra agosto y genera el paquete para el contador. Después crea el reparto de utilidades del trimestre." | Mes cerrado, ZIP descargado, reparto en estado propuesto con ambos socios en la tabla |

Después de cada tarea: SEQ (1 a 7). Al final: SUS (10 ítems).

## Métricas y metas (del PRD)

| Métrica | Meta |
|---|---|
| T1 tiempo (mediana) | ≤ 45 s |
| T3 tiempo (mediana) | ≤ 30 s |
| T5 tiempo de cierre (sin contar la descarga) | ≤ 5 min |
| Éxito T1..T5 | ≥ 3 de 4 en cada tarea |
| SEQ por tarea | mediana ≥ 5 |
| SUS | ≥ 72 |

## Resultados (llenar en la sesión)

| Tarea | Participante | Éxito | Tiempo | SEQ | Observación (hecho) | Interpretación |
|---|---|---|---|---|---|---|
| T1 | P4 |  |  |  |  |  |
| T1 | P1 |  |  |  |  |  |
| T2 | P3 |  |  |  |  |  |
| T2 | P1 |  |  |  |  |  |
| T3 | P1 |  |  |  |  |  |
| T3 | P2 |  |  |  |  |  |
| T4 | P3 |  |  |  |  |  |
| T5 | P1 |  |  |  |  |  |
| T5 | P2 |  |  |  |  |  |
| T5 | P3 |  |  |  |  |  |

SUS: P1 __ · P2 __ · P3 __ · P4 __ · mediana __

## Métricas objetivas de acompañamiento (SQL, mismo día)

```sql
-- destino explícito y categorías en gastos nuevos (desde 2026-08-29)
select destino, count(*) from control_obra.gastos where created_at >= '2026-08-29' group by 1;
select count(*) filter (where categoria = 'Materiales')::float / count(*) from control_obra.gastos where created_at >= '2026-08-29';
-- facturas con UUID a 60 días
select count(*) filter (where comprobacion = 'facturado'), count(*) from control_obra.gastos where tipo_comprobante = 'Fiscal' and created_at >= '2026-08-29';
-- gastos personales dentro de obras
select count(*) from control_obra.gastos where destino = 'socio' and obra_id is not null;
-- uso móvil de captura
select * from public.v_uso_finanzas_30d order by n desc;
```

## Hallazgos

| # | Hallazgo (hecho observado) | Severidad | Recomendación | Métrica que probaría la corrección |
|---|---|---|---|---|
|  |  |  |  |  |
