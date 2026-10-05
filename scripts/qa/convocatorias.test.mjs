// Convocatorias: interfaz (US-843 a US-846) y búsqueda a petición (US-850).
//   * Funciones puras de src/js/convocatorias.js y de supabase/functions/convocatorias-chihuahua/parse.mjs (sin red).
//   * Con OBRA_QA_TOKEN (.env): la regla cumpleFiltro() de JS da lo mismo que la del servidor
//     (control_obra.convocatoria_cumple_filtro, la fuente de verdad) sobre las convocatorias vigentes reales; «Participar»
//     no deja convertir dos veces; la función convocatorias-chihuahua rechaza sin sesión y valida filtros SIN consultar
//     el portal (las búsquedas reales al portal se prueban a mano, ver progress.txt).
// Repo público: los tokens sólo vienen del entorno. Lo que se crea (licitación QA-G-*, seguimiento) se borra al final.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { filtrosManual, fechaDmy, formBusqueda } from '../../supabase/functions/convocatorias-chihuahua/parse.mjs';
const require = createRequire(import.meta.url);
const C = require('../../src/js/convocatorias.js');

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const A = process.env.QA_TOKEN_A || process.env.OBRA_QA_TOKEN || '';
async function rest(path, token, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(token ? { 'x-obra-token': token } : {}), ...(opts.headers || {}) },
  });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
const rpc = (name, token, args = {}) => rest(`rpc/${name}`, token, { method: 'POST', body: JSON.stringify(args) });

const conv = (o) => Object.assign({ fuente: 'chihuahua', entidad: 'Chihuahua', tipo_contratacion: 'obra_publica',
  numero_procedimiento: 'OP-1-2026', titulo: 'Construcción de aula', dependencia: 'Municipio de Cuauhtémoc', municipio: 'Cuauhtémoc' }, o);

test('norm() es control_obra.texto_norm: sin acentos ni mayúsculas, signos a espacio', () => {
  assert.equal(C.norm('  PAVIMENTACIÓN, Calle «Ñandú» #12 '), 'pavimentacion calle nandu 12');
  assert.equal(C.norm(null), '');
  assert.equal(C.textoConvocatoria(conv()), 'op 1 2026 construccion de aula municipio de cuauhtemoc cuauhtemoc');
});

test('US-844: cumpleFiltro (cualquier palabra clave, ninguna excluida, listas vacías = todo)', () => {
  const c = conv();
  assert.equal(C.cumpleFiltro(c, {}), true, 'filtro vacío deja pasar todo');
  assert.equal(C.cumpleFiltro(c, { palabras_clave: ['pavimento', 'AULA'] }), true, 'basta una, sin mayúsculas');
  assert.equal(C.cumpleFiltro(c, { palabras_clave: ['construcción'] }), true, 'sin acentos');
  assert.equal(C.cumpleFiltro(c, { palabras_clave: ['puente'] }), false);
  assert.equal(C.cumpleFiltro(c, { palabras_clave: [' ', ''] }), true, 'claves vacías no exigen');
  assert.equal(C.cumpleFiltro(c, { palabras_excluir: ['Cuauhtemoc'] }), false, 'excluir mira también dependencia y municipio');
  assert.equal(C.cumpleFiltro(c, { fuentes: ['comprasmx'] }), false);
  assert.equal(C.cumpleFiltro(c, { fuentes: ['chihuahua', 'comprasmx'] }), true);
  assert.equal(C.cumpleFiltro(c, { tipos_contratacion: ['servicios_obra'] }), false);
  assert.equal(C.cumpleFiltro(c, { entidades: ['chihuahua'] }), true, 'entidad normalizada');
  assert.equal(C.cumpleFiltro(conv({ entidad: null }), { entidades: ['Chihuahua'] }), false, 'sin entidad no cumple un filtro con entidades');
  assert.equal(C.cumpleFiltro(c, { entidades: [''] }), false, 'como en SQL: una lista con sólo vacíos no deja pasar nada');
  assert.equal(C.cumpleAlguno(c, [{ activo: false }, { activo: true, fuentes: ['comprasmx'] }]), false, 'los apagados no cuentan');
  assert.equal(C.cumpleAlguno(c, [{ activo: true, palabras_clave: ['aula'] }]), true);
});

