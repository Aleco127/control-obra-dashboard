/**
 * Banco de precios (PRD licitaciones · US-806 esqueleto). Módulo de la barra `bp`, sólo nivel >= 80 (D3: los precios
 * no los ve nadie más; la RLS de insumos, insumo_precios, conceptos_historicos, concepto_precios y matriz_componentes
 * lo exige también para leer).
 *
 * Carga perezosa (D4): NO entra a load_all_data_seguro. Al abrirse, `cargar()` lee la primera página de
 * public.insumos_resumen (último precio, mediana, mínimo, máximo, muestras y variación) con el total, y la deja en
 * `D.ins = { filas, total, limite }` (propiedad NO enumerable de D: no se guarda en localStorage).
 * La búsqueda difusa va por la RPC buscar_insumos(p_texto, p_tipo, p_plaza, p_limite) (US-822), que ya devuelve el
 * precio vigente de la plaza (o el último general, con de_otra_plaza = true).
 * En el build sale como módulo diferido (js/banco-precios.<hash>.js en __LAZY['bp']).
 *
 * Precios SIN IVA en todo el banco (como en OPUS).
 * Depende de (navegador): sb, D, M, S, $, F, Skeleton, EmptyState, humanizeError, Toast.
 * Las funciones puras (normalización, precio vigente, antigüedad) se exportan con module.exports.
 */
