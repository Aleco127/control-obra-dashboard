/**
 * Presets de importación de presupuestos (US-242): OPUS y Neodata exportados a Excel.
 * Funciones puras (sin DOM) para poder probarlas en node:
 * - ImportPresets.detectar(headers)                 → {preset:'opus'|'neodata'|null, mapping:{colIdx:campo}}
 * - ImportPresets.construir(rows, mapping, opts)    → {conceptos:[...], partidas:[{nombre, n, importe}], errores:[{fila, motivo}]}
 *   Reconoce filas de partida (descripción sin cantidad ni precio) y las asigna a los conceptos siguientes; la jerarquía
 *   también se lee de la clave (A, A.01, 1.2.3) o de la sangría del texto.
 */
const ImportPresets = (() => {
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9%.]+/g, ' ').trim();
  const numero = (v) => {
    if (typeof v === 'number') return v;
    let s = String(v ?? '').replace(/[$\s]/g, '');
    if (!s) return 0;
    if (s.includes(',') && s.includes('.')) s = s.lastIndexOf('.') > s.lastIndexOf(',') ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) { const p = s.split(','); s = (p[1] && p[1].length > 2) ? s.replace(/,/g, '') : s.replace(',', '.'); }
    const n = parseFloat(s); return isNaN(n) ? 0 : n;
  };
  const CAMPOS = {
    clave: ['codigo', 'code', 'clave', 'cve', 'no.', 'num', 'partida no'],
    descripcion: ['concepto', 'descripcion', 'description', 'nombre'],
    unidad: ['unidad', 'unit', 'u.m.', 'um', 'u'],
    cantidad: ['cantidad', 'cant', 'qty', 'volumen'],
    precio_unitario: ['p. unitario', 'p.u.', 'pu', 'precio unitario', 'precio', 'unitario', 'costo unitario', 'p unitario', 'p.unitario'],
    importe: ['importe', 'total', 'monto', 'subtotal'],
  };
  function detectar(headers) {
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
    return { preset, mapping };
  }
  function nivelClave(clave) {
    const c = String(clave || '').trim(); if (!c) return null;
    if (/^[A-Z]{1,2}$/i.test(c)) return 1;
    const partes = c.split(/[.\-/]/).filter(Boolean); return partes.length;
  }
  /**
   * rows: matriz de celdas (sin encabezados). mapping: {colIdx: campo}. opts: {obra_id, empresa_id, orden}
   */
  function construir(rows, mapping, opts = {}) {
    const col = {}; Object.entries(mapping).forEach(([i, campo]) => { col[campo] = +i; });
    const celda = (r, campo) => (col[campo] === undefined ? '' : r[col[campo]]);
    const conceptos = [], partidas = [], errores = [];
    let partidaActual = '', orden = opts.orden || 0;
    rows.forEach((r, idx) => {
      const fila = idx + 2; // 1 = encabezados
      const desc = String(celda(r, 'descripcion') ?? '').replace(/\s+/g, ' ').trim();
      const clave = String(celda(r, 'clave') ?? '').trim();
      const unidad = String(celda(r, 'unidad') ?? '').trim();
      const cant = numero(celda(r, 'cantidad')), pu = numero(celda(r, 'precio_unitario')), imp = numero(celda(r, 'importe'));
      if (!desc && !clave) return; // fila vacía
      if (/^(total|subtotal|suma|iva|importe total|gran total)/i.test(desc) && !unidad) return; // pies de tabla
      const esPartida = desc && !unidad && cant === 0 && pu === 0;
      if (esPartida) {
        const nivel = nivelClave(clave) || 1;
        partidaActual = nivel <= 1 || !partidaActual ? desc : desc;
        partidas.push({ nombre: desc, clave, nivel, n: 0, importe: imp });
        return;
      }
      if (!desc) { errores.push({ fila, motivo: 'Sin descripción' }); return; }
      if (!unidad) errores.push({ fila, motivo: `"${desc.slice(0, 40)}": sin unidad, se usa PZA` });
      if (cant <= 0) errores.push({ fila, motivo: `"${desc.slice(0, 40)}": cantidad 0` });
      if (pu <= 0 && imp > 0 && cant > 0) { /* se calcula abajo */ } else if (pu <= 0) errores.push({ fila, motivo: `"${desc.slice(0, 40)}": precio unitario 0` });
      const precio = pu > 0 ? pu : (cant > 0 ? Math.round(imp / cant * 10000) / 10000 : 0);
      if (imp > 0 && cant > 0 && precio > 0 && Math.abs(cant * precio - imp) > Math.max(1, imp * 0.005)) errores.push({ fila, motivo: `"${desc.slice(0, 40)}": importe ${imp} no coincide con cantidad × precio (${Math.round(cant * precio * 100) / 100})` });
      const c = { orden: ++orden, clave: clave || `C${String(conceptos.length + 1).padStart(4, '0')}`, descripcion: desc, unidad: unidad || 'PZA', cantidad: cant, precio_unitario: precio, partida: partidaActual || null };
      if (opts.obra_id) c.obra_id = opts.obra_id; if (opts.empresa_id) c.empresa_id = opts.empresa_id;
      conceptos.push(c);
      const p = partidas[partidas.length - 1]; if (p) p.n++;
    });
    return { conceptos, partidas: partidas.filter(p => p.n > 0 || p.nivel <= 1), errores };
  }
  return { detectar, construir, numero, nivelClave, CAMPOS };
})();
if (typeof module !== 'undefined') module.exports = ImportPresets;