test('vigente, días y argumentos de la búsqueda paginada', () => {
  const ahora = '2026-10-05T18:00:00Z';
  assert.equal(C.vigente({ estatus: 'vigente', apertura: null }, ahora), true);
  assert.equal(C.vigente({ estatus: 'terminado' }, ahora), false);
  assert.equal(C.vigente({ estatus: 'en_seguimiento', apertura: '2026-10-04T19:00:00Z' }, ahora), true, 'hasta un día después de la apertura');
  assert.equal(C.vigente({ estatus: 'vigente', apertura: '2026-10-03T12:00:00Z' }, ahora), false);
  assert.equal(C.diasA('2026-10-08T17:00:00Z', '2026-10-05'), 3);
  assert.equal(C.diasA('2026-10-06T05:30:00Z', '2026-10-05'), 0, 'las 23:30 del 5 en México');
  const a = C.argsBusqueda({ texto: ' pavimento ', fuente: 'chihuahua', estado: 'nueva', abren: '7', mis: true, pagina: 2 });
  assert.deepEqual([a.p_texto, a.p_fuentes, a.p_estados, a.p_abren_dias, a.p_mis_filtros, a.p_limite, a.p_offset],
    ['pavimento', ['chihuahua'], ['nueva'], 7, true, 50, 100]);
  assert.equal(C.argsBusqueda({}).p_entidades, null);
  assert.deepEqual(C.parseLista('escuela, Pavimento; escuela\n  ,aula'), ['escuela', 'Pavimento', 'aula']);
});

test('US-845: datos de la licitación, plaza, modalidad y perfil sugerido', () => {
  assert.equal(C.plazaDe('Cuauhtémoc'), 'cuauhtemoc');
  assert.equal(C.plazaDe('Juárez'), 'juarez');
  assert.equal(C.plazaDe('Hidalgo del Parral'), 'parral');
  assert.equal(C.plazaDe('Nuevo Casas Grandes'), 'casas_grandes');
  assert.equal(C.plazaDe('Chihuahua'), 'chihuahua');
  assert.equal(C.plazaDe('Delicias'), 'otra');
  assert.equal(C.plazaDe(null, 'Municipio de Cuauhtémoc'), 'cuauhtemoc');
  assert.equal(C.plazaDe(null, 'Secretaría de Comunicaciones y Obras Públicas'), null);
  assert.equal(C.modalidadDe('invitacion'), 'invitacion');
  assert.equal(C.modalidadDe('otro'), null);
  const perfiles = [
    { id: 1, nombre: 'ICHIFE (Chihuahua)', descripcion: 'Instituto Chihuahuense de Infraestructura Física Educativa. Lista validada…', activo: true, es_fabrica: true },
    { id: 2, nombre: 'Municipio de Cuauhtémoc', descripcion: 'Obra pública municipal de Cd. Cuauhtémoc.', activo: true, es_fabrica: true },
  ];
  assert.equal(C.sugerirPerfil('Instituto Chihuahuense  de Infraestructura Física Educativa', perfiles).id, 1, 'por el nombre completo de la descripción');
  assert.equal(C.sugerirPerfil('ICHIFE', perfiles).id, 1, 'por la sigla');
  assert.equal(C.sugerirPerfil('Municipio de Cuauhtémoc', perfiles).id, 2);
  assert.equal(C.sugerirPerfil('Municipio de Chihuahua', perfiles), null, 'no confunde municipios');
  assert.equal(C.sugerirPerfil('Municipio de Nuevo Casas Grandes', perfiles), null);
  assert.equal(C.sugerirPerfil('', perfiles), null);
  const c = conv({ id_externo: '274240', tipo_procedimiento: 'licitacion_publica', apertura: '2026-10-20T17:30:00Z',
    junta_aclaraciones: '2026-10-09T16:00:00Z', fallo: null, url_detalle: 'https://contrataciones.chihuahua.gob.mx/licitaciones/274240/' });
  const d = C.datosLicitacion(c, 2);
  assert.deepEqual([d.codigo, d.nombre, d.convocante, d.modalidad, d.plaza, d.presentacion, d.junta_aclaraciones, d.fallo, d.perfil_id],
    ['OP-1-2026', 'Construcción de aula', 'Municipio de Cuauhtémoc', 'licitacion_publica', 'cuauhtemoc', '2026-10-20T17:30:00Z', '2026-10-09T16:00:00Z', null, 2]);
  assert.match(d.notas, /Contrataciones Chihuahua: https:\/\/contrataciones/);
  assert.equal(C.datosLicitacion(conv({ numero_procedimiento: null, id_externo: 'abc' })).codigo, 'abc');
});

