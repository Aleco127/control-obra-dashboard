/**
 * Banco de precios (PRD licitaciones · épica D). Módulo de la barra `bp`, sólo nivel >= 80 (D3: los precios no los ve
 * nadie más; la RLS de insumos, insumo_precios, conceptos_historicos, concepto_precios, matriz_componentes,
 * insumo_componentes, insumo_sugerencias y banco_importaciones lo exige también para leer).
 *
 * Carga perezosa (D4): NO entra a load_all_data_seguro. Al abrirse, `cargar()` lee public.insumos_resumen (último
 * precio, mediana, mínimo, máximo, muestras y variación contra el anterior) y lo deja en `D.ins = { filas, total,
 * limite }` (propiedad NO enumerable de D: no se guarda en localStorage). En el build sale como módulo diferido.
 *
 * Pestañas: Insumos (US-822, ficha con historial US-823) · Conceptos (US-826) · Mano de obra (US-831) ·
 * Por clasificar (US-832) · Importar de OPUS (US-825).
 * Precios SIN IVA en todo el banco (como en OPUS). La mediana, el mínimo, el máximo y la variación salen de la vista
 * insumos_resumen; la variación anual se calcula con la historia del insumo.
 * Depende de (navegador): sb, D, M, S, $, F, Skeleton, EmptyState, humanizeError, Toast, Dialog, openMdl, closeMdl,
 * Chart (Chart.js) y XLSX (respaldo de Excel). Las funciones puras se exportan con module.exports y se prueban en
 * scripts/qa/banco-precios.test.mjs y scripts/qa/fsr.test.mjs.
 */
