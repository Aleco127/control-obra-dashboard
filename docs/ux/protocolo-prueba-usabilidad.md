# Protocolo de prueba de usabilidad · Control de Obra

Versión 1.0 (28 de agosto de 2026). Sigue `metodos-ux.md` §5 (Albert y Tullis, *Measuring the User Experience*, caps. 3 a 6). Se ejecuta dos veces con el mismo guion: línea base (versión previa al rediseño) y post (tras desplegar las épicas 2 a 7 del PRD `PRD-control-obra-ux-2026.md`).

## 1. Objetivos ligados a decisiones

| Pregunta | Decisión que informa | Métrica que la responde |
|---|---|---|
| ¿El asistente de alta reduce el tiempo de crear un proyecto completo (obra, cliente, catálogo, programa, plan de pagos)? | Mantener el wizard como camino principal o volver al formulario plano | Mediana de tiempo en T1; éxito en T1 |
| ¿Un cobro registrado se refleja en el saldo sin pasos intermedios? | Conservar la regla "CxC obligatoria" del modal de cobro | Éxito binario T2; errores en T2 |
| ¿El residente captura avance semanal sin ayuda? | Priorizar la vista Semanas sobre el Gantt en móvil | Éxito y SEQ en T3 y T5 |
| ¿El gerente encuentra el saldo de un cliente y la fecha de un hito externo? | Ficha de cliente y alertas de hitos en el dashboard | Éxito y tiempo en T4 y T6 |
| ¿La plataforma se percibe usable en conjunto? | Seguir invirtiendo en pulido o en nuevas funciones | SUS (meta ≥ 72) |

## 2. Participantes

Seis participantes, dos por rol, reclutados del equipo y de colaboradores de Supernova Arquitectos. Con n pequeña la evidencia se defiende por saturación (los mismos problemas aparecen en 2 o más participantes del mismo rol), no por significancia estadística.

| Rol | n | Inclusión | Exclusión |
|---|---|---|---|
| Gerente / dirección | 2 | Firma contratos, recibe anticipos, usa laptop y celular | Participó en el diseño del sistema |
| Residente de obra | 2 | Captura bitácora en campo, usa Android o iPhone | No ha estado en obra en los últimos 3 meses |
| Contador / administración | 2 | Concilia cobros y factura | Sin experiencia con software administrativo |

Registro previo: nombre (solo iniciales en el reporte), rol, años en el puesto, dispositivo habitual, ¿ha usado Control de Obra? (sí/no, cuánto).

## 3. Preparación

- Datos de prueba: empresa "QA Supernova" con la obra `LL-LS-01` (Luminae) cargada, el contrato en PDF y el Anexo A en XLSX (`docs/qa/anexo_a_luminae.xlsx`), cliente Pedro Hernández con obra `ALTOZANO-PH` y anticipo registrado.
- Dispositivos: laptop 1440 × 900 (T1, T2, T4, T6) y celular del participante (T3, T5). Conexión normal; para T5 se activa modo avión a mitad de la captura.
- Grabación: pantalla y audio (con consentimiento), cronómetro por tarea, hoja de registro (sección 7).
- Piloto: una sesión previa con un compañero del equipo para ajustar redacción y tiempos (no cuenta en resultados).
- Duración objetivo: 45 minutos por participante.

## 4. Guion de sesión

1. Bienvenida (3 min): "Probamos el sistema, no a ti. Piensa en voz alta. No hay respuestas incorrectas."
2. Preguntas de contexto (3 min): rol, cómo lleva hoy la cobranza y el avance.
3. Tareas T1 a T6 (30 min). Después de cada tarea: SEQ.
4. SUS (5 min).
5. Entrevista de cierre (4 min): qué le costó más, qué haría con su celular en obra, qué falta.

## 5. Tareas (situaciones del negocio)

