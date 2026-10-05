/**
 * Convocatorias (PRD licitaciones · épica F, US-843 a US-846 y US-850). Pestaña «Convocatorias» de Licitaciones (`lc`),
 * sólo nivel >= 80 (las RPC lo exigen en el servidor).
 *
 * Se engancha con Licitaciones.registrarPestana('lista', {k:'convocatorias', ...}). Viaja con licitaciones.js: en el
 * build sale en el mismo diferido de `lc` (scripts/build.mjs, LAZY_ARCHIVOS.extra) y sin build lo pide
 * Licitaciones.render() con conExtras().
 *
 * Datos (nada de traer las ~1,000 convocatorias al navegador):
 *   - Lista: RPC convocatorias_buscar paginada en el servidor (50 por página) o, tras una búsqueda en los portales,
 *     filtrada por corrida (p_corrida_id).
 *   - Pie: convocatorias_estado (última búsqueda de cada fuente y quién la lanzó).
 *   - Filtros guardados: vista public.convocatoria_filtros (RLS n80); vista previa con get_convocatorias_conteo_filtro.
 *   - Marcas: convocatoria_marcar. «Participar»: convocatoria_participar (crea la licitación y deja «convertida»).
 *
 * Búsqueda a petición (US-850, D12 y D13): nada se consulta hasta que el usuario pulsa «Buscar en los portales».
 *   - Chihuahua: función de borde convocatorias-chihuahua con la sesión (x-obra-token).
 *   - ComprasMX: conector local http://127.0.0.1:8879 (US-851) en la PC del usuario; si no responde se explica cómo
 *     abrirlo y Chihuahua sigue sola.
 *
 * Regla «cumple el filtro»: la fuente de verdad es SQL (control_obra.convocatoria_cumple_filtro, migración 100), que
 * usan convocatorias_buscar, la vista previa, el contador de la barra y el resumen tras una búsqueda. cumpleFiltro()
 * de aquí es la MISMA regla en JS (para pruebas y para marcar filas sin volver al servidor) y
 * scripts/qa/convocatorias.test.mjs la compara contra el servidor.
 *
 * Depende de (navegador): sb, D, M, S, $, Toast, Dialog, EmptyState, Skeleton, openMdl, closeMdl, currentUser,
 * Licitaciones. Las funciones puras se exportan con module.exports para node --test.
 */
