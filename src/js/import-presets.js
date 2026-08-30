/**
 * Presets de importación de presupuestos (US-242): OPUS 24, Neodata y catálogos de concurso.
 * Funciones puras (sin DOM) para poder probarlas en node:
 * - ImportPresets.detectar(headers, rows?)          → {preset:'opus'|'neodata'|null, mapping:{colIdx:campo}, porPosicion}
 * - ImportPresets.construir(rows, mapping, opts)    → {conceptos, partidas, errores, sinPrecios, duplicadas}
 *
 * Fidelidad con OPUS 24 Premium (skill /opus-budget-direct):
 * - El exportador de OPUS escribe columnas fijas: Clave · Concepto · Unidad · Cantidad · P.U. · Importe,
 *   con el nombre del proyecto en B5 y los encabezados en la fila 6. Si los encabezados no se reconocen
 *   se usa ese orden por posición.
 * - Un renglón es partida (Agrupador) cuando trae clave y descripción pero ni unidad ni cantidad; el
 *   importe de esa fila es el subtotal del grupo.
 * - Las claves siguen el patrón NN-XXX para la partida (01-PRE) y NN-XXX-NNN para el concepto
 *   (01-PRE-105), así que la partida de cada concepto se deduce de su propia clave y no depende de que
 *   las filas vengan en orden ni de que exista el renglón del grupo.
 * - Un catálogo de concurso sale de OPUS con los precios en cero: es válido y se importa como catálogo
 *   para cotizar, sin marcar cada renglón como error.
 */
