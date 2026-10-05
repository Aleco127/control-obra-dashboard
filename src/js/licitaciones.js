/**
 * Licitaciones (PRD licitaciones · US-806 esqueleto). Módulo de la barra `lc` (grupo «Licitaciones»), sólo nivel >= 80.
 *
 * Carga perezosa (D4): NO entra a load_all_data_seguro. Al abrirse, `cargar()` lee public.licitaciones (RLS: empresa
 * de la sesión y nivel >= 80) y deja la lista en `D.lic` (arreglo). `D.lic` es una propiedad NO enumerable de D, así
 * que Cache.saveAppData no la guarda en localStorage (los datos de licitaciones no se persisten en el navegador) y,
 * si L() reemplaza D, el módulo vuelve a pedirla sola.
 * En el build el archivo sale como módulo diferido (js/licitaciones.<hash>.js en __LAZY['lc']); sin build lo carga
 * abrirModuloArchivo() de index.html.
 *
 * Depende de (navegador): sb, D, M, S, $, Skeleton, EmptyState, humanizeError, Toast.
 * Las funciones puras (etiquetas, próxima fecha clave, KPIs) se exportan con module.exports para node --test.
 */
const Licitaciones = (() => {
  'use strict';

  // ---- Catálogos (slugs de la BD → etiquetas) ----------------------------------------------------------------------
  const ESTATUS = {
    en_preparacion: 'En preparación', presentada: 'Presentada', ganada: 'Ganada', perdida: 'Perdida',
    desierta: 'Desierta', cancelada: 'Cancelada', no_participamos: 'No participamos',
  };
  const MODALIDADES = {
    licitacion_publica: 'Licitación pública', invitacion: 'Invitación a cuando menos tres personas',
    adjudicacion_directa: 'Adjudicación directa', privada: 'Privada',
  };
  const PLAZAS = {
    cuauhtemoc: 'Cd. Cuauhtémoc', chihuahua: 'Chihuahua', juarez: 'Cd. Juárez', parral: 'Parral',
    casas_grandes: 'Casas Grandes', otra: 'Otra',
  };
  const SOBRES = { legal: 'Legal', tecnico: 'Técnico', economico: 'Económico' };
  const ORIGENES = { expediente: 'Del expediente', se_genera: 'Se genera', opus: 'Sale de OPUS', dependencia: 'Lo entrega la dependencia' };
  const ESTADOS_REQUISITO = {
    pendiente: 'Pendiente', en_revision: 'En revisión', listo: 'Listo', firmado: 'Firmado', escaneado: 'Escaneado',
    foliado: 'Foliado', validado: 'Validado',
  };
  const CATEGORIAS_ARCHIVO = {
    bases: 'Bases', anexo: 'Anexo', acta_junta: 'Acta de junta', plano: 'Plano', catalogo: 'Catálogo',
    circular: 'Circular', fallo: 'Fallo', otro: 'Otro',
  };
  /** Fechas clave en el orden en que ocurren en un concurso. */
  const FECHAS_CLAVE = [
    ['visita', 'Visita de obra'], ['junta_aclaraciones', 'Junta de aclaraciones'],
    ['presentacion', 'Presentación'], ['fallo', 'Fallo'],
  ];
  /** Columnas que pide la lista (lista explícita, como las vistas). */
  const COLUMNAS = 'id,codigo,nombre,convocante,perfil_id,modalidad,plaza,visita,junta_aclaraciones,presentacion,fallo,estatus,monto_propuesto,monto_ganador,obra_id,updated_at';

  // ---- Funciones puras ------------------------------------------------------------------------------------------------
  /** Fecha civil de hoy en México (YYYY-MM-DD). */
  function hoyMx(d) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
  }
  /** Días civiles entre hoy (YYYY-MM-DD) y una fecha/timestamp, contada en México. Negativo si ya pasó. */
  function diasHasta(fecha, hoy) {
    if (!fecha) return null;
    const f = String(fecha).length > 10 ? hoyMx(new Date(fecha)) : String(fecha).slice(0, 10);
    const a = Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10));
    const h = String(hoy || hoyMx());
    const b = Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 1, +h.slice(8, 10));
    return Math.round((a - b) / 86400000);
  }
  /** Próxima fecha clave (hoy o después) de una licitación: {campo, etiqueta, fecha, dias} o null. */
  function proximaFechaClave(lic, hoy) {
    if (!lic) return null;
    for (const [campo, etiqueta] of FECHAS_CLAVE) {
      const dias = diasHasta(lic[campo], hoy);
      if (dias !== null && dias >= 0) return { campo, etiqueta, fecha: lic[campo], dias };
    }
    return null;
  }
  /** KPIs de la lista: en preparación, presentadas, ganadas en el año y % de éxito (ganadas / con fallo del año). */
  function resumen(lics, anio) {
    const a = String(anio || hoyMx().slice(0, 4));
    const delAnio = (l) => String(l.fallo || l.presentacion || '').slice(0, 4) === a;
    const lista = Array.isArray(lics) ? lics : [];
    const enPrep = lista.filter((l) => l.estatus === 'en_preparacion').length;
    const presentadas = lista.filter((l) => l.estatus === 'presentada').length;
    const ganadas = lista.filter((l) => l.estatus === 'ganada' && delAnio(l)).length;
    const resueltas = lista.filter((l) => ['ganada', 'perdida', 'desierta'].includes(l.estatus) && delAnio(l)).length;
    return { en_preparacion: enPrep, presentadas, ganadas_anio: ganadas, resueltas_anio: resueltas, pct_exito: resueltas ? Math.round((ganadas / resueltas) * 100) : null };
  }
  const etiqueta = (mapa, v) => (v && mapa[v]) || v || '';

  // ---- Datos (navegador) --------------------------------------------------------------------------------------------
  let enVuelo = null;
  let pintadas = 0;
  function guardarEnD(clave, valor) {
    Object.defineProperty(D, clave, { value: valor, writable: true, configurable: true, enumerable: false });
  }
  /** Lee las licitaciones de la empresa y las deja en D.lic. Con force vuelve a pedirlas. Devuelve el arreglo. */
  async function cargar(force) {
    if (!force && Array.isArray(D.lic)) return D.lic;
    if (enVuelo && !force) return enVuelo;
    enVuelo = (async () => {
      const { data, error } = await sb.from('licitaciones').select(COLUMNAS)
        .order('presentacion', { ascending: false, nullsFirst: false }).order('id', { ascending: false });
      if (error) throw error;
      guardarEnD('lic', data || []);
      return D.lic;
    })();
    try { return await enVuelo; } finally { enVuelo = null; }
  }

  // ---- Interfaz -------------------------------------------------------------------------------------------------------
  function cabecera() {
    return `<div class="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4"><div>
<h1 class="text-xl font-bold"><i class="ri-auction-line" aria-hidden="true"></i> Licitaciones</h1>
<p class="text-sm text-ink-muted mt-1">Cada concurso con sus fechas clave, los archivos de la convocante y los requisitos por sobre.</p></div></div>`;
  }
  function chipEstatus(s) {
    const tono = { ganada: 'ok', presentada: 'info', en_preparacion: 'warn', perdida: 'danger' }[s];
    const estilo = tono ? `background:var(--${tono}-soft);color:var(--${tono})` : 'background:var(--surface-2);color:var(--ink-muted)';
    return `<span class="chip" style="${estilo}">${S(etiqueta(ESTATUS, s))}</span>`;
  }
  function lista(lics) {
    const hoy = hoyMx();
    const k = resumen(lics);
    const kpi = (t, v) => `<div class="kpi"><p class="kpi-v">${v}</p><p class="kpi-l">${t}</p></div>`;
    const filas = lics.map((l) => {
      const p = proximaFechaClave(l, hoy);
      const prox = p ? `${S(p.etiqueta)} · ${p.dias === 0 ? 'hoy' : `en ${p.dias} día${p.dias === 1 ? '' : 's'}`}` : '<span class="text-ink-subtle">Sin fechas próximas</span>';
      return `<tr><td class="font-mono text-xs">${S(l.codigo)}</td><td>${S(l.nombre)}</td><td>${S(l.convocante || '')}</td><td>${chipEstatus(l.estatus)}</td><td>${prox}</td></tr>`;
    }).join('');
    return `<div class="kpi-strip">${kpi('En preparación', k.en_preparacion)}${kpi('Presentadas', k.presentadas)}${kpi('Ganadas en el año', k.ganadas_anio)}${kpi('Éxito en el año', k.pct_exito === null ? '—' : k.pct_exito + ' %')}</div>
<div class="table-wrap g rounded-xl" tabindex="0" role="region" aria-label="Licitaciones"><table class="table-modern w-full text-sm"><thead><tr><th scope="col">Código</th><th scope="col">Nombre</th><th scope="col">Convocante</th><th scope="col">Estatus</th><th scope="col">Próxima fecha</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  }
  function vacio() {
    return EmptyState({
      icon: 'ri-auction-line', title: 'Aún no hay licitaciones',
      body: 'Registra cada concurso con su convocante y su fecha de presentación; después le agregas las bases, los archivos y los requisitos por sobre.',
      action: { label: 'Nueva licitación', icon: 'ri-add-line', onClick: 'Licitaciones.nueva()' },
    });
  }
  function errorHtml(e) {
    return EmptyState({
      icon: 'ri-error-warning-line', title: 'No se pudieron cargar las licitaciones',
      body: humanizeError(e), action: { label: 'Reintentar', icon: 'ri-refresh-line', onClick: 'Licitaciones.recargar()' },
    });
  }

  /** Pinta el módulo en el contenedor: esqueleto mientras carga, lista, estado vacío o error. */
  async function render(c, force) {
    const turno = ++pintadas;
    c.innerHTML = cabecera() + `<div id="lcCuerpo" aria-busy="true" aria-live="polite">${Skeleton.table(4, 5)}</div>`;
    const cuerpo = () => (turno === pintadas && M === 'lc' ? $('lcCuerpo') : null);
    try {
      const lics = await cargar(force);
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      el.innerHTML = lics.length ? lista(lics) : vacio();
    } catch (e) {
      const el = cuerpo(); if (!el) return;
      el.removeAttribute('aria-busy');
      el.innerHTML = errorHtml(e);
    }
  }
  function recargar() { const c = $('c'); if (c) render(c, true); }
  /** Alta (US-813). En el esqueleto sólo avisa. */
  function nueva() { Toast.info('La captura de licitaciones se habilita en la siguiente entrega de este módulo.'); }

  return {
    render, cargar, recargar, nueva,
    // puras
    hoyMx, diasHasta, proximaFechaClave, resumen, etiqueta,
    ESTATUS, MODALIDADES, PLAZAS, SOBRES, ORIGENES, ESTADOS_REQUISITO, CATEGORIAS_ARCHIVO, FECHAS_CLAVE, COLUMNAS,
  };
})();
if (typeof module !== 'undefined') module.exports = Licitaciones;