const Convocatorias = (() => {
  'use strict';

  // ---- Catálogos -------------------------------------------------------------------------------------------------------
  const FUENTES = { chihuahua: 'Chihuahua', comprasmx: 'Federal' };
  const FUENTES_PORTAL = { chihuahua: 'Contrataciones Chihuahua', comprasmx: 'ComprasMX' };
  const TIPOS = {
    obra_publica: 'Obra pública', servicios_obra: 'Servicios relacionados con la obra', adquisicion: 'Adquisición',
    arrendamiento: 'Arrendamiento', servicios: 'Servicios', otro: 'Otro',
  };
  const PROCEDIMIENTOS = { licitacion_publica: 'Licitación pública', invitacion: 'Invitación a cuando menos tres', adjudicacion_directa: 'Adjudicación directa' };
  const ESTADOS = { nueva: 'Nuevas', interesa: 'Me interesan', descartada: 'Descartadas', convertida: 'Convertidas' };
  const ESTATUS_PORTAL = { vigente: 'Vigente', en_seguimiento: 'En seguimiento', terminado: 'Terminado', cancelado: 'Cancelado' };
  const ESTADOS_DESCARGA = { pendiente: 'Documentos en cola', en_curso: 'Bajando documentos', lista: 'Documentos listos', fallo: 'Descarga con error' };
  const ENTIDADES = ['Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas', 'Chihuahua',
    'Ciudad de México', 'Coahuila', 'Colima', 'Durango', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco', 'México',
    'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro', 'Quintana Roo', 'San Luis Potosí',
    'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas'];
  const POR_PAGINA = 50;
  const PAUSA_MS = 30000;   // entre búsquedas a la misma fuente (el servidor lo exige en Chihuahua)
  const CONECTOR = 'http://127.0.0.1:8879';
  const DOC_CONECTOR = 'https://github.com/Aleco127/control-obra-dashboard/blob/master/docs/licitaciones/conector-local.md';
  const TZ = 'America/Mexico_City';

  // ---- Funciones puras -------------------------------------------------------------------------------------------------
  /** Igual que control_obra.texto_norm: minúsculas, sin acentos (ñ → n), todo lo que no sea letra o número a un espacio. */
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /** Texto donde se buscan las palabras clave: el mismo de la columna generada convocatorias.texto_norm (migración 108: con la descripción al final). */
  function textoConvocatoria(c) {
    const x = c || {};
    return norm([x.numero_procedimiento, x.titulo, x.dependencia, x.unidad_compradora, x.municipio, x.descripcion].map((v) => v || '').join(' '));
  }
  const lista = (v) => (Array.isArray(v) ? v : []);
  /**
   * ¿La convocatoria cumple el filtro? Misma semántica que control_obra.convocatoria_cumple_filtro (migración 100):
   * palabras clave = basta una (subcadena del texto normalizado); palabras a excluir = ninguna; fuentes, entidades y
   * tipos vacíos = todos; entidad comparada normalizada (sin entidad no cumple un filtro con entidades).
   */
  function cumpleFiltro(c, f) {
    if (!c || !f) return false;
    const fuentes = lista(f.fuentes); const tipos = lista(f.tipos_contratacion); const ents = lista(f.entidades);
    if (fuentes.length && !fuentes.includes(c.fuente)) return false;
    if (tipos.length && !tipos.includes(c.tipo_contratacion)) return false;
    if (ents.length) {
      const e = norm(c.entidad);
      if (!ents.some((x) => norm(x) !== '' && norm(x) === e)) return false;
    }
    const txt = c.texto_norm != null ? String(c.texto_norm) : textoConvocatoria(c);
    const claves = lista(f.palabras_clave).map(norm).filter(Boolean);
    if (claves.length && !claves.some((k) => txt.includes(k))) return false;
    const fuera = lista(f.palabras_excluir).map(norm).filter(Boolean);
    if (fuera.some((k) => txt.includes(k))) return false;
    return true;
  }
  /** ¿Cumple algún filtro ACTIVO? (lo que hace p_mis_filtros en el servidor). */
  function cumpleAlguno(c, filtros) { return lista(filtros).some((f) => f && f.activo !== false && cumpleFiltro(c, f)); }
  /** Vigente como en el servidor (control_obra.convocatoria_vigente): estatus vigente/en seguimiento y apertura no vencida (o sin fecha). */
  function vigente(c, ahora) {
    const est = (c && c.estatus) || 'vigente';
    if (!['vigente', 'en_seguimiento'].includes(est)) return false;
    if (!c.apertura) return true;
    return new Date(c.apertura).getTime() >= (ahora ? new Date(ahora).getTime() : Date.now()) - 86400000;
  }
  /** «a, b; c» → ['a','b','c'] (sin vacíos ni repetidos). */
  function parseLista(s) {
    const out = [];
    for (const x of String(s == null ? '' : s).split(/[,;\n]+/)) { const t = x.trim(); if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t); }
    return out;
  }
  function hoyMx(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date()); }
  /** Días civiles (México) de hoy a una fecha; negativo si ya pasó; null sin fecha. */
  function diasA(ts, hoy) {
    if (!ts) return null;
    const f = hoyMx(new Date(ts)); const h = String(hoy || hoyMx());
    return Math.round((Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10)) - Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 1, +h.slice(8, 10))) / 86400000);
  }
  /**
   * Texto de la barra → {palabras, excluir}: «red agua -mantenimiento» = deben aparecer «red» y «agua» (todas) y no
   * «mantenimiento». Las palabras se normalizan como en el servidor; «-» solo o vacío no cuenta.
   */
  function parseTextoBarra(s) {
    const palabras = []; const excluir = [];
    for (const t of String(s == null ? '' : s).split(/\s+/)) {
      if (!t) continue;
      if (t.startsWith('-')) { const n = norm(t.slice(1)); if (n && !excluir.includes(n)) excluir.push(n); }
      else { for (const w of norm(t).split(' ')) if (w && !palabras.includes(w)) palabras.push(w); }
    }
    return { palabras, excluir };
  }
  /** ¿Pasa la convocatoria el texto de la barra? (misma regla que p_texto + p_excluir de convocatorias_buscar). */
  function cumpleTextoBarra(c, s) {
    const { palabras, excluir } = parseTextoBarra(s);
    const txt = c && c.texto_norm != null ? String(c.texto_norm) : textoConvocatoria(c);
    return palabras.every((w) => txt.includes(w)) && !excluir.some((w) => txt.includes(w));
  }
  /** Estado vacío de la barra (lo que deja «Quitar filtros»). */
  const BARRA_VACIA = { texto: '', fuente: '', entidad: '', municipio: '', dependencia: '', tipo: '', procedimiento: '', estatus: '',
    estado: '', abren: '', abren_desde: '', abren_hasta: '', pub: '', pub_desde: '', pub_hasta: '', orden: 'apertura', mis: false, filtro: '', pagina: 0 };
  /** Estado inicial: las nuevas que cumplen mis filtros (US-843). */
  const BARRA_INICIAL = Object.assign({}, BARRA_VACIA, { estado: 'nueva', mis: true });
  const ORDENES = { apertura: 'Apertura más próxima', publicacion: 'Publicación más reciente', dependencia: 'Dependencia' };
  const PLAZOS_APERTURA = { 7: 'los próximos 7 días', 15: 'los próximos 15 días', 30: 'los próximos 30 días', rango: 'Rango de fechas…' };
  const PLAZOS_PUBLICACION = { 7: 'los últimos 7 días', 15: 'los últimos 15 días', 30: 'los últimos 30 días', 60: 'los últimos 60 días', 90: 'los últimos 90 días', rango: 'Rango de fechas…' };
  const fechaOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  /** Argumentos de convocatorias_buscar desde el estado de la barra (todo el filtrado y la paginación en el servidor). */
  function argsBusqueda(s) {
    const x = Object.assign({}, BARRA_VACIA, s || {});
    const t = parseTextoBarra(x.texto);
    const rangoA = x.abren === 'rango'; const rangoP = x.pub === 'rango';
    return {
      p_texto: t.palabras.length ? t.palabras.join(' ') : null,
      p_excluir: t.excluir.length ? t.excluir : null,
      p_fuentes: x.fuente ? [x.fuente] : null,
      p_entidades: x.entidad ? [x.entidad] : null,
      p_municipio: String(x.municipio || '').trim() || null,
      p_dependencia: String(x.dependencia || '').trim() || null,
      p_tipos: x.tipo ? [x.tipo] : null,
      p_procedimientos: x.procedimiento ? [x.procedimiento] : null,
      p_estatus: x.estatus ? [x.estatus] : null,
      p_estados: x.estado ? [x.estado] : null,
      p_abren_dias: x.abren && !rangoA ? Number(x.abren) : null,
      p_abren_desde: rangoA && fechaOk(x.abren_desde) ? x.abren_desde : null,
      p_abren_hasta: rangoA && fechaOk(x.abren_hasta) ? x.abren_hasta : null,
      p_pub_dias: x.pub && !rangoP ? Number(x.pub) : null,
      p_pub_desde: rangoP && fechaOk(x.pub_desde) ? x.pub_desde : null,
      p_pub_hasta: rangoP && fechaOk(x.pub_hasta) ? x.pub_hasta : null,
      p_orden: ORDENES[x.orden] ? x.orden : 'apertura',
      p_filtro_id: x.filtro ? Number(x.filtro) : null,
      p_mis_filtros: !!x.mis,
      // Con un estatus del portal elegido se ven también las terminadas o canceladas; si no, sólo las vigentes.
      p_solo_vigentes: !x.estatus,
      p_limite: POR_PAGINA,
      p_offset: Math.max(0, Number(x.pagina) || 0) * POR_PAGINA,
    };
  }
  const fmtDia = (v) => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${+m[3]}/${+m[2]}/${m[1]}` : ''; };
  function rangoTexto(d, h) { return d && h ? `${fmtDia(d)} a ${fmtDia(h)}` : d ? `desde el ${fmtDia(d)}` : h ? `hasta el ${fmtDia(h)}` : ''; }
  /**
   * Fichas de los filtros puestos: [{k, t}] en el orden de la barra. `k` es lo que se quita con Convocatorias.quitar(k).
   * `nombreFiltro(id)` da el nombre de un filtro guardado.
   */
  function fichasActivas(s, nombreFiltro) {
    const x = Object.assign({}, BARRA_VACIA, s || {});
    const out = [];
    const t = parseTextoBarra(x.texto);
    if (t.palabras.length) out.push({ k: 'texto', t: `Texto: ${t.palabras.join(' ')}` });
    for (const w of t.excluir) out.push({ k: 'excluir:' + w, t: `Sin «${w}»` });
    if (x.filtro) out.push({ k: 'filtro', t: `Filtro guardado: ${(nombreFiltro && nombreFiltro(x.filtro)) || '#' + x.filtro}` });
    if (x.mis) out.push({ k: 'mis', t: 'Cumplen mis filtros' });
    if (x.fuente) out.push({ k: 'fuente', t: `Fuente: ${FUENTES_PORTAL[x.fuente] || x.fuente}` });
    if (x.entidad) out.push({ k: 'entidad', t: `Entidad: ${x.entidad}` });
    if (String(x.municipio || '').trim()) out.push({ k: 'municipio', t: `Municipio: ${String(x.municipio).trim()}` });
    if (String(x.dependencia || '').trim()) out.push({ k: 'dependencia', t: `Dependencia: ${String(x.dependencia).trim()}` });
    if (x.tipo) out.push({ k: 'tipo', t: TIPOS[x.tipo] || x.tipo });
    if (x.procedimiento) out.push({ k: 'procedimiento', t: PROCEDIMIENTOS[x.procedimiento] || x.procedimiento });
    if (x.estatus) out.push({ k: 'estatus', t: `Estatus: ${ESTATUS_PORTAL[x.estatus] || x.estatus}` });
    if (x.estado) out.push({ k: 'estado', t: `Seguimiento: ${ESTADOS[x.estado] || x.estado}` });
    if (x.abren === 'rango' && (x.abren_desde || x.abren_hasta)) out.push({ k: 'abren', t: `Abren ${rangoTexto(x.abren_desde, x.abren_hasta)}` });
    else if (x.abren && x.abren !== 'rango') out.push({ k: 'abren', t: `Abren en ${PLAZOS_APERTURA[x.abren] || x.abren + ' días'}` });
    if (x.pub === 'rango' && (x.pub_desde || x.pub_hasta)) out.push({ k: 'pub', t: `Publicadas ${rangoTexto(x.pub_desde, x.pub_hasta)}` });
    else if (x.pub && x.pub !== 'rango') out.push({ k: 'pub', t: `Publicadas en ${PLAZOS_PUBLICACION[x.pub] || x.pub + ' días'}` });
    return out;
  }
  /** Estado de la barra sin la ficha `k`. */
  function quitarFicha(s, k) {
    const x = Object.assign({}, BARRA_VACIA, s || {}, { pagina: 0 });
    if (k.startsWith('excluir:')) {
      const w = k.slice(8);
      x.texto = String(x.texto || '').split(/\s+/).filter((t) => !(t.startsWith('-') && norm(t.slice(1)) === w)).join(' ');
    } else if (k === 'texto') {
      x.texto = String(x.texto || '').split(/\s+/).filter((t) => t.startsWith('-') && norm(t.slice(1))).join(' ');
    } else if (k === 'abren') { x.abren = ''; x.abren_desde = ''; x.abren_hasta = ''; }
    else if (k === 'pub') { x.pub = ''; x.pub_desde = ''; x.pub_hasta = ''; }
    else if (k === 'mis') x.mis = false;
    else if (k in x) x[k] = '';
    return x;
  }
  /**
   * «Guardar esta búsqueda» → filtro guardado (US-844). Las columnas del filtro sólo saben de palabras clave (basta
   * una), palabras a excluir, fuentes, entidades y tipos; la barra completa va en `barra` y se reaplica al elegirlo.
   */
  function filtroDesdeBarra(s) {
    const x = Object.assign({}, BARRA_VACIA, s || {});
    const t = parseTextoBarra(x.texto);
    const barra = {};
    for (const k of Object.keys(BARRA_VACIA)) if (!['pagina', 'filtro', 'mis'].includes(k) && x[k] !== BARRA_VACIA[k]) barra[k] = x[k];
    return {
      palabras_clave: t.palabras, palabras_excluir: t.excluir,
      fuentes: x.fuente ? [x.fuente] : [], entidades: x.entidad ? [x.entidad] : [], tipos_contratacion: x.tipo ? [x.tipo] : [],
      barra,
    };
  }
  /** Estado de la barra al elegir un filtro guardado: su barra (si se guardó desde aquí) + la regla del filtro. */
  function barraDesdeFiltro(f) {
    const x = f || {};
    const b = x.barra && typeof x.barra === 'object' ? x.barra : {};
    const out = Object.assign({}, BARRA_VACIA, { estado: '' });
    for (const k of Object.keys(BARRA_VACIA)) if (k in b && !['pagina', 'filtro', 'mis'].includes(k)) out[k] = b[k];
    out.filtro = x.id ? String(x.id) : '';
    out.mis = false;
    return out;
  }
  /** Número de filtros puestos (para «Filtros (N)» en el teléfono). */
  function cuentaFiltros(s) { return fichasActivas(s).length; }
  /** Modalidad de la licitación desde el tipo de procedimiento de la convocatoria. */
  function modalidadDe(tp) { return ['licitacion_publica', 'invitacion', 'adjudicacion_directa'].includes(tp) ? tp : null; }
  /** Plaza de la licitación (catálogo de Licitaciones) desde el municipio (o «Municipio de X» de la dependencia). */
  function plazaDe(municipio, dependencia) {
    let m = norm(municipio);
    if (!m) { const d = String(dependencia || '').match(/municipio de (.+)$/i); m = d ? norm(d[1]) : ''; }
    if (!m) return null;
    if (m.includes('cuauhtemoc')) return 'cuauhtemoc';
    if (m.includes('juarez')) return 'juarez';
    if (m.includes('parral')) return 'parral';
    if (m.includes('casas grandes')) return 'casas_grandes';
    if (m === 'chihuahua') return 'chihuahua';
    return 'otra';
  }
  const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'municipio', 'gobierno', 'estado', 'chihuahua', 'secretaria', 'instituto']);
  /**
   * Perfil de convocante sugerido para la dependencia: el que comparte el nombre (sin lo que va entre paréntesis), su
   * sigla, o el nombre completo que abre su descripción («Instituto Chihuahuense de …»). null si ninguno se parece.
   */
  function sugerirPerfil(dependencia, perfiles) {
    const dep = norm(dependencia);
    if (!dep) return null;
    const palabrasDep = new Set(dep.split(' '));
    let mejor = null; let puntos = 0;
    for (const p of lista(perfiles)) {
      if (!p || p.activo === false) continue;
      const nombre = norm(String(p.nombre || '').replace(/\([^)]*\)/g, ' '));
      const desc = norm(String(p.descripcion || '').split('.')[0]);
      let pts = 0;
      if (nombre && (dep === nombre || dep.includes(nombre))) pts = 3;
      else if (desc && desc.split(' ').length >= 3 && dep.includes(desc)) pts = 3;
      else if (nombre && nombre.split(' ').length === 1 && nombre.length >= 4 && palabrasDep.has(nombre)) pts = 2;
      else {
        const sig = nombre.split(' ').filter((w) => w && !PALABRAS_VACIAS.has(w));
        if (sig.length && sig.every((w) => palabrasDep.has(w))) pts = 1;
      }
      if (pts > puntos || (pts === puntos && pts > 0 && mejor && !mejor.es_fabrica && p.es_fabrica === false)) { mejor = p; puntos = pts; }
    }
    return puntos > 0 ? mejor : null;
  }
  /** Datos para guardar_licitacion a partir de una convocatoria (US-845). */
  function datosLicitacion(c, perfilId) {
    const x = c || {};
    const portal = FUENTES_PORTAL[x.fuente] || x.fuente || '';
    return {
      codigo: String(x.numero_procedimiento || x.id_externo || '').trim().slice(0, 120),
      nombre: String(x.titulo || '').trim().slice(0, 300),
      convocante: (x.dependencia || x.unidad_compradora || '').trim() || null,
      modalidad: modalidadDe(x.tipo_procedimiento),
      plaza: plazaDe(x.municipio, x.dependencia),
      junta_aclaraciones: x.junta_aclaraciones || null,
      presentacion: x.apertura || null,
      fallo: x.fallo || null,
      perfil_id: perfilId || null,
      notas: `Convocatoria de ${portal}${x.url_detalle ? ': ' + x.url_detalle : ''}`,
    };
  }
  const CAMPOS_FECHA = [['junta_aclaraciones', 'Junta de aclaraciones'], ['apertura', 'Presentación y apertura'], ['fallo', 'Fallo']];
  /** Cambios de fechas de la convocatoria respecto de lo ya aceptado en la licitación: [{campo, etiqueta, antes, ahora}]. */
  function cambiosFechas(info) {
    if (!info || !info.aceptadas || !info.actuales) return [];
    const t = (v) => (v ? new Date(v).getTime() : null);
    return CAMPOS_FECHA.filter(([k]) => t(info.aceptadas[k]) !== t(info.actuales[k]))
      .map(([k, et]) => ({ campo: k, etiqueta: et, antes: info.aceptadas[k] || null, ahora: info.actuales[k] || null }));
  }
  /** Sólo enlaces http(s) (url_detalle viene de un portal externo). */
  function urlSegura(u) { const s = String(u || '').trim(); return /^https?:\/\//i.test(s) ? s : null; }
  /** Resumen de un filtro guardado en una línea. */
  function resumenFiltro(f) {
    const x = f || {}; const p = [];
    p.push(lista(x.fuentes).length ? lista(x.fuentes).map((k) => FUENTES_PORTAL[k] || k).join(' y ') : 'Todas las fuentes');
    if (lista(x.entidades).length) p.push(lista(x.entidades).join(', '));
    p.push(lista(x.tipos_contratacion).length ? lista(x.tipos_contratacion).map((k) => TIPOS[k] || k).join(', ') : 'todos los tipos');
    if (lista(x.palabras_clave).length) p.push('con «' + lista(x.palabras_clave).join('», «') + '»');
    if (lista(x.palabras_excluir).length) p.push('sin «' + lista(x.palabras_excluir).join('», «') + '»');
    return p.join(' · ');
  }
  /** Formulario de «Buscar en los portales» lleno con un filtro guardado (el portal busca UNA frase: va la primera palabra clave). */
  function formDesdeFiltro(f) {
    const x = f || {};
    const tipos = lista(x.tipos_contratacion).filter((t) => t === 'obra_publica' || t === 'servicios_obra');
    return {
      chihuahua: !lista(x.fuentes).length || lista(x.fuentes).includes('chihuahua'),
      comprasmx: !lista(x.fuentes).length || lista(x.fuentes).includes('comprasmx'),
      texto: lista(x.palabras_clave)[0] || '',
      tipo: tipos.length === 1 ? tipos[0] : '',
      entidad: lista(x.entidades)[0] || '',
    };
  }
  /** Cuerpo para la función convocatorias-chihuahua. */
  function cuerpoChihuahua(f) {
    const x = f || {};
    return { texto: x.texto || '', tipo_contratacion: x.tipo || '', tipo_procedimiento: x.procedimiento || '',
             estatus: x.estatus === undefined ? 'vigente' : x.estatus, desde: x.desde || '', hasta: x.hasta || '',
             max_resultados: Number(x.max) || 50 };
  }
  /** Cuerpo para el conector local de ComprasMX (contrato de US-851; US-852: siempre con fechas, tope 100 por omisión). */
  function cuerpoComprasmx(f) {
    const x = f || {};
    return { texto: x.texto || '', tipos: x.tipo ? [x.tipo] : ['obra_publica', 'servicios_obra'],
             entidades: x.entidad ? [x.entidad] : [], desde: x.desde || '', hasta: x.hasta || '', max_resultados: Number(x.max) || 100 };
  }
  const PERIODOS = { 7: 'Últimos 7 días', 15: 'Últimos 15 días', 30: 'Últimos 30 días', 60: 'Últimos 60 días', 90: 'Últimos 90 días', rango: 'Rango de fechas…' };
  const DIAS_MAX_BUSQUEDA = 90;
  /**
   * Fechas de publicación de una búsqueda en los portales (US-852): nunca sin límite. `periodo` = 7…90 días hacia atrás
   * desde hoy, o 'rango' con desde y hasta (máximo 90 días, sin empezar en el futuro). → {desde, hasta} o {error}.
   */
  function periodoFechas(periodo, desde, hasta, hoy) {
    const h = String(hoy || hoyMx());
    const dia = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
    if (periodo !== 'rango') {
      const n = Number(periodo) || 30;
      if (!PERIODOS[n]) return { error: 'Elige un periodo de publicación.' };
      return { desde: iso(dia(h) - n * 86400000), hasta: h };
    }
    if (!fechaOk(desde) || !fechaOk(hasta)) return { error: 'Escribe las dos fechas del rango.' };
    if (desde > hasta) return { error: 'La fecha inicial es posterior a la final.' };
    if (desde > h) return { error: 'La fecha inicial no puede estar en el futuro.' };
    if ((dia(hasta) - dia(desde)) / 86400000 > DIAS_MAX_BUSQUEDA) return { error: `El rango no puede pasar de ${DIAS_MAX_BUSQUEDA} días: busca sólo lo reciente.` };
    return { desde, hasta };
  }
  /**
   * Por qué no respondió el conector (Chrome «acceso a la red local»): 'denegado' si el usuario negó el permiso,
   * 'preguntar' si Chrome aún no lo pide, 'apagado' si el permiso está dado (o no existe) y nadie escucha.
   */
  function causaConector(estadoPermiso) {
    if (estadoPermiso === 'denied') return 'denegado';
    if (estadoPermiso === 'prompt') return 'preguntar';
    return 'apagado';
  }
  /** Texto del pie para una fuente (convocatorias_estado). */
  function textoUltimaBusqueda(e, fmtFecha) {
    const portal = FUENTES_PORTAL[e && e.fuente] || (e && e.fuente) || '';
    if (!e || !e.ultima_inicio) return `${portal}: todavía no se ha buscado.`;
    const f = fmtFecha ? fmtFecha(e.ultima_inicio) : e.ultima_inicio;
    const quien = e.ultima_usuario ? `por ${e.ultima_usuario}` : e.ultima_origen && /conector/.test(e.ultima_origen) ? 'desde el conector local' : 'carga inicial del sistema';
    const res = e.ultima_error ? `terminó con error: ${e.ultima_error}` : e.ultima_fin ? `${e.encontradas || 0} encontrada${e.encontradas === 1 ? '' : 's'}, ${e.nuevas || 0} nueva${e.nuevas === 1 ? '' : 's'}` : 'en curso';
    return `${portal}: última búsqueda el ${f}, ${quien} (${res}).`;
  }

  // ---- Estado del navegador -----------------------------------------------------------------------------------------------
  const st = Object.assign({}, BARRA_INICIAL);
  let filas = []; let total = 0; let estado = []; let filtros = null; let cargando = 0;
  let opciones = null;          // {dependencias:[{v,n}], municipios:[{v,n}]} para autocompletar (convocatorias_opciones)
  let stCargado = false;        // la barra ya se leyó de sessionStorage
  let panelAbierto = null;      // <details> de la barra en el teléfono
  let barraPendiente = null;    // «Guardar esta búsqueda»: barra que se guarda con el filtro nuevo
  let ultimaMs = null;          // tiempo de la última consulta de la lista (para medir)
  let resultados = null;        // tras «Buscar en los portales»: [{fuente, corrida, inicio, filas, resumen, error}]
  let busqueda = null;          // búsqueda en curso: {fuentes:{chihuahua:{estado, texto}, comprasmx:{...}}, ctl:{}}
  let deshacer = null;          // {id, prev, titulo, t}
  const fichaCache = new Map(); // licitacion_id → respuesta de get_convocatoria_de_licitacion

  const fmtFechaHora = (ts) => (ts ? new Intl.DateTimeFormat('es-MX', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) : '');
  const errTxt = (e, ctx) => (typeof Licitaciones !== 'undefined' && Licitaciones.errTxt ? Licitaciones.errTxt(e, ctx) : (ctx ? ctx + ': ' : '') + ((e && e.message) || e));
  const uid = () => (typeof currentUser !== 'undefined' && currentUser ? currentUser.id || currentUser.user_id || 'u' : 'u');
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } } };
  async function rpc(nombre, args) {
    const { data, error } = await sb.rpc(nombre, args);
    if (error) throw error;
    return data;
  }

  // ---- Carga ----------------------------------------------------------------------------------------------------------
  async function cargarFiltros(force) {
    if (filtros && !force) return filtros;
    const { data, error } = await sb.from('convocatoria_filtros').select('id,nombre,palabras_clave,palabras_excluir,fuentes,entidades,tipos_contratacion,activo,de_fabrica,updated_at,barra').order('de_fabrica', { ascending: false }).order('nombre');
    if (error) throw error;
    filtros = data || [];
    return filtros;
  }
  async function cargarEstado() { try { estado = (await rpc('convocatorias_estado')) || []; } catch (e) { estado = []; } return estado; }
  async function cargarLista() {
    const turno = ++cargando;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const d = await rpc('convocatorias_buscar', argsBusqueda(st));
    if (turno !== cargando) return false;
    ultimaMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    filas = d || []; total = filas.length ? Number(filas[0].total) || 0 : 0;
    return true;
  }
  async function cargarOpciones() {
    if (opciones) return opciones;
    try { opciones = (await rpc('convocatorias_opciones')) || { dependencias: [], municipios: [] }; } catch (e) { opciones = { dependencias: [], municipios: [] }; }
    return opciones;
  }
  // La barra sobrevive a salir y volver al módulo en la misma sesión (sessionStorage, por usuario).
  const claveBarra = () => 'conv_barra:' + uid();
  function leerBarra() {
    if (stCargado) return;
    stCargado = true;
    try {
      const g = JSON.parse(sessionStorage.getItem(claveBarra()) || 'null');
      if (g && typeof g === 'object') for (const k of Object.keys(BARRA_VACIA)) if (k in g) st[k] = g[k];
    } catch (e) { /* sin sessionStorage */ }
  }
  function guardarBarra() { try { sessionStorage.setItem(claveBarra(), JSON.stringify(st)); } catch (e) { /* sin sessionStorage */ } }
  /** Marca la pestaña como revisada: el contador de la barra (US-846) cuenta lo nuevo desde aquí. */
  function marcarVisto() {
    ls.set('conv_visto:' + uid(), new Date().toISOString());
    if (typeof window !== 'undefined' && window.CONV_AVISOS) window.CONV_AVISOS = { nuevas: 0 };
    try { if (typeof convAvisosCargar === 'function') convAvisosCargar(); } catch (e) { /* sin barra */ }
  }

  // ---- Pintado ----------------------------------------------------------------------------------------------------------
  const el = () => (typeof document !== 'undefined' ? document.getElementById('cvPanel') : null);
  const sel = (id, et, opciones, val, onch, vacio) => `<div class="min-w-0"><label class="text-xs mb-1 block" for="${id}">${et}</label><select id="${id}" class="inp w-full" onchange="${onch}">${vacio !== undefined ? `<option value="">${S(vacio)}</option>` : ''}${Object.entries(opciones).map(([k, v]) => `<option value="${S(k)}" ${String(k) === String(val) ? 'selected' : ''}>${S(v)}</option>`).join('')}</select></div>`;
  const entidadesOpc = () => ENTIDADES.reduce((o, e) => { o[e] = e; return o; }, {});

  /** Punto de entrada de la pestaña (Licitaciones.registrarPestana). */
  async function pintar(cont) {
    cont.innerHTML = `<div id="cvPanel"><div aria-busy="true">${Skeleton.table(5, 5)}</div></div>`;
    try {
      leerBarra();
      await cargarFiltros();
      if (!filtros.some((f) => f.activo) && st.mis) st.mis = false;   // sin filtros activos «sólo mis filtros» daría vacío
      if (st.filtro && !filtros.some((f) => String(f.id) === String(st.filtro))) st.filtro = '';
      await Promise.all([cargarLista(), cargarEstado(), cargarOpciones()]);
      marcarVisto();
      repintar();
    } catch (e) {
      const p = el(); if (p) p.innerHTML = EmptyState({ icon: 'ri-error-warning-line', title: 'No se pudieron cargar las convocatorias', body: errTxt(e), action: { label: 'Reintentar', icon: 'ri-refresh-line', onClick: 'Convocatorias.recargar()' } });
    }
  }
  function repintar() {
    const p = el(); if (!p) return;
    p.innerHTML = cabeceraHtml() + busquedaHtml() + deshacerHtml() + (resultados ? resultadosHtml() : barraHtml() + `<div id="cvFichas">${fichasHtml()}</div><div id="cvLista">${listaHtml()}</div>`) + pieHtml();
  }
  /** Sólo fichas, contador y lista: la barra no se vuelve a pintar (no pierde el foco ni lo escrito). */
  function repintarLista() {
    const l = typeof document !== 'undefined' && document.getElementById('cvLista');
    if (!l || resultados) { repintar(); return; }
    l.innerHTML = listaHtml();
    const f = document.getElementById('cvFichas'); if (f) f.innerHTML = fichasHtml();
    const n = document.getElementById('cvNFiltros'); if (n) n.textContent = String(cuentaFiltros(st));
  }
  function cabeceraHtml() {
    const activos = (filtros || []).filter((f) => f.activo).length;
    return `<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
