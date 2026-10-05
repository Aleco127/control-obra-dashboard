-- 093_perfiles_convocante.sql (US-817) — Perfiles de convocante de fábrica (ICHIFE y Municipio de Cuauhtémoc) y RPC
-- para generar los requisitos de una licitación desde su perfil, guardar una licitación como perfil y editar perfiles.
--
-- Fuentes de las semillas (4-oct-2026):
--   * ICHIFE: C:\dev\Codex\opus-host-bridge\licitagen\seeds\perfil_ichife.json (nombre, descripción, naming_pattern,
--     estructura de sobres). El seed no trae la lista de anexos: se tomó de la licitación LO-67-010-908029999-N-12-2026
--     (output\00_Formatos_verificacion_Anexos_1_2_3.docx, 00_Legal_Anexos_L1_L11.docx, P1_Anexos_T1_T13_tecnicos.docx y
--     documentos_requeridos.json; L-11 y T-13 de los PDF escaneados de ANEXOS ESCANEADOS). Incluye T-9a.
--   * Municipio de Cuauhtémoc: índice de anexos y checklist de MC-2617057-057 (ENTREGABLES\ANEXOS\00_INDICE_DE_ANEXOS.docx,
--     04_CHECKLIST_ENTREGA_PROPUESTA_CONJUNTA.md) cotejados con las bases de MC-2617064-064 (numerales 6, 7 y 8: misma
--     lista). «Fuera de sobre» (numeral 6) va como sobre legal. Se agregan DD-04 (69-B del CFF) y la constancia de no
--     adeudo estatal, que las bases exigen aunque no estén en la lista del numeral 6.
--   * Los perfiles de fábrica llevan empresa_id NULL y es_fabrica = true (sólo lectura para la app).
--
-- naming_pattern (paquete de entrega, US-820): {NN} posición dentro del sobre con 2 dígitos, {anexo} clave del anexo,
-- {XX} clave sin espacios ni signos, {sobre}, {descripcion} (recortada). La extensión real del archivo reemplaza a .pdf.

-- 1) Normalizador de la lista de requisitos de un perfil -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION control_obra.licit_requisitos_json_norm(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'control_obra', 'public' AS $$
DECLARE x jsonb; v_out jsonb := '[]'::jsonb; v_vistos text[] := '{}'; a text; v_sobre text; v_origen text; v_cat text;
BEGIN
  IF p IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF jsonb_typeof(p) <> 'array' THEN
    RAISE EXCEPTION 'La lista de requisitos debe ser un arreglo.' USING ERRCODE = '22023';
  END IF;
  FOR x IN SELECT e FROM jsonb_array_elements(p) e LOOP
    IF jsonb_typeof(x) <> 'object' THEN RAISE EXCEPTION 'Cada requisito debe ser un objeto.' USING ERRCODE = '22023'; END IF;
    a := btrim(COALESCE(x->>'anexo_id', ''));
    IF a = '' THEN RAISE EXCEPTION 'Hay un requisito sin clave de anexo.' USING ERRCODE = '22023'; END IF;
    IF lower(a) = ANY (v_vistos) THEN RAISE EXCEPTION 'El anexo % está repetido en el perfil.', a USING ERRCODE = '22023'; END IF;
    v_vistos := v_vistos || lower(a);
    v_sobre := COALESCE(NULLIF(x->>'sobre', ''), 'legal');
    IF v_sobre NOT IN ('legal','tecnico','economico') THEN RAISE EXCEPTION 'Sobre no válido en el anexo %.', a USING ERRCODE = '22023'; END IF;
    v_origen := COALESCE(NULLIF(x->>'origen', ''), 'se_genera');
    IF v_origen NOT IN ('expediente','se_genera','opus','dependencia') THEN RAISE EXCEPTION 'Origen no válido en el anexo %.', a USING ERRCODE = '22023'; END IF;
    v_cat := NULLIF(x->>'categoria_expediente', '');
    IF v_cat IS NOT NULL AND v_cat NOT IN ('opinion_sat','opinion_imss','opinion_infonavit','identificacion','acta_constitutiva','poder',
         'constancia_fiscal','comprobante_domicilio','estados_financieros','cmic','colegio','poliza_rc','curriculum','otro',
         'padron_contratistas','declaracion_anual') THEN
      RAISE EXCEPTION 'Categoría del expediente no válida en el anexo %.', a USING ERRCODE = '22023';
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object('anexo_id', a, 'sobre', v_sobre, 'descripcion', COALESCE(x->>'descripcion', ''),
      'origen', v_origen, 'requiere_firma', COALESCE((x->>'requiere_firma')::boolean, false), 'categoria_expediente', v_cat));
  END LOOP;
  RETURN v_out;