const ImportPresets = (() => {
  // --- Claves de OPUS -------------------------------------------------------
  const RE_GRUPO_OPUS = /^\d{1,3}\s*-\s*[A-ZÑ]{2,6}$/i;                        // 01-PRE
  const RE_CONCEPTO_OPUS = /^\d{1,3}\s*-\s*[A-ZÑ]{2,6}\s*-\s*\d{1,5}[A-Z]?$/i; // 01-PRE-105

  /** Repara el texto que llega mal codificado de un CSV latin-1 leído como UTF-8. */
  const MOJIBAKE = { 'Ã¡': 'á', 'Ã©': 'é', 'Ã­': 'í', 'Ã³': 'ó', 'Ãº': 'ú', 'Ã±': 'ñ', 'Ã‘': 'Ñ', 'Ã': 'Á', 'Ã‰': 'É', 'Ã': 'Í', 'Ã“': 'Ó', 'Ãš': 'Ú', 'Ã¼': 'ü', 'Âº': 'º', 'Â°': '°' };
  function repararTexto(s) {
    let t = String(s === null || s === undefined ? '' : s);
    if (/[ÃÂ]/.test(t)) { Object.keys(MOJIBAKE).forEach(mal => { t = t.split(mal).join(MOJIBAKE[mal]); }); }
    if (t.indexOf('�') >= 0) {
      // El carácter perdido en un catálogo en español es casi siempre la Ó de "-CIÓN/-SIÓN" o una Ñ.
      t = t.replace(/([CS])I�N/g, '$1IÓN').replace(/([cs])i�n/g, '$1ión')
           .replace(/([A-ZÁÉÍÓÚ])�([A-ZÁÉÍÓÚ])/g, '$1Ñ$2').replace(/([a-záéíóú])�([a-záéíóú])/g, '$1ñ$2')
           .replace(/�/g, '');
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  /** Normaliza un encabezado: junta las letras sueltas de "C o n c e p t o", quita saltos y acentos. */
  const norm = (s) => {
    let t = repararTexto(s).replace(/[\r\n]+/g, ' ');
    if ((t.match(/(^|\s)\S(\s|$)/g) || []).length >= 3) t = t.replace(/\s*-\s*/g, '').replace(/\s+/g, '');
    return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9%.]+/g, ' ').trim();
  };
  const vacio = (v) => String(v === null || v === undefined ? '' : v).trim() === '';
  const numero = (v) => {
    if (typeof v === 'number') return v;
    let s = String(v === null || v === undefined ? '' : v).replace(/[$\s]/g, '');
    if (!s) return 0;
    if (s.includes(',') && s.includes('.')) s = s.lastIndexOf('.') > s.lastIndexOf(',') ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) { const p = s.split(','); s = (p[1] && p[1].length > 2) ? s.replace(/,/g, '') : s.replace(',', '.'); }
    const n = parseFloat(s); return isNaN(n) ? 0 : n;
  };

  /** Unidades tal como las escribe OPUS (mayúsculas, sin puntos). */
  const UNIDADES = { m: 'M', m2: 'M2', m3: 'M3', ml: 'ML', mt: 'M', mts: 'M', 'm²': 'M2', 'm³': 'M3', pza: 'PZA', pz: 'PZA', pieza: 'PZA', piezas: 'PZA', kg: 'KG', ton: 'TON', tn: 'TON', lt: 'LT', l: 'LT', litro: 'LT', lote: 'LOTE', jgo: 'JGO', juego: 'JGO', sal: 'SAL', salida: 'SAL', srv: 'SRV', serv: 'SRV', servicio: 'SRV', ha: 'HA', has: 'HA', vje: 'VJE', viaje: 'VJE', cja: 'CJA', rollo: 'ROLLO', tramo: 'TRAMO', jor: 'JOR', hr: 'HR', hra: 'HR', dia: 'DIA', mes: 'MES', und: 'PZA', un: 'PZA', u: 'PZA' };
  const unidad = (v) => { const t = repararTexto(v).replace(/\.$/, ''); if (!t) return ''; const k = t.toLowerCase().replace(/\./g, ''); return UNIDADES[k] || t.toUpperCase(); };

  const CAMPOS = {
    clave: ['codigo', 'code', 'clave', 'cve', 'no.', 'num', 'partida no'],
    descripcion: ['concepto', 'conceptos', 'descripcion', 'description', 'nombre'],
    unidad: ['unidad', 'unit', 'u.m.', 'um', 'u'],
    cantidad: ['cantidad', 'cantidaddeobra', 'cant', 'qty', 'volumen'],
    precio_unitario: ['p. unitario', 'p.u.', 'pu', 'precio unitario', 'preciosunitarios', 'precio', 'unitario', 'costo unitario', 'p unitario', 'p.unitario'],
    importe: ['importe', 'total', 'monto', 'subtotal'],
  };
  /** Orden de columnas del exportador de OPUS cuando no hay encabezados legibles. */
  const LAYOUT_OPUS = { 0: 'clave', 1: 'descripcion', 2: 'unidad', 3: 'cantidad', 4: 'precio_unitario', 5: 'importe' };

  function esClaveOpus(c) { const t = String(c === null || c === undefined ? '' : c).trim(); return RE_GRUPO_OPUS.test(t) || RE_CONCEPTO_OPUS.test(t); }

  /** ¿Las filas tienen la forma posicional de un exportado de OPUS (clave NN-XXX-NNN en la columna A)? */
  function pareceLayoutOpus(rows) {
    const muestra = (rows || []).filter(r => r && r.some(c => !vacio(c))).slice(0, 60);
    if (muestra.length < 3) return false;
    const conClave = muestra.filter(r => esClaveOpus(r[0])).length;
    const conUnidad = muestra.filter(r => !vacio(r[2]) && /^[A-Za-z][A-Za-z0-9²³.]{0,5}$/.test(String(r[2]).trim())).length;
    return conClave >= Math.max(3, muestra.length * 0.5) && conUnidad >= muestra.length * 0.3;
  }

  function detectar(headers, rows) {
    const hs = (headers || []).map(norm);
    const mapping = {};
    const asignar = (campo) => { const i = hs.findIndex((h, idx) => !mapping[idx] && CAMPOS[campo].some(k => h === k || h.startsWith(k + ' ') || h.includes(k))); if (i >= 0) mapping[i] = campo; return i >= 0; };
    // orden importa: 'importe' antes que 'precio' para que "total" no se lleve el precio
    ['clave', 'descripcion', 'unidad', 'cantidad', 'importe', 'precio_unitario'].forEach(asignar);
    const tiene = (c) => Object.values(mapping).includes(c);
    let preset = null;
    if (tiene('descripcion') && tiene('precio_unitario') && tiene('importe')) {
      const cod = hs.some(h => /^codigo/.test(h)), conc = hs.some(h => /^concepto/.test(h)), pu = hs.some(h => /p\.? ?unitario|^p\.u\.?$/.test(h));
      const cve = hs.some(h => /^clave/.test(h)), desc = hs.some(h => /^descripcion/.test(h)), precio = hs.some(h => /^precio$/.test(h));
      preset = (cod || conc || pu) && !(cve && desc && precio) ? 'opus' : (cve || desc || precio) ? 'neodata' : 'opus';
    }
    // Sin encabezados legibles: si las claves son de OPUS se usa su orden fijo de columnas.
    if (!preset && pareceLayoutOpus(rows && rows.length ? rows : [headers || []])) {
      return { preset: 'opus', mapping: Object.assign({}, LAYOUT_OPUS), porPosicion: true };
    }
    return { preset: preset, mapping: mapping, porPosicion: false };
  }

  /** Nivel jerárquico de la clave: 01-PRE = 1, 01-PRE-105 = 2, A = 1, A.01 = 2, 1.2.3 = 3. */
  function nivelClave(clave) {
    const c = String(clave || '').trim(); if (!c) return null;
    if (RE_GRUPO_OPUS.test(c)) return 1;
    if (RE_CONCEPTO_OPUS.test(c)) return 2;
    if (/^[A-Z]{1,2}$/i.test(c)) return 1;
    return c.split(/[.\-/]/).filter(Boolean).length;
  }

  /** Clave de la partida a la que pertenece un concepto: 01-PRE-105 → 01-PRE, A.01 → A, 1.2.3 → 1.2. */
  function claveGrupoDe(clave) {
    const c = String(clave || '').trim(); if (!c || RE_GRUPO_OPUS.test(c)) return null;
    if (RE_CONCEPTO_OPUS.test(c)) return c.replace(/\s*-\s*\d{1,5}[A-Z]?$/i, '').replace(/\s*-\s*/g, '-').toUpperCase();
    const partes = c.split(/[.\-/]/).filter(Boolean);
    if (partes.length < 2) return null;
    return c.slice(0, c.length - (partes[partes.length - 1].length + 1)).toUpperCase();
  }

  /**
   * rows: matriz de celdas (sin encabezados). mapping: {colIdx: campo}. opts: {obra_id, empresa_id, orden}
   */
  function construir(rows, mapping, opts) {
    opts = opts || {};
    const col = {}; Object.entries(mapping).forEach(([i, campo]) => { col[campo] = +i; });
    const celda = (r, campo) => (col[campo] === undefined ? '' : r[col[campo]]);
    const conceptos = [], partidas = [], errores = [];
    const porClave = {};                 // clave de partida → objeto partida
    let orden = opts.orden || 0, ultimaPartida = null;

    // --- Paso 1: clasificar cada renglón ------------------------------------
    const filas = [];
    rows.forEach((r, idx) => {
      const fila = idx + 2; // 1 = encabezados
      const desc = repararTexto(celda(r, 'descripcion'));
      const clave = repararTexto(celda(r, 'clave')).toUpperCase();
      const uni = unidad(celda(r, 'unidad'));
      const cantVacia = vacio(celda(r, 'cantidad')), puVacio = vacio(celda(r, 'precio_unitario'));
      const cant = numero(celda(r, 'cantidad')), pu = numero(celda(r, 'precio_unitario')), imp = numero(celda(r, 'importe'));
      if (!desc && !clave) return;
      if (/^(total|subtotal|suma|iva|importe total|gran total|costo directo)/i.test(desc) && !uni) return;
      // Partida (Agrupador de OPUS): clave de grupo, o descripción sin unidad ni cantidad.
      const esPartida = !!desc && (RE_GRUPO_OPUS.test(clave) || (!uni && cantVacia && puVacio) || (!uni && cant === 0 && pu === 0));
      filas.push({ fila: fila, desc: desc, clave: clave, uni: uni, cant: cant, pu: pu, imp: imp, esPartida: esPartida });
    });

    // --- Paso 2: registrar partidas -----------------------------------------
    filas.filter(f => f.esPartida).forEach(f => {
      const p = { nombre: f.desc, clave: f.clave, nivel: nivelClave(f.clave) || 1, n: 0, importe: f.imp, suma: 0 };
      partidas.push(p);
      if (f.clave) porClave[f.clave] = p;
    });
    // Catálogo de OPUS exportado sin los renglones de grupo: se deducen de la clave de cada concepto.
    if (!partidas.length) {
      filas.filter(f => !f.esPartida).forEach(f => {
        const g = claveGrupoDe(f.clave);
        if (g && !porClave[g]) { const p = { nombre: g, clave: g, nivel: 1, n: 0, importe: 0, suma: 0, derivada: true }; partidas.push(p); porClave[g] = p; }
      });
    }

    // --- Paso 3: conceptos ---------------------------------------------------
    const crudos = filas.filter(f => !f.esPartida);
    const sinPrecios = crudos.length > 0 && crudos.every(f => f.pu === 0 && f.imp === 0);
    const vistas = {};
    filas.forEach(f => {
      if (f.esPartida) { ultimaPartida = porClave[f.clave] || partidas.find(p => p.nombre === f.desc) || ultimaPartida; return; }
      if (!f.desc) { errores.push({ fila: f.fila, motivo: 'Sin descripción' }); return; }
      const corta = f.desc.slice(0, 40);
      if (!f.uni) errores.push({ fila: f.fila, motivo: `"${corta}": sin unidad, se usa PZA` });
      if (f.cant <= 0) errores.push({ fila: f.fila, motivo: `"${corta}": cantidad 0` });
      if (!sinPrecios && f.pu <= 0 && !(f.imp > 0 && f.cant > 0)) errores.push({ fila: f.fila, motivo: `"${corta}": precio unitario 0` });
      const precio = f.pu > 0 ? f.pu : (f.cant > 0 && f.imp > 0 ? Math.round(f.imp / f.cant * 10000) / 10000 : 0);
      if (f.imp > 0 && f.cant > 0 && precio > 0 && Math.abs(f.cant * precio - f.imp) > Math.max(1, f.imp * 0.005)) errores.push({ fila: f.fila, motivo: `"${corta}": importe ${f.imp} no coincide con cantidad × precio (${Math.round(f.cant * precio * 100) / 100})` });
      // La partida sale de la clave del propio concepto; si no la trae, de la última partida leída.
      const p = porClave[claveGrupoDe(f.clave)] || ultimaPartida || null;
      if (f.clave) { if (vistas[f.clave]) errores.push({ fila: f.fila, motivo: `Clave repetida ${f.clave} (también en la fila ${vistas[f.clave]})` }); else vistas[f.clave] = f.fila; }
      const c = { orden: ++orden, clave: f.clave || `C${String(conceptos.length + 1).padStart(4, '0')}`, descripcion: f.desc, unidad: f.uni || 'PZA', cantidad: f.cant, precio_unitario: precio, partida: p ? p.nombre : null };
      if (opts.obra_id) c.obra_id = opts.obra_id;
      if (opts.empresa_id) c.empresa_id = opts.empresa_id;
      conceptos.push(c);
      if (p) { p.n++; p.suma += f.cant * precio; }
    });

    // --- Paso 4: cuadre de cada partida contra su subtotal --------------------
    if (!sinPrecios) partidas.forEach(p => {
      if (p.importe > 0 && p.n > 0 && Math.abs(p.suma - p.importe) > Math.max(1, p.importe * 0.005))
        errores.push({ fila: null, motivo: `Partida "${p.nombre}": sus conceptos suman ${Math.round(p.suma * 100) / 100} y el subtotal del archivo dice ${p.importe}` });
    });

    return { conceptos: conceptos, partidas: partidas.filter(p => p.n > 0 || p.nivel <= 1), errores: errores, sinPrecios: sinPrecios, duplicadas: errores.filter(e => /repetida/.test(e.motivo)).length };
  }

  return { detectar, construir, numero, unidad, nivelClave, claveGrupoDe, repararTexto, esClaveOpus, pareceLayoutOpus, CAMPOS, LAYOUT_OPUS };
})();
if (typeof module !== 'undefined') module.exports = ImportPresets;