test('US-845: cambios de fechas; enlaces sólo http(s)', () => {
  const info = { aceptadas: { junta_aclaraciones: '2026-10-09T16:00:00+00:00', apertura: '2026-10-20T17:30:00+00:00', fallo: null },
                 actuales: { junta_aclaraciones: '2026-10-09T16:00:00Z', apertura: '2026-10-22T17:30:00Z', fallo: '2026-11-06T20:45:00Z' } };
  assert.deepEqual(C.cambiosFechas(info).map((x) => x.campo), ['apertura', 'fallo'], 'el mismo instante en otra zona no es cambio');
  assert.deepEqual(C.cambiosFechas(null), []);
  assert.equal(C.urlSegura('javascript:alert(1)'), null);
  assert.equal(C.urlSegura(' https://x.mx/a '), 'https://x.mx/a');
});

test('US-850: formulario de búsqueda, filtro guardado y cuerpos de cada fuente', () => {
  const p = C.formDesdeFiltro({ fuentes: ['comprasmx'], entidades: ['Chihuahua'], tipos_contratacion: ['obra_publica', 'servicios_obra'], palabras_clave: ['escuela', 'aula'] });
  assert.deepEqual(p, { chihuahua: false, comprasmx: true, texto: 'escuela', tipo: '', entidad: 'Chihuahua' });
  assert.equal(C.formDesdeFiltro({ tipos_contratacion: ['servicios_obra'] }).tipo, 'servicios_obra');
  assert.deepEqual(C.cuerpoComprasmx({ texto: 'aula', tipo: '', entidad: 'Chihuahua', desde: '2026-09-01', hasta: '', max: 30 }),
    { texto: 'aula', tipos: ['obra_publica', 'servicios_obra'], entidades: ['Chihuahua'], desde: '2026-09-01', hasta: '', max_resultados: 30 });
  assert.deepEqual(C.cuerpoChihuahua({ texto: 'aula', tipo: 'obra_publica', procedimiento: 'invitacion', estatus: '', max: 10 }),
    { texto: 'aula', tipo_contratacion: 'obra_publica', tipo_procedimiento: 'invitacion', estatus: '', desde: '', hasta: '', max_resultados: 10 });
  assert.equal(C.CONECTOR, 'http://127.0.0.1:8879');
  const f = (x) => C.textoUltimaBusqueda(x, (t) => t.slice(0, 10));
  assert.equal(f({ fuente: 'comprasmx' }), 'ComprasMX: todavía no se ha buscado.');
  assert.equal(f({ fuente: 'chihuahua', ultima_inicio: '2026-10-05T15:00:00Z', ultima_fin: 'x', ultima_usuario: 'Ricardo', encontradas: 1, nuevas: 0 }),
    'Contrataciones Chihuahua: última búsqueda el 2026-10-05, por Ricardo (1 encontrada, 0 nuevas).');
  assert.match(f({ fuente: 'comprasmx', ultima_inicio: '2026-10-05', ultima_origen: 'conector-pc', ultima_error: 'Bloqueo' }), /desde el conector local \(terminó con error: Bloqueo\)/);
});