const BancoPrecios = (() => {
  'use strict';

  // ---- Catálogos ------------------------------------------------------------------------------------------------------
  const TIPOS = { material: 'Material', mano_obra: 'Mano de obra', equipo: 'Equipo', herramienta: 'Herramienta', auxiliar: 'Auxiliar', flete: 'Flete' };
  const PLAZAS = { cuauhtemoc: 'Cd. Cuauhtémoc', chihuahua: 'Chihuahua', juarez: 'Cd. Juárez', parral: 'Parral', casas_grandes: 'Casas Grandes', otra: 'Otra' };
  const FUENTES = { opus: 'OPUS', cotizacion: 'Cotización', compra: 'Compra', manual: 'Manual', referencia: 'Referencia' };
  /** Un precio con más de estos días se marca como viejo (US-823, US-829). */
  const DIAS_PRECIO_VIEJO = 180;
  const LIMITE_PAGINA = 1000;
  const LIMITE_TOTAL = 10000;
  const COLUMNAS = 'id,clave,descripcion,unidad,tipo,familia,activo,ultimo_precio,ultima_fecha,ultima_plaza,ultima_fuente,precio_anterior,fecha_anterior,variacion_pct,mediana,minimo,maximo,muestras,compuesto';
  /** Umbral de «parecido por descripción» de la conciliación (US-825). */
  const UMBRAL_PARECIDO = 0.6;

  // ---- Funciones puras ------------------------------------------------------------------------------------------------
  function hoyMx(d) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
  }
  /** Misma normalización que control_obra.texto_norm (minúsculas, sin acentos, sin puntuación, espacios simples). */
  function normalizarTexto(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /** Días entre la fecha de un precio y hoy (YYYY-MM-DD). */
  function antiguedadDias(fecha, hoy) {
    if (!fecha) return null;
    const u = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
    return Math.round((u(String(hoy || hoyMx())) - u(String(fecha).slice(0, 10))) / 86400000);
  }
  const esViejo = (fecha, hoy) => { const d = antiguedadDias(fecha, hoy); return d !== null && d > DIAS_PRECIO_VIEJO; };
  const ordenReciente = (a, b) => String(b.fecha).localeCompare(String(a.fecha)) || ((b.id || 0) - (a.id || 0));
  /**
   * Precio vigente (D5): el más reciente de la plaza; si la plaza no tiene, el más reciente de cualquier plaza.
   * precios: [{precio, fecha, plaza, id?}] · devuelve {precio, fecha, plaza, de_otra_plaza} o null.
   */
  function precioVigente(precios, plaza) {
    const v = precioVigenteFila(precios, plaza);
    return v ? { precio: Number(v.fila.precio), fecha: String(v.fila.fecha).slice(0, 10), plaza: v.fila.plaza, de_otra_plaza: v.de_otra_plaza } : null;
  }
  /** Igual que precioVigente pero devuelve el registro completo (fuente, datos…): {fila, de_otra_plaza} o null (US-829). */
  function precioVigenteFila(precios, plaza) {
    const lista = (precios || []).filter((p) => p && p.precio !== null && p.precio !== undefined && p.fecha).slice().sort(ordenReciente);
    if (!lista.length) return null;
    const dePlaza = plaza ? lista.find((p) => p.plaza === plaza) : null;
    return { fila: dePlaza || lista[0], de_otra_plaza: !!plaza && !dePlaza };
  }
  /**
   * Variación anual (US-823): último precio contra el más reciente que tenga al menos 365 días menos que él.
   * Devuelve {pct, desde, hasta, precio_desde} o null si no hay historia de un año.
   */
  function variacionAnual(precios) {
    const lista = (precios || []).filter((p) => p && p.fecha && Number(p.precio) > 0).slice().sort(ordenReciente);
    if (lista.length < 2) return null;
    const u = lista[0];
    const ant = lista.find((p) => antiguedadDias(p.fecha, String(u.fecha).slice(0, 10)) >= 365);
    if (!ant) return null;
    return { pct: Math.round((Number(u.precio) - Number(ant.precio)) / Number(ant.precio) * 10000) / 100,
      desde: String(ant.fecha).slice(0, 10), hasta: String(u.fecha).slice(0, 10), precio_desde: Number(ant.precio) };
  }
  /** Propuesta (opus, referencia, cotización, manual) o compra (factura): la gráfica los distingue (US-832). */
  const grupoFuente = (f) => (f === 'compra' ? 'compra' : 'propuesta');
  /** Series de la gráfica: una por plaza, puntos ordenados por fecha con la fuente de cada uno. */
  function seriesPorPlaza(precios) {
    const out = {};
    (precios || []).filter((p) => p && p.fecha && p.precio !== null && p.precio !== undefined)
      .slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || ((a.id || 0) - (b.id || 0)))
      .forEach((p) => { (out[p.plaza || 'otra'] = out[p.plaza || 'otra'] || []).push({ fecha: String(p.fecha).slice(0, 10), precio: Number(p.precio), fuente: p.fuente, grupo: grupoFuente(p.fuente) }); });
    return out;
  }

  // ---- Conciliación de un archivo de OPUS (US-825) -------------------------------------------------------------------
  /** Trigramas como pg_trgm: cada palabra con dos espacios delante y uno detrás. */
  function trigramas(s) {
    const out = new Set();
    for (const w of normalizarTexto(s).split(' ').filter(Boolean)) {
      const p = `  ${w} `;
      for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
    }
    return out;
  }
  /** similarity() de pg_trgm: trigramas comunes entre trigramas totales (0 a 1). */
  function similitud(a, b) {
    const A = a instanceof Set ? a : trigramas(a); const B = b instanceof Set ? b : trigramas(b);
    if (!A.size || !B.size) return 0;
    let c = 0; for (const t of A) if (B.has(t)) c++;
    return c / (A.size + B.size - c);
  }
  const llaveInsumo = (clave, unidad, tipo) => `${String(clave == null ? '' : clave).trim().toLowerCase()}|${String(unidad == null ? '' : unidad).trim().toLowerCase()}|${tipo}`;
  /**
   * Concilia los recursos de un archivo opus-insumos/v1 contra los insumos del banco, en tres cubetas:
   *   coincide: misma clave + unidad + tipo (sin distinguir mayúsculas). Si la descripción no se parece (< 0.3) lleva
   *             aviso 'descripcion_distinta'. También coincide (aviso 'alias') una clave de OPUS que una importación
   *             anterior ya ligó a un insumo (opts.alias = {clave_minúsculas: insumo_id}, de banco_importaciones.mapa);
   *   parecido: mismo tipo y descripción con similitud ≥ umbral (0.6): A REVISAR, nada se fusiona solo;
   *   nuevo:    lo demás.
   * omitidos: sin clave o con un tipo que el banco no maneja (otro_<n>).
   * recursos: [{clave, descripcion, unidad, tipo, ...}] · existentes: [{id, clave, descripcion, unidad, tipo}]
   */
  function conciliarInsumos(recursos, existentes, opts) {
    const umbral = (opts && opts.umbral) || UMBRAL_PARECIDO;
    const alias = (opts && opts.alias) || {};
    const idx = new Map(); const porTipo = {}; const porId = new Map((existentes || []).map((e) => [Number(e.id), e]));
    for (const e of existentes || []) {
      if (!idx.has(llaveInsumo(e.clave, e.unidad, e.tipo))) idx.set(llaveInsumo(e.clave, e.unidad, e.tipo), e);
      (porTipo[e.tipo] = porTipo[e.tipo] || []).push({ e, tri: trigramas(e.descripcion) });
    }
    const res = { coincide: [], parecido: [], nuevo: [], omitidos: [] };
    for (const r of recursos || []) {
      if (!r || !String(r.clave || '').trim() || !TIPOS[r.tipo]) { res.omitidos.push({ recurso: r, motivo: !r || !String(r.clave || '').trim() ? 'sin_clave' : 'tipo' }); continue; }
      const tri = trigramas(r.descripcion);
      const m = idx.get(llaveInsumo(r.clave, r.unidad, r.tipo));
      if (m) { res.coincide.push({ recurso: r, insumo: m, aviso: similitud(tri, trigramas(m.descripcion)) < 0.3 ? 'descripcion_distinta' : null }); continue; }
      // La misma clave de OPUS ya se ligó (y confirmó) en una importación anterior: se respeta si el tipo y la unidad son
      // los mismos (otro proyecto puede usar la misma clave con otra unidad: AGUA lt contra AGUA M3)
      const al = alias[String(r.clave).trim().toLowerCase()];
      const ai = al !== undefined ? porId.get(Number(al)) : null;
      if (ai && ai.tipo === r.tipo && String(ai.unidad || '').trim().toLowerCase() === String(r.unidad || '').trim().toLowerCase()) { res.coincide.push({ recurso: r, insumo: ai, aviso: 'alias' }); continue; }
      const cands = (porTipo[r.tipo] || []).map((x) => ({ insumo: x.e, puntaje: Math.round(similitud(tri, x.tri) * 1000) / 1000 }))
        .filter((x) => x.puntaje >= umbral).sort((a, b) => b.puntaje - a.puntaje || String(a.insumo.clave).localeCompare(String(b.insumo.clave))).slice(0, 3);
      if (cands.length) res.parecido.push({ recurso: r, candidato: cands[0].insumo, puntaje: cands[0].puntaje, candidatos: cands });
      else res.nuevo.push({ recurso: r });
    }
    return res;
  }
  /** Alias clave de OPUS → insumo a partir de los mapas de importaciones anteriores (la más reciente manda). */
  function aliasDeImportaciones(filas) {
    const out = {};
    for (const f of filas || []) for (const [k, v] of Object.entries((f && f.mapa) || {})) out[k] = Number(v);
    return out;
  }
  /**
   * Mapa clave (minúsculas) → insumo_id que se manda a importar_opus_insumos. Las coincidencias entran siempre; un
   * parecido sólo si el usuario lo confirmó: decisiones[clave] = id del insumo elegido (o 'nuevo' / ausente = nuevo).
   */
  function mapaImportacion(conc, decisiones) {
    const mapa = {}; const d = decisiones || {};
    for (const c of conc.coincide) mapa[String(c.recurso.clave).trim().toLowerCase()] = c.insumo.id;
    for (const p of conc.parecido) {
      const k = String(p.recurso.clave).trim().toLowerCase(); const v = d[k];
      if (v !== undefined && v !== null && v !== 'nuevo' && p.candidatos.some((c) => c.insumo.id === Number(v))) mapa[k] = Number(v);
    }
    return mapa;
  }
  /** Lee y valida un archivo opus-insumos/v1 (texto u objeto). Lanza un Error en español si no sirve. */
  function leerOpusInsumos(entrada) {
    let doc = entrada;
    if (typeof entrada === 'string') {
      if (/Ã[\u0080-¿]|Ã[³©¡­±‘]/.test(entrada)) throw new Error('El archivo trae acentos dañados (por ejemplo «Ã³»). Vuelve a exportarlo desde el bridge en UTF-8.');
      try { doc = JSON.parse(entrada.replace(/^﻿/, '')); } catch (e) { throw new Error('El archivo no es un JSON válido.'); }
    }
    const errores = validarOpusInsumos(doc);
    if (errores.length) throw new Error(errores.join(' '));
    return doc;
  }
  function validarOpusInsumos(doc) {
    const e = [];
    if (!doc || typeof doc !== 'object') return ['El archivo está vacío.'];
    if (doc.formato !== 'opus-insumos/v1') e.push(`El formato es «${doc.formato || 'desconocido'}»; se espera opus-insumos/v1.`);
    for (const k of ['recursos', 'conceptos', 'componentes']) if (!Array.isArray(doc[k])) e.push(`Falta la lista «${k}».`);
    if (Array.isArray(doc.recursos)) {
      const malos = doc.recursos.filter((r) => r && r.precio !== null && r.precio !== undefined && typeof r.precio !== 'number').length;
      if (malos) e.push(`${malos} recurso${malos === 1 ? '' : 's'} con precio que no es número.`);
    }
    return e;
  }
  /** Fecha de la propuesta (D5): fechas.presentacion; si no hay, la última actualización de precios. */
  function fechaPropuesta(doc) {
    const f = doc && doc.fechas ? (doc.fechas.presentacion || doc.fechas.concurso || doc.fechas.ultima_actualizacion_precios || doc.fechas.creacion) : null;
    return f ? String(f).slice(0, 10) : null;
  }
  /** Plaza sugerida por la ciudad del proyecto. */
  function plazaSugerida(doc) {
    const t = normalizarTexto([doc && doc.proyecto && doc.proyecto.ciudad, doc && doc.proyecto && doc.proyecto.descripcion, doc && doc.proyecto && doc.proyecto.nombre].filter(Boolean).join(' '));
    if (/cuauhtemoc/.test(t)) return 'cuauhtemoc';
    if (/casas grandes|paquime/.test(t)) return 'casas_grandes';
    if (/juarez/.test(t)) return 'juarez';
    if (/parral/.test(t)) return 'parral';
    if (/chihuahua/.test(t)) return 'chihuahua';
    return 'otra';
  }
  const TIPO_DE_SECCION = [[/mano de obra|^mo$|cuadrilla/, 'mano_obra'], [/herramienta/, 'herramienta'], [/equipo|maquinaria/, 'equipo'], [/auxiliar|basico/, 'auxiliar'], [/flete/, 'flete'], [/material/, 'material']];
  /**
   * Respaldo (US-825): el Excel de «Explosión de insumos» de OPUS. filas = matriz de celdas (XLSX sheet_to_json con
   * header:1). Busca el renglón de encabezados (Clave, Descripción, Unidad, Costo/Precio) y toma el tipo de una columna
   * «Tipo» o de los renglones de sección («MATERIALES», «MANO DE OBRA», …). Devuelve un documento opus-insumos/v1 sin
   * conceptos ni componentes.
   */
  function excelAOpusInsumos(filas, nombre) {
    const norm = (v) => normalizarTexto(v);
    let h = -1; let col = {};
    for (let i = 0; i < Math.min((filas || []).length, 40); i++) {
      const fila = (filas[i] || []).map(norm);
      const ic = fila.findIndex((c) => c === 'clave' || c === 'codigo');
      const id = fila.findIndex((c) => c.startsWith('descripcion') || c === 'concepto' || c === 'insumo');
      if (ic >= 0 && id >= 0) {
        h = i;
        col = { clave: ic, descripcion: id,
          unidad: fila.findIndex((c) => c === 'unidad' || c === 'u' || c === 'um' || c.startsWith('unidad')),
          tipo: fila.findIndex((c) => c === 'tipo' || c.startsWith('tipo de')),
          precio: (() => { const pref = ['costo unitario', 'costo', 'precio unitario', 'precio', 'p u', 'pu']; for (const p of pref) { const k = fila.findIndex((c) => c === p); if (k >= 0) return k; } return fila.findIndex((c) => /^(costo|precio)/.test(c)); })() };
        break;
      }
    }
    if (h < 0 || col.precio < 0) throw new Error('No encontré los encabezados Clave, Descripción y Costo en el Excel. Exporta la «Explosión de insumos» de OPUS o usa el JSON del bridge.');
    const recursos = []; let tipo = 'material';
    for (let i = h + 1; i < filas.length; i++) {
      const f = filas[i] || [];
      const llenas = f.filter((c) => c !== null && c !== undefined && String(c).trim() !== '');
      if (!llenas.length) continue;
      if (llenas.length === 1 && typeof llenas[0] === 'string') {
        const t = norm(llenas[0]); const s = TIPO_DE_SECCION.find(([re]) => re.test(t)); if (s) tipo = s[1]; continue;
      }
      const clave = String(f[col.clave] == null ? '' : f[col.clave]).trim();
      const precio = typeof f[col.precio] === 'number' ? f[col.precio] : parseFloat(String(f[col.precio] || '').replace(/[$,\s]/g, ''));
      if (!clave || !(precio >= 0)) continue;
      let t = tipo;
      if (col.tipo >= 0 && f[col.tipo]) { const s = TIPO_DE_SECCION.find(([re]) => re.test(norm(f[col.tipo]))); if (s) t = s[1]; }
      recursos.push({ clave, descripcion: String(f[col.descripcion] || clave).trim(), unidad: col.unidad >= 0 ? String(f[col.unidad] || '').trim() : '', tipo: t, precio: Math.round(precio * 1e6) / 1e6, moneda: 'MXN' });
    }
    if (!recursos.length) throw new Error('El Excel no trae insumos con clave y costo.');
    return { formato: 'opus-insumos/v1', generado: null, origen: { herramienta: 'excel-explosion-de-insumos', archivo: nombre || null },
      proyecto: { nombre: nombre ? String(nombre).replace(/\.(xlsx?|csv)$/i, '') : 'Excel de OPUS' }, fechas: {}, recursos, conceptos: [], componentes: [] };
  }

  // ---- Matrices (US-826) ----------------------------------------------------------------------------------------------
  // OPUS la modela como herramienta y a veces como mano de obra (BanRegio.mdf: «HERRAMIENTA M», tipo 2): manda la unidad
  const esHerramientaPctMo = (c) => c && /^\(%\)\s*mo$/i.test(String(c.unidad || '').trim());
  /**
   * Recalcula una matriz a precios vigentes: Σ cantidad × precio. Un componente compuesto (cuadrilla o auxiliar) se
   * recalcula primero con su propia matriz (auxiliares[insumo_id]) y cuenta en el tipo del compuesto (una cuadrilla en
   * mano de obra). La herramienta nativa de OPUS «(%)mo» vale cantidad × la mano de obra de la matriz.
   * componentes: [{insumo_id, cantidad, tipo, unidad, compuesto}] · precios: {insumo_id: número|null}
   * Devuelve {total, porTipo, renglones:[{...componente, precio, importe, sinPrecio}], sinPrecio: n}.
   */
  function recalcularMatriz(componentes, precios, auxiliares, nivel) {
    const aux = auxiliares || {}; const prof = nivel || 0;
    const porTipo = Object.fromEntries(Object.keys(TIPOS).map((k) => [k, 0]));
    let sinPrecio = 0;
    const red = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
    const precioDe = (c) => {
      if (c.compuesto && aux[c.insumo_id] && aux[c.insumo_id].length && prof < 5) return recalcularMatriz(aux[c.insumo_id], precios, aux, prof + 1).total;
      const p = precios ? precios[c.insumo_id] : null;
      return p === null || p === undefined || Number.isNaN(Number(p)) ? null : Number(p);
    };
    const renglones = (componentes || []).map((c) => {
      if (esHerramientaPctMo(c)) return { ...c, precio: null, importe: 0, pctMo: true };
      const precio = precioDe(c);
      if (precio === null) sinPrecio++;
      // Como OPUS: cada importe se redondea a 2 decimales (decimales_costos) y luego se suma
      const importe = precio === null ? 0 : red(Number(c.cantidad) * precio);
      return { ...c, precio, importe, sinPrecio: precio === null };
    });
    for (const r of renglones) if (!r.pctMo && porTipo[r.tipo] !== undefined) porTipo[r.tipo] = red(porTipo[r.tipo] + r.importe);
    const mo = porTipo.mano_obra;
    for (const r of renglones) if (r.pctMo) { const t = porTipo[r.tipo] !== undefined ? r.tipo : 'herramienta'; r.precio = mo; r.importe = red(Number(r.cantidad) * mo); porTipo[t] = red(porTipo[t] + r.importe); }
    const total = red(renglones.reduce((s, r) => s + r.importe, 0));
    return { total, porTipo, renglones, sinPrecio };
  }
  /** Composición del costo directo en porcentaje: materiales, mano de obra y equipo + herramienta (US-826). */
  function composicionCD(porTipo) {
    const t = Object.values(porTipo || {}).reduce((s, v) => s + (Number(v) || 0), 0);
    if (!t) return null;
    const p = (v) => Math.round((Number(v) || 0) / t * 10000) / 100;
    return { material: p(porTipo.material), mano_obra: p(porTipo.mano_obra), equipo_herramienta: p((porTipo.equipo || 0) + (porTipo.herramienta || 0)),
      otros: p((porTipo.auxiliar || 0) + (porTipo.flete || 0)), total: Math.round(t * 100) / 100 };
  }
  /** Referencia de la skill para una obra de acabados: materiales ~58 %, mano de obra ~37 %, equipo y herramienta ~5 %. */
  const COMPOSICION_REFERENCIA = { material: 58, mano_obra: 37, equipo_herramienta: 5 };

  // ---- Factor de salario real (US-831) ---------------------------------------------------------------------------------
  /**
   * FSR con el método del Anexo 2 del IIPU actualizado (parámetros de parametros_laborales, ver migración 098):
   *   FSB = 1 + (aguinaldo + prima vacacional × vacaciones) / 365.25 ;  SBC = round(SB × FSB, 2)
   *   Cuotas patronales por jornada = cuota fija % × UMA + excedente % × max(0, SBC − 3 UMA)
   *       + (prestaciones en dinero + gastos médicos + riesgo + invalidez y vida + guarderías + retiro
   *          + cesantía y vejez según SBC/UMA + INFONAVIT) % × SBC
   *   Ps = cuotas / SB ;  FSR sin ISN = (Tp/Tl) × (1 + Ps) ;  FSR = FSR sin ISN × (1 + ISN)
   * Reproduce el tabulador de la skill (MO-PEON $360 → 1.84650 … MO-CABO $620 → 1.83089).
   */
  function cesantiaPct(sbc, p) {
    const tabla = (p && p.cesantia_tabla) || [];
    const sm = Number(p && p.salario_minimo) || 0; const uma = Number(p && p.uma) || 1;
    const base = tabla.find((x) => x.base === 'salario_minimo');
    if (base && sm && sbc <= sm * (Number(base.hasta_sm) || 1) + 1e-9) return Number(base.pct);
    const r = sbc / uma;
    const fila = tabla.filter((x) => x.base !== 'salario_minimo').find((x) => x.hasta_uma === null || x.hasta_uma === undefined || r <= Number(x.hasta_uma) + 1e-9);
    return fila ? Number(fila.pct) : 0;
  }
  function calcularFSR(salarioBase, p) {
    const sb = Number(salarioBase);
    if (!(sb > 0) || !p) return null;
    const d = p.datos || {};
    const uma = Number(p.uma); const dias = Number(d.dias_anio) || 365.25;
    const r4 = (v) => Math.round(v * 1e4) / 1e4; const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
    const fsb = 1 + ((Number(d.aguinaldo_dias) || 15) + (Number(d.prima_vacacional_pct) || 25) / 100 * (Number(p.dias_vacaciones) || 12)) / dias;
    const sbc = r2(sb * fsb);
    const ces = cesantiaPct(sbc, p);
    const tasas = {
      prestaciones_dinero: Number(d.prestaciones_dinero_pct) || 0, gastos_medicos: Number(d.gastos_medicos_pct) || 0,
      riesgo_trabajo: Number(p.riesgo_trabajo_pct) || 0, invalidez_vida: Number(d.invalidez_vida_pct) || 0,
      guarderias: Number(d.guarderias_pct) || 0, retiro: Number(d.retiro_pct) || 0, cesantia_vejez: ces, infonavit: Number(d.infonavit_pct) || 0,
    };
    const cuotas = {
      cuota_fija: (Number(d.cuota_fija_pct) || 0) / 100 * uma,
      excedente: (Number(d.excedente_pct) || 0) / 100 * Math.max(0, sbc - 3 * uma),
    };
    for (const [k, t] of Object.entries(tasas)) cuotas[k] = t / 100 * sbc;
    const totalCuotas = Object.values(cuotas).reduce((s, v) => s + v, 0);
    const ps = totalCuotas / sb;
    const tp = Number(d.tp) || 0; const tl = Number(d.tl) || 0;
    if (!tp || !tl) return null;
    const fsrSinIsn = (tp / tl) * (1 + ps);
    const isn = (Number(p.isn_pct) || 0) / 100;
    const fsr = fsrSinIsn * (1 + isn);
    return { salario_base: sb, fsb: Math.round(fsb * 1e6) / 1e6, sbc, sbc_uma: r4(sbc / uma), tasas, cesantia_pct: ces,
      cuotas: Object.fromEntries(Object.entries(cuotas).map(([k, v]) => [k, r4(v)])), total_cuotas: r4(totalCuotas), ps: Math.round(ps * 1e6) / 1e6,
      tp, tl, tp_tl: Math.round(tp / tl * 1e6) / 1e6, fsr_sin_isn: Math.round(fsrSinIsn * 1e5) / 1e5, isn_pct: isn * 100,
      fsr: Math.round(fsr * 1e5) / 1e5, costo_jornada: r2(sb * Math.round(fsr * 1e5) / 1e5), anio: p.anio };
  }
  /** Parámetros de un año: los de la empresa mandan sobre los de fábrica; si no hay del año, null. */
  function parametrosDelAnio(filas, anio) {
    const delAnio = (filas || []).filter((f) => Number(f.anio) === Number(anio));
    return delAnio.find((f) => !f.es_fabrica) || delAnio.find((f) => f.es_fabrica) || null;
  }

  // ---- Datos (navegador) --------------------------------------------------------------------------------------------
  let enVuelo = null;
  let pintadas = 0;
  const est = { tab: 'insumos', tipo: '', q: '', plaza: '', resultados: null, buscando: 0 };
  function guardarEnD(clave, valor) {
    Object.defineProperty(D, clave, { value: valor, writable: true, configurable: true, enumerable: false });
  }
  async function cargar(force) {
    if (!force && D.ins && Array.isArray(D.ins.filas)) return D.ins;
    if (enVuelo && !force) return enVuelo;
    enVuelo = (async () => {
      const filas = []; let total = 0;
      for (let desde = 0; desde < LIMITE_TOTAL; desde += LIMITE_PAGINA) {
        const { data, error, count } = await sb.from('insumos_resumen').select(COLUMNAS, desde === 0 ? { count: 'exact' } : undefined)
          .order('tipo').order('clave').order('id').range(desde, desde + LIMITE_PAGINA - 1);
        if (error) throw error;
        if (desde === 0) total = count ?? (data || []).length;
        filas.push(...(data || []));
        if (!data || data.length < LIMITE_PAGINA) break;
      }
      guardarEnD('ins', { filas, total: Math.max(total, filas.length), limite: LIMITE_TOTAL });
      return D.ins;
    })();
    try { return await enVuelo; } finally { enVuelo = null; }
  }
  const filaPorId = (id) => (D.ins && D.ins.filas || []).find((x) => x.id === id);
  const proveedorNombre = (id) => { const p = (D.pv || []).find((x) => x.id === id); return p ? (p.nombre_proveedor || p.nombre || '') : ''; };
  const plazaOpts = (sel, vacio) => (vacio ? `<option value="">${S(vacio)}</option>` : '') + Object.entries(PLAZAS).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${S(v)}</option>`).join('');
  const tipoOpts = (sel) => Object.entries(TIPOS).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${S(v)}</option>`).join('');
  const num = (v, d = 2) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${Number(v).toLocaleString('es-MX', { maximumFractionDigits: 2 })} %`);
  const fechaCorta = (iso) => { if (!iso) return '—'; const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };

  // ---- Interfaz: armazón --------------------------------------------------------------------------------------------
  const PESTANAS = [['insumos', 'Insumos', 'ri-price-tag-3-line'], ['conceptos', 'Conceptos', 'ri-file-list-3-line'],
    ['mano_obra', 'Mano de obra', 'ri-user-settings-line'], ['clasificar', 'Por clasificar', 'ri-inbox-archive-line'],
    ['importar', 'Importar de OPUS', 'ri-upload-cloud-2-line']];
  function cabecera() {
    return `<div class="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-3"><div>