<p class="text-sm text-ink-muted">Convocatorias de obra de ComprasMX (federal) y Contrataciones Chihuahua (estatal). Se traen sólo cuando las buscas.</p>
<div class="flex flex-wrap gap-2"><button type="button" class="btn btn-s" onclick="Convocatorias.abrirFiltros()"><i class="ri-filter-3-line" aria-hidden="true"></i> Mis filtros (${activos})</button>
<button type="button" class="btn btn-p" onclick="Convocatorias.abrirBusqueda()" ${busqueda ? 'disabled' : ''}><i class="ri-search-eye-line" aria-hidden="true"></i> Buscar en los portales</button></div></div>`;
  }
  function barraHtml() {
    if (panelAbierto === null) panelAbierto = typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 640px)').matches;
    const n = cuentaFiltros(st);
    const fecha = (id, et, v, k) => `<div class="min-w-0"><label class="text-xs mb-1 block" for="${id}">${et}</label><input id="${id}" type="date" class="inp w-full" value="${S(v || '')}" onchange="Convocatorias.filtrar('${k}',this.value)"></div>`;
    const guardados = (filtros || []).reduce((o, f) => { o[f.id] = f.nombre; return o; }, {});
    const deps = ((opciones && opciones.dependencias) || []).map((d) => `<option value="${S(d.v)}">`).join('');
    const muns = ((opciones && opciones.municipios) || []).map((d) => `<option value="${S(d.v)}">`).join('');
    return `<details class="cv-filtros mb-2" id="cvFiltrosPanel" ${panelAbierto ? 'open' : ''} ontoggle="Convocatorias.panelFiltros(this.open)">