test('US-850: filtros de la función convocatorias-chihuahua viajan en el POST del portal', () => {
  assert.equal(fechaDmy('2026-09-01'), '01/09/2026');
  assert.equal(fechaDmy('2026-02-30'), '');
  const a = filtrosManual({ texto: '  pavimentación  ', tipo_contratacion: 'obra_publica', tipo_procedimiento: 'licitacion_publica', desde: '2026-09-01', hasta: '2026-10-05', max_resultados: 500 });
  assert.equal(a.consultas.length, 1, 'un tipo = una consulta al portal');
  assert.deepEqual(a.consultas[0], { materia: '3', estatus: '0', texto: 'pavimentación', tipoLicitacion: '1', desde: '01/09/2026', hasta: '05/10/2026' });
  assert.equal(a.filtros.max_resultados, 200, 'tope de 200');
  const form = formBusqueda('tok', a.consultas[0]);
  assert.deepEqual(['desc_procedimiento', 'TipoProc', 'Tipo_de_Licitaci_n', 'Estatus', 'fechainicio', 'fechafin', 'rdFechas'].map((k) => form.get(k)),
    ['pavimentación', '3', '1', '0', '01/09/2026', '05/10/2026', '2']);
  assert.equal(filtrosManual({}).consultas.length, 2, 'sin tipo: obra y servicios (máximo 2 consultas)');
  assert.equal(filtrosManual({}).filtros.estatus, 'vigente', 'por omisión sólo vigentes');
  assert.match(filtrosManual({ estatus: '' }).error, /texto o un rango de fechas/);
  assert.ok(filtrosManual({ estatus: '', texto: 'aula' }).consultas.every((q) => q.estatus === '-1'));
  assert.match(filtrosManual({ tipo_contratacion: 'adquisicion' }).error, /no válido/);
  assert.match(filtrosManual({ desde: '2026-10-05', hasta: '2026-09-01' }).error, /posterior/);
  assert.match(filtrosManual({ desde: '05/10/2026' }).error, /AAAA-MM-DD/);
});