const BancoPrecios = (() => {
  'use strict';

  // ---- Catálogos ------------------------------------------------------------------------------------------------------
  const TIPOS = { material: 'Material', mano_obra: 'Mano de obra', equipo: 'Equipo', herramienta: 'Herramienta', auxiliar: 'Auxiliar' };
  const PLAZAS = { cuauhtemoc: 'Cd. Cuauhtémoc', chihuahua: 'Chihuahua', juarez: 'Cd. Juárez', parral: 'Parral', casas_grandes: 'Casas Grandes', otra: 'Otra' };
  const FUENTES = { opus: 'OPUS', cotizacion: 'Cotización', compra: 'Compra', manual: 'Manual', referencia: 'Referencia' };
  /** Un precio con más de estos días se marca como viejo (US-823, US-829). */
  const DIAS_PRECIO_VIEJO = 180;
  const LIMITE_PAGINA = 200;
  const COLUMNAS = 'id,clave,descripcion,unidad,tipo,familia,activo,ultimo_precio,ultima_fecha,ultima_plaza,ultima_fuente,precio_anterior,variacion_pct,mediana,minimo,maximo,muestras';

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
  /**
   * Precio vigente (D5): el más reciente de la plaza; si la plaza no tiene, el más reciente de cualquier plaza.
   * precios: [{precio, fecha, plaza, id?}] · devuelve {precio, fecha, plaza, de_otra_plaza} o null.
   */
  function precioVigente(precios, plaza) {
    const orden = (a, b) => String(b.fecha).localeCompare(String(a.fecha)) || ((b.id || 0) - (a.id || 0));
    const lista = (precios || []).filter((p) => p && p.precio !== null && p.precio !== undefined && p.fecha).slice().sort(orden);
    if (!lista.length) return null;
    const dePlaza = plaza ? lista.find((p) => p.plaza === plaza) : null;
    const p = dePlaza || lista[0];
    return { precio: Number(p.precio), fecha: String(p.fecha).slice(0, 10), plaza: p.plaza, de_otra_plaza: !!plaza && !dePlaza };
  }

  // ---- Datos (navegador) --------------------------------------------------------------------------------------------
  let enVuelo = null;
  let pintadas = 0;
  function guardarEnD(clave, valor) {
    Object.defineProperty(D, clave, { value: valor, writable: true, configurable: true, enumerable: false });
  }
  async function cargar(force) {
    if (!force && D.ins && Array.isArray(D.ins.filas)) return D.ins;
    if (enVuelo && !force) return enVuelo;
    enVuelo = (async () => {
      const { data, error, count } = await sb.from('insumos_resumen').select(COLUMNAS, { count: 'exact' })
        .order('tipo').order('clave').limit(LIMITE_PAGINA);
      if (error) throw error;
      guardarEnD('ins', { filas: data || [], total: count ?? (data || []).length, limite: LIMITE_PAGINA });
      return D.ins;
    })();
    try { return await enVuelo; } finally { enVuelo = null; }
  }

  // ---- Interfaz -------------------------------------------------------------------------------------------------------
  function cabecera() {
    return `<div class="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4"><div>
<h1 class="text-xl font-bold"><i class="ri-price-tag-3-line" aria-hidden="true"></i> Banco de precios</h1>
<p class="text-sm text-ink-muted mt-1">Cada precio con su fecha, plaza y fuente, sin IVA, para reutilizarlo en tus propuestas y cargarlo a OPUS.</p></div></div>`;
  }
  function tabla(ins) {
    const hoy = hoyMx();
    const filas = ins.filas.map((i) => {
      const viejo = esViejo(i.ultima_fecha, hoy);
      const precio = i.ultimo_precio === null || i.ultimo_precio === undefined ? '<span class="text-ink-subtle">Sin precio</span>' : F(i.ultimo_precio);
      return `<tr><td class="font-mono text-xs">${S(i.clave)}</td><td>${S(i.descripcion)}</td><td>${S(i.unidad)}</td><td>${S(TIPOS[i.tipo] || i.tipo)}</td><td class="text-right">${precio}</td><td${viejo ? ' style="color:var(--warn)" title="Precio con más de 180 días"' : ''}>${S(i.ultima_fecha || '—')}</td><td class="text-right">${Number(i.muestras) || 0}</td></tr>`;
    }).join('');
    const pie = ins.total > ins.filas.length ? `<p class="text-xs text-ink-subtle mt-2">Se muestran ${ins.filas.length} de ${ins.total} insumos.</p>` : '';
    return `<div class="table-wrap g rounded-xl" tabindex="0" role="region" aria-label="Insumos del banco de precios"><table class="table-modern w-full text-sm"><thead><tr><th scope="col">Clave</th><th scope="col">Descripción</th><th scope="col">Unidad</th><th scope="col">Tipo</th><th scope="col" class="text-right">Último precio</th><th scope="col">Fecha</th><th scope="col" class="text-right">Muestras</th></tr></thead><tbody>${filas}</tbody></table></div>${pie}`;
  }
  function vacio() {
    return EmptyState({
      icon: 'ri-price-tag-3-line', title: 'El banco de precios está vacío',
      body: 'Aquí se guardará cada insumo con su historial de precios por plaza y fuente: propuestas de OPUS, cotizaciones y compras reales.',
      action: { label: 'Agregar insumo', icon: 'ri-add-line', onClick: 'BancoPrecios.nuevoInsumo()' },
    });
  }
  function errorHtml(e) {
    return EmptyState({
      icon: 'ri-error-warning-line', title: 'No se pudo cargar el banco de precios',
      body: humanizeError(e), action: { label: 'Reintentar', icon: 'ri-refresh-line', onClick: 'BancoPrecios.recargar()' },
    });
  }
  async function render(c, force) {
    const turno = ++pintadas;
    c.innerHTML = cabecera() + `<div id="bpCuerpo" aria-busy="true" aria-live="polite">${Skeleton.table(5, 6)}</div>`;
    const cuerpo = () => (turno === pintadas && M === 'bp' ? $('bpCuerpo') : null);
    try {
      const ins = await cargar(force);
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      el.innerHTML = ins.filas.length ? tabla(ins) : vacio();
    } catch (e) {
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      el.innerHTML = errorHtml(e);
    }
  }
  function recargar() { const c = $('c'); if (c) render(c, true); }
  /** Alta de insumo (US-822). En el esqueleto sólo avisa. */
  function nuevoInsumo() { Toast.info('La captura de insumos se habilita en la siguiente entrega de este módulo.'); }

  return {
    render, cargar, recargar, nuevoInsumo,
    // puras
    hoyMx, normalizarTexto, antiguedadDias, esViejo, precioVigente,
    TIPOS, PLAZAS, FUENTES, DIAS_PRECIO_VIEJO, LIMITE_PAGINA, COLUMNAS,
  };
})();
if (typeof module !== 'undefined') module.exports = BancoPrecios;