<summary class="btn btn-s"><i class="ri-filter-3-line" aria-hidden="true"></i> <span>Filtros (<span id="cvNFiltros">${n}</span>)</span></summary>
<form class="grid grid-cols-2 gap-2 mt-2 sm:mt-0 items-end sm:grid-cols-3 lg:grid-cols-6" onsubmit="event.preventDefault();Convocatorias.filtrar('texto',document.getElementById('cvTexto').value)" role="search" aria-label="Filtrar convocatorias">
<div class="col-span-2 sm:col-span-3 lg:col-span-3"><label class="text-xs mb-1 block" for="cvTexto">Buscar en lo guardado</label><input id="cvTexto" class="inp w-full" type="search" value="${S(st.texto)}" placeholder="Palabras (todas); «-palabra» para excluir" aria-describedby="cvTextoAyuda" oninput="Convocatorias.escribir(this.value)" onchange="Convocatorias.filtrar('texto',this.value)"><p id="cvTextoAyuda" class="field-hint">Busca en número, título, descripción y dependencia, sin acentos ni mayúsculas.</p></div>
${sel('cvFiltroG', 'Filtro guardado', guardados, st.filtro, 'Convocatorias.usarFiltroBarra(this.value)', 'Ninguno')}
${sel('cvOrden', 'Ordenar por', ORDENES, st.orden || 'apertura', "Convocatorias.filtrar('orden',this.value)")}
${sel('cvEstado', 'Seguimiento', ESTADOS, st.estado, "Convocatorias.filtrar('estado',this.value)", 'Todos')}
${sel('cvFuente', 'Fuente', FUENTES_PORTAL, st.fuente, "Convocatorias.filtrar('fuente',this.value)", 'Todas')}
${sel('cvEntidad', 'Entidad', entidadesOpc(), st.entidad, "Convocatorias.filtrar('entidad',this.value)", 'Todas')}
<div class="min-w-0"><label class="text-xs mb-1 block" for="cvMunicipio">Municipio</label><input id="cvMunicipio" class="inp w-full" list="cvMunLista" value="${S(st.municipio)}" placeholder="Todos" onchange="Convocatorias.filtrar('municipio',this.value)"><datalist id="cvMunLista">${muns}</datalist></div>
<div class="min-w-0 col-span-2 sm:col-span-1 lg:col-span-2"><label class="text-xs mb-1 block" for="cvDependencia">Dependencia</label><input id="cvDependencia" class="inp w-full" list="cvDepLista" value="${S(st.dependencia)}" placeholder="Todas (escribe para ver sugerencias)" onchange="Convocatorias.filtrar('dependencia',this.value)"><datalist id="cvDepLista">${deps}</datalist></div>
${sel('cvTipo', 'Tipo de contratación', TIPOS, st.tipo, "Convocatorias.filtrar('tipo',this.value)", 'Todos')}
${sel('cvProc', 'Procedimiento', PROCEDIMIENTOS, st.procedimiento, "Convocatorias.filtrar('procedimiento',this.value)", 'Todos')}
${sel('cvEstatus', 'Estatus en el portal', ESTATUS_PORTAL, st.estatus, "Convocatorias.filtrar('estatus',this.value)", 'Vigentes')}
${sel('cvAbren', 'Abren en', PLAZOS_APERTURA, st.abren, "Convocatorias.filtrar('abren',this.value)", 'Cualquier fecha')}
${st.abren === 'rango' ? fecha('cvAbrenD', 'Abren desde', st.abren_desde, 'abren_desde') + fecha('cvAbrenH', 'Abren hasta', st.abren_hasta, 'abren_hasta') : ''}
${sel('cvPub', 'Publicadas en', PLAZOS_PUBLICACION, st.pub, "Convocatorias.filtrar('pub',this.value)", 'Cualquier fecha')}
${st.pub === 'rango' ? fecha('cvPubD', 'Publicadas desde', st.pub_desde, 'pub_desde') + fecha('cvPubH', 'Publicadas hasta', st.pub_hasta, 'pub_hasta') : ''}
<label class="zk-switch col-span-2 sm:col-span-3 lg:col-span-2"><input type="checkbox" id="cvMis" ${st.mis ? 'checked' : ''} onchange="Convocatorias.filtrar('mis',this.checked)"><span class="zk-slider" aria-hidden="true"></span> Sólo las que cumplen mis filtros</label>
<div class="col-span-2 sm:col-span-3 lg:col-span-6 flex flex-wrap gap-2"><button type="button" class="btn btn-s" onclick="Convocatorias.guardarBusqueda()"><i class="ri-bookmark-line" aria-hidden="true"></i> Guardar esta búsqueda</button></div>
</form></details>`;
  }
  function fichasHtml() {
    const fs = fichasActivas(st, (id) => { const f = (filtros || []).find((x) => String(x.id) === String(id)); return f && f.nombre; });
    if (!fs.length) return '';
    return `<ul class="flex flex-wrap gap-2 mb-3" aria-label="Filtros puestos">${fs.map((f) => `<li class="cv-ficha"><span title="${S(f.t)}">${S(f.t)}</span><button type="button" onclick="Convocatorias.quitar('${S(f.k)}')" aria-label="Quitar el filtro ${S(f.t)}"><i class="ri-close-line" aria-hidden="true"></i></button></li>`).join('')}