test('US-853: texto de la barra (todas las palabras, «-palabra» excluye), fichas y filtros guardados desde la barra', () => {
  assert.deepEqual(C.parseTextoBarra('  Red AGUA -Mantenimiento - agua -mantenimiento'), { palabras: ['red', 'agua'], excluir: ['mantenimiento'] });
  const c = conv({ descripcion: 'Red de agua potable en la colonia Siglo XXI' });
  assert.match(C.textoConvocatoria(c), /red de agua potable/, 'la descripción entra al texto (migración 108)');
  assert.equal(C.cumpleTextoBarra(c, 'agua aula'), true, 'todas las palabras, en cualquier campo');
  assert.equal(C.cumpleTextoBarra(c, 'agua puente'), false);
  assert.equal(C.cumpleTextoBarra(c, 'aula -potable'), false, 'excluir mira también la descripción');
  const s = { ...C.BARRA_INICIAL, texto: 'agua -mantenimiento', municipio: 'Juárez', pub: '30', abren: 'rango', abren_desde: '2026-10-01', abren_hasta: '2026-10-31', orden: 'publicacion' };
  const a = C.argsBusqueda(s);
  assert.deepEqual([a.p_texto, a.p_excluir, a.p_municipio, a.p_pub_dias, a.p_abren_dias, a.p_abren_desde, a.p_abren_hasta, a.p_orden, a.p_estados, a.p_mis_filtros, a.p_solo_vigentes],
    ['agua', ['mantenimiento'], 'Juárez', 30, null, '2026-10-01', '2026-10-31', 'publicacion', ['nueva'], true, true]);
  assert.equal(C.argsBusqueda({ estatus: 'terminado' }).p_solo_vigentes, false, 'con estatus del portal se ven también las no vigentes');
  assert.equal(C.argsBusqueda({ orden: 'x' }).p_orden, 'apertura');
  const f = C.fichasActivas(s, () => 'X');
  assert.deepEqual(f.map((x) => x.k), ['texto', 'excluir:mantenimiento', 'mis', 'municipio', 'estado', 'abren', 'pub']);
  assert.equal(C.cuentaFiltros(C.BARRA_VACIA), 0);
  assert.equal(C.cuentaFiltros(C.quitarFicha(s, 'abren')), 6);
  assert.equal(C.quitarFicha(s, 'texto').texto, '-mantenimiento', 'quitar el texto deja las exclusiones');
  assert.equal(C.quitarFicha(s, 'excluir:mantenimiento').texto, 'agua');
  const g = C.filtroDesdeBarra({ ...s, fuente: 'comprasmx', entidad: 'Chihuahua', tipo: 'obra_publica', texto: 'red agua -mant' });
  assert.deepEqual([g.palabras_clave, g.palabras_excluir, g.fuentes, g.entidades, g.tipos_contratacion], [['red', 'agua'], ['mant'], ['comprasmx'], ['Chihuahua'], ['obra_publica']]);
  assert.equal(g.barra.municipio, 'Juárez'); assert.equal('pagina' in g.barra, false);
  const b = C.barraDesdeFiltro({ id: 7, barra: g.barra });
  assert.deepEqual([b.filtro, b.municipio, b.texto, b.mis, b.orden], ['7', 'Juárez', 'red agua -mant', false, 'publicacion']);
  assert.deepEqual([C.barraDesdeFiltro({ id: 3 }).filtro, C.barraDesdeFiltro({ id: 3 }).estado], ['3', ''], 'filtro sin barra: sólo su regla');
});

test('US-853: lista de Licitaciones con texto, convocante y resultado', () => {
  const L = require('../../src/js/licitaciones.js');
  const lics = [
    { id: 1, codigo: 'LO-1', nombre: 'Pavimentación de la calle 5', convocante: 'Municipio de Cuauhtémoc', estatus: 'ganada' },
    { id: 2, codigo: 'IO-2', nombre: 'Escuela primaria', convocante: 'ICHIFE', estatus: 'presentada' },
    { id: 3, codigo: 'LP-3', nombre: 'Pavimento acceso', convocante: 'ICHIFE', estatus: 'desierta' },
  ];
  assert.deepEqual(L.filtrar(lics, { texto: 'PAVIMENTACION cuauhtemoc' }).map((l) => l.id), [1], 'todas las palabras, sin acentos');
  assert.deepEqual(L.filtrar(lics, { convocante: 'ichife' }).map((l) => l.id), [2, 3]);
  assert.deepEqual(L.filtrar(lics, { resultado: 'sin_fallo' }).map((l) => l.id), [2]);
  assert.deepEqual(L.filtrar(lics, { resultado: 'otro' }).map((l) => l.id), [3]);
  assert.deepEqual(L.convocantesDe(lics), ['ICHIFE', 'Municipio de Cuauhtémoc']);
  assert.deepEqual(L.fichasLista({ texto: 'x', convocante: 'ICHIFE', resultado: 'ganada' }).map((f) => f.k), ['texto', 'convocante', 'resultado']);
});

// ---- Contra el servidor ------------------------------------------------------------------------------------------------
const conToken = { skip: A ? false : 'OBRA_QA_TOKEN no definido' };

