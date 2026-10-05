/**
 * Precios de una licitación (PRD licitaciones · US-829 y US-833). Pestaña «Precios» de la ficha de Licitaciones (`lc`),
 * sólo nivel >= 80 (la RLS de licitacion_precios y del banco lo exige también para leer).
 *
 *  - Insumos (US-829): la lista de insumos del concurso con el precio que se cargará a OPUS. Cada renglón propone el
 *    precio vigente del banco (D5: el último de la plaza de la licitación; si no hay, el último de cualquier plaza) y
 *    marca en ámbar lo de otra plaza o con más de 180 días. Se ajusta a mano o en lote con un porcentaje y se descarga
 *    como JSON opus-insumos/v1 (sólo `recursos[]`, válido para POST /opus/upsert-recursos del bridge) y como Excel.
 *    Se guarda en control_obra.licitacion_precios (migración 107).
 *  - Catálogo (US-833): importa el catálogo del concurso con ImportPresets, empareja cada concepto con
 *    conceptos_historicos (primero por clave, luego por descripción) y muestra el PU histórico más reciente, el rango y
 *    el costo de su matriz recalculado a precios vigentes. Exporta a Excel; no escribe en OPUS. De esas matrices salen
 *    también los insumos que el catálogo necesita (la vía «importar el catálogo» de US-829).
 *
 * Carga: archivo propio, diferido. En el build va en __LAZY['lcp'] (scripts/build.mjs › LAZY_ARCHIVOS); sin build lo
 * pide conModuloArchivo('lcp') de index.html. licitaciones.js › pintarPrecios lo carga al abrir la pestaña y le
 * delega el pintado; este módulo pide a su vez el Banco de precios (conModuloArchivo('bp')) para reutilizar
 * precioVigenteFila, recalcularMatriz, datosMatriz, similitud y las etiquetas.
 * Depende de (navegador): sb, S, $, fmt, Skeleton, EmptyState, humanizeError, Toast, Dialog, XLSX, ImportPresets,
 * conModuloArchivo. Las funciones puras se exportan con module.exports (scripts/qa/licitacion-precios.test.mjs).
 */