<h1 class="text-xl font-bold"><i class="ri-price-tag-3-line" aria-hidden="true"></i> Banco de precios</h1>
<p class="text-sm text-ink-muted mt-1">Cada precio con su fecha, plaza y fuente, sin IVA, para reutilizarlo en tus propuestas y cargarlo a OPUS.</p></div>
<div class="flex flex-wrap gap-2"><button type="button" class="btn btn-s" onclick="BancoPrecios.irA('importar')"><i class="ri-upload-cloud-2-line" aria-hidden="true"></i> Importar de OPUS</button>
<button type="button" class="btn btn-p" onclick="BancoPrecios.nuevoInsumo()"><i class="ri-add-line" aria-hidden="true"></i> Agregar insumo</button></div></div>
<div class="tabs mb-4" role="tablist" aria-label="Secciones del banco de precios">${PESTANAS.map(([k, t, ic]) => `<button type="button" role="tab" id="bpTab-${k}" aria-selected="${est.tab === k}" aria-controls="bpCuerpo" class="tab${est.tab === k ? ' active' : ''}" onclick="BancoPrecios.irA('${k}')"><i class="${ic}" aria-hidden="true"></i> ${t}${k === 'clasificar' ? '<span class="tab-n" id="bpNClasificar" hidden></span>' : ''}</button>`).join('')}</div>`;
  }
  function vacio() {
    return EmptyState({
      icon: 'ri-price-tag-3-line', title: 'El banco de precios está vacío',
      body: 'Aquí se guardará cada insumo con su historial de precios por plaza y fuente: propuestas de OPUS, cotizaciones y compras reales.',
      action: { label: 'Agregar insumo', icon: 'ri-add-line', onClick: 'BancoPrecios.nuevoInsumo()' },
      secondary: { label: 'Importar de OPUS', onClick: "BancoPrecios.irA('importar')" },
    });
  }
  function errorHtml(e) {
    return EmptyState({
      icon: 'ri-error-warning-line', title: 'No se pudo cargar el banco de precios',
      body: humanizeError(e), action: { label: 'Reintentar', icon: 'ri-refresh-line', onClick: 'BancoPrecios.recargar()' },
    });
  }
  const VISTAS = {};
  async function render(c, force) {
    const turno = ++pintadas;
    c.innerHTML = cabecera() + `<div id="bpCuerpo" role="tabpanel" aria-labelledby="bpTab-${est.tab}" aria-busy="true" aria-live="polite">${Skeleton.table(5, 6)}</div>`;
    const cuerpo = () => (turno === pintadas && M === 'bp' ? $('bpCuerpo') : null);
    try {
      const ins = await cargar(force);
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      const vista = VISTAS[est.tab] || VISTAS.insumos;
      await vista(el, ins);
      contarPorClasificar();
    } catch (e) {
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      el.innerHTML = errorHtml(e);
    }
  }
  function recargar() { const c = $('c'); if (c && M === 'bp') render(c, true); }
  function irA(tab) { est.tab = PESTANAS.some((p) => p[0] === tab) ? tab : 'insumos'; const c = $('c'); if (c && M === 'bp') render(c); }
  /** Contador de la pestaña «Por clasificar» (US-832); si la tabla no existe todavía, no estorba. */
  async function contarPorClasificar() {
    try {
      const { count, error } = await sb.from('insumo_sugerencias').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
      const el = $('bpNClasificar'); if (!el || error) return;
      el.textContent = String(count || 0); el.hidden = !count;
    } catch (e) { /* sin contador */ }
  }

  // ---- Insumos (US-822) ---------------------------------------------------------------------------------------------
  function filasVisibles(ins) {
    const base = est.resultados || ins.filas;
    return est.tipo ? base.filter((i) => i.tipo === est.tipo) : base;
  }
  function tablaInsumos(filas) {
    const hoy = hoyMx();
    const cuerpo = filas.map((i) => {
      const precio = i._precio !== undefined ? i._precio : i.ultimo_precio;
      const fecha = i._fecha !== undefined ? i._fecha : i.ultima_fecha;
      const viejo = esViejo(fecha, hoy);
      const otra = i._otraPlaza ? ` <span class="chip chip-ind" title="No hay precio de ${S(PLAZAS[est.plaza] || '')}; se muestra el de ${S(PLAZAS[i._plaza] || i._plaza || '')}">${S(PLAZAS[i._plaza] || i._plaza || '')}</span>` : '';
      const pr = i.compuesto && (precio === null || precio === undefined) ? '<span class="text-ink-muted">De su matriz</span>'
        : (precio === null || precio === undefined ? '<span class="text-ink-muted">Sin precio</span>' : F(precio));
      return `<tr class="cursor-pointer" onclick="BancoPrecios.abrirInsumo(${i.id})">
<td data-et="Clave"><button type="button" class="link font-mono text-xs text-left" onclick="event.stopPropagation();BancoPrecios.abrirInsumo(${i.id})">${S(i.clave)}</button></td>
<td data-et="Descripción">${S(i.descripcion)}${i.compuesto ? ' <span class="chip chip-ind">Compuesto</span>' : ''}${i.activo === false ? ' <span class="chip chip-ind">Inactivo</span>' : ''}</td>
<td data-et="Unidad">${S(i.unidad)}</td><td data-et="Tipo">${S(TIPOS[i.tipo] || i.tipo)}</td>
<td data-et="Último precio" class="text-right">${pr}${otra}</td>
<td data-et="Fecha"${viejo ? ' class="bp-viejo" title="Precio con más de 180 días"' : ''}>${viejo ? '<i class="ri-time-line" aria-hidden="true"></i> ' : ''}${S(fechaCorta(fecha))}</td>
<td data-et="Muestras" class="text-right">${Number(i.muestras) || 0}</td></tr>`;
    }).join('');
    return `<div class="table-wrap g rounded-xl" tabindex="0" role="region" aria-label="Insumos del banco de precios"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Clave</th><th scope="col">Descripción</th><th scope="col">Unidad</th><th scope="col">Tipo</th><th scope="col" class="text-right">${est.plaza ? 'Precio vigente' : 'Último precio'}</th><th scope="col">Fecha</th><th scope="col" class="text-right">Muestras</th></tr></thead><tbody>${cuerpo}</tbody></table></div>`;
  }
  function pintarListaInsumos() {
    const el = $('bpLista'); if (!el || !D.ins) return;
    const filas = filasVisibles(D.ins);
    const base = est.resultados || D.ins.filas;
    const cuenta = (t) => (t ? base.filter((i) => i.tipo === t).length : base.length);
    $('bpTipos').innerHTML = [['', 'Todos'], ...Object.entries(TIPOS)].map(([k, v]) => `<button type="button" class="seg-btn${est.tipo === k ? ' active' : ''}" aria-pressed="${est.tipo === k}" onclick="BancoPrecios.filtrarTipo('${k}')">${S(v)} <span class="tab-n">${cuenta(k)}</span></button>`).join('');
    const pie = est.resultados ? `<p class="text-xs text-ink-muted mt-2">${filas.length} resultado${filas.length === 1 ? '' : 's'}${est.q ? ` para «${S(est.q)}»` : ''}${est.plaza ? ` con el precio vigente de ${S(PLAZAS[est.plaza])}` : ''}.</p>`
      : (D.ins.total > D.ins.filas.length ? `<p class="text-xs text-ink-muted mt-2">Se muestran ${D.ins.filas.length} de ${D.ins.total} insumos. Usa la búsqueda para encontrar el resto.</p>` : '');
    el.innerHTML = filas.length ? tablaInsumos(filas) + pie
      : EmptyState({ icon: 'ri-search-line', title: 'Sin insumos que coincidan', body: est.q ? 'Prueba con otra palabra o con la clave. La búsqueda tolera acentos y errores de dedo.' : 'No hay insumos de este tipo todavía.', action: { label: 'Agregar insumo', icon: 'ri-add-line', onClick: 'BancoPrecios.nuevoInsumo()' } });
  }
  VISTAS.insumos = (el, ins) => {
    if (!ins.filas.length && !est.q) { el.innerHTML = vacio(); return; }
    el.innerHTML = `<div class="flex flex-col md:flex-row gap-2 mb-3">
<label class="flex-1"><span class="sr-only">Buscar insumo</span><input id="bpBuscar" type="search" class="inp w-full" placeholder="Buscar por clave o descripción (tolera acentos y errores)" value="${S(est.q)}" oninput="BancoPrecios.buscar(this.value)" autocomplete="off"></label>
<label class="md:w-56"><span class="sr-only">Plaza del precio</span><select id="bpPlaza" class="inp w-full" onchange="BancoPrecios.filtrarPlaza(this.value)">${plazaOpts(est.plaza, 'Todas las plazas (último precio)')}</select></label></div>
<div class="seg mb-3 bp-seg" id="bpTipos" role="group" aria-label="Tipo de insumo"></div><div id="bpLista"></div>`;
    pintarListaInsumos();
  };
  let tBuscar = null;
  function buscar(q) { est.q = String(q || ''); clearTimeout(tBuscar); tBuscar = setTimeout(ejecutarBusqueda, 300); }
  function filtrarPlaza(p) { est.plaza = p || ''; ejecutarBusqueda(); }
  function filtrarTipo(t) { est.tipo = t || ''; pintarListaInsumos(); }
  async function ejecutarBusqueda() {
    const turno = ++est.buscando;
    if (!est.q.trim() && !est.plaza) { est.resultados = null; pintarListaInsumos(); return; }
    try {
      const { data, error } = await sb.rpc('buscar_insumos', { p_texto: est.q.trim(), p_tipo: null, p_plaza: est.plaza || null, p_limite: 200 });
      if (error) throw error;
      if (turno !== est.buscando) return;
      est.resultados = (data || []).map((r) => {
        const base = filaPorId(r.id) || {};
        return { ...base, ...r, compuesto: base.compuesto, _precio: r.precio_vigente, _fecha: r.fecha_vigente, _plaza: r.plaza_vigente, _otraPlaza: !!(est.plaza && r.de_otra_plaza && r.precio_vigente !== null) };
      });
      pintarListaInsumos();
    } catch (e) { Toast.error(humanizeError(e, 'Búsqueda')); }
  }

  // ---- Modales (se inyectan una vez) ----------------------------------------------------------------------------------
  const MDL_INSUMO = `<div id="mdlBpInsumo" class="modal"><div class="modal-content g rounded-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="bpInsTitulo">