END; $$;
GRANT EXECUTE ON FUNCTION control_obra.licit_requisitos_json_norm(jsonb) TO anon, authenticated;

-- 2) Semillas de fábrica (idempotentes: actualizan si ya existen) ----------------------------------------------------------
INSERT INTO control_obra.perfiles_convocante (empresa_id, nombre, descripcion, naming_pattern, sobres_json, requisitos_json, es_fabrica, activo, created_by)
VALUES
  (NULL, 'ICHIFE (Chihuahua)',
   'Instituto Chihuahuense de Infraestructura Física Educativa. Lista validada con la licitación ICHIFE LO-67-010-908029999-N-12-2026: 13 legales (con Anexo 1 y C-1), 15 técnicos (con Anexo 2 y T-9a) y 17 económicos (con Anexo 3 y E-10a). Los económicos se presentan por partida.',
   '{NN}_Anexo_{XX}.pdf',
   $s1$[{"clave": "legal", "nombre": "Documentación legal", "carpeta": "01 DOCUMENTACION LEGAL", "prefijo": "L"},
  {"clave": "tecnico", "nombre": "Proposición técnica", "carpeta": "02 PROPOSICION TECNICA", "prefijo": "T"},
  {"clave": "economico", "nombre": "Propuesta económica", "carpeta": "03 PROPUESTA ECONOMICA", "prefijo": "E"}]$s1$::jsonb,
   control_obra.licit_requisitos_json_norm($r1$[{"anexo_id": "Anexo 1", "sobre": "legal", "descripcion": "Formato de verificación de documentación legal", "origen": "se_genera", "requiere_firma": false, "categoria_expediente": null},
  {"anexo_id": "C-1", "sobre": "legal", "descripcion": "Carta de ausencia de conflicto de interés", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "L-1", "sobre": "legal", "descripcion": "Manifiesto de correo electrónico y domicilio para oír y recibir notificaciones", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "L-2", "sobre": "legal", "descripcion": "Acreditación de existencia legal y personalidad jurídica: resumen firmado + acta, poder, INE y constancia fiscal", "origen": "expediente", "requiere_firma": true, "categoria_expediente": "acta_constitutiva"},
  {"anexo_id": "L-3", "sobre": "legal", "descripcion": "Manifiesto de no encontrarse en los supuestos de los artículos 51 y 78 de la Ley", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "L-4", "sobre": "legal", "descripcion": "Carta de declaración de integridad", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "L-5", "sobre": "legal", "descripcion": "Manifiesto de nacionalidad mexicana (art. 36 del Reglamento)", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "L-6", "sobre": "legal", "descripcion": "Manifiesto de cumplimiento de la Ley Federal del Trabajo y la Ley del Seguro Social", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "L-7", "sobre": "legal", "descripcion": "Solvencia económica: dos declaraciones anuales, provisionales, balances y cédula del contador", "origen": "expediente", "requiere_firma": false, "categoria_expediente": "estados_financieros"},
  {"anexo_id": "L-8", "sobre": "legal", "descripcion": "Manifiesto de no subcontratar a otro licitante del mismo procedimiento", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "L-9", "sobre": "legal", "descripcion": "Manifiesto de no ejecutar con otro participante acciones para obtener ventaja indebida", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "L-10", "sobre": "legal", "descripcion": "Participación conjunta: convenio o manifiesto «No aplica»", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "L-11", "sobre": "legal", "descripcion": "Registro vigente en el SIEM (constancia o comprobante de pago)", "origen": "expediente", "requiere_firma": false, "categoria_expediente": "cmic"},
  {"anexo_id": "Anexo 2", "sobre": "tecnico", "descripcion": "Formato de verificación de documentos de la propuesta técnica", "origen": "se_genera", "requiere_firma": false, "categoria_expediente": null},
  {"anexo_id": "T-1", "sobre": "tecnico", "descripcion": "Manifiesto de conocimiento de la convocatoria", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "T-2", "sobre": "tecnico", "descripcion": "Manifiesto de conocer el sitio de los trabajos, sus condiciones e implicaciones técnicas", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "T-3", "sobre": "tecnico", "descripcion": "Manifiesto de haber considerado normas de calidad, memoria descriptiva y especificaciones", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "T-4", "sobre": "tecnico", "descripcion": "Manifiesto de conocer el proyecto ejecutivo del plantel (en su caso)", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "T-5", "sobre": "tecnico", "descripcion": "Manifiesto de conocer el modelo de contrato", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "T-6", "sobre": "tecnico", "descripcion": "Manifestación de las partes que serán subcontratadas", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "T-7", "sobre": "tecnico", "descripcion": "Manifiesto de estratificación MIPYMES de la empresa", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "T-8", "sobre": "tecnico", "descripcion": "Relación del personal técnico y administrativo con currículum de cada uno", "origen": "expediente", "requiere_firma": true, "categoria_expediente": "curriculum"},
  {"anexo_id": "T-9", "sobre": "tecnico", "descripcion": "Relación de obras similares realizadas o en ejecución, con contratos y actas de entrega-recepción", "origen": "expediente", "requiere_firma": true, "categoria_expediente": "curriculum"},
  {"anexo_id": "T-9a", "sobre": "tecnico", "descripcion": "Relación de contratos de obra en vigor (importe contratado, por ejercer y fecha de término)", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "T-10", "sobre": "tecnico", "descripcion": "Planeación integral y procedimiento constructivo", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "T-11", "sobre": "tecnico", "descripcion": "Relación de maquinaria y equipo, con facturas o cartas de arrendamiento", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "T-12", "sobre": "tecnico", "descripcion": "Programa calendarizado de ejecución general de los trabajos", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "T-13", "sobre": "tecnico", "descripcion": "Carta de responsable técnico permanente en obra, con registro estatal y cédula profesional", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "Anexo 3", "sobre": "economico", "descripcion": "Formato de verificación de documentos de la propuesta económica", "origen": "se_genera", "requiere_firma": false, "categoria_expediente": null},
  {"anexo_id": "E-1", "sobre": "economico", "descripcion": "Análisis, cálculo e integración de los precios unitarios", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-2", "sobre": "economico", "descripcion": "Análisis, cálculo e integración del factor de salario real", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-3", "sobre": "economico", "descripcion": "Costos horarios de maquinaria y equipo de construcción", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-4", "sobre": "economico", "descripcion": "Análisis, cálculo e integración de los costos indirectos", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-5", "sobre": "economico", "descripcion": "Análisis, cálculo e integración del costo por financiamiento", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-6", "sobre": "economico", "descripcion": "Cálculo del cargo por utilidad", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-7", "sobre": "economico", "descripcion": "Determinación de cargos adicionales", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-8", "sobre": "economico", "descripcion": "Relación y análisis de los costos unitarios básicos", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-9", "sobre": "economico", "descripcion": "Listado de insumos que intervienen en la proposición", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-10", "sobre": "economico", "descripcion": "Catálogo de conceptos", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-10a", "sobre": "economico", "descripcion": "Propuesta económica (carta con el monto total)", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-11", "sobre": "economico", "descripcion": "Programa de ejecución general de los trabajos", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-12", "sobre": "economico", "descripcion": "Programa de erogaciones a costo directo de materiales y equipos", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-13", "sobre": "economico", "descripcion": "Programa de erogaciones a costo directo de mano de obra", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-14", "sobre": "economico", "descripcion": "Programa de erogaciones a costo directo de maquinaria y equipo", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "E-15", "sobre": "economico", "descripcion": "Programa de erogaciones del personal de oficinas centrales y de campo", "origen": "opus", "requiere_firma": true, "categoria_expediente": null}]$r1$::jsonb),
   true, true, NULL),
  (NULL, 'Municipio de Cuauhtémoc',
   'Obra pública municipal de Cd. Cuauhtémoc, Chih. (LOPSRM del Estado de Chihuahua). Lista común de MC-2617057-057 y MC-2617064-064: fuera de sobre (numeral 6, aquí como «legal»), sobre técnico (numeral 7) y sobre económico (numeral 8), más la memoria USB con todo digitalizado y AE-03/AE-04 en XLS. En proposición conjunta, 6.2 a 6.7 y 7.2, 7.3, 7.4, 7.7, 7.8, 7.9 y 7.13 van por cada integrante.',
   '{NN}_{anexo}_{descripcion}.pdf',
   $s2$[{"clave": "legal", "nombre": "Fuera de sobre (numeral 6)", "carpeta": "A_FUERA_DE_SOBRE"},
  {"clave": "tecnico", "nombre": "Sobre técnico (numeral 7)", "carpeta": "B_SOBRE_TECNICO"},
  {"clave": "economico", "nombre": "Sobre económico (numeral 8)", "carpeta": "C_SOBRE_ECONOMICO"}]$s2$::jsonb,
   control_obra.licit_requisitos_json_norm($r2$[{"anexo_id": "6.1", "sobre": "legal", "descripcion": "Identificación oficial vigente con fotografía de quien asiste al acto", "origen": "expediente", "requiere_firma": false, "categoria_expediente": "identificacion"},
  {"anexo_id": "6.2 DD-01", "sobre": "legal", "descripcion": "Escrito de facultades suficientes para comprometerse por sí o por su representada", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "6.3", "sobre": "legal", "descripcion": "Identificación oficial del representante legal que firma la proposición", "origen": "expediente", "requiere_firma": false, "categoria_expediente": "identificacion"},
  {"anexo_id": "6.4 DD-02", "sobre": "legal", "descripcion": "Declaración de integridad", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "6.5 DD-07", "sobre": "legal", "descripcion": "Manifestación de correo electrónico para notificaciones", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "6.6", "sobre": "legal", "descripcion": "Comprobante de domicilio fiscal (sólo si difiere del registrado en el Padrón)", "origen": "expediente", "requiere_firma": false, "categoria_expediente": "comprobante_domicilio"},
  {"anexo_id": "6.7 DD-03", "sobre": "legal", "descripcion": "Escrito de datos bancarios, con comprobante bancario", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "6.8 DD-05", "sobre": "legal", "descripcion": "Listado de verificación de recepción de documentos", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "6.9", "sobre": "legal", "descripcion": "Convenio de proposición conjunta, original notariado (sólo si es conjunta)", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "DD-04", "sobre": "legal", "descripcion": "Manifestación de no ubicarse en el supuesto del art. 69-B del CFF (operaciones inexistentes)", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "No adeudo estatal", "sobre": "legal", "descripcion": "Constancia de no adeudo fiscal estatal (Recaudación de Rentas de Chihuahua)", "origen": "expediente", "requiere_firma": false, "categoria_expediente": "otro"},
  {"anexo_id": "7.1", "sobre": "tecnico", "descripcion": "Recibo original y copia del pago del costo de participación", "origen": "dependencia", "requiere_firma": false, "categoria_expediente": null},
  {"anexo_id": "7.2", "sobre": "tecnico", "descripcion": "Constancia vigente del Padrón Único de Contratistas, o solicitud de inscripción o revalidación", "origen": "expediente", "requiere_firma": false, "categoria_expediente": "padron_contratistas"},
  {"anexo_id": "7.3 DD-08", "sobre": "tecnico", "descripcion": "Manifestación de que los datos del Padrón están completos y actualizados", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.4 AT-11", "sobre": "tecnico", "descripcion": "Manifestación de no encontrarse en los supuestos de los artículos 71 y 102 de la Ley", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.5 AT-02", "sobre": "tecnico", "descripcion": "Manifestación de conocimiento del sitio y sus condiciones ambientales", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.6 AT-02A", "sobre": "tecnico", "descripcion": "Manifestación de conocer el proyecto ejecutivo, las normas de calidad y las especificaciones", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.7 AT-03", "sobre": "tecnico", "descripcion": "Manifestación de conocer las bases y las actas de las juntas de aclaraciones", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.8 AT-04", "sobre": "tecnico", "descripcion": "Manifestación de subcontratar o no subcontratar", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.9 AT-05", "sobre": "tecnico", "descripcion": "Relación de contratos en vigor, con constancias de avance de cada contratante público", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.10 AT-10", "sobre": "tecnico", "descripcion": "Trabajos anteriores: 2 a 5 contratos de los últimos 5 años con actas o finiquitos", "origen": "expediente", "requiere_firma": true, "categoria_expediente": "curriculum"},
  {"anexo_id": "7.11 AT-12", "sobre": "tecnico", "descripcion": "Planeación integral y procedimiento constructivo", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.12 AT-06", "sobre": "tecnico", "descripcion": "Relación de maquinaria y equipo, con facturas o cartas de arrendamiento", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.13 AT-01", "sobre": "tecnico", "descripcion": "Designación y currículum del superintendente, con cédula profesional", "origen": "expediente", "requiere_firma": true, "categoria_expediente": "curriculum"},
  {"anexo_id": "7.14 AT-09", "sobre": "tecnico", "descripcion": "Manifestación de conocer el modelo de contrato y ajustarse a sus términos", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.15 AT-08", "sobre": "tecnico", "descripcion": "Programa de utilización de personal técnico, administrativo y de servicios", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.16 AT-07", "sobre": "tecnico", "descripcion": "Programa calendarizado de utilización de maquinaria y equipo", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.17 AT-07A", "sobre": "tecnico", "descripcion": "Programa calendarizado de equipos de instalación permanente", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.18 AT-07B", "sobre": "tecnico", "descripcion": "Programa calendarizado de utilización de mano de obra", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.19 AT-13", "sobre": "tecnico", "descripcion": "Programa calendarizado de materiales (al menos los 10 más importantes)", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.20", "sobre": "tecnico", "descripcion": "Opinión de cumplimiento fiscal del SAT (32-D), positiva y de fecha actual", "origen": "expediente", "requiere_firma": false, "categoria_expediente": "opinion_sat"},
  {"anexo_id": "7.21", "sobre": "tecnico", "descripcion": "Opinión de cumplimiento en seguridad social del IMSS, positiva y de fecha actual", "origen": "expediente", "requiere_firma": false, "categoria_expediente": "opinion_imss"},
  {"anexo_id": "7.22", "sobre": "tecnico", "descripcion": "Acta constitutiva y reformas, y acta de nacimiento del representante legal", "origen": "expediente", "requiere_firma": false, "categoria_expediente": "acta_constitutiva"},
  {"anexo_id": "7.23", "sobre": "tecnico", "descripcion": "Constancia de no inhabilitación del Gobierno del Estado", "origen": "expediente", "requiere_firma": false, "categoria_expediente": "otro"},
  {"anexo_id": "7.24 AT-14", "sobre": "tecnico", "descripcion": "Manifestación de contenido nacional de materiales y equipo de instalación permanente", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "7.25", "sobre": "tecnico", "descripcion": "Copia del convenio de proposición conjunta (sólo si es conjunta)", "origen": "se_genera", "requiere_firma": false, "categoria_expediente": null},
  {"anexo_id": "8.1", "sobre": "economico", "descripcion": "Garantía de seriedad: cheque cruzado por el 5 % del monto sin IVA", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.2 AE-01", "sobre": "economico", "descripcion": "Carta compromiso de seriedad de la proposición", "origen": "se_genera", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.3 AE-02", "sobre": "economico", "descripcion": "Proposición económica (escrito con el monto total)", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.4", "sobre": "economico", "descripcion": "Listado de insumos: materiales, mano de obra y maquinaria", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.5", "sobre": "economico", "descripcion": "Factor de salario real con tabulador de salarios base", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.6", "sobre": "economico", "descripcion": "Costos horarios de maquinaria y equipo de construcción", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.7 AE-05", "sobre": "economico", "descripcion": "Costos indirectos: oficinas centrales, campo, seguros y fianzas", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.8", "sobre": "economico", "descripcion": "Desglose del uso del anticipo (formato libre)", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.9 AE-06", "sobre": "economico", "descripcion": "Costo por financiamiento, con el indicador económico utilizado", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.10 AE-07", "sobre": "economico", "descripcion": "Utilidad propuesta por el licitante", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.11", "sobre": "economico", "descripcion": "Análisis detallado de precios unitarios de todos los conceptos, con básicos auxiliares", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.12", "sobre": "economico", "descripcion": "Relación y análisis de costos unitarios básicos de materiales", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.13 AE-04", "sobre": "economico", "descripcion": "Catálogo de conceptos con precio unitario en número y letra (también en XLS)", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.14 AE-03", "sobre": "economico", "descripcion": "Programa de ejecución y montos mensuales por concepto (también en XLS)", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.15a AE-08", "sobre": "economico", "descripcion": "Programa de erogaciones a costo directo de mano de obra", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.15b AE-08", "sobre": "economico", "descripcion": "Programa de erogaciones de los 10 materiales más significativos", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.15c AE-08", "sobre": "economico", "descripcion": "Programa de erogaciones de maquinaria y equipo de construcción", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.15d AE-08", "sobre": "economico", "descripcion": "Programa de erogaciones de materiales y equipos de instalación permanente", "origen": "opus", "requiere_firma": true, "categoria_expediente": null},
  {"anexo_id": "8.15e AE-08", "sobre": "economico", "descripcion": "Programa de erogaciones del personal técnico, administrativo y de servicios", "origen": "opus", "requiere_firma": true, "categoria_expediente": null}]$r2$::jsonb),
   true, true, NULL)
ON CONFLICT ((COALESCE(empresa_id, 0)), (lower(nombre))) DO UPDATE
  SET descripcion = EXCLUDED.descripcion, naming_pattern = EXCLUDED.naming_pattern, sobres_json = EXCLUDED.sobres_json,
      requisitos_json = EXCLUDED.requisitos_json, activo = true;

-- 3) generar_requisitos_perfil: idempotente, nunca pisa lo ya capturado -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generar_requisitos_perfil(p_licitacion_id integer, p_perfil_id integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  v_lic control_obra.licitaciones%ROWTYPE;
  v_perfil integer; v_req jsonb; v_n integer;
BEGIN
  SELECT * INTO v_lic FROM control_obra.licitaciones WHERE id = p_licitacion_id AND empresa_id = v_emp;
  IF v_lic.id IS NULL THEN RAISE EXCEPTION 'La licitación no existe.' USING ERRCODE = '42501'; END IF;
  v_perfil := COALESCE(p_perfil_id, v_lic.perfil_id);
  IF v_perfil IS NULL THEN
    RAISE EXCEPTION 'La licitación no tiene perfil de convocante: elígelo en «Editar datos».' USING ERRCODE = '22023';
  END IF;
  SELECT requisitos_json INTO v_req FROM control_obra.perfiles_convocante
   WHERE id = v_perfil AND (empresa_id IS NULL OR empresa_id = v_emp);
  IF v_req IS NULL THEN RAISE EXCEPTION 'El perfil de convocante no existe.' USING ERRCODE = '22023'; END IF;

  WITH src AS (
    SELECT x, ord FROM jsonb_array_elements(v_req) WITH ORDINALITY AS t(x, ord)
     WHERE NOT EXISTS (SELECT 1 FROM control_obra.licitacion_requisitos r
                        WHERE r.licitacion_id = v_lic.id AND lower(r.anexo_id) = lower(btrim(t.x->>'anexo_id')))
  ), base AS (
    SELECT sobre, max(orden) AS m FROM control_obra.licitacion_requisitos WHERE licitacion_id = v_lic.id GROUP BY sobre
  )
  INSERT INTO control_obra.licitacion_requisitos (licitacion_id, anexo_id, sobre, descripcion, origen, requiere_firma, categoria_expediente, orden)
  SELECT v_lic.id, btrim(s.x->>'anexo_id'), COALESCE(NULLIF(s.x->>'sobre', ''), 'legal'), COALESCE(s.x->>'descripcion', ''),
         COALESCE(NULLIF(s.x->>'origen', ''), 'se_genera'), COALESCE((s.x->>'requiere_firma')::boolean, false),
         NULLIF(s.x->>'categoria_expediente', ''),
         COALESCE(b.m, 0) + row_number() OVER (PARTITION BY COALESCE(NULLIF(s.x->>'sobre', ''), 'legal') ORDER BY s.ord)
    FROM src s LEFT JOIN base b ON b.sobre = COALESCE(NULLIF(s.x->>'sobre', ''), 'legal')
  ON CONFLICT (licitacion_id, anexo_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_lic.perfil_id IS DISTINCT FROM v_perfil THEN
    UPDATE control_obra.licitaciones SET perfil_id = v_perfil WHERE id = v_lic.id;
  END IF;
  RETURN jsonb_build_object('success', true, 'insertados', v_n, 'en_perfil', jsonb_array_length(v_req),
                            'ya_estaban', jsonb_array_length(v_req) - v_n, 'perfil_id', v_perfil);
END; $$;

-- 4) guardar_perfil_desde_licitacion: «Guardar como perfil» (nivel >= 80) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.guardar_perfil_desde_licitacion(p_licitacion_id integer, p_nombre text,
  p_descripcion text DEFAULT NULL, p_reemplazar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  v_lic control_obra.licitaciones%ROWTYPE;
  v_req jsonb; v_existe integer; v_id integer; v_pat text; v_sob jsonb;
BEGIN
  IF NULLIF(btrim(p_nombre), '') IS NULL THEN RAISE EXCEPTION 'Escribe el nombre del perfil.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_lic FROM control_obra.licitaciones WHERE id = p_licitacion_id AND empresa_id = v_emp;
  IF v_lic.id IS NULL THEN RAISE EXCEPTION 'La licitación no existe.' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('anexo_id', anexo_id, 'sobre', sobre, 'descripcion', descripcion, 'origen', origen,
           'requiere_firma', requiere_firma, 'categoria_expediente', categoria_expediente)
           ORDER BY array_position(ARRAY['legal','tecnico','economico'], sobre), orden, id), '[]'::jsonb)
    INTO v_req FROM control_obra.licitacion_requisitos WHERE licitacion_id = v_lic.id;
  IF jsonb_array_length(v_req) = 0 THEN
    RAISE EXCEPTION 'La licitación todavía no tiene requisitos que guardar.' USING ERRCODE = '22023';
  END IF;
  SELECT naming_pattern, sobres_json INTO v_pat, v_sob FROM control_obra.perfiles_convocante WHERE id = v_lic.perfil_id;
  SELECT id INTO v_existe FROM control_obra.perfiles_convocante WHERE empresa_id = v_emp AND lower(nombre) = lower(btrim(p_nombre));
  IF v_existe IS NOT NULL AND NOT p_reemplazar THEN
    RAISE EXCEPTION 'Ya tienes un perfil llamado «%». Elige otro nombre o reemplázalo.', btrim(p_nombre) USING ERRCODE = '23505';
  END IF;
  IF v_existe IS NOT NULL THEN
    UPDATE control_obra.perfiles_convocante SET requisitos_json = v_req,
           descripcion = COALESCE(NULLIF(btrim(p_descripcion), ''), descripcion)
     WHERE id = v_existe RETURNING id INTO v_id;
  ELSE
    INSERT INTO control_obra.perfiles_convocante (nombre, descripcion, naming_pattern, sobres_json, requisitos_json, es_fabrica, activo)
    VALUES (btrim(p_nombre), NULLIF(btrim(p_descripcion), ''), v_pat, COALESCE(v_sob, '[]'::jsonb), v_req, false, true)
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_id, 'requisitos', jsonb_array_length(v_req), 'reemplazado', v_existe IS NOT NULL);
END; $$;