const LicitacionPrecios = (() => {
  'use strict';
  /* global BancoPrecios, ImportPresets */
  const BP = () => (typeof BancoPrecios !== 'undefined' ? BancoPrecios : (typeof require === 'function' ? require('./banco-precios.js') : null));
  const IP = () => (typeof ImportPresets !== 'undefined' ? ImportPresets : (typeof require === 'function' ? require('./import-presets.js') : null));

  const DIAS_VIEJO = 180;
  /** Una clave igual sólo cuenta si la descripción se parece al menos esto (las claves «1.11» se repiten entre obras). */
  const UMBRAL_CLAVE = 0.4;
  /** Parecido por descripción (trigramas, como pg_trgm) para emparejar sin clave. */
  const UMBRAL_DESCRIPCION = 0.6;
  /** Tipos que el bridge sabe cargar (opus-insumos-v1.md › Carga a OPUS). */
  const TIPOS_OPUS = ['material', 'mano_obra', 'herramienta', 'equipo', 'flete'];
  const MOTIVOS = {
    compuesto: 'Cuadrilla o auxiliar: su precio sale de su matriz',
    tipo: 'Tipo que OPUS no carga como precio',
    sin_precio: 'Sin precio',
    clave_repetida: 'Clave repetida en la lista',
    sin_clave: 'Sin clave',
  };
  const red2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
  const r6 = (v) => Math.round(Number(v) * 1e6) / 1e6;
  const normClave = (c) => String(c == null ? '' : c).trim().toLowerCase();
  const normUnidad = (u) => String(u == null ? '' : u).trim().toLowerCase().replace(/[.\s]/g, '');
  const esPctMo = (i) => !!i && /^\(%\)\s*mo$/i.test(String(i.unidad || '').trim());

  // ---- Funciones puras: lista de precios (US-829) ----------------------------------------------------------------------
  /**
   * Propuesta del banco para un insumo: precio vigente de la plaza (o el último general) con fecha, plaza, fuente y los
   * datos que OPUS necesita además del costo. precios: [{precio, fecha, plaza, fuente, datos}].
   */
  function propuestaDeInsumo(precios, plaza) {
    const v = BP().precioVigenteFila(precios, plaza || null);
    if (!v) return { precio_banco: null, fecha_banco: null, plaza_banco: null, fuente_banco: null, datos: {}, de_otra_plaza: false };
    const f = v.fila;
    return { precio_banco: Number(f.precio), fecha_banco: String(f.fecha).slice(0, 10), plaza_banco: f.plaza || null,
      fuente_banco: f.fuente || null, datos: datosParaOpus(f.datos), de_otra_plaza: v.de_otra_plaza };
  }
  /** De `insumo_precios.datos` se guarda sólo lo que OPUS usa: mano de obra (SB, SBC, FSR…) y subtipo de material. */
  function datosParaOpus(d) {
    const out = {}; if (!d || typeof d !== 'object') return out;
    const mo = Object.assign({}, d.mano_obra || {});
    for (const k of ['salario_base', 'sbc', 'fsr']) if (mo[k] === undefined && d[k] !== undefined) mo[k] = d[k];
    const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
    const m = {};
    for (const k of ['salario_base', 'sbc', 'fsr', 'factor_salario_base']) { const n = num(mo[k]); if (n !== undefined) m[k] = n; }
    if (typeof mo.usa_hoja_fsr === 'boolean') m.usa_hoja_fsr = mo.usa_hoja_fsr;
    if (mo.categoria_fasar) m.categoria_fasar = String(mo.categoria_fasar);
    if (Object.keys(m).length) out.mano_obra = m;
    if (d.material && typeof d.material === 'object') out.material = d.material;
    if (d.clave_opus) out.clave_opus = String(d.clave_opus);
    return out;
  }
  /** Ámbar (US-829): precio de otra plaza o con más de 180 días. Sin precio del banco: aviso aparte. */
  function estadoFila(fila, plazaLic, hoy) {
    const dias = fila && fila.fecha_banco ? BP().antiguedadDias(fila.fecha_banco, hoy) : null;
    const viejo = dias !== null && dias > DIAS_VIEJO;
    const otraPlaza = !!(plazaLic && fila && fila.plaza_banco && fila.plaza_banco !== plazaLic);
    const sinPrecio = !fila || fila.precio_banco === null || fila.precio_banco === undefined;
    const motivos = [];
    if (otraPlaza) motivos.push('otra plaza');
    if (viejo) motivos.push(`${dias} días`);
    return { dias, viejo, otraPlaza, sinPrecio, ambar: viejo || otraPlaza, motivos };
  }
  /** Ajuste en lote: precio = precio del banco × (1 + pct/100), a 2 decimales. Sin precio del banco parte del actual. */
  function ajustarPorcentaje(filas, pct) {
    const p = Number(pct);
    if (!Number.isFinite(p) || p <= -100) throw new Error('El porcentaje debe ser un número mayor que -100.');
    return (filas || []).map((f) => {
      const base = f.precio_banco !== null && f.precio_banco !== undefined ? Number(f.precio_banco) : Number(f.precio) || 0;
      return { id: f.id, precio: red2(base * (1 + p / 100)), ajuste_pct: p, manual: false };
    });
  }
  /** Fecha y hora con zona de México (UTC-6, sin horario de verano). */
  function isoMx(d) {
    const x = new Date((d || new Date()).getTime() - 6 * 3600000);
    return x.toISOString().slice(0, 19) + '-06:00';
  }
  const fechaLocal = (ts) => (ts ? new Date(new Date(ts).getTime() - 6 * 3600000).toISOString().slice(0, 19) : null);
  /**
   * Documento opus-insumos/v1 de la lista (contrato C:\dev\Codex\opus-host-bridge\docs\opus-insumos-v1.md). Sólo trae
   * `recursos[]` (conceptos y componentes vacíos): es lo que lee POST /opus/upsert-recursos.
   * filas: [{insumo_id, precio, fecha_banco, datos}] · insumos: {id: {clave, descripcion, unidad, tipo, compuesto}}
   * Devuelve {doc, omitidos:[{clave, descripcion, motivo}]}.
   */
  function documentoOpus(lic, filas, insumos, ahora) {
    const recursos = []; const omitidos = []; const vistas = new Set(); const porTipo = {};
    let ultima = null;
    const orden = (filas || []).slice().sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0));
    for (const f of orden) {
      const i = insumos[f.insumo_id] || {};
      const clave = String(i.clave || '').trim();
      const omitir = (motivo) => omitidos.push({ clave, descripcion: i.descripcion || '', motivo });
      if (!clave) { omitir('sin_clave'); continue; }
      if (i.compuesto) { omitir('compuesto'); continue; }
      if (!TIPOS_OPUS.includes(i.tipo)) { omitir('tipo'); continue; }
      const precio = Number(f.precio);
      if (!(precio > 0) && !esPctMo(i)) { omitir('sin_precio'); continue; }
      if (vistas.has(normClave(clave))) { omitir('clave_repetida'); continue; }
      vistas.add(normClave(clave));
      const r = { clave, descripcion: i.descripcion || clave, unidad: i.unidad || (i.tipo === 'mano_obra' ? 'jor' : ''), tipo: i.tipo,
        precio: red2(precio), moneda: 'MXN', familia: i.familia || null,
        ultima_actualizacion: f.fecha_banco ? String(f.fecha_banco).slice(0, 10) + 'T00:00:00' : null, matrices: 0 };
      const d = f.datos || {};
      if (i.tipo === 'mano_obra' && d.mano_obra && Number(d.mano_obra.fsr) > 0) {
        // OPUS guarda precio = ROUND(SB × FSR, 2) y el bridge hace mandar al precio: el SB se deriva del precio elegido
        const mo = d.mano_obra; const fsr = Number(mo.fsr);
        const fsb = Number(mo.factor_salario_base) > 0 ? Number(mo.factor_salario_base) : (Number(mo.sbc) > 0 && Number(mo.salario_base) > 0 ? Number(mo.sbc) / Number(mo.salario_base) : null);
        const sb = r6(r.precio / fsr);
        r.mano_obra = { salario_base: sb, sbc: fsb ? red2(sb * fsb) : (mo.sbc !== undefined ? Number(mo.sbc) : null), fsr,
          factor_salario_base: fsb ? r6(fsb) : null, usa_hoja_fsr: typeof mo.usa_hoja_fsr === 'boolean' ? mo.usa_hoja_fsr : false,
          categoria_fasar: mo.categoria_fasar || null };
      }
      if (i.tipo === 'material' && d.material) {
        r.material = { tipo_material: d.material.tipo_material ?? 1, origen: d.material.origen ?? 1, marca: d.material.marca ?? null, proveedor: d.material.proveedor ?? null };
      }
      recursos.push(r);
      porTipo[i.tipo] = (porTipo[i.tipo] || 0) + 1;
      if (f.fecha_banco && (!ultima || String(f.fecha_banco) > ultima)) ultima = String(f.fecha_banco).slice(0, 10);
    }
    const plazas = BP().PLAZAS;
    const doc = {
      formato: 'opus-insumos/v1', generado: isoMx(ahora),
      origen: { herramienta: 'control-obra/licitacion-precios', archivo: null, solo_usados: false, textos_reparados: 0 },
      proyecto: { nombre: lic && lic.nombre ? lic.nombre : null, descripcion: lic && lic.nombre ? lic.nombre : null,
        numero_concurso: lic && lic.codigo ? lic.codigo : null, ciudad: lic && lic.plaza && lic.plaza !== 'otra' ? plazas[lic.plaza] || null : null,
        estado: lic && lic.plaza && lic.plaza !== 'otra' ? 'Chihuahua' : null, moneda: 'MXN', decimales_costos: 2,
        costo_directo_total: null, importe_total: null },
      fechas: { creacion: null, concurso: null, presentacion: lic ? fechaLocal(lic.presentacion) : null,
        inicio_obra: lic && lic.inicio_obra ? String(lic.inicio_obra).slice(0, 10) + 'T00:00:00' : null, fin_obra: null,
        ultima_actualizacion_precios: ultima ? ultima + 'T00:00:00' : null },
      resumen: { recursos: recursos.length, recursos_por_tipo: porTipo, conceptos: 0, conceptos_con_matriz: 0, componentes: 0, componentes_sin_insumo: 0 },
      recursos, conceptos: [], componentes: [],
    };
    return { doc, omitidos };
  }
  /** Renglones del Excel legible de la lista (encabezados en español, montos como números). */
  function filasExcelLista(filas, insumos, plazaLic, hoy) {
    const B = BP();
    return (filas || []).map((f) => {
      const i = insumos[f.insumo_id] || {}; const e = estadoFila(f, plazaLic, hoy);
      return {
        Clave: i.clave || '', 'Descripción': i.descripcion || '', Unidad: i.unidad || '', Tipo: B.TIPOS[i.tipo] || i.tipo || '',
        'Precio para OPUS (sin IVA)': Number(f.precio) || 0,
        'Precio del banco': f.precio_banco === null || f.precio_banco === undefined ? '' : Number(f.precio_banco),
        'Fecha del precio': f.fecha_banco || '', Plaza: f.plaza_banco ? B.PLAZAS[f.plaza_banco] || f.plaza_banco : '',
        'Antigüedad (días)': e.dias === null ? '' : e.dias, Fuente: f.fuente_banco ? B.FUENTES[f.fuente_banco] || f.fuente_banco : '',
        Ajuste: f.manual ? 'A mano' : (f.ajuste_pct !== null && f.ajuste_pct !== undefined ? `${Number(f.ajuste_pct)} %` : ''),
        Aviso: e.sinPrecio ? 'Sin precio en el banco' : e.motivos.join(', '),
        'Cantidad estimada': f.cantidad === null || f.cantidad === undefined ? '' : Number(f.cantidad),
      };
    });
  }

  // ---- Funciones puras: catálogo del concurso (US-833) -----------------------------------------------------------------
  /**
   * Lee un catálogo (matriz de celdas de XLSX con header:1) con ImportPresets: localiza los encabezados (o el orden fijo
   * de OPUS), detecta el preset y construye los conceptos. Acepta precios en cero (catálogo de concurso).
   * Devuelve {proyecto, conceptos:[{clave, descripcion, unidad, cantidad, precio_unitario, partida}], errores, sinPrecios, preset}.
   */
  function leerCatalogo(filas) {
    const P = IP();
    let rows = (filas || []).filter((r) => r && r.some((c) => String(c ?? '').trim()));
    if (!rows.length) throw new Error('El archivo no trae renglones.');
    const esHeader = (r) => { const t = r.map((c) => String(c ?? '').toLowerCase()); return t.filter(Boolean).length >= 3 && t.some((c) => /clave|codigo|código|desc|concepto/.test(c)) && t.some((c) => /unidad|cantidad|cant\b|precio|p\.u|unitario|importe/.test(c)); };
    let proyecto = '';
    const hIdx = rows.slice(0, 25).findIndex(esHeader);
    const nombreDe = (pre) => { let mejor = ''; pre.forEach((r) => r.forEach((c) => { const t = String(c ?? '').replace(/\s+/g, ' ').trim().replace(/^(obra|proyecto|cliente|presupuesto)\s*:\s*/i, ''); if (t.length >= 8 && t.length <= 160 && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{4}/.test(t) && !/^(fecha|clave|codigo|concepto|unidad|cantidad|importe|hoja|p[aá]gina)\b/i.test(t) && t.length > mejor.length) mejor = t; })); return mejor; };
    let headers;
    if (hIdx >= 0) { proyecto = nombreDe(rows.slice(0, hIdx)); headers = rows[hIdx].map((c) => String(c ?? '').trim()); rows = rows.slice(hIdx + 1); } else {
      const cIdx = rows.slice(0, 25).findIndex((r) => P.esClaveOpus(r[0]));
      if (cIdx < 0) throw new Error('No encontré los encabezados (Clave, Concepto, Unidad, Cantidad) ni claves de OPUS en el archivo.');
      proyecto = nombreDe(rows.slice(0, cIdx)); rows = rows.slice(cIdx); headers = rows[0].map((_, i) => `Columna ${i + 1}`);
    }
    const datos = rows.map((r) => r.map((c) => (typeof c === 'number' ? c : String(c ?? '').trim())));
    const det = P.detectar(headers, datos);
    const mapping = Object.keys(det.mapping || {}).length ? det.mapping : P.LAYOUT_OPUS;
    if (!Object.values(mapping).includes('descripcion')) throw new Error('No encontré la columna de la descripción del concepto.');
    const r = P.construir(datos, mapping, {});
    if (!r.conceptos.length) throw new Error('El catálogo no trae conceptos.');
    return { proyecto, conceptos: r.conceptos, errores: r.errores, sinPrecios: r.sinPrecios, preset: det.preset };
  }
  /** Índice de conceptos históricos para emparejar: por clave y con los trigramas de la descripción ya calculados. */
  function indiceHistoricos(historicos, conAntecedente) {
    const B = BP(); const porClave = new Map(); const todos = [];
    for (const h of historicos || []) {
      const x = { h, tri: B.trigramas(h.descripcion), u: normUnidad(h.unidad), ant: conAntecedente ? conAntecedente.has(h.id) : false };
      todos.push(x);
      const k = normClave(h.clave); if (k) { if (!porClave.has(k)) porClave.set(k, []); porClave.get(k).push(x); }
    }
    return { porClave, todos };
  }
  /**
   * Empareja cada concepto del catálogo con un concepto histórico: primero por clave (si la descripción se parece al
   * menos UMBRAL_CLAVE), luego por descripción (≥ UMBRAL_DESCRIPCION). En empate gana el que tiene antecedente (PU o
   * matriz) y la misma unidad. Devuelve [{concepto, historico, metodo:'clave'|'descripcion'|null, puntaje, unidad_distinta}].
   */
  function emparejarCatalogo(conceptos, historicos, opts) {
    const B = BP(); const o = opts || {};
    const idx = o.indice || indiceHistoricos(historicos, o.conAntecedente);
    const mejor = (cands, tri, u) => cands.map((x) => ({ x, sim: B.similitud(tri, x.tri) }))
      .sort((a, b) => (b.sim - a.sim) || ((b.x.ant ? 1 : 0) - (a.x.ant ? 1 : 0)) || ((b.x.u === u ? 1 : 0) - (a.x.u === u ? 1 : 0)) || (a.x.h.id - b.x.h.id))[0] || null;
    return (conceptos || []).map((c) => {
      const tri = B.trigramas(c.descripcion); const u = normUnidad(c.unidad);
      const porClave = idx.porClave.get(normClave(c.clave)) || [];
      let m = mejor(porClave, tri, u); let metodo = 'clave';
      if (!m || m.sim < UMBRAL_CLAVE) {
        // Por descripción: el mejor parecido; a igualdad (± 0.02) prefiere antecedente y misma unidad
        let best = null;
        for (const x of idx.todos) {
          const sim = B.similitud(tri, x.tri); if (sim < UMBRAL_DESCRIPCION) continue;
          const pts = sim + (x.ant ? 0.02 : 0) + (x.u === u ? 0.01 : 0);
          if (!best || pts > best.pts || (pts === best.pts && x.h.id < best.x.h.id)) best = { x, sim, pts };
        }
        m = best; metodo = 'descripcion';
      }
      if (!m) return { concepto: c, historico: null, metodo: null, puntaje: null, unidad_distinta: false };
      return { concepto: c, historico: m.x.h, metodo, puntaje: Math.round(m.sim * 1000) / 1000, unidad_distinta: !!u && !!m.x.u && m.x.u !== u };
    });
  }
  /** PU más reciente, rango y número de muestras de un concepto histórico. pus: [{pu, fecha, plaza, licitacion_id, costo_directo}]. */
  function resumenPUs(pus) {
    const l = (pus || []).filter((p) => p && p.pu !== null && p.pu !== undefined && Number(p.pu) > 0)
      .slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || ((b.id || 0) - (a.id || 0)));
    if (!l.length) return null;
    const v = l.map((p) => Number(p.pu));
    return { reciente: l[0], min: Math.min(...v), max: Math.max(...v), n: l.length };
  }
  /** Licitación de la matriz que se usa para un concepto: la del PU más reciente que tenga matriz; si no, la primera. */
  function licitacionDeMatriz(pus, licsConMatriz) {
    const con = new Set((licsConMatriz || []).map((x) => x || 0));
    if (!con.size) return null;
    const l = (pus || []).slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const p = l.find((x) => con.has(x.licitacion_id || 0));
    return p ? (p.licitacion_id || 0) : [...con][0];
  }
  /**
   * Fila de la sugerencia de un concepto: PU histórico reciente y rango, costo directo de la matriz a precios vigentes y
   * el PU con la misma proporción PU/CD de la propuesta más reciente (mismos sobrecostos).
   * calc = resultado de recalcularMatriz o null.
   */
  function sugerenciaDe(emp, resumen, calc) {
    const c = emp.concepto; const r = resumen;
    const cd0 = r && r.reciente.costo_directo !== null && r.reciente.costo_directo !== undefined && Number(r.reciente.costo_directo) > 0 ? Number(r.reciente.costo_directo) : null;
    const cdVig = calc && calc.total > 0 ? calc.total : null;
    const puSug = cdVig !== null && cd0 && r ? red2(cdVig * Number(r.reciente.pu) / cd0) : (r ? Number(r.reciente.pu) : null);
    return {
      clave: c.clave, descripcion: c.descripcion, unidad: c.unidad, cantidad: Number(c.cantidad) || 0, partida: c.partida || null,
      historico_id: emp.historico ? emp.historico.id : null, historico_clave: emp.historico ? emp.historico.clave : null,
      metodo: emp.metodo, puntaje: emp.puntaje, unidad_distinta: emp.unidad_distinta,
      antecedente: !!(r || cdVig !== null),
      pu_reciente: r ? Number(r.reciente.pu) : null, fecha_pu: r ? String(r.reciente.fecha).slice(0, 10) : null,
      plaza_pu: r ? r.reciente.plaza : null, licitacion_pu: r ? r.reciente.licitacion_id : null,
      pu_min: r ? r.min : null, pu_max: r ? r.max : null, muestras: r ? r.n : 0,
      cd_original: cd0, cd_vigente: cdVig, sin_precio: calc ? calc.sinPrecio : 0, pu_sugerido: puSug,
      importe_sugerido: puSug !== null ? red2(puSug * (Number(c.cantidad) || 0)) : null,
    };
  }
  function resumenSugerencias(filas) {
    const t = (filas || []).length; const con = (filas || []).filter((f) => f.antecedente).length;
    return { total: t, con_antecedente: con, desde_cero: t - con,
      por_clave: (filas || []).filter((f) => f.antecedente && f.metodo === 'clave').length,
      por_descripcion: (filas || []).filter((f) => f.antecedente && f.metodo === 'descripcion').length,
      importe: red2((filas || []).reduce((s, f) => s + (f.importe_sugerido || 0), 0)) };
  }
  /**
   * Insumos que necesita el catálogo: Σ cantidad del concepto × cantidad del componente en su matriz. Una cuadrilla o
   * un auxiliar se explota en sus componentes (no se carga como precio). matrices: {historico_id: [{insumo_id, cantidad}]}
   * · aux: {insumo_id: [{insumo_id, cantidad}]} · compuestos: Set de ids. Devuelve {insumo_id: cantidad}.
   */
  function explotarInsumos(emparejados, matrices, aux, compuestos) {
    const out = {}; const comp = compuestos || new Set(); const a = aux || {};
    const sumar = (id, q, prof) => {
      if (comp.has(id) && a[id] && a[id].length && prof < 5) { for (const x of a[id]) sumar(x.insumo_id, q * Number(x.cantidad), prof + 1); return; }
      if (comp.has(id)) return;
      out[id] = r6((out[id] || 0) + q);
    };
    for (const e of emparejados || []) {
      if (!e.historico) continue;
      const m = matrices[e.historico.id] || []; const q = Number(e.concepto.cantidad) || 0;
      for (const x of m) sumar(x.insumo_id, (q || 1) * Number(x.cantidad), 0);
    }
    return out;
  }
  function filasExcelSugerencias(filas) {
    const B = BP();
    return (filas || []).map((f) => ({
      Clave: f.clave, Concepto: f.descripcion, Unidad: f.unidad, Cantidad: f.cantidad,
      Antecedente: f.antecedente ? `${f.historico_clave || 's/c'} (${f.metodo === 'clave' ? 'por clave' : `por descripción ${Math.round((f.puntaje || 0) * 100)} %`})${f.unidad_distinta ? ' · unidad distinta' : ''}` : 'Analizar desde cero',
      'PU más reciente': f.pu_reciente ?? '', 'Fecha del PU': f.fecha_pu || '', 'Plaza del PU': f.plaza_pu ? B.PLAZAS[f.plaza_pu] || f.plaza_pu : '',
      'PU mínimo': f.pu_min ?? '', 'PU máximo': f.pu_max ?? '', Muestras: f.muestras || '',
      'Costo directo original': f.cd_original ?? '', 'Costo directo a precios vigentes': f.cd_vigente ?? '',
      'PU sugerido': f.pu_sugerido ?? '', 'Importe sugerido': f.importe_sugerido ?? '',
    }));
  }

  // ---- Estado (navegador) -------------------------------------------------------------------------------------------
  /** E = {lic, archivos, filas, info:{id:insumo}, precios:{id:[...]}, vista, cat, busqueda} de la licitación abierta. */
  let E = null;
  let turno = 0;
  const S_ = (v) => (typeof S === 'function' ? S(v) : String(v ?? ''));
  const money = (v) => (v === null || v === undefined || v === '' ? '—' : (typeof fmt === 'function' ? fmt(v) : '$' + Number(v).toFixed(2)));
  const num = (v, d) => Number(v || 0).toLocaleString('es-MX', { maximumFractionDigits: d === undefined ? 2 : d });
  const errTxt = (e, ctx) => {
    const m = e && e.message ? String(e.message) : String(e || '');
    if (/[áéíóúñ¿]/i.test(m) && !/^(TypeError|Failed)/.test(m)) return m;
    return typeof humanizeError === 'function' ? humanizeError(e, ctx) : (ctx ? ctx + ': ' : '') + m;
  };
  const fechaCorta = (f) => { if (!f) return '—'; const [a, m, d] = String(f).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
  async function paginado(fabrica) {
    const out = [];
    for (let desde = 0; desde < 20000; desde += 1000) {
      const { data, error } = await fabrica().range(desde, desde + 999);
      if (error) throw error; out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  async function porTandas(ids, fabrica) {
    const out = [];
    for (let i = 0; i < ids.length; i += 150) out.push(...await paginado(() => fabrica(ids.slice(i, i + 150))));
    return out;
  }

  async function cargarLista() {
    const filas = await paginado(() => sb.from('licitacion_precios').select('id,licitacion_id,insumo_id,precio,precio_banco,fecha_banco,plaza_banco,fuente_banco,ajuste_pct,manual,cantidad,origen,datos,orden,notas,updated_at')
      .eq('licitacion_id', E.lic.id).order('orden').order('id'));
    E.filas = filas;
    await cargarInsumos(filas.map((f) => f.insumo_id));
  }
  /** Info y precios de los insumos que faltan en E.info / E.precios. */
  async function cargarInsumos(ids) {
    const faltan = [...new Set(ids)].filter((id) => !E.info[id]);
    if (!faltan.length) return;
    const [ins, pre] = await Promise.all([
      porTandas(faltan, (t) => sb.from('insumos').select('id,clave,descripcion,unidad,tipo,familia,compuesto').in('id', t).order('id')),
      porTandas(faltan, (t) => sb.from('insumo_precios').select('id,insumo_id,precio,fecha,plaza,fuente,datos').in('insumo_id', t).order('id')),
    ]);
    for (const i of ins) E.info[i.id] = i;
    for (const id of faltan) E.precios[id] = [];
    for (const p of pre) (E.precios[p.insumo_id] = E.precios[p.insumo_id] || []).push(p);
  }

  /** Punto de entrada: Licitaciones › Precios. ctx = {lic, archivos, ...} de la ficha. */
  async function pintar(el, ctx) {
    const t = ++turno;
    if (!E || !ctx || !E.lic || E.lic.id !== ctx.lic.id) E = { lic: ctx.lic, archivos: ctx.archivos || [], filas: [], info: {}, precios: {}, vista: 'insumos', cat: null, busqueda: null, sel: new Set() };
    else { E.lic = ctx.lic; E.archivos = ctx.archivos || []; }
    el.innerHTML = `<div aria-busy="true">${Skeleton.table(5, 5)}</div>`;
    try {
      if (typeof BancoPrecios === 'undefined' && typeof conModuloArchivo === 'function') await conModuloArchivo('bp');
      if (typeof BancoPrecios === 'undefined') throw new Error('No se pudo cargar el Banco de precios. Revisa tu conexión e intenta de nuevo.');
      await cargarLista();
      if (t !== turno) return;
      repintar();
    } catch (e) {
      if (t !== turno) return;
      el.innerHTML = EmptyState({ icon: 'ri-error-warning-line', title: 'No se pudo abrir la lista de precios', body: errTxt(e), action: { label: 'Reintentar', icon: 'ri-refresh-line', onClick: 'Licitaciones.tabFicha(\'precios\')' } });
    }
  }
  function panel() { return document.getElementById('lcPanel'); }
  function repintar() {
    const el = panel(); if (!el || !E) return;
    const seg = (k, t, ic) => `<button type="button" class="seg-btn${E.vista === k ? ' active' : ''}" aria-pressed="${E.vista === k}" onclick="LicitacionPrecios.verVista('${k}')"><i class="${ic}" aria-hidden="true"></i> ${t}</button>`;
    el.innerHTML = `<div class="seg bp-seg mb-3" role="group" aria-label="Precios de la licitación">${seg('insumos', `Insumos para OPUS (${E.filas.length})`, 'ri-price-tag-3-line')}${seg('catalogo', 'Precios unitarios del catálogo', 'ri-file-list-3-line')}</div><div id="lpCuerpo"></div>`;
    if (E.vista === 'catalogo') pintarCatalogo(); else pintarInsumos();
  }
  function verVista(k) { if (!E) return; E.vista = k === 'catalogo' ? 'catalogo' : 'insumos'; repintar(); }

  // ---- Vista Insumos (US-829) ---------------------------------------------------------------------------------------
  function ordenadas() {
    const tipos = Object.keys(BP().TIPOS);
    return E.filas.slice().sort((a, b) => {
      const ia = E.info[a.insumo_id] || {}; const ib = E.info[b.insumo_id] || {};
      return (tipos.indexOf(ia.tipo) - tipos.indexOf(ib.tipo)) || String(ia.clave || '').localeCompare(String(ib.clave || ''), 'es');
    });
  }
  function catalogosDeArchivos() {
    return (E.archivos || []).filter((a) => /\.(xlsx|xls|csv)$/i.test(String(a.nombre || a.archivo_path || '')) && (a.categoria === 'catalogo' || /catalog/i.test(String(a.nombre || ''))));
  }
  function pintarInsumos() {
    const el = document.getElementById('lpCuerpo'); if (!el) return;
    const B = BP(); const hoy = B.hoyMx(); const plaza = E.lic.plaza || null;
    const filas = ordenadas();
    const est = filas.map((f) => estadoFila(f, plaza, hoy));
    const ambar = est.filter((e) => e.ambar).length; const sinPrecio = filas.filter((f) => !(Number(f.precio) > 0) && !esPctMo(E.info[f.insumo_id])).length;
    const { omitidos } = documentoOpus(E.lic, E.filas, E.info);
    const cats = catalogosDeArchivos();
    const kpi = (v, l) => `<div class="kpi"><p class="kpi-v">${v}</p><p class="kpi-l">${l}</p></div>`;
    const aviso = !plaza ? `<p class="bp-aviso text-sm rounded-lg p-3 mb-3" role="note"><i class="ri-map-pin-line" aria-hidden="true"></i> La licitación no tiene plaza: el precio propuesto es el último de cualquier plaza. Captura la plaza con «Editar datos» o en la pestaña Bases.</p>` : '';
    const barra = `<div class="flex flex-wrap gap-2 items-end mb-3">
<label class="flex-1 min-w-[220px]"><span class="text-xs mb-1 block">Agregar insumos del banco</span><input id="lpBuscar" type="search" class="inp w-full" placeholder="Busca por clave o descripción" autocomplete="off" oninput="LicitacionPrecios.buscar(this.value)" value="${S_(E.busqueda ? E.busqueda.q : '')}"></label>
<button type="button" class="btn btn-s" onclick="LicitacionPrecios.elegirCatalogo()"><i class="ri-file-excel-2-line" aria-hidden="true"></i> Importar el catálogo del concurso</button>
${cats.map((a) => `<button type="button" class="btn btn-s" onclick="LicitacionPrecios.catalogoDeArchivo(${+a.id})"><i class="ri-folder-3-line" aria-hidden="true"></i> Usar «${S_(String(a.nombre).slice(0, 40))}»</button>`).join('')}
<input id="lpCatFile" type="file" accept=".xlsx,.xls,.csv" class="hidden" aria-hidden="true" tabindex="-1" onchange="LicitacionPrecios.leerArchivoCatalogo(this.files[0])"></div>
<div id="lpResultados" aria-live="polite"></div>`;
    if (!filas.length) {
      el.innerHTML = aviso + barra + EmptyState({ icon: 'ri-price-tag-3-line', title: 'La lista de precios está vacía',
        body: 'Busca arriba los insumos del concurso o importa su catálogo: con las matrices históricas se proponen los insumos que va a necesitar, cada uno con el precio vigente de la plaza.' });
      pintarResultados(); return;
    }
    const renglon = (f, e) => {
      const i = E.info[f.insumo_id] || {}; const pct = esPctMo(i);
      const vig = propuestaDeInsumo(E.precios[f.insumo_id], plaza);
      const masNuevo = vig.precio_banco !== null && (vig.fecha_banco !== f.fecha_banco || vig.plaza_banco !== f.plaza_banco || Number(vig.precio_banco) !== Number(f.precio_banco));
      const banco = e.sinPrecio ? '<span class="text-danger">Sin precio en el banco</span>'
        : `${money(f.precio_banco)}<span class="block text-xs ${e.ambar ? 'bp-viejo' : 'text-ink-muted'}">${S_(fechaCorta(f.fecha_banco))} · ${S_(B.PLAZAS[f.plaza_banco] || f.plaza_banco || 'sin plaza')}${e.dias !== null ? ` · ${e.dias} días` : ''}${e.ambar ? ` <i class="ri-error-warning-line" aria-hidden="true"></i><span class="sr-only"> Aviso: ${S_(e.motivos.join(' y '))}</span>` : ''}</span>`;
      const ajuste = f.manual ? '<span class="chip chip-ind">A mano</span>' : (f.ajuste_pct !== null && f.ajuste_pct !== undefined && Number(f.ajuste_pct) !== 0 ? `<span class="chip chip-ind">${Number(f.ajuste_pct) > 0 ? '+' : ''}${num(f.ajuste_pct)} %</span>` : '');
      return `<tr${e.ambar ? ' class="lp-ambar"' : ''}><td data-et="Insumo"><span class="font-mono text-xs">${S_(i.clave || '')}</span> ${S_(i.descripcion || '')}${f.cantidad ? `<span class="block text-xs text-ink-muted">Cantidad estimada: ${num(f.cantidad, 3)} ${S_(i.unidad || '')}</span>` : ''}</td>
<td data-et="Unidad">${S_(i.unidad || '')}</td><td data-et="Tipo">${S_(B.TIPOS[i.tipo] || i.tipo || '')}</td>
<td data-et="Precio del banco" class="text-right">${banco}${masNuevo ? `<button type="button" class="link text-xs" onclick="LicitacionPrecios.actualizarFila(${+f.id})">Usar el vigente: ${money(vig.precio_banco)}</button>` : ''}</td>
<td data-et="Precio para OPUS" class="text-right">${pct ? '<span class="text-xs text-ink-muted">% de la mano de obra</span>' : `<input type="number" min="0" step="0.01" inputmode="decimal" class="inp text-right w-32${e.ambar ? ' lp-inp-ambar' : ''}" value="${Number(f.precio).toFixed(2)}" aria-label="Precio para OPUS de ${S_(i.clave || '')}" onchange="LicitacionPrecios.cambiarPrecio(${+f.id}, this.value)">`} ${ajuste}</td>
<td data-et="" class="text-right"><button type="button" class="btn-icon" onclick="LicitacionPrecios.quitar(${+f.id})" aria-label="Quitar ${S_(i.clave || 'insumo')} de la lista"><i class="ri-delete-bin-line" aria-hidden="true"></i></button></td></tr>`;
    };
    el.innerHTML = aviso + `<div class="kpi-strip">${kpi(filas.length, 'Insumos en la lista')}${kpi(ambar, 'En ámbar (viejos u otra plaza)')}${kpi(sinPrecio, 'Sin precio')}${kpi(filas.length - omitidos.length, 'Van a OPUS')}</div>` + barra +
`<div class="flex flex-wrap gap-2 items-end mb-3">
<label><span class="text-xs mb-1 block">Ajuste en lote (%)</span><input id="lpPct" type="number" step="0.1" class="inp w-28" placeholder="Ej. 5"></label>
<label><span class="text-xs mb-1 block">A cuáles</span><select id="lpPctA" class="inp"><option value="todos">Todos</option><option value="ambar">Sólo los ámbar</option></select></label>
<button type="button" class="btn btn-s" onclick="LicitacionPrecios.aplicarPorcentaje()"><i class="ri-percent-line" aria-hidden="true"></i> Aplicar el porcentaje</button>
<span class="flex-1"></span>
<button type="button" class="btn btn-s" onclick="LicitacionPrecios.descargarExcel()"><i class="ri-file-excel-2-line" aria-hidden="true"></i> Descargar Excel</button>
<button type="button" class="btn btn-p" onclick="LicitacionPrecios.descargarOpus()"><i class="ri-download-2-line" aria-hidden="true"></i> Descargar para OPUS</button></div>
${omitidos.length ? `<p class="text-xs text-ink-muted mb-2">${omitidos.length} insumo${omitidos.length === 1 ? '' : 's'} no van en el archivo para OPUS: ${S_(resumenOmitidos(omitidos))}.</p>` : ''}
<div class="table-wrap g rounded-xl" tabindex="0" role="region" aria-label="Lista de precios de la licitación"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Insumo</th><th scope="col">Unidad</th><th scope="col">Tipo</th><th scope="col" class="text-right">Precio del banco</th><th scope="col" class="text-right">Precio para OPUS (sin IVA)</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
<tbody>${filas.map((f, k) => renglon(f, est[k])).join('')}</tbody></table></div>
<p class="text-xs text-ink-muted mt-2">Precios sin IVA. En ámbar: precio de otra plaza o con más de ${DIAS_VIEJO} días. El archivo para OPUS es opus-insumos/v1 y se carga con el bridge (upsert-recursos).</p>`;
    pintarResultados();
  }
  function resumenOmitidos(om) {
    const c = {}; for (const o of om) c[o.motivo] = (c[o.motivo] || 0) + 1;
    return Object.entries(c).map(([k, n]) => `${(MOTIVOS[k] || k).toLowerCase()} (${n})`).join(', ');
  }

  // Búsqueda en el banco
  let tBuscar = null; let nBusq = 0;
  function buscar(q) {
    E.busqueda = { q: String(q || ''), filas: E.busqueda ? E.busqueda.filas : null };
    clearTimeout(tBuscar); tBuscar = setTimeout(ejecutarBusqueda, 300);
  }
  async function ejecutarBusqueda() {
    const q = E.busqueda ? E.busqueda.q.trim() : '';
    if (!q) { E.busqueda = null; pintarResultados(); return; }
    const n = ++nBusq;
    try {
      const { data, error } = await sb.rpc('buscar_insumos', { p_texto: q, p_tipo: null, p_plaza: E.lic.plaza || null, p_limite: 15 });
      if (error) throw error;
      if (n !== nBusq || !E.busqueda) return;
      E.busqueda.filas = data || []; pintarResultados();
    } catch (e) { const el = document.getElementById('lpResultados'); if (el) el.innerHTML = `<p class="text-sm text-danger">${S_(errTxt(e, 'No se pudo buscar'))}</p>`; }
  }
  function pintarResultados() {
    const el = document.getElementById('lpResultados'); if (!el) return;
    if (!E.busqueda || !E.busqueda.filas) { el.innerHTML = ''; return; }
    const B = BP(); const en = new Set(E.filas.map((f) => f.insumo_id));
    const fs = E.busqueda.filas;
    el.innerHTML = fs.length ? `<ul class="g rounded-xl mb-3 divide-y" aria-label="Insumos encontrados">${fs.map((r) => {
      const ya = en.has(r.id); const comp = r.tipo === 'auxiliar';
      return `<li class="flex flex-wrap items-center gap-2 p-2 text-sm"><span class="flex-1 min-w-[200px]"><span class="font-mono text-xs">${S_(r.clave)}</span> ${S_(r.descripcion)} <span class="text-xs text-ink-muted">· ${S_(r.unidad || '')} · ${S_(B.TIPOS[r.tipo] || r.tipo)}</span></span>
<span class="text-right">${r.precio_vigente !== null && r.precio_vigente !== undefined ? `${money(r.precio_vigente)} <span class="text-xs ${r.de_otra_plaza || B.esViejo(r.fecha_vigente) ? 'bp-viejo' : 'text-ink-muted'}">${S_(fechaCorta(r.fecha_vigente))} · ${S_(B.PLAZAS[r.plaza_vigente] || r.plaza_vigente || '')}</span>` : '<span class="text-xs text-danger">Sin precio</span>'}</span>
<button type="button" class="btn btn-s" ${ya || comp ? 'disabled' : ''} onclick="LicitacionPrecios.agregar([${+r.id}])">${ya ? 'Ya está en la lista' : comp ? 'Auxiliar: va por su matriz' : '<i class="ri-add-line" aria-hidden="true"></i> Agregar'}</button></li>`;
    }).join('')}</ul>` : '<p class="text-sm text-ink-muted mb-3">Ningún insumo del banco coincide.</p>';
  }

  /** Agrega insumos a la lista con su precio vigente. cantidades: {insumo_id: cantidad} (del catálogo). */
  async function agregar(ids, cantidades, origen) {
    if (!E) return 0;
    try {
      await cargarInsumos(ids);
      const en = new Set(E.filas.map((f) => f.insumo_id));
      const compuestos = ids.filter((id) => E.info[id] && E.info[id].compuesto);
      if (compuestos.length && !cantidades) {
        // Una cuadrilla o auxiliar no se carga como precio: se agregan sus componentes
        const dm = await BP().datosMatriz(compuestos.map((id) => ({ insumo_id: id, cantidad: 1 })), null);
        const exp = explotarInsumos([{ concepto: { cantidad: 1 }, historico: { id: 0 } }], { 0: compuestos.map((id) => ({ insumo_id: id, cantidad: 1 })) }, dm.aux, new Set(Object.values(dm.info).filter((i) => i.compuesto).map((i) => i.id)));
        ids = ids.filter((id) => !compuestos.includes(id)).concat(Object.keys(exp).map(Number));
        await cargarInsumos(ids);
        Toast.info('La cuadrilla no se carga como precio: se agregaron sus componentes.');
      }
      let orden = E.filas.reduce((m, f) => Math.max(m, Number(f.orden) || 0), 0);
      const nuevos = [...new Set(ids)].filter((id) => !en.has(id) && E.info[id] && !E.info[id].compuesto).map((id) => {
        const p = propuestaDeInsumo(E.precios[id], E.lic.plaza);
        return { licitacion_id: E.lic.id, insumo_id: id, precio: p.precio_banco !== null ? red2(p.precio_banco) : 0, precio_banco: p.precio_banco,
          fecha_banco: p.fecha_banco, plaza_banco: p.plaza_banco, fuente_banco: p.fuente_banco, datos: p.datos,
          cantidad: cantidades && cantidades[id] !== undefined ? cantidades[id] : null, origen: origen || 'busqueda', orden: ++orden };
      });
      if (!nuevos.length) { Toast.info('Esos insumos ya estaban en la lista.'); return 0; }
      const guardados = [];
      for (let i = 0; i < nuevos.length; i += 200) {
        const { data, error } = await sb.from('licitacion_precios').insert(nuevos.slice(i, i + 200)).select('id,licitacion_id,insumo_id,precio,precio_banco,fecha_banco,plaza_banco,fuente_banco,ajuste_pct,manual,cantidad,origen,datos,orden,notas,updated_at');
        if (error) throw error; guardados.push(...(data || []));
      }
      E.filas = E.filas.concat(guardados);
      if (origen !== 'catalogo') Toast.success(guardados.length === 1 ? 'Insumo agregado a la lista' : `${guardados.length} insumos agregados a la lista`);
      if (E.vista === 'insumos') pintarInsumos();
      return guardados.length;
    } catch (e) { Toast.error(errTxt(e, 'No se agregaron los insumos')); return 0; }
  }
  async function actualizarFilas(cambios, msg) {
    const COLS = 'id,insumo_id,precio,precio_banco,fecha_banco,plaza_banco,fuente_banco,ajuste_pct,manual,datos,updated_at';
    try {
      if (cambios.length === 1) {
        const { id, ...set } = cambios[0];
        const { data, error } = await sb.from('licitacion_precios').update(set).eq('id', id).select(COLS).single();
        if (error) throw error;
        const f = E.filas.find((x) => x.id === id); if (f) Object.assign(f, data);
      } else {
        // En lote: upsert por (licitación, insumo) de tandas de 200; sólo se escriben las columnas que trae el cambio
        const porId = new Map(E.filas.map((f) => [f.id, f]));
        const filas = cambios.filter((c) => porId.has(c.id)).map(({ id, ...set }) => ({ licitacion_id: E.lic.id, insumo_id: porId.get(id).insumo_id, ...set }));
        for (let i = 0; i < filas.length; i += 200) {
          const { data, error } = await sb.from('licitacion_precios').upsert(filas.slice(i, i + 200), { onConflict: 'licitacion_id,insumo_id' }).select(COLS);
          if (error) throw error;
          for (const d of data || []) { const f = porId.get(d.id); if (f) Object.assign(f, d); }
        }
      }
      if (msg) Toast.success(msg);
    } catch (e) { Toast.error(errTxt(e, 'No se guardó el precio')); }
    if (E.vista === 'insumos') pintarInsumos();
  }
  function cambiarPrecio(id, v) {
    const p = parseFloat(String(v).replace(/[$,\s]/g, ''));
    if (!(p >= 0)) { Toast.error('Escribe un precio válido (número mayor o igual a cero).'); pintarInsumos(); return; }
    return actualizarFilas([{ id, precio: red2(p), manual: true, ajuste_pct: null }]);
  }
  function actualizarFila(id) {
    const f = E.filas.find((x) => x.id === id); if (!f) return;
    const p = propuestaDeInsumo(E.precios[f.insumo_id], E.lic.plaza);
    return actualizarFilas([{ id, precio: red2(p.precio_banco), precio_banco: p.precio_banco, fecha_banco: p.fecha_banco, plaza_banco: p.plaza_banco, fuente_banco: p.fuente_banco, datos: p.datos, manual: false, ajuste_pct: null }], 'Precio actualizado al vigente del banco');
  }
  async function aplicarPorcentaje() {
    const v = (document.getElementById('lpPct') || {}).value; const a = (document.getElementById('lpPctA') || {}).value;
    if (v === '' || v === undefined) { Toast.warning('Escribe el porcentaje (por ejemplo 5 o -3).'); return; }
    const hoy = BP().hoyMx();
    const objetivo = E.filas.filter((f) => !esPctMo(E.info[f.insumo_id]) && (a !== 'ambar' || estadoFila(f, E.lic.plaza, hoy).ambar));
    if (!objetivo.length) { Toast.info('No hay renglones a los que aplicar el ajuste.'); return; }
    let cambios;
    try { cambios = ajustarPorcentaje(objetivo, v); } catch (e) { Toast.error(e.message); return; }
    const manuales = objetivo.filter((f) => f.manual).length;
    const ok = await Dialog.confirm({ title: 'Aplicar el porcentaje', body: `Se recalculan ${objetivo.length} precio${objetivo.length === 1 ? '' : 's'} como precio del banco ${Number(v) >= 0 ? 'más' : 'menos'} ${Math.abs(Number(v))} %.${manuales ? ` ${manuales} de ellos se capturaron a mano y se reemplazan.` : ''}`, confirmText: 'Aplicar el porcentaje' });
    if (!ok) return;
    await actualizarFilas(cambios, `Ajuste de ${Number(v)} % aplicado a ${cambios.length} precio${cambios.length === 1 ? '' : 's'}`);
  }
  async function quitar(id) {
    const f = E.filas.find((x) => x.id === id); if (!f) return;
    try {
      const { error } = await sb.from('licitacion_precios').delete().eq('id', id);
      if (error) throw error;
      E.filas = E.filas.filter((x) => x.id !== id);
      Toast.success(`${(E.info[f.insumo_id] || {}).clave || 'Insumo'} quitado de la lista`);
      pintarInsumos();
    } catch (e) { Toast.error(errTxt(e, 'No se quitó el insumo')); }
  }
  function nombreArchivo(ext) {
    const base = String(E.lic.codigo || 'licitacion').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
    return `${base}.${ext}`;
  }
  function descargarBlob(blob, nombre) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function descargarOpus() {
    const { doc, omitidos } = documentoOpus(E.lic, E.filas, E.info);
    if (!doc.recursos.length) { Toast.warning('No hay insumos con precio para mandar a OPUS.'); return; }
    descargarBlob(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json;charset=utf-8' }), 'opus-insumos_' + nombreArchivo('json'));
    Toast.success(`Archivo para OPUS con ${doc.recursos.length} insumo${doc.recursos.length === 1 ? '' : 's'}${omitidos.length ? ` (${omitidos.length} fuera: ${resumenOmitidos(omitidos)})` : ''}`);
  }
  function descargarExcel() {
    if (typeof XLSX === 'undefined') { Toast.error('No cargó el generador de Excel. Revisa tu conexión y vuelve a intentar.'); return; }
    const filas = filasExcelLista(ordenadas(), E.info, E.lic.plaza, BP().hoyMx());
    const ws = XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 16 }, { wch: 60 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 14 }];
    filas.forEach((f, i) => { for (const col of ['E', 'F']) { const c = ws[col + (i + 2)]; if (c && typeof c.v === 'number') c.z = '"$"#,##0.00'; } });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Precios');
    XLSX.writeFile(wb, 'Precios_' + nombreArchivo('xlsx'));
    Toast.success('Lista de precios exportada a Excel');
  }

  // ---- Vista Catálogo (US-833 y la vía «importar el catálogo» de US-829) ------------------------------------------
  function elegirCatalogo() { const i = document.getElementById('lpCatFile'); if (i) { i.value = ''; i.click(); } }
  async function filasDeArchivo(buf, nombre) {
    if (typeof XLSX === 'undefined') throw new Error('No cargó el lector de Excel. Revisa tu conexión y vuelve a intentar.');
    const wb = /\.csv$/i.test(nombre || '') ? XLSX.read(new TextDecoder('utf-8').decode(buf), { type: 'string' }) : XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  }
  async function leerArchivoCatalogo(file) {
    if (!file) return;
    try { await procesarCatalogo(await filasDeArchivo(await file.arrayBuffer(), file.name), file.name); } catch (e) { Toast.error(errTxt(e, 'No se pudo leer el catálogo')); }
  }
  async function catalogoDeArchivo(id) {
    const a = (E.archivos || []).find((x) => x.id === id); if (!a) return;
    try {
      const { data, error } = await sb.storage.from('licitaciones').download(a.archivo_path);
      if (error) throw error;
      await procesarCatalogo(await filasDeArchivo(await data.arrayBuffer(), a.nombre), a.nombre);
    } catch (e) { Toast.error(errTxt(e, 'No se pudo leer el catálogo')); }
  }
  /** Lee el catálogo, lo empareja con el banco y recalcula las matrices a precios vigentes. */
  async function procesarCatalogo(rows, nombre) {
    const cat = leerCatalogo(rows);
    E.vista = 'catalogo'; E.cat = { nombre, proyecto: cat.proyecto, errores: cat.errores, sinPrecios: cat.sinPrecios, cargando: true, filas: null, filtro: 'todos' };
    repintar();
    try {
      E.cat = Object.assign(E.cat, await analizarCatalogo(cat.conceptos), { cargando: false });
    } catch (e) { E.cat.cargando = false; E.cat.error = errTxt(e, 'No se pudo analizar el catálogo'); }
    if (E.vista === 'catalogo') pintarCatalogo();
  }
  async function analizarCatalogo(conceptos) {
    const B = BP();
    const [historicos, pus] = await Promise.all([
      paginado(() => sb.from('conceptos_historicos').select('id,clave,descripcion,unidad').order('id')),
      paginado(() => sb.from('concepto_precios').select('id,concepto_id,licitacion_id,fecha,plaza,pu,costo_directo').order('id')),
    ]);
    const pusDe = {}; for (const p of pus) (pusDe[p.concepto_id] = pusDe[p.concepto_id] || []).push(p);
    const conPU = new Set(Object.keys(pusDe).map(Number));
    const emp = emparejarCatalogo(conceptos, historicos, { conAntecedente: conPU });
    const hIds = [...new Set(emp.filter((e) => e.historico).map((e) => e.historico.id))];
    const mc = await porTandas(hIds, (t) => sb.from('matriz_componentes').select('id,concepto_id,insumo_id,cantidad,licitacion_id,orden').in('concepto_id', t).order('id'));
    // Una matriz por concepto: la de la licitación del PU más reciente que la tenga
    const porLic = {};
    for (const m of mc) {
      const c = porLic[m.concepto_id] = porLic[m.concepto_id] || {};
      (c[m.licitacion_id || 0] = c[m.licitacion_id || 0] || []).push(m);
    }
    const matrices = {};
    for (const id of hIds) {
      const lics = Object.keys(porLic[id] || {}).map(Number);
      const lic = licitacionDeMatriz(pusDe[id], lics);
      if (lic !== null) matrices[id] = porLic[id][lic].slice().sort((a, b) => (a.orden || 0) - (b.orden || 0)).map((m) => ({ insumo_id: m.insumo_id, cantidad: Number(m.cantidad) }));
    }
    const todos = Object.values(matrices).flat();
    const dm = todos.length ? await B.datosMatriz(todos, null) : { info: {}, precios: {}, aux: {} };
    // Precio vigente: el de la lista de esta licitación si el insumo está en ella; si no, el vigente de la plaza
    const deLista = Object.fromEntries(E.filas.map((f) => [f.insumo_id, Number(f.precio)]));
    const vig = {};
    for (const id of Object.keys(dm.info)) { const v = B.precioVigente(dm.precios[id], E.lic.plaza || null); vig[id] = deLista[id] !== undefined ? deLista[id] : (v ? v.precio : null); }
    const filas = emp.map((e) => {
      let calc = null;
      if (e.historico && matrices[e.historico.id]) calc = B.recalcularMatriz(matrices[e.historico.id].map((x) => ({ ...x, ...(dm.info[x.insumo_id] || {}) })), vig, dm.aux);
      return sugerenciaDe(e, e.historico ? resumenPUs(pusDe[e.historico.id]) : null, calc);
    });
    const compuestos = new Set(Object.values(dm.info).filter((i) => i.compuesto).map((i) => i.id));
    const insumos = explotarInsumos(emp, matrices, dm.aux, compuestos);
    for (const [id, i] of Object.entries(dm.info)) { if (!E.info[id]) E.info[id] = i; if (!E.precios[id]) E.precios[id] = dm.precios[id] || []; }
    return { filas, resumen: resumenSugerencias(filas), insumos };
  }
  function pintarCatalogo() {
    const el = document.getElementById('lpCuerpo'); if (!el) return;
    const C = E.cat;
    const btnImp = `<button type="button" class="btn btn-s" onclick="LicitacionPrecios.elegirCatalogo()"><i class="ri-file-excel-2-line" aria-hidden="true"></i> ${C ? 'Importar otro catálogo' : 'Importar el catálogo del concurso'}</button>${catalogosDeArchivos().map((a) => ` <button type="button" class="btn btn-s" onclick="LicitacionPrecios.catalogoDeArchivo(${+a.id})"><i class="ri-folder-3-line" aria-hidden="true"></i> Usar «${S_(String(a.nombre).slice(0, 40))}»</button>`).join('')}<input id="lpCatFile" type="file" accept=".xlsx,.xls,.csv" class="hidden" aria-hidden="true" tabindex="-1" onchange="LicitacionPrecios.leerArchivoCatalogo(this.files[0])">`;
    if (!C) {
      el.innerHTML = EmptyState({ icon: 'ri-file-list-3-line', title: 'Importa el catálogo del concurso',
        body: 'Sube el Excel del catálogo (el de OPUS con precios en cero sirve). Cada concepto se busca en las matrices históricas por clave y luego por descripción, con su PU más reciente, el rango y el costo de su matriz a precios vigentes.' }) + `<div class="flex flex-wrap justify-center gap-2 mt-3">${btnImp}</div>`;
      return;
    }
    if (C.cargando) { el.innerHTML = `<p class="text-sm mb-2" role="status"><i class="ri-loader-4-line animate-spin" aria-hidden="true"></i> Buscando antecedentes de ${S_(C.nombre || 'el catálogo')}…</p>${Skeleton.table(6, 5)}`; return; }
    if (C.error) { el.innerHTML = `<p class="text-sm text-danger mb-3">${S_(C.error)}</p>${btnImp}`; return; }
    const r = C.resumen; const B = BP();
    const kpi = (v, l) => `<div class="kpi"><p class="kpi-v">${v}</p><p class="kpi-l">${l}</p></div>`;
    const vis = C.filas.filter((f) => C.filtro === 'todos' || (C.filtro === 'con' ? f.antecedente : !f.antecedente));
    const nIns = Object.keys(C.insumos || {}).length; const enLista = new Set(E.filas.map((f) => f.insumo_id));
    const faltan = Object.keys(C.insumos || {}).map(Number).filter((id) => !enLista.has(id)).length;
    const seg = (k, t) => `<button type="button" class="seg-btn${C.filtro === k ? ' active' : ''}" aria-pressed="${C.filtro === k}" onclick="LicitacionPrecios.filtrarCatalogo('${k}')">${t}</button>`;
    const fila = (f) => `<tr><td data-et="Clave" class="font-mono text-xs whitespace-nowrap">${S_(f.clave)}</td><td data-et="Concepto">${S_(String(f.descripcion).slice(0, 160))}${String(f.descripcion).length > 160 ? '…' : ''}${f.antecedente ? `<span class="block text-xs text-ink-muted">Antecedente ${S_(f.historico_clave || 's/c')} · ${f.metodo === 'clave' ? 'por clave' : `por descripción (${Math.round((f.puntaje || 0) * 100)} %)`}${f.unidad_distinta ? ' · <span class="bp-viejo">unidad distinta</span>' : ''}</span>` : '<span class="block text-xs bp-viejo">Analizar desde cero</span>'}</td>
<td data-et="Cantidad" class="text-right">${num(f.cantidad, 3)} ${S_(f.unidad)}</td>
<td data-et="PU más reciente" class="text-right">${f.pu_reciente !== null ? `${money(f.pu_reciente)}<span class="block text-xs text-ink-muted">${S_(fechaCorta(f.fecha_pu))} · ${S_(B.PLAZAS[f.plaza_pu] || f.plaza_pu || '')}</span>` : '—'}</td>
<td data-et="Rango" class="text-right">${f.muestras > 1 ? `${money(f.pu_min)} a ${money(f.pu_max)}<span class="block text-xs text-ink-muted">${f.muestras} PU</span>` : (f.muestras === 1 ? '<span class="text-xs text-ink-muted">Un solo PU</span>' : '—')}</td>
<td data-et="Costo de la matriz hoy" class="text-right">${f.cd_vigente !== null ? `${money(f.cd_vigente)}${f.cd_original ? `<span class="block text-xs text-ink-muted">Original ${money(f.cd_original)}</span>` : ''}${f.sin_precio ? `<span class="block text-xs text-danger">${f.sin_precio} sin precio</span>` : ''}` : '—'}</td>
<td data-et="PU sugerido" class="text-right font-semibold">${money(f.pu_sugerido)}</td></tr>`;
    el.innerHTML = `<div class="flex flex-wrap items-center gap-2 mb-2"><p class="text-sm flex-1"><i class="ri-file-excel-2-line" aria-hidden="true"></i> ${S_(C.nombre || 'Catálogo')}${C.proyecto ? ` · <span class="text-ink-muted">${S_(C.proyecto)}</span>` : ''}</p>${btnImp}</div>
<div class="kpi-strip">${kpi(r.total, 'Conceptos del catálogo')}${kpi(r.con_antecedente, `Con antecedente (${r.total ? Math.round(r.con_antecedente / r.total * 100) : 0} %)`)}${kpi(r.desde_cero, 'Hay que analizar desde cero')}${kpi(money(r.importe), 'Importe con PU sugerido')}</div>
<div class="flex flex-wrap gap-2 items-center mb-3"><div class="seg bp-seg" role="group" aria-label="Filtrar conceptos">${seg('todos', `Todos (${r.total})`)}${seg('con', `Con antecedente (${r.con_antecedente})`)}${seg('sin', `Desde cero (${r.desde_cero})`)}</div><span class="flex-1"></span>
<button type="button" class="btn btn-s" onclick="LicitacionPrecios.exportarSugerencias()"><i class="ri-file-excel-2-line" aria-hidden="true"></i> Exportar a Excel</button>
<button type="button" class="btn btn-p" ${faltan ? '' : 'disabled'} onclick="LicitacionPrecios.agregarDelCatalogo()"><i class="ri-add-line" aria-hidden="true"></i> ${faltan ? `Agregar ${faltan} insumo${faltan === 1 ? '' : 's'} a la lista` : (nIns ? 'Sus insumos ya están en la lista' : 'Sin insumos que agregar')}</button></div>
<p class="text-xs text-ink-muted mb-2">${r.por_clave} por clave y ${r.por_descripcion} por descripción. El costo de la matriz usa el precio de la lista de esta licitación y, si el insumo no está en ella, el vigente de ${S_(E.lic.plaza ? B.PLAZAS[E.lic.plaza] || E.lic.plaza : 'cualquier plaza')}. El PU sugerido conserva la proporción PU / costo directo de la propuesta más reciente. Nada de esto se escribe en OPUS.</p>
<div class="table-wrap g rounded-xl" tabindex="0" role="region" aria-label="Precios unitarios sugeridos del catálogo"><table class="table-modern tbl-apilada w-full text-sm"><thead><tr><th scope="col">Clave</th><th scope="col">Concepto</th><th scope="col" class="text-right">Cantidad</th><th scope="col" class="text-right">PU más reciente</th><th scope="col" class="text-right">Rango</th><th scope="col" class="text-right">Costo de la matriz hoy</th><th scope="col" class="text-right">PU sugerido</th></tr></thead>
<tbody>${vis.map(fila).join('') || '<tr><td colspan="7" class="text-center py-6 text-ink-muted">Ningún concepto en este filtro.</td></tr>'}</tbody></table></div>`;
  }
  function filtrarCatalogo(k) { if (E && E.cat) { E.cat.filtro = ['con', 'sin'].includes(k) ? k : 'todos'; pintarCatalogo(); } }
  async function agregarDelCatalogo() {
    if (!E || !E.cat || !E.cat.insumos) return;
    const ids = Object.keys(E.cat.insumos).map(Number);
    const n = await agregar(ids, E.cat.insumos, 'catalogo');
    if (n) { Toast.success(`${n} insumo${n === 1 ? '' : 's'} del catálogo agregado${n === 1 ? '' : 's'} a la lista`); E.vista = 'insumos'; repintar(); }
  }
  function exportarSugerencias() {
    if (typeof XLSX === 'undefined') { Toast.error('No cargó el generador de Excel. Revisa tu conexión y vuelve a intentar.'); return; }
    const filas = filasExcelSugerencias(E.cat.filas);
    const ws = XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 14 }, { wch: 70 }, { wch: 8 }, { wch: 10 }, { wch: 34 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 9 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    filas.forEach((f, i) => { for (const col of ['F', 'I', 'J', 'L', 'M', 'N', 'O']) { const c = ws[col + (i + 2)]; if (c && typeof c.v === 'number') c.z = '"$"#,##0.00'; } });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PU sugeridos');
    XLSX.writeFile(wb, 'PU_sugeridos_' + nombreArchivo('xlsx'));
    Toast.success('Sugerencia de precios unitarios exportada a Excel');
  }

  return {
    pintar, verVista, buscar, agregar, cambiarPrecio, actualizarFila, aplicarPorcentaje, quitar, descargarOpus, descargarExcel,
    elegirCatalogo, leerArchivoCatalogo, catalogoDeArchivo, procesarCatalogo, filtrarCatalogo, agregarDelCatalogo, exportarSugerencias,
    _estado: () => E,
    // puras
    propuestaDeInsumo, datosParaOpus, estadoFila, ajustarPorcentaje, documentoOpus, filasExcelLista, isoMx,
    leerCatalogo, indiceHistoricos, emparejarCatalogo, resumenPUs, licitacionDeMatriz, sugerenciaDe, resumenSugerencias,
    explotarInsumos, filasExcelSugerencias,
    DIAS_VIEJO, UMBRAL_CLAVE, UMBRAL_DESCRIPCION, TIPOS_OPUS, MOTIVOS,
  };
})();
if (typeof module !== 'undefined') module.exports = LicitacionPrecios;