<div class="flex items-start justify-between gap-3 mb-3"><h3 id="bpInsTitulo" class="font-bold">Agregar insumo</h3><button type="button" class="btn-icon" onclick="closeMdl('mdlBpInsumo')" aria-label="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></div>
<form id="bpInsForm" class="grid grid-cols-2 gap-3" onsubmit="event.preventDefault();BancoPrecios.guardarInsumo()">
<input type="hidden" id="bpInsId">
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Clave *</span><input id="bpInsClave" class="inp w-full" required maxlength="60" autocomplete="off"></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Tipo *</span><select id="bpInsTipo" class="inp w-full">${Object.entries({ material: 'Material', mano_obra: 'Mano de obra', equipo: 'Equipo', herramienta: 'Herramienta', auxiliar: 'Auxiliar', flete: 'Flete' }).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
<label class="col-span-2"><span class="text-xs mb-1 block">Descripción *</span><input id="bpInsDesc" class="inp w-full" required maxlength="400"></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Unidad *</span><input id="bpInsUnidad" class="inp w-full" required maxlength="20" placeholder="M3, PZA, JOR…"></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Familia</span><input id="bpInsFamilia" class="inp w-full" maxlength="80"></label>
<label class="col-span-2"><span class="text-xs mb-1 block">Notas</span><textarea id="bpInsNotas" class="inp w-full" rows="2" maxlength="1000"></textarea></label>
<label class="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" id="bpInsActivo" class="w-4 h-4 rounded" checked> Activo (aparece en las búsquedas para nuevas propuestas)</label>
<p class="col-span-2 text-xs text-ink-muted">La clave, la unidad y el tipo identifican al insumo: no se pueden repetir juntos.</p>
<div class="col-span-2 flex gap-2 justify-end"><button type="button" class="btn btn-s" onclick="closeMdl('mdlBpInsumo')">Cancelar</button><button type="submit" class="btn btn-p" id="bpInsGuardar"><i class="ri-save-line" aria-hidden="true"></i> Guardar insumo</button></div>
</form></div></div>`;
  const MDL_FUSION = `<div id="mdlBpFusion" class="modal"><div class="modal-content g rounded-2xl p-6 w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="bpFusTitulo">
<div class="flex items-start justify-between gap-3 mb-2"><div><h3 id="bpFusTitulo" class="font-bold">Fusionar insumo duplicado</h3><p id="bpFusOrigen" class="text-xs text-ink-muted"></p></div><button type="button" class="btn-icon" onclick="closeMdl('mdlBpFusion')" aria-label="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></div>
<p class="text-sm text-ink-muted mb-3">Elige el insumo que se queda. Sus precios y su lugar en las matrices pasan a él y este se borra. Si los dos tienen un precio del mismo día, plaza y fuente, manda el del que se queda.</p>
<label class="block mb-2"><span class="sr-only">Buscar el insumo que se queda</span><input id="bpFusBuscar" type="search" class="inp w-full" placeholder="Buscar el insumo que se queda" oninput="BancoPrecios.buscarDestino(this.value)" autocomplete="off"></label>
<div id="bpFusLista" class="max-h-72 overflow-y-auto" role="radiogroup" aria-label="Insumo que se queda"></div>
<label class="block mt-3"><span class="text-xs mb-1 block">Motivo (opcional)</span><input id="bpFusMotivo" class="inp w-full" maxlength="200" placeholder="Por ejemplo: misma pieza con otra clave en OPUS"></label>
<div class="flex gap-2 justify-end mt-4"><button type="button" class="btn btn-s" onclick="closeMdl('mdlBpFusion')">Cancelar</button><button type="button" class="btn btn-danger" id="bpFusOk" onclick="BancoPrecios.confirmarFusion()" disabled><i class="ri-git-merge-line" aria-hidden="true"></i> Fusionar insumos</button></div>
</div></div>`;
  function asegurarModales() {
    if (!$('mdlBpInsumo')) document.body.insertAdjacentHTML('beforeend', MDL_INSUMO);
    if (!$('mdlBpFusion')) document.body.insertAdjacentHTML('beforeend', MDL_FUSION);
    if (!$('bpDrawer')) {
      document.body.insertAdjacentHTML('beforeend', `<div id="bpDrawerBack" class="drawer-backdrop" onclick="BancoPrecios.cerrarInsumo()"></div><aside id="bpDrawer" class="drawer" role="dialog" aria-modal="true" aria-labelledby="bpDrawerTitulo" aria-hidden="true"><div class="drawer-h"><h2 id="bpDrawerTitulo" class="font-bold text-lg">Insumo</h2><button type="button" class="btn-icon" onclick="BancoPrecios.cerrarInsumo()" aria-label="Cerrar ficha del insumo"><i class="ri-close-line text-xl" aria-hidden="true"></i></button></div><div id="bpDrawerCuerpo" class="drawer-b"></div></aside>`);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('bpDrawer')?.classList.contains('ac') && !document.querySelector('.modal.ac')) cerrarInsumo(); });
    }
  }

  // ---- Alta y edición de insumo (US-822) ----------------------------------------------------------------------------
  function nuevoInsumo(pre) {
    asegurarModales();
    const p = pre || {};
    $('bpInsTitulo').textContent = p.id ? 'Editar insumo' : 'Agregar insumo';
    $('bpInsId').value = p.id || '';
    $('bpInsClave').value = p.clave || ''; $('bpInsDesc').value = p.descripcion || ''; $('bpInsUnidad').value = p.unidad || '';
    $('bpInsTipo').value = p.tipo || (est.tipo || 'material'); $('bpInsFamilia').value = p.familia || ''; $('bpInsNotas').value = p.notas || '';
    $('bpInsActivo').checked = p.activo !== false;
    openMdl('mdlBpInsumo'); setTimeout(() => $('bpInsClave').focus(), 50);
  }
  async function editarInsumo(id) {
    try {
      const { data, error } = await sb.from('insumos').select('id,clave,descripcion,unidad,tipo,familia,activo,notas').eq('id', id).single();
      if (error) throw error;
      nuevoInsumo(data);
    } catch (e) { Toast.error(humanizeError(e, 'Insumo')); }
  }
  async function guardarInsumo() {
    const id = parseInt($('bpInsId').value, 10) || null;
    const fila = { clave: $('bpInsClave').value.trim(), descripcion: $('bpInsDesc').value.trim(), unidad: $('bpInsUnidad').value.trim(),
      tipo: $('bpInsTipo').value, familia: $('bpInsFamilia').value.trim() || null, notas: $('bpInsNotas').value.trim() || null, activo: $('bpInsActivo').checked };
    if (!fila.clave || !fila.descripcion || !fila.unidad) { Toast.warning('Clave, descripción y unidad son obligatorias.'); return; }
    const btn = $('bpInsGuardar'); btn.disabled = true;
    try {
      const q = id ? sb.from('insumos').update(fila).eq('id', id) : sb.from('insumos').insert(fila);
      const { data, error } = await q.select('id').single();
      if (error) throw error;
      closeMdl('mdlBpInsumo');
      Toast.success(id ? 'Insumo actualizado.' : 'Insumo agregado al banco.');
      await cargar(true);
      if (est.resultados) await ejecutarBusqueda(); else if ($('bpLista')) pintarListaInsumos(); else recargar();
      if (id && $('bpDrawer')?.classList.contains('ac')) abrirInsumo(id);
      return data.id;
    } catch (e) {
      Toast.error(e && e.code === '23505' ? 'Ya existe un insumo con esa clave, unidad y tipo. Usa otra clave o edita el existente.' : humanizeError(e, 'Insumo'));
    } finally { btn.disabled = false; }
  }

  // ---- Fusionar (US-822) ---------------------------------------------------------------------------------------------
  let fusion = { origen: null, destino: null, lista: [] };
  function abrirFusion(id) {
    asegurarModales();
    const o = filaPorId(id) || (ficha && ficha.insumo && ficha.insumo.id === id ? ficha.insumo : null);
    if (!o) return;
    fusion = { origen: o, destino: null, lista: [] };
    $('bpFusOrigen').textContent = `${o.clave} · ${o.descripcion} · ${o.unidad} · ${TIPOS[o.tipo] || o.tipo}`;
    $('bpFusBuscar').value = ''; $('bpFusMotivo').value = ''; $('bpFusOk').disabled = true;
    $('bpFusLista').innerHTML = '<p class="text-sm text-ink-muted">Escribe para buscar insumos del mismo tipo.</p>';
    openMdl('mdlBpFusion'); setTimeout(() => $('bpFusBuscar').focus(), 50);
    buscarDestino(o.descripcion.split(/\s+/).slice(0, 3).join(' '));
  }
  let tDestino = null;
  function buscarDestino(q) {
    clearTimeout(tDestino);
    tDestino = setTimeout(async () => {
      try {
        const { data, error } = await sb.rpc('buscar_insumos', { p_texto: String(q || ''), p_tipo: fusion.origen.tipo, p_plaza: null, p_limite: 30 });
        if (error) throw error;
        fusion.lista = (data || []).filter((x) => x.id !== fusion.origen.id);
        $('bpFusLista').innerHTML = fusion.lista.length ? fusion.lista.map((x) => `<label class="flex items-start gap-2 p-2 rounded hover:bg-slate-50 cursor-pointer"><input type="radio" name="bpFusDest" value="${x.id}" class="mt-1" onchange="BancoPrecios.elegirDestino(${x.id})"${fusion.destino === x.id ? ' checked' : ''}><span class="text-sm"><span class="font-mono text-xs">${S(x.clave)}</span> · ${S(x.descripcion)} <span class="text-ink-muted">· ${S(x.unidad)} · ${Number(x.muestras) || 0} precio${Number(x.muestras) === 1 ? '' : 's'}</span>${x.unidad.toLowerCase() !== fusion.origen.unidad.toLowerCase() ? ' <span class="chip chip-ind">Otra unidad</span>' : ''}</span></label>`).join('')
          : '<p class="text-sm text-ink-muted">Sin coincidencias del mismo tipo.</p>';
      } catch (e) { $('bpFusLista').innerHTML = `<p class="text-sm text-danger">${S(humanizeError(e))}</p>`; }
    }, 250);
  }
  function elegirDestino(id) { fusion.destino = id; $('bpFusOk').disabled = false; }
  async function confirmarFusion() {
    const d = fusion.lista.find((x) => x.id === fusion.destino); const o = fusion.origen;
    if (!d || !o) return;
    const otraUnidad = d.unidad.toLowerCase() !== o.unidad.toLowerCase();
    const ok = await Dialog.confirm({ title: 'Fusionar insumos', tone: 'danger', confirmText: 'Fusionar insumos',
      body: `«${o.clave}» se borra y sus precios y componentes pasan a «${d.clave}». ${otraUnidad ? `Ojo: las unidades son distintas (${o.unidad} y ${d.unidad}); los precios no se convierten. ` : ''}No se puede deshacer.` });
    if (!ok) return;
    const btn = $('bpFusOk'); btn.disabled = true;
    try {
      const { data, error } = await sb.rpc('fusionar_insumos', { p_origen: o.id, p_destino: d.id, p_motivo: $('bpFusMotivo').value || null });
      if (error) throw error;
      closeMdl('mdlBpFusion');
      Toast.success(`Fusionados: ${data.precios_movidos} precio${data.precios_movidos === 1 ? '' : 's'} y ${data.componentes_movidos} componente${data.componentes_movidos === 1 ? '' : 's'} pasaron a ${d.clave}.`);
      await cargar(true);
      if (est.resultados) await ejecutarBusqueda(); else if ($('bpLista')) pintarListaInsumos();
      abrirInsumo(d.id);
    } catch (e) { Toast.error(humanizeError(e, 'Fusionar')); btn.disabled = false; }
  }

  // ---- Ficha del insumo con historial (US-823) -------------------------------------------------------------------------
  let ficha = null; let grafica = null; let focoAntes = null;
  function cerrarInsumo() {
    const d = $('bpDrawer'); if (!d) return;
    d.classList.remove('ac'); d.setAttribute('aria-hidden', 'true'); $('bpDrawerBack').classList.remove('ac');
    if (grafica) { grafica.destroy(); grafica = null; }
    if (focoAntes && focoAntes.focus) try { focoAntes.focus(); } catch (e) { /* nada */ }
  }
  async function abrirInsumo(id) {
    asegurarModales();
    if (!$('bpDrawer').classList.contains('ac')) focoAntes = document.activeElement;
    $('bpDrawer').classList.add('ac'); $('bpDrawer').setAttribute('aria-hidden', 'false'); $('bpDrawerBack').classList.add('ac');
    $('bpDrawerCuerpo').innerHTML = Skeleton.table(4, 3);
    try {
      const [ins, res, pre, comp] = await Promise.all([
        sb.from('insumos').select('id,clave,descripcion,unidad,tipo,familia,activo,notas,compuesto').eq('id', id).single(),
        sb.from('insumos_resumen').select(COLUMNAS).eq('id', id).maybeSingle(),
        sb.from('insumo_precios').select('id,precio,fecha,plaza,fuente,licitacion_id,proveedor_id,gasto_id,datos,notas').eq('insumo_id', id).order('fecha', { ascending: false }).order('id', { ascending: false }).limit(500),
        sb.from('insumo_componentes').select('componente_id,cantidad,licitacion_id,orden').eq('insumo_id', id).order('orden'),
      ]);
      for (const r of [ins, res, pre, comp]) if (r.error) throw r.error;
      const licIds = [...new Set([...(pre.data || []).map((p) => p.licitacion_id), ...(comp.data || []).map((p) => p.licitacion_id)].filter(Boolean))];
      const compIds = [...new Set((comp.data || []).map((c) => c.componente_id))];
      const [lics, comps] = await Promise.all([
        licIds.length ? sb.from('licitaciones').select('id,codigo,nombre').in('id', licIds) : { data: [] },
        compIds.length ? sb.from('insumos_resumen').select('id,clave,descripcion,unidad,tipo,ultimo_precio').in('id', compIds) : { data: [] },
      ]);
      ficha = { insumo: ins.data, resumen: res.data || {}, precios: pre.data || [], componentes: comp.data || [],
        lics: Object.fromEntries((lics.data || []).map((l) => [l.id, l])), comps: Object.fromEntries((comps.data || []).map((c) => [c.id, c])) };
      if ($('bpDrawer').classList.contains('ac')) pintarFicha();
    } catch (e) { $('bpDrawerCuerpo').innerHTML = errorHtml(e); }
  }
  function origenPrecio(p) {
    const partes = [];
    if (p.licitacion_id) { const l = ficha.lics[p.licitacion_id]; partes.push(l ? `Licitación ${S(l.codigo)}` : 'Licitación'); }
    if (p.proveedor_id) partes.push(S(proveedorNombre(p.proveedor_id) || 'Proveedor'));
    if (p.gasto_id) partes.push(`Gasto #${p.gasto_id}`);
    if (!partes.length && p.datos && p.datos.proyecto) partes.push(S(p.datos.proyecto));
    if (!partes.length && p.datos && p.datos.grupo) partes.push(S(p.datos.grupo));
    return partes.join(' · ') || '—';
  }
  function pintarFicha() {
    const { insumo: i, resumen: r, precios } = ficha;
    const hoy = hoyMx();
    $('bpDrawerTitulo').textContent = i.clave;
    const ult = precios[0];
    const viejo = ult && esViejo(ult.fecha, hoy);
    const va = variacionAnual(precios);
    const kpi = (v, l) => `<div class="kpi"><div class="kpi-v">${v}</div><div class="kpi-l">${l}</div></div>`;
    const datosMo = (p) => (p.datos && (p.datos.salario_base || p.datos.fsr) ? `<span class="block text-xs text-ink-muted">SB ${num(p.datos.salario_base)} · FSR ${num(p.datos.fsr, 5)}</span>` : '');
    const filasPre = precios.map((p) => `<tr><td data-et="Fecha">${S(fechaCorta(p.fecha))}</td><td data-et="Plaza">${S(PLAZAS[p.plaza] || p.plaza)}</td><td data-et="Fuente"><span class="chip ${p.fuente === 'compra' ? 'chip-obra' : 'chip-ind'}">${S(FUENTES[p.fuente] || p.fuente)}</span></td><td data-et="Precio" class="text-right">${F(p.precio)}${datosMo(p)}</td><td data-et="Origen">${origenPrecio(p)}${p.notas ? `<span class="block text-xs text-ink-muted">${S(p.notas)}</span>` : ''}</td></tr>`).join('');
    const compHtml = i.compuesto ? `<h3 class="font-bold mt-5 mb-2">Su matriz</h3>${ficha.componentes.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Componentes del insumo compuesto"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Insumo</th><th scope="col" class="text-right">Cantidad</th><th scope="col" class="text-right">Precio</th></tr></thead><tbody>${ficha.componentes.map((c) => { const x = ficha.comps[c.componente_id] || {}; return `<tr><td data-et="Insumo"><span class="font-mono text-xs">${S(x.clave || '')}</span> ${S(x.descripcion || '')}</td><td data-et="Cantidad" class="text-right">${num(c.cantidad, 4)} ${S(x.unidad || '')}</td><td data-et="Precio" class="text-right">${x.ultimo_precio != null ? F(x.ultimo_precio) : '—'}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="text-sm text-ink-muted">Sin componentes cargados.</p>'}<p class="text-xs text-ink-muted mt-1">Es una cuadrilla o un auxiliar: su precio sale de su matriz, no de una cotización.</p>` : '';
    $('bpDrawerCuerpo').innerHTML = `<p class="text-sm">${S(i.descripcion)}</p>
<p class="text-xs text-ink-muted mt-1">${S(TIPOS[i.tipo] || i.tipo)} · ${S(i.unidad)}${i.familia ? ' · ' + S(i.familia) : ''}${i.activo === false ? ' · Inactivo' : ''}</p>
<div class="flex flex-wrap gap-2 mt-3"><button type="button" class="btn btn-s text-xs" onclick="BancoPrecios.editarInsumo(${i.id})"><i class="ri-edit-line" aria-hidden="true"></i> Editar insumo</button><button type="button" class="btn btn-s text-xs" onclick="BancoPrecios.abrirFusion(${i.id})"><i class="ri-git-merge-line" aria-hidden="true"></i> Fusionar con otro</button><button type="button" class="btn btn-p text-xs" onclick="BancoPrecios.mostrarCaptura()"><i class="ri-add-line" aria-hidden="true"></i> Registrar precio</button></div>
${viejo ? `<div class="g rounded-xl p-3 mt-3 text-sm bp-aviso" role="status"><i class="ri-time-line" aria-hidden="true"></i> El último precio es del ${S(fechaCorta(ult.fecha))} (${antiguedadDias(ult.fecha, hoy)} días). Es un precio viejo: cotízalo de nuevo antes de usarlo en una propuesta.</div>` : ''}
<div id="bpCaptura" hidden></div>
<div class="kpi-strip mt-4">${kpi(ult ? F(ult.precio) : '—', ult ? `Último · ${S(fechaCorta(ult.fecha))} · ${S(PLAZAS[ult.plaza] || ult.plaza)}` : 'Último')}${kpi(r.mediana != null ? F(r.mediana) : '—', 'Mediana')}${kpi(r.minimo != null ? F(r.minimo) : '—', 'Mínimo')}${kpi(r.maximo != null ? F(r.maximo) : '—', 'Máximo')}${kpi(va ? pct(va.pct) : '—', va ? `Variación anual (desde ${S(fechaCorta(va.desde))})` : 'Variación anual (sin un año de historia)')}${kpi(pct(r.variacion_pct), 'Contra el precio anterior')}</div>
${precios.length ? `<div class="g rounded-xl p-3 mt-2"><div style="position:relative;height:220px"><canvas id="bpGrafica" role="img" aria-label="Precio de ${S(i.clave)} en el tiempo, una serie por plaza"></canvas></div><p class="text-xs text-ink-muted mt-2"><i class="ri-checkbox-blank-circle-fill" aria-hidden="true"></i> Propuesta, cotización o referencia · <i class="ri-triangle-fill" aria-hidden="true"></i> Compra con factura</p></div>` : ''}
<h3 class="font-bold mt-5 mb-2">Muestras <span class="text-ink-muted font-normal">(${precios.length})</span></h3>
${precios.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Precios registrados del insumo"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Fecha</th><th scope="col">Plaza</th><th scope="col">Fuente</th><th scope="col" class="text-right">Precio</th><th scope="col">Origen</th></tr></thead><tbody>${filasPre}</tbody></table></div>` : `<p class="text-sm text-ink-muted">${i.compuesto ? 'Sin precios propios.' : 'Todavía no tiene precios. Registra una cotización.'}</p>`}
${compHtml}`;
    if (precios.length) pintarGrafica();
  }
  function colorToken(nombre, defecto) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || defecto; } catch (e) { return defecto; }
  }
  function pintarGrafica() {
    const cv = $('bpGrafica'); if (!cv || typeof Chart === 'undefined') return;
    if (grafica) { grafica.destroy(); grafica = null; }
    const series = seriesPorPlaza(ficha.precios);
    const colores = { cuauhtemoc: '--accent-fill', chihuahua: '--ok', juarez: '--violet', parral: '--warn', casas_grandes: '--info', otra: '--ink-muted' };
    const ms = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
    const datasets = Object.entries(series).map(([plaza, pts]) => {
      const c = colorToken(colores[plaza] || '--ink-muted', '#475569');
      return { label: PLAZAS[plaza] || plaza, data: pts.map((p) => ({ x: ms(p.fecha), y: p.precio, fuente: p.fuente })),
        borderColor: c, backgroundColor: c, pointStyle: pts.map((p) => (p.grupo === 'compra' ? 'triangle' : 'circle')),
        pointRadius: pts.map((p) => (p.grupo === 'compra' ? 6 : 4)), tension: 0, spanGaps: true };
    });
    grafica = new Chart(cv.getContext('2d'), {
      type: 'line', data: { datasets },
      options: { responsive: true, maintainAspectRatio: false, animation: false, parsing: true,
        scales: { x: { type: 'linear', ticks: { maxTicksLimit: 6, callback: (v) => { const d = new Date(v); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}`; } } },
          y: { ticks: { callback: (v) => '$' + Number(v).toLocaleString('es-MX') } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } },
          tooltip: { callbacks: { title: (it) => { const d = new Date(it[0].parsed.x); return d.toISOString().slice(0, 10); },
            label: (it) => `${it.dataset.label} · ${FUENTES[it.raw.fuente] || it.raw.fuente}: ${F(it.parsed.y)}` } } } },
    });
  }
  function mostrarCaptura() {
    const el = $('bpCaptura'); if (!el || !ficha) return;
    const hoy = hoyMx();
    const provs = (D.pv || []).slice().sort((a, b) => String(a.nombre_proveedor || '').localeCompare(String(b.nombre_proveedor || '')));
    el.hidden = false;
    el.innerHTML = `<form class="g rounded-xl p-3 mt-3 grid grid-cols-2 gap-3" onsubmit="event.preventDefault();BancoPrecios.guardarPrecio()" aria-label="Registrar precio">
<p class="col-span-2 font-bold text-sm">Registrar precio de ${S(ficha.insumo.clave)} <span class="font-normal text-ink-muted">(sin IVA, por ${S(ficha.insumo.unidad)})</span></p>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Precio sin IVA *</span><input id="bpPreMonto" type="number" min="0" step="0.01" class="inp w-full" required inputmode="decimal"></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Fecha *</span><input id="bpPreFecha" type="date" class="inp w-full" value="${hoy}" max="${hoy}" required></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Plaza *</span><select id="bpPrePlaza" class="inp w-full">${plazaOpts(est.plaza || 'cuauhtemoc')}</select></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Fuente</span><select id="bpPreFuente" class="inp w-full"><option value="cotizacion">Cotización</option><option value="manual">Manual</option></select></label>
<label class="col-span-2"><span class="text-xs mb-1 block">Proveedor</span><select id="bpPreProv" class="inp w-full"><option value="">Sin proveedor</option>${provs.map((p) => `<option value="${p.id}">${S(p.nombre_proveedor || p.nombre || '')}</option>`).join('')}</select></label>
<label class="col-span-2"><span class="text-xs mb-1 block">Nota</span><input id="bpPreNota" class="inp w-full" maxlength="300" placeholder="Por ejemplo: cotización por WhatsApp, vigencia 15 días"></label>
<div class="col-span-2 flex gap-2 justify-end"><button type="button" class="btn btn-s" onclick="BancoPrecios.ocultarCaptura()">Cancelar</button><button type="submit" class="btn btn-p" id="bpPreGuardar"><i class="ri-save-line" aria-hidden="true"></i> Guardar precio</button></div></form>`;
    setTimeout(() => $('bpPreMonto').focus(), 30);
  }
  function ocultarCaptura() { const el = $('bpCaptura'); if (el) { el.hidden = true; el.innerHTML = ''; } }
  async function guardarPrecio() {
    const precio = parseFloat($('bpPreMonto').value);
    if (!(precio >= 0)) { Toast.warning('Captura un precio válido (sin IVA).'); return; }
    const fila = { insumo_id: ficha.insumo.id, precio, fecha: $('bpPreFecha').value, plaza: $('bpPrePlaza').value, fuente: $('bpPreFuente').value,
      proveedor_id: parseInt($('bpPreProv').value, 10) || null, notas: $('bpPreNota').value.trim() || null };
    if (!fila.fecha) { Toast.warning('Falta la fecha del precio.'); return; }
    const btn = $('bpPreGuardar'); btn.disabled = true;
    try {
      const { error } = await sb.from('insumo_precios').insert(fila);
      if (error) throw error;
      Toast.success('Precio registrado.');
      await cargar(true);
      if (est.resultados) await ejecutarBusqueda(); else if ($('bpLista')) pintarListaInsumos();
      abrirInsumo(fila.insumo_id);
    } catch (e) {
      Toast.error(e && e.code === '23505' ? 'Ya hay un precio de ese día, plaza y fuente para este insumo. Cambia la fecha o la fuente.' : humanizeError(e, 'Precio'));
      btn.disabled = false;
    }
  }

  // ---- Importar de OPUS (US-825) -------------------------------------------------------------------------------------
  const imp = { doc: null, archivo: '', conc: null, decisiones: {}, lics: [], resumen: null, ocupado: false };
  async function todosLosInsumos() {
    const out = [];
    for (let desde = 0; desde < LIMITE_TOTAL; desde += 1000) {
      const { data, error } = await sb.from('insumos').select('id,clave,descripcion,unidad,tipo').order('id').range(desde, desde + 999);
      if (error) throw error;
      out.push(...(data || [])); if (!data || data.length < 1000) break;
    }
    return out;
  }
  VISTAS.importar = (el) => {
    el.innerHTML = `<div class="g rounded-xl p-4">
<h2 class="font-bold mb-1">Importar los insumos de un proyecto de OPUS</h2>
<p class="text-sm text-ink-muted mb-3">Sube el JSON <span class="font-mono">opus-insumos/v1</span> que exporta el bridge (o, como respaldo, el Excel de explosión de insumos de OPUS). El banco aprende un precio por insumo con la fecha de la propuesta, su plaza y la licitación; con el JSON también guarda los conceptos con su PU y su matriz. Reimportar no duplica.</p>
<label class="block"><span class="text-xs mb-1 block">Archivo</span><input id="bpImpArchivo" type="file" accept=".json,.xlsx,.xls,.csv,application/json" class="inp w-full" onchange="BancoPrecios.leerArchivo(this.files[0])"></label>
<div id="bpImpPaso" class="mt-4"></div></div>`;
    if (imp.doc) pintarImportacion();
  };
  async function leerArchivo(file) {
    if (!file) return;
    imp.resumen = null; imp.conc = null; imp.decisiones = {};
    try {
      if (/\.json$/i.test(file.name) || file.type === 'application/json') imp.doc = leerOpusInsumos(await file.text());
      else {
        if (typeof XLSX === 'undefined') throw new Error('No cargó el lector de Excel. Recarga la página.');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
        imp.doc = excelAOpusInsumos(filas, file.name);
      }
      imp.archivo = file.name;
      const [ins, lics, maps] = await Promise.all([todosLosInsumos(), sb.from('licitaciones').select('id,codigo,nombre,plaza,presentacion,estatus').order('created_at', { ascending: false }).limit(300),
        sb.from('banco_importaciones').select('mapa,updated_at').order('updated_at')]);
      if (lics.error) throw lics.error;
      imp.lics = lics.data || [];
      imp.conc = conciliarInsumos(imp.doc.recursos, ins, { alias: aliasDeImportaciones(maps.data) });
      for (const p of imp.conc.parecido) imp.decisiones[String(p.recurso.clave).trim().toLowerCase()] = 'nuevo';
      pintarImportacion();
    } catch (e) {
      imp.doc = null;
      const el = $('bpImpPaso'); if (el) el.innerHTML = `<div class="g rounded-xl p-3 bp-aviso" role="alert"><i class="ri-error-warning-line" aria-hidden="true"></i> ${S(e.message || humanizeError(e))}</div>`;
    }
  }
  function licSugerida() {
    const nc = normalizarTexto(imp.doc.proyecto && (imp.doc.proyecto.numero_concurso || imp.doc.proyecto.nombre));
    return imp.lics.find((l) => nc && (nc.includes(normalizarTexto(l.codigo)) || normalizarTexto(l.codigo).includes(nc)));
  }
  function pintarImportacion() {
    const el = $('bpImpPaso'); if (!el || !imp.doc) return;
    const d = imp.doc; const c = imp.conc; const sug = licSugerida();
    const fecha = fechaPropuesta(d) || hoyMx();
    const res = d.resumen || {};
    const fila = (r, extra) => `<tr><td data-et="Clave" class="font-mono text-xs">${S(r.clave)}</td><td data-et="Descripción">${S(r.descripcion || '')}</td><td data-et="Unidad">${S(r.unidad || '')}</td><td data-et="Tipo">${S(TIPOS[r.tipo] || r.tipo)}</td><td data-et="Precio" class="text-right">${r.tiene_matriz ? '<span class="text-ink-muted">De su matriz</span>' : (typeof r.precio === 'number' ? F(r.precio) : '—')}</td>${extra || ''}</tr>`;
    const tabla = (filas, cab, aria) => `<div class="table-wrap mt-2" tabindex="0" role="region" aria-label="${aria}"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Clave</th><th scope="col">Descripción</th><th scope="col">Unidad</th><th scope="col">Tipo</th><th scope="col" class="text-right">Precio</th>${cab || ''}</tr></thead><tbody>${filas}</tbody></table></div>`;
    const parecidos = c.parecido.map((p) => {
      const k = String(p.recurso.clave).trim().toLowerCase(); const v = imp.decisiones[k];
      const opciones = p.candidatos.map((x) => `<label class="flex items-start gap-2 text-xs"><input type="radio" name="bpPar-${S(k)}" value="${x.insumo.id}"${String(v) === String(x.insumo.id) ? ' checked' : ''} onchange="BancoPrecios.decidir('${S(k).replace(/'/g, "\\'")}', ${x.insumo.id})"> <span>Es el mismo que <span class="font-mono">${S(x.insumo.clave)}</span> · ${S(x.insumo.descripcion)} · ${S(x.insumo.unidad)} <span class="text-ink-muted">(${Math.round(x.puntaje * 100)} %)</span></span></label>`).join('');
      return fila(p.recurso, `<td data-et="Decisión"><div class="flex flex-col gap-1">${opciones}<label class="flex items-center gap-2 text-xs"><input type="radio" name="bpPar-${S(k)}" value="nuevo"${v === 'nuevo' || v === undefined ? ' checked' : ''} onchange="BancoPrecios.decidir('${S(k).replace(/'/g, "\\'")}', 'nuevo')"> Es un insumo nuevo</label></div></td>`);
    }).join('');
    const avisos = c.coincide.filter((x) => x.aviso).length;
    el.innerHTML = `<div class="kpi-strip"><div class="kpi"><div class="kpi-v">${S(d.proyecto && d.proyecto.nombre || imp.archivo)}</div><div class="kpi-l">${S(imp.archivo)}</div></div>
<div class="kpi"><div class="kpi-v">${d.recursos.length}</div><div class="kpi-l">Recursos</div></div><div class="kpi"><div class="kpi-v">${d.conceptos.length}</div><div class="kpi-l">Conceptos${res.conceptos_con_matriz !== undefined ? ` (${res.conceptos_con_matriz} con matriz)` : ''}</div></div><div class="kpi"><div class="kpi-v">${d.componentes.length}</div><div class="kpi-l">Componentes</div></div></div>
<div class="grid grid-cols-1 md:grid-cols-4 gap-3 mt-2">
<label class="md:col-span-2"><span class="text-xs mb-1 block">Licitación *</span><select id="bpImpLic" class="inp w-full" onchange="BancoPrecios.cambiarLic(this.value)"><option value="nueva">Crear una licitación nueva</option>${imp.lics.map((l) => `<option value="${l.id}"${sug && sug.id === l.id ? ' selected' : ''}>${S(l.codigo)} · ${S(l.nombre)}</option>`).join('')}</select></label>
<label><span class="text-xs mb-1 block">Plaza *</span><select id="bpImpPlaza" class="inp w-full">${plazaOpts((sug && sug.plaza) || plazaSugerida(d))}</select></label>
<label><span class="text-xs mb-1 block">Fecha de la propuesta *</span><input id="bpImpFecha" type="date" class="inp w-full" value="${S(fecha)}"></label></div>
<div id="bpImpNueva" class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3"${sug ? ' hidden' : ''}>
<label><span class="text-xs mb-1 block">Código de la licitación *</span><input id="bpImpCodigo" class="inp w-full" maxlength="80" value="${S((d.proyecto && (d.proyecto.numero_concurso || d.proyecto.nombre)) || '')}"></label>
<label><span class="text-xs mb-1 block">Nombre *</span><input id="bpImpNombre" class="inp w-full" maxlength="300" value="${S((d.proyecto && (d.proyecto.descripcion || d.proyecto.nombre)) || '')}"></label>
<p class="md:col-span-2 text-xs text-ink-muted">Se crea con estatus «Presentada» y la fecha de la propuesta como presentación; complétala después en Licitaciones.</p></div>
<h3 class="font-bold mt-5">Conciliación</h3>
<p class="text-sm text-ink-muted">Coinciden por clave, unidad y tipo: <b>${c.coincide.length}</b>${avisos ? ` (${avisos} con descripción distinta: revísalos)` : ''} · Parecidos a revisar: <b>${c.parecido.length}</b> · Nuevos: <b>${c.nuevo.length}</b>${c.omitidos.length ? ` · Omitidos: <b>${c.omitidos.length}</b>` : ''}</p>
${c.parecido.length ? `<div class="g rounded-xl p-3 mt-3"><div class="flex flex-wrap items-center justify-between gap-2"><p class="font-bold text-sm">Parecidos por descripción (${c.parecido.length}): confirma uno por uno o en lote</p><div class="flex gap-2"><button type="button" class="btn btn-s text-xs" onclick="BancoPrecios.decidirTodos('mismo')"><i class="ri-check-double-line" aria-hidden="true"></i> Aceptar todos los más parecidos</button><button type="button" class="btn btn-s text-xs" onclick="BancoPrecios.decidirTodos('nuevo')">Todos como nuevos</button></div></div>${tabla(parecidos, '<th scope="col">Decisión</th>', 'Insumos parecidos a revisar')}</div>` : ''}
<details class="mt-3"><summary class="cursor-pointer text-sm font-bold">Coinciden (${c.coincide.length})</summary>${c.coincide.length ? tabla(c.coincide.map((x) => fila(x.recurso, `<td data-et="En el banco">${S(x.insumo.clave)} · ${S(x.insumo.descripcion)}${x.aviso ? ' <span class="chip chip-ind">Descripción distinta</span>' : ''}</td>`)).join(''), '<th scope="col">En el banco</th>', 'Insumos que coinciden') : '<p class="text-sm text-ink-muted mt-2">Ninguno.</p>'}</details>
<details class="mt-2"><summary class="cursor-pointer text-sm font-bold">Nuevos (${c.nuevo.length})</summary>${c.nuevo.length ? tabla(c.nuevo.map((x) => fila(x.recurso)).join(''), '', 'Insumos nuevos') : '<p class="text-sm text-ink-muted mt-2">Ninguno.</p>'}</details>
<div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-s" onclick="BancoPrecios.cancelarImportacion()">Cancelar</button><button type="button" id="bpImpOk" class="btn btn-p" onclick="BancoPrecios.importar()"><i class="ri-upload-cloud-2-line" aria-hidden="true"></i> Importar al banco</button></div>
<div id="bpImpResultado" class="mt-3" aria-live="polite"></div>`;
  }
  function cambiarLic(v) {
    const nueva = v === 'nueva'; $('bpImpNueva').hidden = !nueva;
    const l = imp.lics.find((x) => String(x.id) === String(v));
    if (l && l.plaza) $('bpImpPlaza').value = l.plaza;
    if (l && l.presentacion && !fechaPropuesta(imp.doc)) $('bpImpFecha').value = String(l.presentacion).slice(0, 10);
  }
  function decidir(k, v) { imp.decisiones[k] = v; }
  function decidirTodos(modo) {
    for (const p of imp.conc.parecido) imp.decisiones[String(p.recurso.clave).trim().toLowerCase()] = modo === 'mismo' ? p.candidato.id : 'nuevo';
    const lic = $('bpImpLic').value; const plaza = $('bpImpPlaza').value; const fecha = $('bpImpFecha').value;
    pintarImportacion(); $('bpImpLic').value = lic; cambiarLic(lic); $('bpImpPlaza').value = plaza; $('bpImpFecha').value = fecha;
  }
  function cancelarImportacion() { imp.doc = null; imp.conc = null; imp.resumen = null; irA('importar'); }
  async function importar() {
    if (!imp.doc || imp.ocupado) return;
    const plaza = $('bpImpPlaza').value; const fecha = $('bpImpFecha').value; let lic = $('bpImpLic').value;
    if (!fecha) { Toast.warning('Falta la fecha de la propuesta.'); return; }
    const btn = $('bpImpOk'); btn.disabled = true; imp.ocupado = true;
    try {
      if (lic === 'nueva') {
        const codigo = $('bpImpCodigo').value.trim(); const nombre = $('bpImpNombre').value.trim();
        if (!codigo || !nombre) { Toast.warning('Captura el código y el nombre de la licitación.'); return; }
        const { data, error } = await sb.from('licitaciones').insert({ codigo, nombre, plaza, estatus: 'presentada', presentacion: `${fecha}T12:00:00-06:00`,
          opus_proyecto: (imp.doc.proyecto && imp.doc.proyecto.nombre) || null, monto_propuesto: imp.doc.proyecto && imp.doc.proyecto.importe_total > 0 ? imp.doc.proyecto.importe_total : null }).select('id').single();
        if (error) throw error;
        lic = data.id;
      }
      const mapa = mapaImportacion(imp.conc, imp.decisiones);
      const { data, error } = await sb.rpc('importar_opus_insumos', { p_licitacion_id: Number(lic), p_plaza: plaza, p_fecha: fecha, p_doc: imp.doc, p_mapa: mapa, p_archivo: imp.archivo });
      if (error) throw error;
      imp.resumen = data;
      if (typeof Telemetry !== 'undefined') Telemetry.track('banco_importacion', { recursos: data.recursos, conceptos: data.conceptos, nuevos: data.insumos_nuevos });
      $('bpImpResultado').innerHTML = `<div class="g rounded-xl p-3 text-sm" role="status"><p class="font-bold"><i class="ri-checkbox-circle-line" aria-hidden="true"></i> Importado: ${S(data.proyecto || '')}</p>
<p class="mt-1">${data.recursos_importados} recursos (${data.insumos_nuevos} nuevos, ${data.insumos_existentes} ya estaban) · ${data.precios} precios · ${data.conceptos} conceptos (${data.conceptos_nuevos} nuevos, ${data.conceptos_con_pu} con PU) · ${data.componentes} componentes${data.componentes_auxiliares ? ` y ${data.componentes_auxiliares} de cuadrillas o auxiliares` : ''}.</p>
${(data.sin_precio || []).length ? `<p class="text-xs text-ink-muted mt-1">Sin precio guardado: ${(data.sin_precio || []).map((x) => `${S(x.clave)} (${x.motivo === 'compuesto' ? 'sale de su matriz' : x.motivo === 'herramienta_pct_mo' ? '% de la mano de obra' : 'precio cero en OPUS'})`).join(', ')}.</p>` : ''}</div>`;
      Toast.success('Insumos importados al banco.');
      await cargar(true);
    } catch (e) { Toast.error(e && e.code === '23505' ? 'Ya existe una licitación con ese código: elígela de la lista.' : humanizeError(e, 'Importar')); }
    finally { btn.disabled = false; imp.ocupado = false; }
  }

  // ---- Mano de obra: calculadora de FSR (US-831) -----------------------------------------------------------------------
  const mo = { params: null, anio: null, p: null };
  VISTAS.mano_obra = async (el) => {
    el.innerHTML = Skeleton.table(4, 3);
    const { data, error } = await sb.from('parametros_laborales').select('*').order('anio', { ascending: false });
    if (error) throw error;
    mo.params = data || [];
    const actual = Number(hoyMx().slice(0, 4));
    mo.p = parametrosDelAnio(mo.params, actual);
    const respaldo = mo.p || (mo.params[0] || null);
    mo.anio = respaldo ? respaldo.anio : null;
    const mos = (D.ins.filas || []).filter((i) => i.tipo === 'mano_obra' && !i.compuesto);
    const aviso = !mo.p ? `<div class="g rounded-xl p-3 mb-3 text-sm bp-aviso" role="alert"><i class="ri-error-warning-line" aria-hidden="true"></i> No están capturados los parámetros laborales de ${actual} (UMA, salario mínimo, riesgo, ISN, cesantía y vejez).${respaldo ? ` El cálculo usa los de ${respaldo.anio}: revisa antes de guardar.` : ' No se puede calcular el FSR.'}</div>` : '';
    if (!respaldo) { el.innerHTML = aviso; return; }
    if (!mo.p) mo.p = respaldo;
    const p = mo.p;
    el.innerHTML = `${aviso}<div class="grid grid-cols-1 lg:grid-cols-2 gap-4"><form class="g rounded-xl p-4 grid grid-cols-2 gap-3 content-start" onsubmit="event.preventDefault();BancoPrecios.guardarFsr()" aria-label="Calculadora de factor de salario real">
<p class="col-span-2 font-bold">Factor de salario real ${S(p.anio)}</p>
<p class="col-span-2 text-xs text-ink-muted">Método del Anexo 2 del IIPU: cuota fija sobre UMA, excedente de 3 UMA, tasas fijas, cesantía y vejez escalonada por SBC e ISN. UMA ${num(p.uma)} · riesgo ${num(p.riesgo_trabajo_pct, 5)} % · ISN ${num(p.isn_pct)} % · Tp/Tl ${num(p.datos && p.datos.tp)}/${num(p.datos && p.datos.tl)}${p.es_fabrica ? ' · parámetros de fábrica' : ''}.</p>
<label class="col-span-2"><span class="text-xs mb-1 block">Categoría *</span><select id="bpMoIns" class="inp w-full" onchange="BancoPrecios.elegirCategoria(this.value)"><option value="">Nueva categoría</option>${mos.map((i) => `<option value="${i.id}">${S(i.clave)} · ${S(i.descripcion)}</option>`).join('')}</select></label>
<div id="bpMoNueva" class="col-span-2 grid grid-cols-2 gap-3"><label><span class="text-xs mb-1 block">Clave *</span><input id="bpMoClave" class="inp w-full" maxlength="60" placeholder="MO-…"></label><label><span class="text-xs mb-1 block">Descripción *</span><input id="bpMoDesc" class="inp w-full" maxlength="200" placeholder="Oficial albañil"></label></div>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Salario base por jornada *</span><input id="bpMoSb" type="number" min="1" step="0.01" class="inp w-full" inputmode="decimal" oninput="BancoPrecios.calcularDesglose()" required></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Plaza *</span><select id="bpMoPlaza" class="inp w-full">${plazaOpts('cuauhtemoc')}</select></label>
<label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Fecha *</span><input id="bpMoFecha" type="date" class="inp w-full" value="${hoyMx()}" required></label>
<div class="col-span-2 sm:col-span-1 flex items-end"><button type="submit" class="btn btn-p w-full" id="bpMoGuardar" disabled><i class="ri-save-line" aria-hidden="true"></i> Guardar precio</button></div>
</form><div class="g rounded-xl p-4" id="bpMoDesglose" aria-live="polite"><p class="text-sm text-ink-muted">Captura el salario base para ver el desglose.</p></div></div>`;
  };
  function elegirCategoria(id) { $('bpMoNueva').hidden = !!filaPorId(Number(id)); }
  function calcularDesglose() {
    const r = calcularFSR(parseFloat($('bpMoSb').value), mo.p);
    const el = $('bpMoDesglose'); $('bpMoGuardar').disabled = !r;
    if (!r) { el.innerHTML = '<p class="text-sm text-ink-muted">Captura el salario base para ver el desglose.</p>'; return; }
    const et = { cuota_fija: `Cuota fija (${num(mo.p.datos.cuota_fija_pct)} % de la UMA)`, excedente: `Excedente de 3 UMA (${num(mo.p.datos.excedente_pct)} %)`,
      prestaciones_dinero: 'Prestaciones en dinero', gastos_medicos: 'Gastos médicos de pensionados', riesgo_trabajo: 'Riesgo de trabajo',
      invalidez_vida: 'Invalidez y vida', guarderias: 'Guarderías', retiro: 'Retiro (SAR)', cesantia_vejez: 'Cesantía y vejez', infonavit: 'INFONAVIT' };
    const fila = (a, b, c) => `<tr><td data-et="Concepto">${a}</td><td data-et="Tasa" class="text-right">${b}</td><td data-et="Por jornada" class="text-right">${c}</td></tr>`;
    el.innerHTML = `<div class="kpi-strip"><div class="kpi"><div class="kpi-v">${num(r.fsr, 5)}</div><div class="kpi-l">FSR con ISN</div></div><div class="kpi"><div class="kpi-v">${F(r.costo_jornada)}</div><div class="kpi-l">Costo por jornada</div></div><div class="kpi"><div class="kpi-v">${F(r.sbc)}</div><div class="kpi-l">SBC (${num(r.sbc_uma, 2)} UMA)</div></div></div>
<div class="table-wrap" tabindex="0" role="region" aria-label="Desglose del factor de salario real"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Concepto</th><th scope="col" class="text-right">Tasa</th><th scope="col" class="text-right">Por jornada</th></tr></thead><tbody>
${fila('Factor de salario base (aguinaldo y prima vacacional)', num(r.fsb, 6), F(r.sbc))}
${Object.entries(r.cuotas).map(([k, v]) => fila(S(et[k] || k), r.tasas[k] !== undefined ? `${num(r.tasas[k], 3)} %` : '', F(v))).join('')}
${fila('<b>Cuotas patronales</b>', `Ps ${num(r.ps, 6)}`, `<b>${F(r.total_cuotas)}</b>`)}
${fila('Días pagados entre días laborados (Tp/Tl)', `${num(r.tp)}/${num(r.tl)}`, num(r.tp_tl, 6))}
${fila('FSR sin ISN', '', num(r.fsr_sin_isn, 5))}
${fila(`Impuesto sobre nómina`, `${num(r.isn_pct)} %`, '')}
${fila('<b>FSR</b>', '', `<b>${num(r.fsr, 5)}</b>`)}</tbody></table></div>`;
  }
  async function guardarFsr() {
    const r = calcularFSR(parseFloat($('bpMoSb').value), mo.p); if (!r) return;
    const btn = $('bpMoGuardar'); btn.disabled = true;
    try {
      let id = parseInt($('bpMoIns').value, 10) || null;
      if (!id) {
        const clave = $('bpMoClave').value.trim(); const descripcion = $('bpMoDesc').value.trim();
        if (!clave || !descripcion) { Toast.warning('Captura la clave y la descripción de la categoría.'); return; }
        const { data, error } = await sb.from('insumos').insert({ clave, descripcion, unidad: 'JOR', tipo: 'mano_obra', familia: `Tabulador ${r.anio}` }).select('id').single();
        if (error) throw error; id = data.id;
      }
      const fila = { insumo_id: id, precio: r.costo_jornada, fecha: $('bpMoFecha').value, plaza: $('bpMoPlaza').value, fuente: 'manual', licitacion_id: null,
        datos: { salario_base: r.salario_base, sbc: r.sbc, fsr: r.fsr, fsr_sin_isn: r.fsr_sin_isn, costo_jornada: r.costo_jornada, ps: r.ps, cesantia_pct: r.cesantia_pct, anio: r.anio, metodo: 'anexo2_iipu' },
        notas: `FSR ${r.fsr} con parámetros ${r.anio}` };
      const { error } = await sb.from('insumo_precios').upsert(fila, { onConflict: 'insumo_id,fecha,plaza,fuente,licitacion_id' });
      if (error) throw error;
      Toast.success(`Precio guardado: ${F(r.costo_jornada)} por jornada.`);
      await cargar(true);
      abrirInsumo(id);
    } catch (e) { Toast.error(e && e.code === '23505' ? 'Ya existe una categoría con esa clave. Elígela de la lista.' : humanizeError(e, 'Mano de obra')); }
    finally { btn.disabled = false; }
  }

  // ---- Por clasificar: precios de compra desde las facturas (US-832) --------------------------------------------------
  const cla = { filas: [], ins: {}, actual: null, modo: null, lista: [], destino: null };
  const plazaCompra = () => { try { return localStorage.getItem('bp_plaza_compra') || 'cuauhtemoc'; } catch (e) { return 'cuauhtemoc'; } };
  const MDL_SUG = `<div id="mdlBpSug" class="modal"><div class="modal-content g rounded-2xl p-6 w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="bpSugTitulo">
<div class="flex items-start justify-between gap-3 mb-2"><div><h3 id="bpSugTitulo" class="font-bold">Ligar a un insumo</h3><p id="bpSugConcepto" class="text-xs text-ink-muted"></p></div><button type="button" class="btn-icon" onclick="closeMdl('mdlBpSug')" aria-label="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></div>
<div id="bpSugLigar"><label class="block mb-2"><span class="sr-only">Buscar insumo</span><input id="bpSugBuscar" type="search" class="inp w-full" placeholder="Buscar insumo por clave o descripción" oninput="BancoPrecios.buscarParaSug(this.value)" autocomplete="off"></label><div id="bpSugLista" class="max-h-64 overflow-y-auto" role="radiogroup" aria-label="Insumo al que corresponde"></div></div>
<div id="bpSugCrear" class="grid grid-cols-2 gap-3" hidden><label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Clave *</span><input id="bpSugClave" class="inp w-full" maxlength="60"></label><label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Tipo *</span><select id="bpSugTipo" class="inp w-full">${Object.entries({ material: 'Material', mano_obra: 'Mano de obra', equipo: 'Equipo', herramienta: 'Herramienta', auxiliar: 'Auxiliar', flete: 'Flete' }).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label><label class="col-span-2"><span class="text-xs mb-1 block">Descripción *</span><input id="bpSugDesc" class="inp w-full" maxlength="400"></label><label class="col-span-2 sm:col-span-1"><span class="text-xs mb-1 block">Unidad *</span><input id="bpSugUnidad" class="inp w-full" maxlength="20"></label></div>
<div class="grid grid-cols-2 gap-3 mt-3"><label><span class="text-xs mb-1 block">Factor de unidad</span><input id="bpSugFactor" type="number" min="0.0001" step="any" value="1" class="inp w-full" inputmode="decimal"></label><p class="text-xs text-ink-muted self-end">Si la factura cobra por caja de 10 y el insumo es por pieza, pon 10: el precio se divide entre el factor.</p></div>
<label class="flex items-center gap-2 text-sm mt-3"><input type="checkbox" id="bpSugRecordar" class="w-4 h-4 rounded" checked> Recordar esta decisión para este proveedor y esta descripción</label>
<div class="flex gap-2 justify-end mt-4"><button type="button" class="btn btn-s" onclick="closeMdl('mdlBpSug')">Cancelar</button><button type="button" class="btn btn-p" id="bpSugOk" onclick="BancoPrecios.confirmarSug()"><i class="ri-check-line" aria-hidden="true"></i> Guardar precio de compra</button></div></div></div>`;
  VISTAS.clasificar = async (el) => {
    el.innerHTML = Skeleton.table(4, 4);
    const { data, error } = await sb.from('insumo_sugerencias').select('*').eq('estado', 'pendiente').order('fecha', { ascending: false }).order('id').limit(300);
    if (error) throw error;
    cla.filas = data || [];
    const ids = [...new Set(cla.filas.map((s) => s.insumo_id).filter(Boolean))];
    const { data: ins } = ids.length ? await sb.from('insumos').select('id,clave,descripcion,unidad,tipo').in('id', ids) : { data: [] };
    cla.ins = Object.fromEntries((ins || []).map((i) => [i.id, i]));
    pintarBandeja();
  };
  function pintarBandeja() {
    const el = $('bpCuerpo'); if (!el) return;
    const n = $('bpNClasificar'); if (n) { n.textContent = String(cla.filas.length); n.hidden = !cla.filas.length; }
    const sugeridas = cla.filas.filter((s) => s.sugerencia_accion === 'descartar' || (s.sugerencia_accion === 'ligar' && s.insumo_id));
    const cab = `<div class="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-3"><p class="text-sm text-ink-muted md:max-w-xl">Cada concepto de una factura recibida llega aquí. Nada entra al banco hasta que lo ligas a un insumo, creas uno o lo descartas. El precio es el valor unitario del CFDI, sin IVA.</p>
<div class="flex flex-wrap gap-2 items-end"><label><span class="text-xs mb-1 block">Plaza de las compras</span><select id="bpClaPlaza" class="inp" onchange="try{localStorage.setItem('bp_plaza_compra',this.value)}catch(e){}">${plazaOpts(plazaCompra())}</select></label>
${sugeridas.length ? `<button type="button" class="btn btn-s" onclick="BancoPrecios.aplicarSugeridas()"><i class="ri-check-double-line" aria-hidden="true"></i> Aplicar las ${sugeridas.length} recordadas</button>` : ''}</div></div>`;
    if (!cla.filas.length) { el.innerHTML = cab + EmptyState({ icon: 'ri-inbox-archive-line', title: 'No hay conceptos por clasificar', body: 'Al importar un XML de factura recibida en Compras, sus conceptos aparecen aquí para convertirlos en precios reales de compra.' }); return; }
    const filas = cla.filas.map((s) => {
      const i = s.insumo_id ? cla.ins[s.insumo_id] : null;
      const sug = s.sugerencia_accion === 'ligar' && i ? `<span class="chip chip-obra" title="Decisión recordada">Recordado: ${S(i.clave)}</span>` : (s.sugerencia_accion === 'descartar' ? '<span class="chip chip-ind" title="Decisión recordada">Recordado: descartar</span>' : '');
      return `<tr><td data-et="Fecha">${S(fechaCorta(s.fecha))}</td><td data-et="Proveedor">${S(s.nombre_emisor || proveedorNombre(s.proveedor_id) || s.rfc_emisor || '—')}</td>
<td data-et="Concepto">${S(s.descripcion)}${sug ? `<span class="block mt-1">${sug}</span>` : ''}</td><td data-et="Cantidad" class="text-right">${num(s.cantidad, 2)} ${S(s.unidad || '')}</td><td data-et="Valor unitario" class="text-right">${F(s.valor_unitario)}</td>
<td data-et=""><div class="flex flex-wrap gap-1 justify-end">${sug && s.sugerencia_accion === 'ligar' ? `<button type="button" class="btn btn-p text-xs" onclick="BancoPrecios.aplicarSugerida(${s.id})">Aplicar</button>` : ''}<button type="button" class="btn btn-s text-xs" onclick="BancoPrecios.abrirSug(${s.id},'ligar')">Ligar a insumo</button><button type="button" class="btn btn-s text-xs" onclick="BancoPrecios.abrirSug(${s.id},'crear')">Crear insumo</button><button type="button" class="btn btn-s text-xs" onclick="BancoPrecios.descartarSug(${s.id})">Descartar</button></div></td></tr>`;
    }).join('');
    el.innerHTML = cab + `<div class="table-wrap g rounded-xl" tabindex="0" role="region" aria-label="Conceptos de facturas por clasificar"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Fecha</th><th scope="col">Proveedor</th><th scope="col">Concepto</th><th scope="col" class="text-right">Cantidad</th><th scope="col" class="text-right">Valor unitario</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody>${filas}</tbody></table></div>`;
  }
  function abrirSug(id, modo) {
    if (!$('mdlBpSug')) document.body.insertAdjacentHTML('beforeend', MDL_SUG);
    const s = cla.filas.find((x) => x.id === id); if (!s) return;
    cla.actual = s; cla.modo = modo; cla.destino = s.insumo_id || null;
    $('bpSugTitulo').textContent = modo === 'crear' ? 'Crear insumo con este concepto' : 'Ligar a un insumo';
    $('bpSugConcepto').textContent = `${s.descripcion} · ${F(s.valor_unitario)} por ${s.unidad || 'unidad'} · ${s.nombre_emisor || ''}`;
    $('bpSugLigar').hidden = modo !== 'ligar'; $('bpSugCrear').hidden = modo !== 'crear';
    $('bpSugFactor').value = '1'; $('bpSugRecordar').checked = true; $('bpSugOk').disabled = modo === 'ligar' && !cla.destino;
    if (modo === 'crear') { $('bpSugClave').value = `CFDI-${s.id}`; $('bpSugDesc').value = s.descripcion; $('bpSugUnidad').value = s.unidad || ''; $('bpSugTipo').value = 'material'; }
    else { $('bpSugBuscar').value = s.descripcion.split(/\s+/).slice(0, 4).join(' '); buscarParaSug($('bpSugBuscar').value); }
    openMdl('mdlBpSug');
  }
  let tSug = null;
  function buscarParaSug(q) {
    clearTimeout(tSug);
    tSug = setTimeout(async () => {
      try {
        const { data, error } = await sb.rpc('buscar_insumos', { p_texto: String(q || ''), p_tipo: null, p_plaza: null, p_limite: 30 });
        if (error) throw error;
        cla.lista = data || [];
        $('bpSugLista').innerHTML = cla.lista.length ? cla.lista.map((x) => `<label class="flex items-start gap-2 p-2 rounded hover:bg-slate-50 cursor-pointer"><input type="radio" name="bpSugDest" value="${x.id}" class="mt-1" onchange="BancoPrecios.elegirSugDestino(${x.id})"${cla.destino === x.id ? ' checked' : ''}><span class="text-sm"><span class="font-mono text-xs">${S(x.clave)}</span> · ${S(x.descripcion)} <span class="text-ink-muted">· ${S(x.unidad)} · ${S(TIPOS[x.tipo] || x.tipo)}</span></span></label>`).join('') : '<p class="text-sm text-ink-muted">Sin coincidencias. Prueba otra palabra o crea el insumo.</p>';
      } catch (e) { $('bpSugLista').innerHTML = `<p class="text-sm text-danger">${S(humanizeError(e))}</p>`; }
    }, 250);
  }
  function elegirSugDestino(id) { cla.destino = id; $('bpSugOk').disabled = false; }
  async function clasificar(id, accion, extra) {
    const { data, error } = await sb.rpc('clasificar_sugerencia', { p_id: id, p_accion: accion, p_insumo_id: extra.insumo_id || null, p_plaza: $('bpClaPlaza') ? $('bpClaPlaza').value : plazaCompra(),
      p_recordar: extra.recordar !== false, p_nuevo: extra.nuevo || null, p_factor: extra.factor || 1 });
    if (error) throw error;
    return data;
  }
  async function confirmarSug() {
    const s = cla.actual; if (!s) return;
    const factor = parseFloat($('bpSugFactor').value) || 1;
    const btn = $('bpSugOk'); btn.disabled = true;
    try {
      if (cla.modo === 'crear') {
        const nuevo = { clave: $('bpSugClave').value.trim(), descripcion: $('bpSugDesc').value.trim(), unidad: $('bpSugUnidad').value.trim(), tipo: $('bpSugTipo').value };
        if (!nuevo.clave || !nuevo.descripcion || !nuevo.unidad) { Toast.warning('Clave, descripción y unidad son obligatorias.'); return; }
        await clasificar(s.id, 'crear', { nuevo, factor, recordar: $('bpSugRecordar').checked });
      } else await clasificar(s.id, 'ligar', { insumo_id: cla.destino, factor, recordar: $('bpSugRecordar').checked });
      closeMdl('mdlBpSug'); Toast.success('Precio de compra guardado en el banco.');
      await cargar(true); irA('clasificar');
    } catch (e) { Toast.error(e && e.code === '23505' ? 'Ya existe un insumo con esa clave, unidad y tipo: lígalo en vez de crearlo.' : humanizeError(e, 'Clasificar')); }
    finally { btn.disabled = false; }
  }
  async function descartarSug(id) {
    const s = cla.filas.find((x) => x.id === id); if (!s) return;
    const ok = await Dialog.confirm({ title: 'Descartar concepto', body: `«${s.descripcion}» no entrará al banco. La próxima factura de este proveedor con la misma descripción llegará marcada para descartar.`, confirmText: 'Descartar concepto' });
    if (!ok) return;
    try { await clasificar(id, 'descartar', {}); Toast.info('Concepto descartado.'); irA('clasificar'); } catch (e) { Toast.error(humanizeError(e, 'Descartar')); }
  }
  async function aplicarSugerida(id) {
    const s = cla.filas.find((x) => x.id === id); if (!s || !s.insumo_id) return;
    try { await clasificar(id, 'ligar', { insumo_id: s.insumo_id }); Toast.success('Precio de compra guardado.'); await cargar(true); irA('clasificar'); } catch (e) { Toast.error(humanizeError(e, 'Clasificar')); }
  }
  async function aplicarSugeridas() {
    const lista = cla.filas.filter((s) => s.sugerencia_accion === 'descartar' || (s.sugerencia_accion === 'ligar' && s.insumo_id));
    const ok = await Dialog.confirm({ title: 'Aplicar decisiones recordadas', body: `Se aplicarán ${lista.length} decisiones recordadas por proveedor y descripción (ligar o descartar).`, confirmText: 'Aplicar decisiones' });
    if (!ok) return;
    let n = 0;
    for (const s of lista) { try { await clasificar(s.id, s.sugerencia_accion === 'descartar' ? 'descartar' : 'ligar', { insumo_id: s.insumo_id }); n++; } catch (e) { Toast.error(humanizeError(e, s.descripcion)); } }
    Toast.success(`${n} concepto${n === 1 ? '' : 's'} clasificado${n === 1 ? '' : 's'}.`); await cargar(true); irA('clasificar');
  }

  // ---- Conceptos y matrices (US-826) ---------------------------------------------------------------------------------
  const con = { q: '', lista: null, actual: null };
  VISTAS.conceptos = async (el) => {
    el.innerHTML = `<label class="block mb-3"><span class="sr-only">Buscar concepto</span><input id="bpConBuscar" type="search" class="inp w-full" placeholder="Buscar concepto por clave o descripción" value="${S(con.q)}" oninput="BancoPrecios.buscarConcepto(this.value)" autocomplete="off"></label><div id="bpConLista" aria-live="polite">${Skeleton.table(4, 4)}</div>`;
    await listarConceptos();
  };
  let tCon = null;
  function buscarConcepto(q) { con.q = String(q || ''); clearTimeout(tCon); tCon = setTimeout(listarConceptos, 300); }
  async function listarConceptos() {
    const el = $('bpConLista'); if (!el) return;
    try {
      let q = sb.from('conceptos_historicos').select('id,clave,descripcion,unidad,partida').order('id', { ascending: false }).limit(60);
      const t = con.q.trim().replace(/[,()*%]/g, ' ').trim();
      if (t) { const n = normalizarTexto(t).split(' ').filter(Boolean).join('%'); q = q.or(`clave.ilike.${t}*,descripcion_norm.ilike.*${n}*`); }
      const { data, error } = await q; if (error) throw error;
      const ids = (data || []).map((c) => c.id);
      const { data: pus, error: e2 } = ids.length ? await sb.from('concepto_precios').select('concepto_id,pu,fecha,plaza,licitacion_id').in('concepto_id', ids).order('fecha', { ascending: false }) : { data: [] };
      if (e2) throw e2;
      const ult = {}; for (const p of pus || []) if (!ult[p.concepto_id]) ult[p.concepto_id] = p;
      con.lista = data || [];
      if (!con.lista.length) { el.innerHTML = EmptyState({ icon: 'ri-file-list-3-line', title: t ? 'Sin conceptos que coincidan' : 'Todavía no hay conceptos', body: 'Los conceptos con su PU y su matriz llegan al importar el JSON de un proyecto de OPUS.', action: { label: 'Importar de OPUS', icon: 'ri-upload-cloud-2-line', onClick: "BancoPrecios.irA('importar')" } }); return; }
      el.innerHTML = `<div class="table-wrap g rounded-xl" tabindex="0" role="region" aria-label="Conceptos históricos"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Clave</th><th scope="col">Descripción</th><th scope="col">Unidad</th><th scope="col" class="text-right">Último PU</th><th scope="col">Fecha</th></tr></thead><tbody>${con.lista.map((c) => { const p = ult[c.id]; return `<tr class="cursor-pointer" onclick="BancoPrecios.abrirConcepto(${c.id})"><td data-et="Clave"><button type="button" class="link font-mono text-xs text-left" onclick="event.stopPropagation();BancoPrecios.abrirConcepto(${c.id})">${S(c.clave || 's/c')}</button></td><td data-et="Descripción">${S(String(c.descripcion).slice(0, 220))}${String(c.descripcion).length > 220 ? '…' : ''}</td><td data-et="Unidad">${S(c.unidad)}</td><td data-et="Último PU" class="text-right">${p ? F(p.pu) : '<span class="text-ink-muted">Sin PU</span>'}</td><td data-et="Fecha">${p ? S(fechaCorta(p.fecha)) : '—'}</td></tr>`; }).join('')}</tbody></table></div><p class="text-xs text-ink-muted mt-2">${con.lista.length === 60 ? 'Se muestran los primeros 60; afina la búsqueda.' : `${con.lista.length} concepto${con.lista.length === 1 ? '' : 's'}.`}</p>`;
    } catch (e) { el.innerHTML = errorHtml(e); }
  }
  /** Lee insumos, precios y matrices auxiliares necesarios para recalcular las matrices de un concepto. */
  async function datosMatriz(componentes, licId) {
    const ids = new Set(componentes.map((c) => c.insumo_id));
    const aux = {}; let pendientes = [...ids];
    for (let nivel = 0; nivel < 4 && pendientes.length; nivel++) {
      const ins = [];
      for (let i = 0; i < pendientes.length; i += 150) {
        const r = await sb.from('insumos').select('id,compuesto').in('id', pendientes.slice(i, i + 150));
        if (r.error) throw r.error; ins.push(...(r.data || []));
      }
      const comp = ins.filter((i) => i.compuesto).map((i) => i.id);
      pendientes = [];
      if (comp.length) {
        const { data: ic, error: e2 } = await sb.from('insumo_componentes').select('insumo_id,componente_id,cantidad,licitacion_id,orden').in('insumo_id', comp).order('orden');
        if (e2) throw e2;
        for (const id of comp) {
          const todas = (ic || []).filter((x) => x.insumo_id === id);
          const deLic = todas.filter((x) => x.licitacion_id === licId);
          const lic = deLic.length ? licId : (todas[0] && todas[0].licitacion_id);
          aux[id] = todas.filter((x) => x.licitacion_id === lic).map((x) => ({ insumo_id: x.componente_id, cantidad: Number(x.cantidad) }));
          for (const x of aux[id]) if (!ids.has(x.insumo_id)) { ids.add(x.insumo_id); pendientes.push(x.insumo_id); }
        }
      }
    }
    // Por tandas de ids: PostgREST corta en 1,000 filas y una URL con cientos de ids crece demasiado (US-833 pide
    // las matrices de un catálogo completo de una vez)
    const lista = [...ids]; const insData = []; const preData = [];
    for (let i = 0; i < lista.length; i += 150) {
      const t = lista.slice(i, i + 150);
      const ins = await sb.from('insumos').select('id,clave,descripcion,unidad,tipo,compuesto').in('id', t);
      if (ins.error) throw ins.error; insData.push(...(ins.data || []));
      for (let desde = 0; ; desde += LIMITE_PAGINA) {
        const pre = await sb.from('insumo_precios').select('id,insumo_id,precio,fecha,plaza,fuente,datos').in('insumo_id', t)
          .order('fecha', { ascending: false }).order('id', { ascending: false }).range(desde, desde + LIMITE_PAGINA - 1);
        if (pre.error) throw pre.error; preData.push(...(pre.data || []));
        if (!pre.data || pre.data.length < LIMITE_PAGINA) break;
      }
    }
    const info = Object.fromEntries(insData.map((i) => [i.id, i]));
    const precios = {}; for (const p of preData) (precios[p.insumo_id] = precios[p.insumo_id] || []).push(p);
    for (const k of Object.keys(aux)) aux[k] = aux[k].map((x) => ({ ...x, ...(info[x.insumo_id] ? { tipo: info[x.insumo_id].tipo, unidad: info[x.insumo_id].unidad, compuesto: info[x.insumo_id].compuesto } : {}) }));
    return { info, precios, aux };
  }
  async function abrirConcepto(id, licElegida, plazaElegida) {
    asegurarModales();
    if (!$('bpDrawer').classList.contains('ac')) focoAntes = document.activeElement;
    $('bpDrawer').classList.add('ac'); $('bpDrawer').setAttribute('aria-hidden', 'false'); $('bpDrawerBack').classList.add('ac');
    $('bpDrawerCuerpo').innerHTML = Skeleton.table(5, 3);
    try {
      const [c, pus, mc] = await Promise.all([
        sb.from('conceptos_historicos').select('id,clave,descripcion,unidad,partida').eq('id', id).single(),
        sb.from('concepto_precios').select('id,licitacion_id,fecha,plaza,pu,costo_directo,cantidad,fuente').eq('concepto_id', id).order('fecha', { ascending: false }),
        sb.from('matriz_componentes').select('insumo_id,cantidad,rendimiento,licitacion_id,orden').eq('concepto_id', id).order('orden'),
      ]);
      for (const r of [c, pus, mc]) if (r.error) throw r.error;
      const licIds = [...new Set([...(pus.data || []).map((p) => p.licitacion_id), ...(mc.data || []).map((m) => m.licitacion_id)].filter(Boolean))];
      const { data: licsRes } = licIds.length ? await sb.from('licitaciones').select('id,codigo,nombre').in('id', licIds) : { data: [] };
      const licMap = Object.fromEntries((licsRes || []).map((l) => [l.id, l]));
      const matrices = {}; for (const m of mc.data || []) (matrices[m.licitacion_id || 0] = matrices[m.licitacion_id || 0] || []).push(m);
      const lics = Object.keys(matrices).map(Number);
      const pu0 = (pus.data || []).find((p) => matrices[p.licitacion_id || 0]) || (pus.data || [])[0] || null;
      const lic = licElegida !== undefined ? Number(licElegida) : (pu0 ? (pu0.licitacion_id || 0) : (lics[0] || 0));
      const puLic = (pus.data || []).find((p) => (p.licitacion_id || 0) === lic) || pu0;
      const plaza = plazaElegida || (puLic && puLic.plaza) || 'cuauhtemoc';
      const comps = (matrices[lic] || []).map((m) => ({ insumo_id: m.insumo_id, cantidad: Number(m.cantidad) }));
      let calc = null; let dm = null;
      if (comps.length) {
        dm = await datosMatriz(comps, lic || null);
        const vig = {}; const meta = {};
        for (const [iid, lista] of Object.entries(dm.precios)) { const v = precioVigente(lista, plaza); vig[iid] = v ? v.precio : null; meta[iid] = v; }
        const enr = comps.map((x) => ({ ...x, ...(dm.info[x.insumo_id] || {}) }));
        calc = recalcularMatriz(enr, vig, dm.aux);
        calc.meta = meta;
      }
      con.actual = { concepto: c.data, pus: pus.data || [], licMap, lic, plaza };
      pintarConcepto(c.data, pus.data || [], licMap, lics, lic, plaza, puLic, calc);
    } catch (e) { $('bpDrawerCuerpo').innerHTML = errorHtml(e); }
  }
  function pintarConcepto(c, pus, licMap, lics, lic, plaza, puLic, calc) {
    $('bpDrawerTitulo').textContent = c.clave || 'Concepto';
    const hoy = hoyMx();
    const kpi = (v, l) => `<div class="kpi"><div class="kpi-v">${v}</div><div class="kpi-l">${l}</div></div>`;
    const cd0 = puLic && puLic.costo_directo != null ? Number(puLic.costo_directo) : null;
    const pu0 = puLic ? Number(puLic.pu) : null;
    const cd1 = calc ? calc.total : null;
    const pu1 = cd1 !== null && cd0 && pu0 ? Math.round(cd1 * (pu0 / cd0) * 100) / 100 : null;
    const dif = cd1 !== null && cd0 ? Math.round((cd1 - cd0) / cd0 * 10000) / 100 : null;
    const comp = calc ? composicionCD(calc.porTipo) : null;
    const barra = (lbl, v, ref) => `<div class="mb-2"><div class="flex justify-between text-xs"><span>${lbl}</span><span>${num(v, 1)} %${ref !== undefined ? ` <span class="text-ink-muted">(referencia ~${ref} %)</span>` : ''}</span></div><div class="bp-barra" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, v))}%"></span></div></div>`;
    const renglones = calc ? calc.renglones.map((r) => { const m = calc.meta[r.insumo_id]; const viejo = m && esViejo(m.fecha, hoy); return `<tr><td data-et="Insumo"><button type="button" class="link font-mono text-xs" onclick="BancoPrecios.abrirInsumo(${r.insumo_id})">${S(r.clave || '')}</button> ${S(r.descripcion || '')}${r.compuesto ? ' <span class="chip chip-ind">Compuesto</span>' : ''}</td><td data-et="Tipo">${S(TIPOS[r.tipo] || r.tipo || '')}</td><td data-et="Cantidad" class="text-right">${num(r.cantidad, 4)} ${S(r.unidad || '')}</td><td data-et="Precio vigente" class="text-right${viejo ? ' bp-viejo' : ''}">${r.pctMo ? `${num(r.cantidad * 100, 2)} % de MO` : (r.precio === null ? '<span class="text-danger">Sin precio</span>' : F(r.precio))}${m && m.de_otra_plaza ? ` <span class="chip chip-ind">${S(PLAZAS[m.plaza] || m.plaza)}</span>` : ''}${viejo ? ' <i class="ri-time-line" aria-label="Precio con más de 180 días"></i>' : ''}</td><td data-et="Importe" class="text-right">${F(r.importe)}</td></tr>`; }).join('') : '';
    $('bpDrawerCuerpo').innerHTML = `<p class="text-sm">${S(c.descripcion)}</p><p class="text-xs text-ink-muted mt-1">${S(c.unidad)}${c.partida ? ' · ' + S(c.partida) : ''}</p>
<div class="grid grid-cols-2 gap-2 mt-3"><label><span class="text-xs mb-1 block">Matriz de</span><select class="inp w-full" onchange="BancoPrecios.abrirConcepto(${c.id}, this.value, '${plaza}')">${lics.length ? lics.map((l) => `<option value="${l}"${l === lic ? ' selected' : ''}>${S(licMap[l] ? licMap[l].codigo : 'Sin licitación')}</option>`).join('') : '<option>Sin matriz</option>'}</select></label>
<label><span class="text-xs mb-1 block">Precios vigentes de</span><select class="inp w-full" onchange="BancoPrecios.abrirConcepto(${c.id}, ${lic}, this.value)">${plazaOpts(plaza)}</select></label></div>
<div class="kpi-strip mt-3">${kpi(pu0 !== null ? F(pu0) : '—', puLic ? `PU original · ${S(fechaCorta(puLic.fecha))}` : 'PU original')}${kpi(cd0 !== null ? F(cd0) : '—', 'Costo directo original')}${kpi(cd1 !== null ? F(cd1) : '—', 'Costo directo a precios vigentes')}${kpi(pu1 !== null ? F(pu1) : '—', 'PU con los mismos sobrecostos')}${kpi(dif !== null ? pct(dif) : '—', 'Diferencia del costo directo')}</div>
${calc && calc.sinPrecio ? `<p class="text-xs text-danger mb-2">${calc.sinPrecio} insumo${calc.sinPrecio === 1 ? '' : 's'} sin precio: el costo recalculado sale bajo.</p>` : ''}
${comp ? `<div class="g rounded-xl p-3 mt-2"><p class="font-bold text-sm mb-2">Composición del costo directo</p>${barra('Materiales', comp.material, COMPOSICION_REFERENCIA.material)}${barra('Mano de obra', comp.mano_obra, COMPOSICION_REFERENCIA.mano_obra)}${barra('Equipo y herramienta', comp.equipo_herramienta, COMPOSICION_REFERENCIA.equipo_herramienta)}${comp.otros ? barra('Auxiliares y fletes', comp.otros) : ''}<p class="text-xs text-ink-muted">Referencia de la skill para una obra de acabados e instalaciones.</p></div>` : ''}
<h3 class="font-bold mt-4 mb-2">Matriz${calc ? ` <span class="text-ink-muted font-normal">(${calc.renglones.length} componentes)</span>` : ''}</h3>
${calc ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Matriz del concepto a precios vigentes"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Insumo</th><th scope="col">Tipo</th><th scope="col" class="text-right">Cantidad</th><th scope="col" class="text-right">Precio vigente</th><th scope="col" class="text-right">Importe</th></tr></thead><tbody>${renglones}</tbody></table></div>` : '<p class="text-sm text-ink-muted">Este concepto no tiene matriz (catálogo sin análisis de precio unitario).</p>'}
<h3 class="font-bold mt-4 mb-2">Precios unitarios históricos</h3>
${pus.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Precios unitarios del concepto"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Fecha</th><th scope="col">Licitación</th><th scope="col">Plaza</th><th scope="col" class="text-right">PU</th></tr></thead><tbody>${pus.map((p) => `<tr><td data-et="Fecha">${S(fechaCorta(p.fecha))}</td><td data-et="Licitación">${S(licMap[p.licitacion_id] ? licMap[p.licitacion_id].codigo : '—')}</td><td data-et="Plaza">${S(PLAZAS[p.plaza] || p.plaza)}</td><td data-et="PU" class="text-right">${F(p.pu)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="text-sm text-ink-muted">Sin PU registrado.</p>'}`;
  }

  return {
    elegirCategoria, calcularDesglose, guardarFsr,
    abrirSug, buscarParaSug, elegirSugDestino, confirmarSug, descartarSug, aplicarSugerida, aplicarSugeridas,
    leerArchivo, cambiarLic, decidir, decidirTodos, cancelarImportacion, importar, buscarConcepto, abrirConcepto,
    trigramas, similitud, conciliarInsumos, aliasDeImportaciones, mapaImportacion, leerOpusInsumos, validarOpusInsumos, fechaPropuesta, plazaSugerida,
    excelAOpusInsumos, recalcularMatriz, composicionCD, COMPOSICION_REFERENCIA, calcularFSR, cesantiaPct, parametrosDelAnio,
    render, cargar, recargar, irA, nuevoInsumo, editarInsumo, guardarInsumo, buscar, filtrarPlaza, filtrarTipo,
    abrirInsumo, cerrarInsumo, mostrarCaptura, ocultarCaptura, guardarPrecio,
    abrirFusion, buscarDestino, elegirDestino, confirmarFusion,
    // puras
    datosMatriz,
    hoyMx, normalizarTexto, antiguedadDias, esViejo, precioVigente, precioVigenteFila, variacionAnual, seriesPorPlaza, grupoFuente,
    TIPOS, PLAZAS, FUENTES, DIAS_PRECIO_VIEJO, LIMITE_PAGINA, COLUMNAS, UMBRAL_PARECIDO,
  };
})();
if (typeof module !== 'undefined') module.exports = BancoPrecios;