-- 5) Editor de perfiles en Configuración (nivel 100) -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guardar_perfil_convocante(p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
DECLARE
  v_emp integer := control_obra.licit_sesion_n80();
  p jsonb := COALESCE(p_datos, '{}'::jsonb);
  v_id integer := NULLIF(p->>'id', '')::integer;
  v_row control_obra.perfiles_convocante%ROWTYPE;
BEGIN
  IF COALESCE(control_obra.get_session_nivel(), 0) < 100 THEN
    RAISE EXCEPTION 'Sólo un administrador puede editar los perfiles de convocante.' USING ERRCODE = '42501';
  END IF;
  IF v_id IS NULL AND NULLIF(btrim(p->>'nombre'), '') IS NULL THEN
    RAISE EXCEPTION 'Escribe el nombre del perfil.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO control_obra.perfiles_convocante (nombre, descripcion, naming_pattern, sobres_json, requisitos_json, es_fabrica, activo)
      VALUES (btrim(p->>'nombre'), NULLIF(btrim(p->>'descripcion'), ''), NULLIF(btrim(p->>'naming_pattern'), ''),
              COALESCE(CASE WHEN jsonb_typeof(p->'sobres_json') = 'array' THEN p->'sobres_json' END, '[]'::jsonb),
              control_obra.licit_requisitos_json_norm(COALESCE(p->'requisitos_json', '[]'::jsonb)), false,
              COALESCE((p->>'activo')::boolean, true))
      RETURNING * INTO v_row;
    ELSE
      UPDATE control_obra.perfiles_convocante pc SET
        nombre          = CASE WHEN p ? 'nombre' THEN btrim(p->>'nombre') ELSE pc.nombre END,
        descripcion     = CASE WHEN p ? 'descripcion' THEN NULLIF(btrim(p->>'descripcion'), '') ELSE pc.descripcion END,
        naming_pattern  = CASE WHEN p ? 'naming_pattern' THEN NULLIF(btrim(p->>'naming_pattern'), '') ELSE pc.naming_pattern END,
        sobres_json     = CASE WHEN p ? 'sobres_json' AND jsonb_typeof(p->'sobres_json') = 'array' THEN p->'sobres_json' ELSE pc.sobres_json END,
        requisitos_json = CASE WHEN p ? 'requisitos_json' THEN control_obra.licit_requisitos_json_norm(p->'requisitos_json') ELSE pc.requisitos_json END,
        activo          = CASE WHEN p ? 'activo' THEN COALESCE((p->>'activo')::boolean, true) ELSE pc.activo END
      WHERE pc.id = v_id AND pc.empresa_id = v_emp AND NOT pc.es_fabrica
      RETURNING * INTO v_row;
      IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'Ese perfil no se puede editar (es de fábrica o no es de tu empresa). Duplícalo para cambiarlo.' USING ERRCODE = '42501';
      END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya tienes un perfil llamado «%».', btrim(p->>'nombre') USING ERRCODE = '23505';
  END;
  RETURN jsonb_build_object('success', true, 'id', v_row.id, 'perfil', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.borrar_perfil_convocante(p_id integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'control_obra', 'public' AS $$
DECLARE v_emp integer := control_obra.licit_sesion_n80(); v_n integer;
BEGIN
  IF COALESCE(control_obra.get_session_nivel(), 0) < 100 THEN
    RAISE EXCEPTION 'Sólo un administrador puede borrar perfiles de convocante.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM control_obra.perfiles_convocante WHERE id = p_id AND empresa_id = v_emp AND NOT es_fabrica;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'Ese perfil no se puede borrar (es de fábrica o no es de tu empresa).' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('success', true);
END; $$;

REVOKE ALL ON FUNCTION public.generar_requisitos_perfil(integer, integer), public.guardar_perfil_desde_licitacion(integer, text, text, boolean),
  public.guardar_perfil_convocante(jsonb), public.borrar_perfil_convocante(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generar_requisitos_perfil(integer, integer), public.guardar_perfil_desde_licitacion(integer, text, text, boolean),
  public.guardar_perfil_convocante(jsonb), public.borrar_perfil_convocante(integer) TO anon, authenticated;