test('una sola regla: cumpleFiltro() (JS) cuenta lo mismo que convocatoria_cumple_filtro (SQL) en las vigentes reales', conToken, async () => {
  const r = await rpc('convocatorias_buscar', A, { p_solo_vigentes: true, p_limite: 1000 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const vig = r.body;
  assert.ok(vig.length > 0);
  const casos = [
    {},
    { fuentes: ['chihuahua'], tipos_contratacion: ['obra_publica', 'servicios_obra'] },
    { fuentes: ['comprasmx'], entidades: ['chihuahua'] },
    { palabras_clave: ['pavimentacion', 'ESCUELA'], palabras_excluir: ['juárez'] },
    { palabras_clave: ['construcción'], tipos_contratacion: ['servicios_obra'] },
    { palabras_clave: ['cuauhtemoc'] },
    { entidades: ['Ciudad de México'] },
  ];
  for (const f of casos) {
    const s = await rpc('get_convocatorias_conteo_filtro', A, { p_claves: f.palabras_clave || [], p_excluir: f.palabras_excluir || [],
      p_fuentes: f.fuentes || [], p_entidades: f.entidades || [], p_tipos: f.tipos_contratacion || [] });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    if (vig.length < 1000) assert.equal(s.body.vigentes, vig.length, 'mismo universo de vigentes');
    const js = vig.filter((c) => C.cumpleFiltro(c, f)).length;
    assert.equal(js, s.body.cumplen, `mismo conteo para ${JSON.stringify(f)}`);
  }
});

test('US-853: la barra se filtra en el servidor con la misma regla que en JS, y responde rápido', conToken, async () => {
  const todas = await rpc('convocatorias_buscar', A, { p_solo_vigentes: false, p_limite: 1000 });
  assert.equal(todas.status, 200, JSON.stringify(todas.body));
  const U = todas.body;
  assert.ok(U.length > 900, 'universo de ~1,000 convocatorias');
  assert.ok('descripcion' in U[0] && 'descarga_estado' in U[0], 'la RPC expone descripción y estado de la descarga');
  assert.ok(U.filter((c) => c.fuente === 'comprasmx').every((c) => c.descripcion), 'las federales tienen descripción');
  for (const texto of ['pavimentacion', 'agua potable', 'construccion -pavimentacion', 'chihuahua escuela -juarez']) {
    const t = C.parseTextoBarra(texto);
    const r = await rpc('convocatorias_buscar', A, { p_texto: t.palabras.join(' '), p_excluir: t.excluir, p_solo_vigentes: false, p_limite: 1000 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.length, U.filter((c) => C.cumpleTextoBarra(c, texto)).length, `misma regla para «${texto}»`);
  }
  const pub = await rpc('convocatorias_buscar', A, { p_pub_dias: 30, p_solo_vigentes: false, p_orden: 'publicacion', p_limite: 1000 });
  assert.equal(pub.status, 200);
  const lim = Date.now() - 31 * 86400e3;
  assert.ok(pub.body.every((c) => c.publicacion && new Date(c.publicacion).getTime() >= lim), 'publicadas en los últimos 30 días');
  const fechas = pub.body.map((c) => new Date(c.publicacion).getTime());
  assert.deepEqual(fechas, [...fechas].sort((a, b) => b - a), 'orden por publicación más reciente');
  const dep = await rpc('convocatorias_buscar', A, { p_dependencia: 'Obras Públicas', p_solo_vigentes: false, p_orden: 'dependencia', p_limite: 1000 });
  assert.ok(dep.body.length > 0 && dep.body.every((c) => C.norm(`${c.dependencia || ''} ${c.unidad_compradora || ''}`).includes('obras publicas')), 'dependencia o unidad, sin acentos');
  assert.equal(dep.body.length, U.filter((c) => C.norm(`${c.dependencia || ''} ${c.unidad_compradora || ''}`).includes('obras publicas')).length);
  const nd = dep.body.map((c) => C.norm(c.dependencia || c.unidad_compradora || ''));
  assert.deepEqual(nd, [...nd].sort(), 'orden por dependencia');
  const op = await rpc('convocatorias_opciones', A, {});
  assert.equal(op.status, 200); assert.ok(op.body.dependencias.length > 5 && op.body.municipios.length > 0);
  assert.notEqual((await rpc('convocatorias_buscar', A, { p_orden: 'precio' })).status, 200, 'orden no válido');
  assert.notEqual((await rpc('convocatorias_buscar', '', {})).status, 200, 'sin sesión no hay lista');
  // Tiempos: consultas típicas de la barra (50 por página), mediana de 3.
  const casos = [{}, { p_texto: 'pavimentacion', p_estados: ['nueva'], p_mis_filtros: true }, { p_dependencia: 'obras publicas', p_pub_dias: 30, p_orden: 'publicacion' },
    { p_texto: 'construccion', p_excluir: ['mantenimiento'], p_municipio: 'juarez', p_abren_dias: 30, p_orden: 'dependencia' }];
  const ms = [];
  for (const k of casos) {
    const t = [];
    for (let i = 0; i < 3; i++) { const t0 = Date.now(); const r = await rpc('convocatorias_buscar', A, { p_limite: 50, ...k }); t.push(Date.now() - t0); assert.equal(r.status, 200); }
    ms.push(t.sort((a, b) => a - b)[1]);
  }
  console.log('# tiempos convocatorias_buscar (ms, mediana de 3, ida y vuelta desde esta PC):', ms.join(', '));
  // El criterio de < 400 ms se mide aislado en convocatorias-filtros-smoke.py: aquí la suite corre en paralelo y la red
  // de esta PC a Supabase varía; el servidor tarda 3-20 ms (EXPLAIN en progress.txt). Aquí sólo una cota de cordura.
  assert.ok(ms.sort((a, b) => a - b)[1] < 400 && Math.max(...ms) < 1500, `consultas de la barra: ${ms}`);
});

test('sin sesión no hay vista previa, ni conversión, ni búsqueda en el portal', async () => {
  assert.notEqual((await rpc('get_convocatorias_conteo_filtro', '', {})).status, 200);
  assert.notEqual((await rpc('convocatoria_participar', '', { p_convocatoria_id: 1, p_datos: {} })).status, 200);
  assert.notEqual((await rpc('generar_avisos_convocatorias', '', { p_simular: true })).status, 200, 'los recordatorios sólo los genera service_role');
  assert.notEqual((await rpc('convocatoria_busqueda_iniciar', '', { p_fuente: 'chihuahua', p_origen: 'x', p_usuario: null, p_empresa: 1, p_filtros: {} })).status, 200);
  const fn = (h, b) => fetch(`${SB}/functions/v1/convocatorias-chihuahua`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b || {}) });
  assert.equal((await fn({})).status, 401, 'sin sesión ni llave');
  assert.equal((await fn({ 'x-obra-token': 'qa-no-existe' })).status, 401, 'sesión falsa');
  const pre = await fetch(`${SB}/functions/v1/convocatorias-chihuahua`, { method: 'OPTIONS' });
  assert.match(pre.headers.get('access-control-allow-headers') || '', /x-obra-token/, 'CORS para la app');
  if (A) {
    const r = await fn({ 'x-obra-token': A }, { estatus: '' });
    assert.equal(r.status, 400, 'filtros inválidos se rechazan antes de tocar el portal');
    assert.match((await r.json()).error, /texto o un rango/);
  }
});

test('US-845: «Participar» crea la licitación, deja «convertida» y no deja convertir dos veces', conToken, async () => {
  const b = await rpc('convocatorias_buscar', A, { p_estados: ['nueva'], p_solo_vigentes: false, p_fuentes: ['chihuahua'], p_limite: 1, p_offset: 37 });
  assert.equal(b.status, 200);
  if (!b.body.length) return;
  const c = b.body[0];
  const codigo = `QA-G-${Date.now()}`;
  let licId = null;
  try {
    const p = await rpc('convocatoria_participar', A, { p_convocatoria_id: c.id, p_datos: { ...C.datosLicitacion(c, null), codigo } });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    licId = p.body.id;
    assert.equal(p.body.licitacion.codigo, codigo);
    assert.equal(p.body.licitacion.nombre, c.titulo.slice(0, 300));
    const s = await rest(`convocatoria_seguimiento?convocatoria_id=eq.${c.id}&select=estado,licitacion_id,fechas_aceptadas`, A);
    assert.deepEqual([s.body[0].estado, s.body[0].licitacion_id], ['convertida', licId]);
    assert.ok(s.body[0].fechas_aceptadas && 'apertura' in s.body[0].fechas_aceptadas);
    const otra = await rpc('convocatoria_participar', A, { p_convocatoria_id: c.id, p_datos: { ...C.datosLicitacion(c, null), codigo: codigo + 'b' } });
    assert.notEqual(otra.status, 200, 'segunda conversión rechazada');
    assert.match(JSON.stringify(otra.body), /ya se convirtió/);
    const huerf = await rest(`licitaciones?codigo=eq.${codigo}b&select=id`, A);
    assert.equal(huerf.body.length, 0, 'la segunda no dejó licitación huérfana');
    const directo = await rest(`convocatoria_seguimiento?convocatoria_id=eq.${c.id}`, A, { method: 'PATCH', body: JSON.stringify({ estado: 'interesa' }) });
    assert.notEqual(directo.status, 200, 'tampoco por PostgREST directo');
    const marca = await rpc('convocatoria_marcar', A, { p_convocatoria_id: c.id, p_estado: 'descartada' });
    assert.notEqual(marca.status, 200);
    const info = await rpc('get_convocatoria_de_licitacion', A, { p_licitacion_id: licId });
    assert.equal(info.status, 200);
    assert.equal(info.body.convocatoria_id, c.id);
    assert.equal(info.body.cambio, false);
    const ign = await rpc('convocatoria_fechas_resolver', A, { p_licitacion_id: licId, p_actualizar: false });
    assert.equal(ign.status, 200, JSON.stringify(ign.body));
    const nada = await rpc('get_convocatoria_de_licitacion', A, { p_licitacion_id: -1 });
    assert.equal(nada.body, null);
  } finally {
    if (licId) await rest(`licitaciones?id=eq.${licId}`, A, { method: 'DELETE' });
    await rest(`convocatoria_seguimiento?convocatoria_id=eq.${c.id}`, A, { method: 'DELETE' });
  }
});

test('US-846: contador de nuevas sin revisar y resumen de una búsqueda', conToken, async () => {
  const a = await rpc('get_convocatorias_avisos', A, { p_desde: new Date(Date.now() + 3600e3).toISOString() });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.nuevas, 0, 'nada visto después del futuro');
  const b = await rpc('get_convocatorias_avisos', A, { p_desde: '2000-01-01T00:00:00Z' });
  assert.ok(b.body.nuevas >= 0);
  const e = await rpc('convocatorias_estado', A);
  assert.equal(e.status, 200);
  for (const k of ['ultima_id', 'ultima_usuario', 'ultima_origen']) assert.ok(k in e.body[0], k);
  const ult = e.body.find((x) => x.ultima_id);
  if (ult) {
    const r = await rpc('get_convocatoria_corrida_resumen', A, { p_corrida_id: ult.ultima_id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    for (const k of ['encontradas', 'nuevas', 'nuevas_cumplen', 'vistas']) assert.ok(k in r.body, k);
    const l = await rpc('convocatorias_buscar', A, { p_corrida_id: ult.ultima_id, p_solo_vigentes: false, p_limite: 5 });
    assert.equal(l.status, 200, JSON.stringify(l.body));
  }
});