| # | Situación que se lee al participante | Éxito total | Éxito parcial | Rol |
|---|---|---|---|---|
| T1 | "Acabas de firmar el contrato de Luminae (aquí está el PDF y el catálogo en Excel). Da de alta el proyecto en el sistema con su cliente, catálogo, programa por semanas y plan de pagos 30-30-20-20." | Obra creada con cliente ligado, ≥ 30 conceptos, programa con actividades y 4 exhibiciones | Obra creada con al menos 2 de los 4 elementos | Gerente, Contador |
| T2 | "El cliente de Luminae te acaba de transferir el anticipo de $85,320.95. Regístralo y dime cuánto queda pendiente de la obra." | Cobro aplicado a la 1ª exhibición y saldo correcto ($199,082.24) verbalizado | Cobro registrado pero sin saldo correcto | Contador, Gerente |
| T3 | "Es viernes de la semana 3 de Luminae. Captura que el muro de tablaroca a una cara va al 60 % y la losa al 100 %." (celular) | Ambos porcentajes guardados desde la vista Semanas o la bitácora rápida | Uno de los dos | Residente |
| T4 | "Pedro Hernández te llama y pregunta cuánto ha pagado y cuánto debe." | Responde $20,000 pagados y $30,000 pendientes desde la ficha de cliente o de obra | Encuentra la obra pero no el saldo | Gerente, Contador |
| T5 | "Estás en la obra de Luminae, sin buena señal. Registra la bitácora de hoy con una foto." (celular, modo avión a mitad) | Bitácora y foto guardadas; al volver la señal se envían solas | Bitácora guardada sin foto | Residente |
| T6 | "¿Qué día es la Mesa Directiva de Altozano y quién depende de que ocurra?" | Encuentra 25 de septiembre y que depende del cliente (hito externo) | Encuentra la fecha sin el responsable | Gerente |

Tiempo límite por tarea: 10 min (T1), 4 min (T2, T3, T5), 3 min (T4, T6). Si se agota, se marca fallo y se asiste.

## 6. Métricas

Por tarea (cap. 4 y 5 de Albert y Tullis):

- Éxito binario (1/0) y nivel (total, parcial, fallo). Se reporta frecuencia absoluta y proporción con intervalo de confianza de Wald ajustado al 95 % (n ≤ 6: sumar 2 éxitos y 4 intentos antes de calcular p).
- Tiempo en tarea en segundos, del enunciado a la verbalización de "listo". Se reporta la mediana (los tiempos están sesgados) y el rango.
- Errores: acciones que alejan de la meta (clic en módulo equivocado, dato guardado en campo incorrecto, mensaje de error). Se cuentan y clasifican.
- SEQ (1 muy difícil a 7 muy fácil) inmediatamente después de cada tarea.
- Incidencias observadas con severidad = impacto (bloquea, dificulta, molesta) × frecuencia (participantes que la sufren): alta si bloquea o si dificulta a ≥ 3; media si dificulta a 1 o 2 o molesta a ≥ 3; baja el resto.

De cierre:

- SUS (10 ítems, escala 0 a 100). Referencia: mediana publicada 69 a 71 (Tullis 2008; Bangor et al. 2009). Meta ≥ 72.
- Entrevista: 3 hallazgos cualitativos por participante como máximo.

Complementarias desde la base de datos (no dependen de la sesión): `% obras con catálogo + programa + plan`, `cobros huérfanos`, `v_uso_modulos_30d`.

## 7. Hoja de registro (una por participante)

```
Participante: P_   Rol: ______   Dispositivo: ______   Fecha: ______   Moderador: ______
| Tarea | Inicio | Fin | Seg | Éxito (T/P/F) | Errores | SEQ | Observaciones (dato, no interpretación) |
| T1 |  |  |  |  |  |  |  |
| T2 |  |  |  |  |  |  |  |
| T3 |  |  |  |  |  |  |  |
| T4 |  |  |  |  |  |  |  |
| T5 |  |  |  |  |  |  |  |
| T6 |  |  |  |  |  |  |  |
SUS: Q1__ Q2__ Q3__ Q4__ Q5__ Q6__ Q7__ Q8__ Q9__ Q10__  → puntaje ____
Cierre: 1) ______ 2) ______ 3) ______
```

## 8. Plantilla de reporte

1. Resumen ejecutivo (5 líneas): éxito global, SUS, dos hallazgos de severidad alta.
2. Participantes (tabla anónima).
3. Resultados por tarea: tabla con éxito (n/6, proporción, IC Wald ajustado), mediana y rango de tiempo, errores, mediana SEQ.
4. SUS por participante y mediana; comparación contra 69 a 71 y contra la meta.
5. Hallazgos priorizados: tabla observación vs interpretación, severidad, participantes afectados, recomendación y métrica que probará si se resolvió.
6. Comparación contra línea base (solo en la prueba post): misma tabla con delta por tarea.
7. Anexos: hojas de registro, capturas, consulta SQL de adopción.

Cálculo del IC Wald ajustado (n = 6): p̃ = (x + 2) / (n + 4); IC = p̃ ± 1.96 · √(p̃ (1 − p̃) / (n + 4)). Ejemplo: 5 de 6 éxitos → p̃ = 0.70, IC 0.42 a 0.98.