<li><button type="button" class="btn btn-s text-xs" onclick="Convocatorias.quitarFiltros()"><i class="ri-filter-off-line" aria-hidden="true"></i> Quitar filtros</button></li></ul>`;
  }
  function descripcionHtml(c) {
    const d = String(c.descripcion || '').trim();
    if (!d || norm(d) === norm(c.titulo)) return '';
    const larga = d.length > 160;
    return `<p class="text-xs text-ink-muted mt-1 cv-desc" id="cvDesc-${+c.id}">${S(d)}</p>${larga ? `<button type="button" class="text-xs text-accent hover:underline" aria-expanded="false" aria-controls="cvDesc-${+c.id}" onclick="Convocatorias.verMas(${+c.id},this)">Ver más</button>` : ''}`;
  }
  function chipFuente(f) { return `<span class="chip" style="background:var(--${f === 'comprasmx' ? 'accent' : 'warn'}-soft);color:var(--${f === 'comprasmx' ? 'accent' : 'warn'})">${S(FUENTES[f] || f)}</span>`; }
  function aperturaHtml(c) {
    if (!c.apertura) return '<span class="text-ink-muted">Sin fecha publicada</span>';
    const d = diasA(c.apertura);
    const cuando = d < 0 ? 'ya pasó' : d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`;
    const tono = d >= 0 && d <= 2 ? 'text-danger font-semibold' : d >= 0 && d <= 5 ? 'text-warn font-semibold' : 'text-ink-muted';
    return `${S(fmtFechaHora(c.apertura))}<span class="block text-xs ${tono}">${cuando}</span>`;
  }
  function accionesHtml(c) {
    const url = urlSegura(c.url_detalle);
    const ver = url ? `<a class="btn btn-s text-xs" href="${S(url)}" target="_blank" rel="noopener noreferrer"><i class="ri-external-link-line" aria-hidden="true"></i> Ver en el portal</a>` : '';
    const e = c.seguimiento_estado || 'nueva';
    if (e === 'convertida') return `<button type="button" class="btn btn-s text-xs" onclick="Convocatorias.abrirLicitacion(${+c.licitacion_id || 0})" ${c.licitacion_id ? '' : 'disabled'}><i class="ri-auction-line" aria-hidden="true"></i> Abrir licitación</button>${ver}`;
    const interesa = e === 'interesa'
      ? `<button type="button" class="btn btn-s text-xs" aria-pressed="true" onclick="Convocatorias.marcar(${+c.id},'nueva')"><i class="ri-star-fill" aria-hidden="true"></i> Me interesa</button>`
      : `<button type="button" class="btn btn-s text-xs" aria-pressed="false" onclick="Convocatorias.marcar(${+c.id},'interesa')"><i class="ri-star-line" aria-hidden="true"></i> Me interesa</button>`;
    const descartar = e === 'descartada'
      ? `<button type="button" class="btn btn-s text-xs" onclick="Convocatorias.marcar(${+c.id},'nueva')"><i class="ri-arrow-go-back-line" aria-hidden="true"></i> Restaurar</button>`
      : `<button type="button" class="btn btn-s text-xs" onclick="Convocatorias.marcar(${+c.id},'descartada')"><i class="ri-close-circle-line" aria-hidden="true"></i> Descartar</button>`;
    return `${e !== 'descartada' ? interesa : ''}${descartar}${ver}${e !== 'descartada' ? `<button type="button" class="btn btn-p text-xs" onclick="Convocatorias.participar(${+c.id})"><i class="ri-add-line" aria-hidden="true"></i> Participar</button>` : ''}`;
  }
  function filaHtml(c, nuevaDesde) {
    const nueva = nuevaDesde && c.primera_vez_vista && new Date(c.primera_vez_vista) >= new Date(nuevaDesde);
    const est = c.seguimiento_estado && c.seguimiento_estado !== 'nueva' ? ` <span class="chip" style="background:var(--surface-2);color:var(--ink-muted)">${S({ interesa: 'Me interesa', descartada: 'Descartada', convertida: 'Convertida' }[c.seguimiento_estado] || '')}</span>` : '';
    const docs = c.descarga_estado ? ` <span class="chip" style="background:var(--surface-2);color:var(--ink-muted)"><i class="ri-folder-download-line" aria-hidden="true"></i> ${S(ESTADOS_DESCARGA[c.descarga_estado] || c.descarga_estado)}</span>` : '';
    return `<tr data-cv="${+c.id}"><td data-et="Convocatoria"><div class="text-left min-w-0"><p class="font-medium">${S(c.titulo || 'Sin título')}</p>
<p class="text-xs text-ink-muted font-mono">${S(c.numero_procedimiento || c.id_externo || '')}</p>${descripcionHtml(c)}<p class="mt-1">${chipFuente(c.fuente)}${nueva ? ' <span class="chip" style="background:var(--ok-soft);color:var(--ok)">Nueva</span>' : ''}${est}${docs}</p></div></td>
<td data-et="Dependencia"><span>${S(c.dependencia || '—')}</span></td><td data-et="Entidad"><span>${S(c.entidad || '—')}${c.municipio ? `<span class="block text-xs text-ink-muted">${S(c.municipio)}</span>` : ''}</span></td>
<td data-et="Tipo"><span>${S(TIPOS[c.tipo_contratacion] || '—')}${c.tipo_procedimiento && PROCEDIMIENTOS[c.tipo_procedimiento] ? `<span class="block text-xs text-ink-muted">${S(PROCEDIMIENTOS[c.tipo_procedimiento])}</span>` : ''}</span></td>
<td data-et="Apertura"><span>${aperturaHtml(c)}</span></td><td data-et=""><div class="grid grid-cols-2 gap-1 cv-acciones" style="min-width:15rem">${accionesHtml(c)}</div></td></tr>`;
  }
  function tablaHtml(rows, etiqueta, nuevaDesde) {
    return `<div class="table-wrap g rounded-xl" tabindex="0" role="region" aria-label="${S(etiqueta)}"><table class="table-modern lc-tbl w-full text-sm"><thead><tr><th scope="col">Convocatoria</th><th scope="col">Dependencia</th><th scope="col">Entidad</th><th scope="col">Tipo</th><th scope="col">Apertura</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody>${rows.map((c) => filaHtml(c, nuevaDesde)).join('')}</tbody></table></div>`;
  }
  function listaHtml() {
    if (!filas.length) {
      const sinFiltros = !(filtros || []).some((f) => f.activo);
      return EmptyState({
        icon: 'ri-file-search-line', title: 'Ninguna convocatoria coincide',
        body: sinFiltros ? 'Todavía no tienes filtros guardados. Crea uno con lo que te interesa (tipo de obra, entidad, palabras clave) o busca directamente en los portales.'
          : st.estado === 'nueva' && st.mis ? 'No hay convocatorias nuevas que cumplan tus filtros. Busca en los portales para traer lo más reciente.' : 'Cambia los filtros de arriba o busca en los portales.',
        action: { label: 'Buscar en los portales', icon: 'ri-search-eye-line', onClick: 'Convocatorias.abrirBusqueda()' },
      });
    }
    const desde = st.pagina * POR_PAGINA + 1; const hasta = st.pagina * POR_PAGINA + filas.length;
    const pag = total > POR_PAGINA ? `<nav class="flex items-center justify-end gap-2 mt-3" aria-label="Páginas de convocatorias">
<button type="button" class="btn btn-s" onclick="Convocatorias.pagina(-1)" ${st.pagina ? '' : 'disabled'}><i class="ri-arrow-left-s-line" aria-hidden="true"></i> Anteriores</button>
<button type="button" class="btn btn-s" onclick="Convocatorias.pagina(1)" ${hasta < total ? '' : 'disabled'}>Siguientes <i class="ri-arrow-right-s-line" aria-hidden="true"></i></button></nav>` : '';
    return `<p class="text-xs text-ink-muted mb-2" aria-live="polite" id="cvConteo">${total.toLocaleString('es-MX')} convocatoria${total === 1 ? '' : 's'} · ${desde} a ${hasta}</p>${tablaHtml(filas, 'Lista de convocatorias')}${pag}`;
  }
  function resultadosHtml() {
    const bloques = resultados.map((r) => {
      const res = r.resumen;
      const linea = r.error ? `<p class="text-sm text-danger">${S(r.error)}</p>`
        : `<p class="text-sm text-ink-muted mb-2">${S(resumenTexto(r))}</p>`;
      return `<section class="mb-4" aria-labelledby="cvRes-${S(r.fuente)}"><h3 id="cvRes-${S(r.fuente)}" class="font-bold text-sm mb-1">${S(FUENTES_PORTAL[r.fuente])}</h3>${linea}
${r.filas && r.filas.length ? tablaHtml(r.filas, 'Resultados de ' + FUENTES_PORTAL[r.fuente], r.inicio) : !r.error ? '<p class="text-sm text-ink-muted">Sin resultados con esos filtros.</p>' : ''}${res && res.vistas > (r.filas || []).length ? `<p class="text-xs text-ink-muted mt-1">Se muestran ${r.filas.length} de ${res.vistas}.</p>` : ''}</section>`;
    }).join('');
    return `<div class="flex items-center justify-between gap-2 mb-2"><h2 class="font-bold">Resultados de tu búsqueda</h2><button type="button" class="btn btn-s" onclick="Convocatorias.cerrarResultados()"><i class="ri-arrow-left-line" aria-hidden="true"></i> Volver a la lista</button></div>${bloques}`;
  }
  function resumenTexto(r) {
    const s = r.resumen || {};
    const enc = s.encontradas != null ? s.encontradas : (r.respuesta && r.respuesta.encontradas) || 0;
    const nv = s.nuevas != null ? s.nuevas : (r.respuesta && r.respuesta.nuevas) || 0;
    let t = `${enc} encontrada${enc === 1 ? '' : 's'}, ${nv} nueva${nv === 1 ? '' : 's'}`;
    if (s.hay_filtros) t += nv ? `; ${s.nuevas_cumplen} de las nuevas cumple${s.nuevas_cumplen === 1 ? '' : 'n'} tus filtros guardados` : '';
    if (r.respuesta && r.respuesta.truncado) t += '. Llegó al tope de resultados: afina el texto o las fechas para ver el resto';
    if (r.respuesta && Number(r.respuesta.sin_descripcion) > 0) t += `. ${r.respuesta.sin_descripcion} quedaron sin descripción por el tope de fichas que se abren en cada búsqueda: vuelve a buscar con los mismos filtros para completarlas`;
    return t + '.';
  }
  function busquedaHtml() {
    if (!busqueda) return '';
    const item = (f) => {
      const b = busqueda.fuentes[f]; if (!b) return '';
      const ic = b.estado === 'buscando' ? '<i class="ri-loader-4-line animate-spin" aria-hidden="true"></i>' : b.estado === 'error' ? '<i class="ri-error-warning-line text-danger" aria-hidden="true"></i>' : b.estado === 'omitida' ? '<i class="ri-forbid-line text-ink-muted" aria-hidden="true"></i>' : '<i class="ri-checkbox-circle-line text-ok" aria-hidden="true"></i>';
      return `<li class="flex items-start gap-2 py-1">${ic}<span><b>${S(FUENTES_PORTAL[f])}:</b> ${b.html || S(b.texto || '')}</span></li>`;
    };
    const activa = Object.values(busqueda.fuentes).some((b) => b.estado === 'buscando');
    return `<section class="g rounded-xl p-3 mb-3" role="status" aria-live="polite" aria-label="Búsqueda en los portales"><ul class="text-sm">${item('chihuahua')}${item('comprasmx')}</ul>
${activa ? '<button type="button" class="btn btn-s mt-2" onclick="Convocatorias.cancelarBusqueda()"><i class="ri-stop-circle-line" aria-hidden="true"></i> Cancelar búsqueda</button>' : ''}</section>`;
  }
  function deshacerHtml() {
    if (!deshacer) return '';
    return `<div class="g rounded-xl p-3 mb-3 flex items-center justify-between gap-2" role="status"><span class="text-sm">Descartaste «${S(String(deshacer.titulo || '').slice(0, 80))}».</span><button type="button" class="btn btn-s" onclick="Convocatorias.deshacerDescartar()"><i class="ri-arrow-go-back-line" aria-hidden="true"></i> Deshacer</button></div>`;
  }
  function pieHtml() {
    const fuentes = ['chihuahua', 'comprasmx'].map((f) => estado.find((e) => e.fuente === f) || { fuente: f });
    return `<footer class="mt-4 text-xs text-ink-muted space-y-1" aria-label="Últimas búsquedas">${fuentes.map((e) => `<p><i class="ri-time-line" aria-hidden="true"></i> ${S(textoUltimaBusqueda(e, fmtFechaHora))}</p>`).join('')}</footer>`;
  }

  // ---- Acciones de la lista -------------------------------------------------------------------------------------------------
  let pendientes = 0;
  async function refrescar() {
    pendientes++;
    try { if (await cargarLista()) repintarLista(); } catch (e) { Toast.error(errTxt(e, 'No se pudo actualizar la lista')); } finally { pendientes--; }
  }
  function filtrar(k, v) {
    st[k] = k === 'mis' ? !!v : (v == null ? '' : String(v));
    st.pagina = 0; guardarBarra();
    if (k === 'abren' || k === 'pub') repintar();   // muestra u oculta el rango de fechas
    refrescar();
  }
  let escribirTimer = null;
  /** Texto mientras se escribe: espera 300 ms sin teclear y filtra (sin repintar la barra). */
  function escribir(v) { clearTimeout(escribirTimer); escribirTimer = setTimeout(() => { if (String(v) !== String(st.texto)) filtrar('texto', v); }, 300); }
  function quitar(k) {
    const n = quitarFicha(st, k); Object.assign(st, n); guardarBarra();
    repintar(); refrescar();
  }
  function quitarFiltros() { Object.assign(st, BARRA_VACIA, { orden: st.orden || 'apertura' }); guardarBarra(); repintar(); refrescar(); }
  function usarFiltroBarra(id) {
    if (!id) { st.filtro = ''; st.pagina = 0; guardarBarra(); repintar(); refrescar(); return; }
    const f = (filtros || []).find((x) => String(x.id) === String(id)); if (!f) return;
    Object.assign(st, barraDesdeFiltro(f)); guardarBarra(); repintar(); refrescar();
  }
  function panelFiltros(abierto) { panelAbierto = !!abierto; }
  function verMas(id, btn) {
    const p = document.getElementById('cvDesc-' + id); if (!p) return;
    const abierta = p.classList.toggle('abierta');
    if (btn) { btn.textContent = abierta ? 'Ver menos' : 'Ver más'; btn.setAttribute('aria-expanded', String(abierta)); }
  }
  /** «Guardar esta búsqueda»: abre el alta de filtro prellenada con la barra (US-853 → US-844). */
  function guardarBusqueda() {
    const d = filtroDesdeBarra(st);
    barraPendiente = d.barra;
    editarFiltro(null, Object.assign({ activo: true, nombre: '' }, d));
  }
  function pagina(d) { st.pagina = Math.max(0, st.pagina + d); guardarBarra(); refrescar(); }
  async function recargar() { const p = el(); if (p && p.parentElement) return pintar(p.parentElement); }
  function buscarFila(id) {
    const enRes = resultados ? resultados.flatMap((r) => r.filas || []) : [];
    return filas.find((c) => c.id === id) || enRes.find((c) => c.id === id) || null;
  }
  function aplicarEstado(id, estadoNuevo) {
    for (const c of [...filas, ...(resultados ? resultados.flatMap((r) => r.filas || []) : [])]) if (c.id === id) c.seguimiento_estado = estadoNuevo;
  }
  async function marcar(id, estadoNuevo, sinDeshacer) {
    const c = buscarFila(id); const prev = c ? c.seguimiento_estado || 'nueva' : 'nueva';
    try {
      await rpc('convocatoria_marcar', { p_convocatoria_id: id, p_estado: estadoNuevo, p_nota: null });
      aplicarEstado(id, estadoNuevo);
      if (!resultados && st.estado && st.estado !== estadoNuevo) { filas = filas.filter((x) => x.id !== id); total = Math.max(0, total - 1); }
      if (estadoNuevo === 'descartada' && !sinDeshacer) {
        deshacer = { id, prev, titulo: c ? c.titulo : '', t: Date.now() };
        const t = deshacer.t; setTimeout(() => { if (deshacer && deshacer.t === t) { deshacer = null; repintar(); } }, 10000);
      } else if (sinDeshacer) deshacer = null;
      repintar();
      if (estadoNuevo === 'interesa') Toast.success('Marcada «Me interesa»: te recordaremos 5 y 2 días antes de la apertura.');
    } catch (e) { Toast.error(errTxt(e, 'No se guardó la marca')); }
  }
  async function deshacerDescartar() {
    if (!deshacer) return;
    const { id, prev } = deshacer; deshacer = null;
    await marcar(id, prev, true);
    if (!resultados) await refrescar();
  }
  function abrirLicitacion(id) { if (id && typeof Licitaciones !== 'undefined') Licitaciones.abrir(id); }
  function cerrarResultados() { resultados = null; refrescar(); }

  // ---- Modal propio -------------------------------------------------------------------------------------------------------
  function modal(titulo, cuerpo, ancho) {
    let m = document.getElementById('mdlConv');
    if (!m) {
      document.body.insertAdjacentHTML('beforeend', '<div id="mdlConv" class="modal"><div id="mdlConvC" class="modal-content g rounded-2xl p-5 w-full mx-4 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="mdlConvT"></div></div>');
      m = document.getElementById('mdlConv');
      m.addEventListener('click', (e) => { if (e.target === m) cerrarModal(); });
    }
    const c = document.getElementById('mdlConvC');
    c.className = `modal-content g rounded-2xl p-5 w-full mx-4 max-h-[90vh] overflow-y-auto ${ancho || 'max-w-2xl'}`;
    c.innerHTML = `<div class="flex items-start justify-between gap-3 mb-4"><h2 id="mdlConvT" class="text-lg font-bold n">${S(titulo)}</h2>
<button type="button" class="btn-icon" onclick="Convocatorias.cerrarModal()" aria-label="Cerrar"><i class="ri-close-line text-xl" aria-hidden="true"></i></button></div>${cuerpo}`;
    openMdl('mdlConv');
    setTimeout(() => { const f = c.querySelector('input:not([type=hidden]):not([type=checkbox]),select,textarea'); if (f) f.focus(); }, 30);
    return c;
  }
  function cerrarModal() { closeMdl('mdlConv'); }
  const val = (id) => { const x = document.getElementById(id); return x ? String(x.value || '').trim() : ''; };
  const chk = (id) => { const x = document.getElementById(id); return !!(x && x.checked); };
  const campo = (id, et, html, cls) => `<div class="${cls || ''}"><label class="text-xs mb-1 block" for="${id}">${et}</label>${html}</div>`;
  const casilla = (id, et, on) => `<label class="zk-switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="zk-slider" aria-hidden="true"></span> ${S(et)}</label>`;

  // ---- Mis filtros (US-844) -------------------------------------------------------------------------------------------------
  async function abrirFiltros() {
    try { await cargarFiltros(true); } catch (e) { Toast.error(errTxt(e, 'No se pudieron leer tus filtros')); return; }
    const filasF = filtros.map((f) => `<li class="py-3 border-b flex flex-col sm:flex-row sm:items-center gap-2" style="border-color:var(--line)"><div class="grow min-w-0"><p class="font-medium">${S(f.nombre)}${f.de_fabrica ? ' <span class="chip" style="background:var(--surface-2);color:var(--ink-muted)">De fábrica</span>' : ''}${f.activo ? '' : ' <span class="chip" style="background:var(--surface-2);color:var(--ink-muted)">Apagado</span>'}</p><p class="text-xs text-ink-muted">${S(resumenFiltro(f))}</p></div>
<div class="flex gap-1"><button type="button" class="btn btn-s text-xs" onclick="Convocatorias.editarFiltro(${+f.id})"><i class="ri-edit-line" aria-hidden="true"></i> Editar</button><button type="button" class="btn btn-s text-xs" onclick="Convocatorias.borrarFiltro(${+f.id})"><i class="ri-delete-bin-line" aria-hidden="true"></i> Borrar</button></div></li>`).join('');
    modal('Mis filtros de convocatorias', `<p class="text-sm text-ink-muted mb-3">Un filtro describe lo que te interesa. La vista «Nuevas» y el contador de la barra usan los filtros encendidos.</p>
<ul>${filasF || '<li class="text-sm text-ink-muted py-3">Todavía no tienes filtros.</li>'}</ul>
<div class="flex justify-end gap-2 pt-3"><button type="button" class="btn btn-s" onclick="Convocatorias.cerrarModal()">Cerrar</button><button type="button" class="btn btn-p" onclick="Convocatorias.editarFiltro(null)"><i class="ri-add-line" aria-hidden="true"></i> Nuevo filtro</button></div>`);
  }
  function editarFiltro(id, prefill) {
    if (!prefill) barraPendiente = null;
    const f = id ? (filtros || []).find((x) => x.id === id) || {} : prefill || { activo: true, tipos_contratacion: ['obra_publica', 'servicios_obra'] };
    const fu = lista(f.fuentes); const ti = lista(f.tipos_contratacion);
    const extra = prefill && prefill.barra ? Object.keys(prefill.barra).filter((k) => !['texto', 'fuente', 'entidad', 'tipo', 'orden'].includes(k)) : [];
    const nota = prefill ? `<p class="text-sm g rounded-xl p-3">Se guarda toda la barra: al elegir este filtro en «Filtro guardado» vuelve tal cual.${lista(prefill.palabras_clave).length > 1 ? ' En «Mis filtros» (vista «Nuevas» y contador de la barra) basta <b>una</b> de las palabras clave; en la barra se exigen todas.' : ''}${extra.length ? ' Municipio, dependencia, procedimiento, estatus, seguimiento y fechas sólo se aplican en la barra.' : ''}</p>` : '';
    modal(id ? 'Editar filtro' : prefill ? 'Guardar esta búsqueda' : 'Nuevo filtro', `<form id="cvFormFiltro" class="space-y-3" onsubmit="event.preventDefault();Convocatorias.guardarFiltro(${id ? +id : 'null'})" oninput="Convocatorias.previa()" onchange="Convocatorias.previa()">
${nota}
${campo('cvfNombre', 'Nombre del filtro *', `<input id="cvfNombre" class="inp w-full" required maxlength="120" value="${S(f.nombre || '')}" placeholder="Ej. Escuelas en Cuauhtémoc">`)}
${campo('cvfClaves', 'Palabras clave (basta una; sepáralas con comas)', `<input id="cvfClaves" class="inp w-full" value="${S(lista(f.palabras_clave).join(', '))}" placeholder="Ej. escuela, pavimentación, Cuauhtémoc"><p class="field-hint">Sin acentos ni mayúsculas: «pavimentacion» también encuentra «PAVIMENTACIÓN».</p>`)}
${campo('cvfExcluir', 'Palabras a excluir', `<input id="cvfExcluir" class="inp w-full" value="${S(lista(f.palabras_excluir).join(', '))}" placeholder="Ej. mantenimiento, suministro">`)}
<fieldset><legend class="text-xs mb-1">Fuentes (ninguna = todas)</legend><div class="flex flex-wrap gap-3">${casilla('cvfFChih', 'Contrataciones Chihuahua', fu.includes('chihuahua'))}${casilla('cvfFFed', 'ComprasMX (federal)', fu.includes('comprasmx'))}</div></fieldset>
<fieldset><legend class="text-xs mb-1">Tipos de contratación (ninguno = todos)</legend><div class="flex flex-wrap gap-3">${Object.entries(TIPOS).map(([k, v]) => casilla('cvfT-' + k, v, ti.includes(k))).join('')}</div></fieldset>
${campo('cvfEntidades', 'Entidades (separadas por comas; vacío = todas)', `<input id="cvfEntidades" class="inp w-full" list="cvfEntLista" value="${S(lista(f.entidades).join(', '))}" placeholder="Ej. Chihuahua"><datalist id="cvfEntLista">${ENTIDADES.map((e) => `<option value="${S(e)}">`).join('')}</datalist>`)}
${casilla('cvfActivo', 'Filtro encendido', f.activo !== false)}
<p id="cvfPrevia" class="text-sm g rounded-xl p-3" role="status" aria-live="polite">Calculando cuántas convocatorias vigentes cumplen…</p>
<div class="flex justify-end gap-2 pt-2"><button type="button" class="btn btn-s" onclick="Convocatorias.abrirFiltros()">Volver</button><button type="submit" class="btn btn-p"><i class="ri-save-line" aria-hidden="true"></i> Guardar filtro</button></div></form>`);
    previa();
  }
  function leerFormFiltro() {
    return {
      nombre: val('cvfNombre'),
      palabras_clave: parseLista(val('cvfClaves')), palabras_excluir: parseLista(val('cvfExcluir')),
      fuentes: [chk('cvfFChih') && 'chihuahua', chk('cvfFFed') && 'comprasmx'].filter(Boolean),
      tipos_contratacion: Object.keys(TIPOS).filter((k) => chk('cvfT-' + k)),
      entidades: parseLista(val('cvfEntidades')), activo: chk('cvfActivo'),
    };
  }
  let previaTimer = null; let previaTurno = 0;
  function previa() {
    clearTimeout(previaTimer);
    previaTimer = setTimeout(async () => {
      const out = document.getElementById('cvfPrevia'); if (!out) return;
      const f = leerFormFiltro(); const turno = ++previaTurno;
      try {
        const r = await rpc('get_convocatorias_conteo_filtro', { p_claves: f.palabras_clave, p_excluir: f.palabras_excluir, p_fuentes: f.fuentes, p_entidades: f.entidades, p_tipos: f.tipos_contratacion });
        if (turno !== previaTurno || !document.getElementById('cvfPrevia')) return;
        out.innerHTML = `<b>${Number(r.cumplen).toLocaleString('es-MX')}</b> de ${Number(r.vigentes).toLocaleString('es-MX')} convocatorias vigentes guardadas cumplen este filtro.`;
      } catch (e) { if (turno === previaTurno) out.textContent = errTxt(e, 'No se pudo calcular la vista previa'); }
    }, 350);
  }
  async function guardarFiltro(id) {
    const form = document.getElementById('cvFormFiltro'); if (form && !form.reportValidity()) return;
    const datos = leerFormFiltro();
    const desdeBarra = !id && barraPendiente;
    if (desdeBarra) datos.barra = barraPendiente;
    try {
      const q = id ? sb.from('convocatoria_filtros').update(datos).eq('id', id) : sb.from('convocatoria_filtros').insert(datos).select('id').single();
      const { data, error } = await q;
      if (error) throw error;
      barraPendiente = null;
      Toast.success(id ? 'Filtro guardado' : 'Filtro creado');
      await cargarFiltros(true);
      if (desdeBarra) {
        // La barra queda con el filtro recién guardado elegido.
        st.filtro = data && data.id ? String(data.id) : ''; guardarBarra();
        cerrarModal(); repintar(); refrescar();
        return;
      }
      if (filtros.some((f) => f.activo)) st.mis = true;
      await abrirFiltros();
      refrescar();
    } catch (e) { Toast.error(/duplicate|23505/.test(String(e && (e.code || e.message))) ? 'Ya tienes un filtro con ese nombre.' : errTxt(e, 'No se guardó el filtro')); }
  }
  async function borrarFiltro(id) {
    const f = (filtros || []).find((x) => x.id === id); if (!f) return;
    const ok = await Dialog.confirm({ title: 'Borrar filtro', body: `Se borrará «${f.nombre}». Las convocatorias y tus marcas no cambian.`, confirmText: 'Borrar filtro', tone: 'danger' });
    if (!ok) return;
    try {
      const { error } = await sb.from('convocatoria_filtros').delete().eq('id', id);
      if (error) throw error;
      Toast.success('Filtro borrado');
      await cargarFiltros(true); await abrirFiltros(); refrescar();
    } catch (e) { Toast.error(errTxt(e, 'No se borró el filtro')); }
  }

  // ---- Participar (US-845) -------------------------------------------------------------------------------------------------
  async function participar(id) {
    const c = buscarFila(id); if (!c) return;
    let ps = [];
    try { ps = await Licitaciones.cargarPerfiles(); } catch (e) { /* sin perfiles se puede crear igual */ }
    const sug = sugerirPerfil(c.dependencia || c.unidad_compradora, ps);
    const d = datosLicitacion(c, sug ? sug.id : null);
    const L = Licitaciones;
    const opc = (mapa, v) => '<option value="">Sin dato</option>' + Object.entries(mapa).map(([k, t]) => `<option value="${S(k)}" ${k === v ? 'selected' : ''}>${S(t)}</option>`).join('');
    const optsPerfil = '<option value="">Sin perfil</option>' + ps.filter((p) => p.activo).map((p) => `<option value="${+p.id}" ${sug && p.id === sug.id ? 'selected' : ''}>${S(p.nombre)}${sug && p.id === sug.id ? ' (sugerido)' : ''}</option>`).join('');
    const fecha = (idc, et, v) => campo(idc, et, `<input id="${idc}" type="datetime-local" class="inp w-full" value="${S(L.aLocalMx(v))}">`);
    modal('Participar en la convocatoria', `<form id="cvFormPart" class="space-y-3" onsubmit="event.preventDefault();Convocatorias.confirmarParticipar(${+id})">
<p class="text-sm text-ink-muted">Se crea la licitación con estos datos y la convocatoria queda como «Convertida». Revisa y ajusta lo que haga falta.</p>
<div class="grid sm:grid-cols-2 gap-3">
${campo('cvpCodigo', 'Código o número de concurso *', `<input id="cvpCodigo" class="inp w-full font-mono" required maxlength="120" value="${S(d.codigo)}">`)}
${campo('cvpConvocante', 'Convocante', `<input id="cvpConvocante" class="inp w-full" maxlength="200" value="${S(d.convocante || '')}">`)}
${campo('cvpNombre', 'Nombre de la obra *', `<textarea id="cvpNombre" class="inp w-full" rows="2" required maxlength="300">${S(d.nombre)}</textarea>`, 'sm:col-span-2')}
${campo('cvpModalidad', 'Modalidad', `<select id="cvpModalidad" class="inp w-full">${opc(L.MODALIDADES, d.modalidad)}</select>`)}
${campo('cvpPlaza', 'Plaza', `<select id="cvpPlaza" class="inp w-full">${opc(L.PLAZAS, d.plaza)}</select>`)}
${fecha('cvpJunta', 'Junta de aclaraciones', d.junta_aclaraciones)}${fecha('cvpPresentacion', 'Presentación y apertura', d.presentacion)}${fecha('cvpFallo', 'Fallo', d.fallo)}
${campo('cvpPerfil', 'Perfil de convocante', `<select id="cvpPerfil" class="inp w-full">${optsPerfil}</select><p class="field-hint">${sug ? 'Sugerido por la dependencia: ' + S(sug.nombre) + '.' : 'Ningún perfil se parece a esta dependencia; puedes elegir uno o dejarlo sin perfil.'}</p>`)}
</div>
<div class="flex justify-end gap-2 pt-2"><button type="button" class="btn btn-s" onclick="Convocatorias.cerrarModal()">Cancelar</button><button type="submit" class="btn btn-p" id="cvpGuardar"><i class="ri-auction-line" aria-hidden="true"></i> Crear licitación</button></div></form>`, 'max-w-3xl');
  }
  async function confirmarParticipar(id) {
    const form = document.getElementById('cvFormPart'); if (form && !form.reportValidity()) return;
    const c = buscarFila(id); const L = Licitaciones;
    const base = datosLicitacion(c || {}, null);
    const datos = {
      codigo: val('cvpCodigo'), nombre: val('cvpNombre'), convocante: val('cvpConvocante') || null,
      modalidad: val('cvpModalidad') || null, plaza: val('cvpPlaza') || null, perfil_id: val('cvpPerfil') || null,
      junta_aclaraciones: L.aIsoMx(val('cvpJunta')), presentacion: L.aIsoMx(val('cvpPresentacion')), fallo: L.aIsoMx(val('cvpFallo')),
      notas: base.notas,
    };
    const btn = document.getElementById('cvpGuardar'); if (btn) btn.disabled = true;
    try {
      const r = await rpc('convocatoria_participar', { p_convocatoria_id: id, p_datos: datos });
      cerrarModal();
      aplicarEstado(id, 'convertida');
      for (const x of [...filas, ...(resultados ? resultados.flatMap((q) => q.filas || []) : [])]) if (x.id === id) x.licitacion_id = r.id;
      Toast.success('Licitación creada: ' + (r.licitacion && r.licitacion.codigo));
      await L.cargar(true);
      L.abrir(r.id);
    } catch (e) {
      if (btn) btn.disabled = false;
      Toast.error(errTxt(e, 'No se creó la licitación'));
    }
  }

  // ---- Aviso de cambio de fechas en la ficha (US-845) ---------------------------------------------------------------------
  /** Gancho de la ficha (Licitaciones.registrarAvisoFicha): si la licitación nació de una convocatoria cuyas fechas cambiaron, lo dice. */
  async function avisoFicha(cont, ctx) {
    if (!cont || !ctx || !ctx.lic) return;
    const id = ctx.lic.id;
    let info = fichaCache.get(id);
    if (info === undefined) {
      try { info = await rpc('get_convocatoria_de_licitacion', { p_licitacion_id: id }); } catch (e) { info = null; }
      fichaCache.set(id, info);
    }
    if (!info || !document.body.contains(cont)) return;
    const url = urlSegura(info.url_detalle);
    const origen = `<p class="text-xs text-ink-muted mb-2"><i class="ri-links-line" aria-hidden="true"></i> Viene de la convocatoria ${S(info.numero_procedimiento || '')} de ${S(FUENTES_PORTAL[info.fuente] || info.fuente)}${url ? ` · <a class="text-accent hover:underline" href="${S(url)}" target="_blank" rel="noopener noreferrer">Ver en el portal</a>` : ''}</p>`;
    const cambios = cambiosFechas(info);
    if (!info.cambio || !cambios.length) { cont.innerHTML = origen; return; }
    cont.innerHTML = origen + `<div class="rounded-xl p-3 mb-3" style="background:var(--warn-soft);color:var(--ink)" role="alert"><p class="font-semibold text-sm"><i class="ri-calendar-event-line" aria-hidden="true"></i> La convocante cambió fechas de la convocatoria</p>
<ul class="text-sm mt-1">${cambios.map((x) => `<li>${S(x.etiqueta)}: ${S(fmtFechaHora(x.antes) || 'sin fecha')} → <b>${S(fmtFechaHora(x.ahora) || 'sin fecha')}</b></li>`).join('')}</ul>
<div class="flex flex-wrap gap-2 mt-2"><button type="button" class="btn btn-p text-xs" onclick="Convocatorias.resolverFechas(${+id},true)"><i class="ri-refresh-line" aria-hidden="true"></i> Actualizar fechas</button><button type="button" class="btn btn-s text-xs" onclick="Convocatorias.resolverFechas(${+id},false)">Ignorar este cambio</button></div></div>`;
  }
  async function resolverFechas(licId, actualizar) {
    try {
      const r = await rpc('convocatoria_fechas_resolver', { p_licitacion_id: licId, p_actualizar: !!actualizar });
      fichaCache.delete(licId);
      Toast.success(actualizar ? 'Fechas actualizadas desde la convocatoria' : 'Listo: ya no se avisará de este cambio');
      const L = Licitaciones;
      if (actualizar && r && r.licitacion) await L.cargar(true);
      if (L.ficha && L.ficha.lic && L.ficha.lic.id === licId) L.abrir(licId, L.estado.tab);
    } catch (e) { Toast.error(errTxt(e, 'No se pudo resolver el cambio de fechas')); }
  }

  // ---- Buscar en los portales (US-850) ------------------------------------------------------------------------------------
  const ultimaClave = (f) => `conv_ultima:${uid()}:${f}`;
  function esperaRestante(f) { const t = Number(ls.get(ultimaClave(f)) || 0); return Math.max(0, Math.ceil((t + PAUSA_MS - Date.now()) / 1000)); }
  async function estadoConector() {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => ctl && ctl.abort(), 2500);
    try {
      const r = await fetch(CONECTOR + '/estado', { signal: ctl ? ctl.signal : undefined });
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.ok ? j : null;
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  /** Estado del permiso «acceso a la red local» de Chrome para esta página ('granted' | 'denied' | 'prompt' | null). */
  async function permisoRedLocal() {
    try {
      if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) return null;
      const p = await navigator.permissions.query({ name: 'local-network-access' });
      return p && p.state ? p.state : null;
    } catch (e) { return null; }   // el navegador no conoce el permiso
  }
  /** Mensaje (HTML) de por qué el conector no responde: permiso negado en Chrome o conector apagado. */
  async function avisoConector() {
    const causa = causaConector(await permisoRedLocal());
    const doc = `<a class="text-accent hover:underline" href="${S(DOC_CONECTOR)}" target="_blank" rel="noopener noreferrer">cómo abrir o instalar el conector</a>`;
    if (causa === 'denegado') {
      return { causa, html: 'Chrome no deja que esta página hable con el conector de tu computadora: el permiso <b>«Acceso a la red local»</b> está bloqueado. Para darlo, haz clic en el <b>candado</b> (o en el icono de ajustes) a la izquierda de la dirección, busca «Acceso a la red local», elige <b>Permitir</b> y recarga la página.' };
    }
    if (causa === 'preguntar') {
      return { causa, html: `el conector no contestó. Si Chrome muestra el aviso «Acceso a la red local», elige <b>Permitir</b> y vuelve a buscar; si no aparece, el conector está apagado: ${doc}.` };
    }
    return { causa, html: `el conector de ComprasMX no responde en esta computadora. Ábrelo (o instálalo) y vuelve a buscar: ${doc}.` };
  }
  function abrirBusqueda(prefill) {
    if (busqueda) return;
    const p = Object.assign({ chihuahua: true, comprasmx: true, texto: '', tipo: 'obra_publica', entidad: 'Chihuahua', periodo: '30', max: 100 }, prefill || {});
    const guardados = filtros || [];
    const usar = guardados.length ? campo('cvbFiltro', 'Usar un filtro guardado', `<select id="cvbFiltro" class="inp w-full" onchange="Convocatorias.usarFiltro(this.value)"><option value="">Elegir…</option>${guardados.map((f) => `<option value="${+f.id}">${S(f.nombre)}</option>`).join('')}</select>`) : '';
    const opc = (mapa, v, vacio) => `<option value="">${S(vacio)}</option>` + Object.entries(mapa).map(([k, t]) => `<option value="${S(k)}" ${k === v ? 'selected' : ''}>${S(t)}</option>`).join('');
    modal('Buscar en los portales', `<form id="cvFormBus" class="space-y-3" onsubmit="event.preventDefault();Convocatorias.lanzarBusqueda()">
<p class="text-sm text-ink-muted">Sólo se consulta lo que pidas aquí y sólo lo publicado recientemente. Chihuahua responde en segundos; ComprasMX usa el conector de tu computadora, trae sólo anuncios vigentes con su descripción y puede tardar de 1 a 5 minutos. Ningún documento se descarga en la búsqueda.</p>
${usar}
<fieldset><legend class="text-xs mb-1">Dónde buscar</legend><div class="flex flex-wrap gap-3">${casilla('cvbChih', 'Contrataciones Chihuahua', p.chihuahua)}${casilla('cvbFed', 'ComprasMX (federal)', p.comprasmx)}</div></fieldset>
<div class="grid sm:grid-cols-2 gap-3">
${campo('cvbTexto', 'Texto (en la descripción del procedimiento)', `<input id="cvbTexto" class="inp w-full" maxlength="120" value="${S(p.texto || '')}" placeholder="Ej. pavimentación">`, 'sm:col-span-2')}
${campo('cvbTipo', 'Tipo de contratación', `<select id="cvbTipo" class="inp w-full">${opc({ obra_publica: TIPOS.obra_publica, servicios_obra: TIPOS.servicios_obra }, p.tipo, 'Obra y servicios relacionados')}</select>`)}
${campo('cvbEntidad', 'Entidad (para ComprasMX)', `<select id="cvbEntidad" class="inp w-full">${opc(entidadesOpc(), p.entidad, 'Todas')}</select>`)}
${campo('cvbProc', 'Tipo de procedimiento (para Chihuahua)', `<select id="cvbProc" class="inp w-full">${opc(PROCEDIMIENTOS, p.procedimiento || '', 'Todos')}</select>`)}
${campo('cvbEstatus', 'Estatus (para Chihuahua)', `<select id="cvbEstatus" class="inp w-full">${opc(ESTATUS_PORTAL, p.estatus === undefined ? 'vigente' : p.estatus, 'Todos')}</select>`)}
${campo('cvbPeriodo', 'Publicadas en', `<select id="cvbPeriodo" class="inp w-full" onchange="Convocatorias.periodoBusqueda(this.value)">${Object.entries(PERIODOS).map(([k, t]) => `<option value="${S(k)}" ${String(k) === String(p.periodo) ? 'selected' : ''}>${S(t)}</option>`).join('')}</select><p class="field-hint">Siempre con límite de fecha (máximo ${DIAS_MAX_BUSQUEDA} días).</p>`)}
${campo('cvbMax', 'Tope de resultados por portal', `<input id="cvbMax" type="number" min="1" max="200" class="inp w-full" value="${S(String(p.max || 100))}"><p class="field-hint">100 por omisión, máximo 200.</p>`)}
<div id="cvbRango" class="grid grid-cols-2 gap-3 sm:col-span-2 ${p.periodo === 'rango' ? '' : 'hidden'}">
${campo('cvbDesde', 'Publicadas desde', `<input id="cvbDesde" type="date" class="inp w-full" value="${S(p.desde || '')}">`)}
${campo('cvbHasta', 'Hasta', `<input id="cvbHasta" type="date" class="inp w-full" value="${S(p.hasta || '')}">`)}
</div>
</div>
<div class="flex justify-end gap-2 pt-2"><button type="button" class="btn btn-s" onclick="Convocatorias.cerrarModal()">Cancelar</button><button type="submit" class="btn btn-p"><i class="ri-search-eye-line" aria-hidden="true"></i> Buscar</button></div></form>`, 'max-w-2xl');
  }
  function usarFiltro(id) {
    const f = (filtros || []).find((x) => String(x.id) === String(id)); if (!f) return;
    const p = formDesdeFiltro(f);
    const set = (i, v) => { const x = document.getElementById(i); if (x) { if (x.type === 'checkbox') x.checked = !!v; else x.value = v; } };
    set('cvbChih', p.chihuahua); set('cvbFed', p.comprasmx); set('cvbTexto', p.texto); set('cvbTipo', p.tipo); set('cvbEntidad', p.entidad);
  }
  function periodoBusqueda(v) { const r = document.getElementById('cvbRango'); if (r) r.classList.toggle('hidden', v !== 'rango'); }
  function leerFormBusqueda() {
    const periodo = val('cvbPeriodo') || '30';
    const fechas = periodoFechas(periodo, val('cvbDesde'), val('cvbHasta'));
    return { chihuahua: chk('cvbChih'), comprasmx: chk('cvbFed'), texto: val('cvbTexto'), tipo: val('cvbTipo'), entidad: val('cvbEntidad'),
             procedimiento: val('cvbProc'), estatus: val('cvbEstatus'), periodo, desde: fechas.desde || '', hasta: fechas.hasta || '',
             errorFechas: fechas.error || null, max: Math.max(1, Math.min(200, Number(val('cvbMax')) || 100)) };
  }
  async function lanzarBusqueda() {
    const form = document.getElementById('cvFormBus'); if (form && !form.reportValidity()) return;
    const f = leerFormBusqueda();
    if (!f.chihuahua && !f.comprasmx) { Toast.warning('Elige al menos un portal.'); return; }
    if (f.errorFechas) { Toast.warning(f.errorFechas); return; }
    for (const k of ['chihuahua', 'comprasmx']) { const w = f[k] && esperaRestante(k); if (w) { Toast.warning(`Espera ${w} s antes de buscar otra vez en ${FUENTES_PORTAL[k]}.`); return; } }
    cerrarModal();
    resultados = null;
    busqueda = { fuentes: {}, ctl: {}, form: f };
    if (f.chihuahua) busqueda.fuentes.chihuahua = { estado: 'buscando', texto: 'buscando…' };
    if (f.comprasmx) busqueda.fuentes.comprasmx = { estado: 'buscando', texto: 'revisando el conector de tu computadora…' };
    repintar();
    const tareas = [];
    if (f.chihuahua) tareas.push(buscarChihuahua(f));
    if (f.comprasmx) tareas.push(buscarComprasmx(f));
    const res = (await Promise.all(tareas)).filter(Boolean);
    resultados = res;
    for (const r of res) if (r.corrida) await cargarResultado(r);
    const b = busqueda; busqueda = null;
    await cargarEstado();
    repintar();
    const p = el(); if (p) p.insertAdjacentHTML('afterbegin', busquedaFinalHtml(b));
  }
  function busquedaFinalHtml(b) {
    const items = Object.entries(b.fuentes).map(([k, x]) => `<li><b>${S(FUENTES_PORTAL[k])}:</b> ${x.html || S(x.texto || '')}</li>`).join('');
    return `<section class="g rounded-xl p-3 mb-3" role="status" aria-label="Resumen de la búsqueda"><ul class="text-sm space-y-1">${items}</ul></section>`;
  }
  async function buscarChihuahua(f) {
    const b = busqueda.fuentes.chihuahua;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null; busqueda.ctl.chihuahua = ctl;
    ls.set(ultimaClave('chihuahua'), String(Date.now()));
    const out = { fuente: 'chihuahua', inicio: new Date().toISOString() };
    try {
      const r = await fetch(SB + '/functions/v1/convocatorias-chihuahua', { method: 'POST', signal: ctl ? ctl.signal : undefined,
        headers: { 'Content-Type': 'application/json', 'x-obra-token': currentUser.token }, body: JSON.stringify(cuerpoChihuahua(f)) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `El servidor respondió ${r.status}`);
      out.corrida = j.corrida_id; out.respuesta = j;
      b.estado = 'ok'; b.texto = `${j.encontradas} encontrada${j.encontradas === 1 ? '' : 's'}, ${j.nuevas} nueva${j.nuevas === 1 ? '' : 's'}.`;
    } catch (e) {
      const cancel = e && e.name === 'AbortError';
      b.estado = cancel ? 'omitida' : 'error'; b.texto = cancel ? 'cancelaste la búsqueda (el portal pudo haber terminado; lo encontrado se guarda igual).' : String((e && e.message) || e);
      out.error = b.texto;
    }
    repintarBusqueda();
    return out;
  }
  async function buscarComprasmx(f) {
    const b = busqueda.fuentes.comprasmx;
    const out = { fuente: 'comprasmx', inicio: new Date().toISOString() };
    const est = await estadoConector();
    if (!est) {
      const av = await avisoConector();
      b.estado = 'omitida';
      b.html = av.html;
      out.error = av.causa === 'denegado' ? 'Chrome bloqueó el acceso a la red local.' : 'El conector local no responde.';
      repintarBusqueda();
      return out;
    }
    if (est.ocupado) { b.estado = 'error'; b.texto = 'el conector ya está buscando; espera a que termine.'; out.error = b.texto; repintarBusqueda(); return out; }
    b.texto = `buscando con Chrome en tu computadora lo publicado del ${fmtDia(f.desde)} al ${fmtDia(f.hasta)}, con su descripción (de 1 a 5 minutos)…`; repintarBusqueda();
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null; busqueda.ctl.comprasmx = ctl;
    ls.set(ultimaClave('comprasmx'), String(Date.now()));
    const cuerpo = cuerpoComprasmx(f);
    try {
      const r = await fetch(CONECTOR + '/comprasmx/buscar', { method: 'POST', signal: ctl ? ctl.signal : undefined, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) throw new Error('el conector ya está ocupado con otra búsqueda.');
      if (!r.ok || j.error) throw new Error(j.error || `el conector respondió ${r.status}`);
      out.corrida = j.corrida_id; out.respuesta = j;
      if (j.corrida_id) { try { await rpc('convocatoria_corrida_asignar', { p_corrida_id: j.corrida_id, p_filtros: cuerpo }); } catch (e) { /* sólo firma la búsqueda */ } }
      b.estado = 'ok'; b.texto = `${j.encontradas || 0} encontrada${j.encontradas === 1 ? '' : 's'}, ${j.nuevas || 0} nueva${j.nuevas === 1 ? '' : 's'}.`;
    } catch (e) {
      const cancel = e && e.name === 'AbortError';
      b.estado = cancel ? 'omitida' : 'error'; b.texto = cancel ? 'cancelaste la búsqueda.' : String((e && e.message) || e);
      if (!cancel && e instanceof TypeError) { const av = await avisoConector(); b.texto = ''; b.html = av.html; }
      out.error = b.texto;
    }
    repintarBusqueda();
    return out;
  }
  async function cargarResultado(r) {
    try {
      const [rows, res] = await Promise.all([
        rpc('convocatorias_buscar', { p_corrida_id: r.corrida, p_solo_vigentes: false, p_limite: 200 }),
        rpc('get_convocatoria_corrida_resumen', { p_corrida_id: r.corrida }),
      ]);
      r.filas = rows || []; r.resumen = res || null;
      if (res && res.inicio) r.inicio = res.inicio;
      const b = busqueda && busqueda.fuentes[r.fuente];
      if (b && b.estado === 'ok') b.texto = resumenTexto(r);
    } catch (e) { r.error = errTxt(e, 'No se pudieron leer los resultados'); }
  }
  function repintarBusqueda() {
    const p = el(); if (!p) return;
    const viejo = p.querySelector('section[aria-label="Búsqueda en los portales"]');
    if (viejo) viejo.outerHTML = busquedaHtml(); else repintar();
  }
  async function cancelarBusqueda() {
    if (!busqueda) return;
    if (busqueda.fuentes.comprasmx && busqueda.fuentes.comprasmx.estado === 'buscando') { try { await fetch(CONECTOR + '/comprasmx/cancelar', { method: 'POST' }); } catch (e) { /* conector apagado */ } }
    for (const c of Object.values(busqueda.ctl)) { try { c && c.abort(); } catch (e) { /* ya terminó */ } }
  }

  // ---- Registro en Licitaciones ---------------------------------------------------------------------------------------------
  if (typeof Licitaciones !== 'undefined' && Licitaciones.registrarPestana) {
    Licitaciones.registrarPestana('lista', { k: 'convocatorias', t: 'Convocatorias', ic: 'ri-file-search-line', pintar }, 'licitaciones');
    if (Licitaciones.registrarAvisoFicha) Licitaciones.registrarAvisoFicha(avisoFicha);
  }

  return {
    pintar, recargar, filtrar, pagina, marcar, deshacerDescartar, abrirLicitacion, cerrarResultados, cerrarModal,
    abrirFiltros, editarFiltro, previa, guardarFiltro, borrarFiltro, participar, confirmarParticipar, avisoFicha, resolverFechas,
    abrirBusqueda, usarFiltro, lanzarBusqueda, cancelarBusqueda, periodoBusqueda,
    escribir, quitar, quitarFiltros, usarFiltroBarra, panelFiltros, verMas, guardarBusqueda,
    get estado() { return { st, total, filas, resultados, busqueda, ocupado: pendientes > 0, ms: ultimaMs }; },
    // puras
    norm, textoConvocatoria, cumpleFiltro, cumpleAlguno, vigente, parseLista, diasA, argsBusqueda, modalidadDe, plazaDe,
    sugerirPerfil, datosLicitacion, cambiosFechas, urlSegura, resumenFiltro, formDesdeFiltro, cuerpoChihuahua, cuerpoComprasmx,
    textoUltimaBusqueda, parseTextoBarra, cumpleTextoBarra, fichasActivas, quitarFicha, filtroDesdeBarra, barraDesdeFiltro,
    cuentaFiltros, periodoFechas, causaConector, PERIODOS,
    FUENTES, FUENTES_PORTAL, TIPOS, PROCEDIMIENTOS, ESTADOS, ENTIDADES, POR_PAGINA, CONECTOR, PAUSA_MS, BARRA_VACIA, BARRA_INICIAL,
  };
})();
if (typeof module !== 'undefined') module.exports = Convocatorias;
