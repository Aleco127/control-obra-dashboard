-- 098_parametros_laborales_2026.sql (épica D: US-824 y US-831) — Parámetros legales 2026 como fila de fábrica.
--
-- Fila de fábrica (empresa_id NULL, es_fabrica = true): la leen todas las empresas con nivel >= 80 y ninguna la
-- puede editar (políticas de 084); una empresa puede capturar su propia fila del año, que manda sobre la de fábrica.
-- Fuente: skill /opus-budget-direct (parámetros verificados 2026) y la memoria de cálculo del Archivo Municipal
-- MC-2617057-057 (Tp/Tl = 383.25 / 285.25). Con estos datos BancoPrecios.calcularFSR() reproduce el tabulador de
-- Cd. Cuauhtémoc 2026 (MO-PEON $360 → 1.84650 … MO-CABO $620 → 1.83089).
--
-- Método (Anexo 2 del IIPU actualizado a 2026), por jornada:
--   SBC = round(SB × FSB, 2), FSB = 1 + (aguinaldo + prima vacacional × vacaciones) / 365.25
--   Cuotas patronales IMSS + INFONAVIT (pesos/día) = cuota fija % × UMA + excedente % × max(0, SBC − 3 UMA)
--        + (prestaciones en dinero + gastos médicos de pensionados + riesgo + invalidez y vida + guarderías + retiro
--           + cesantía y vejez escalonada por SBC/UMA + INFONAVIT) % × SBC
--   Ps = cuotas / SB ;  FSR sin ISN = (Tp / Tl) × (1 + Ps) ;  FSR = FSR sin ISN × (1 + ISN)
-- Idempotente (índice único por COALESCE(empresa_id, 0), anio).

INSERT INTO control_obra.parametros_laborales (
  empresa_id, anio, uma, salario_minimo, salario_minimo_frontera, salario_albanil, dias_vacaciones,
  riesgo_trabajo_pct, isn_pct, cesantia_tabla, datos, es_fabrica, fuente)
VALUES (
  NULL, 2026, 117.31, 315.04, 440.87, 363.44, 12,
  7.58875, 3.0,
  '[
    {"base":"salario_minimo","hasta_sm":1,"pct":3.150,"rango":"1 salario mínimo"},
    {"desde_uma":1.00,"hasta_uma":1.50,"pct":3.676,"rango":"1.01 a 1.50 UMA"},
    {"desde_uma":1.50,"hasta_uma":2.00,"pct":4.851,"rango":"1.51 a 2.00 UMA"},
    {"desde_uma":2.00,"hasta_uma":2.50,"pct":5.556,"rango":"2.01 a 2.50 UMA"},
    {"desde_uma":2.50,"hasta_uma":3.00,"pct":6.026,"rango":"2.51 a 3.00 UMA"},
    {"desde_uma":3.00,"hasta_uma":3.50,"pct":6.361,"rango":"3.01 a 3.50 UMA"},
    {"desde_uma":3.50,"hasta_uma":4.00,"pct":6.613,"rango":"3.51 a 4.00 UMA"},
    {"desde_uma":4.00,"hasta_uma":null,"pct":7.513,"rango":"4.01 UMA en adelante"}
  ]'::jsonb,
  '{
    "metodo":"anexo2_iipu_2026",
    "aguinaldo_dias":15, "prima_vacacional_pct":25, "dias_anio":365.25,
    "tp":383.25, "tl":285.25,
    "cuota_fija_pct":20.40, "excedente_pct":1.10, "prestaciones_dinero_pct":0.70, "gastos_medicos_pct":1.05,
    "invalidez_vida_pct":1.75, "guarderias_pct":1.00, "retiro_pct":2.00, "infonavit_pct":5.00,
    "cesantia_obrera_pct":1.125,
    "zona_frontera":"Sólo 45 municipios fronterizos; en Chihuahua: Juárez, Ojinaga, Ascensión, Janos, Guadalupe, Práxedis G. Guerrero, Coyame del Sotol y Manuel Benavides. Cd. Cuauhtémoc NO."
  }'::jsonb,
  true,
  'UMA: INEGI, DOF 09-ene-2026 (vigente 01-feb-2026 a 31-ene-2027). Salarios mínimos: CONASAMI 2026. Vacaciones: LFT reformada 2023. CEAV: decreto 16-dic-2020. Riesgo clase V. ISN: Ley de Hacienda del Estado de Chihuahua. Tp/Tl: memoria de cálculo MC-2617057-057.')
ON CONFLICT (COALESCE(empresa_id, 0), anio) DO UPDATE SET
  uma = EXCLUDED.uma, salario_minimo = EXCLUDED.salario_minimo, salario_minimo_frontera = EXCLUDED.salario_minimo_frontera,
  salario_albanil = EXCLUDED.salario_albanil, dias_vacaciones = EXCLUDED.dias_vacaciones,
  riesgo_trabajo_pct = EXCLUDED.riesgo_trabajo_pct, isn_pct = EXCLUDED.isn_pct, cesantia_tabla = EXCLUDED.cesantia_tabla,
  datos = EXCLUDED.datos, fuente = EXCLUDED.fuente;
