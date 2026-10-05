// Documentos de UNA convocatoria (US-848) y su revisión (US-849).
//   * Puras: supabase/functions/convocatorias-documentos/documentos.mjs y las de src/js/convocatorias.js (plan con topes,
//     sin duplicar, «Nuevo», convocatoria.json).
//   * Con OBRA_QA_TOKEN (.env): una descarga a la vez por empresa (convocatoria_descarga_iniciar), avance, notas con autor
//     puesto por el servidor, visitas, la política del bucket acepta empresa/<id>/convocatorias/… y la función
//     convocatorias-documentos rechaza sin sesión y no atiende convocatorias de ComprasMX (sin tocar el portal).
// Repo público: los tokens sólo vienen del entorno. Todo lo que se crea se borra al final.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { conIds, nombreArchivo, parseDocumentos, urlPermitida } from '../../supabase/functions/convocatorias-documentos/documentos.mjs';
const require = createRequire(import.meta.url);
const C = require('../../src/js/convocatorias.js');

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';
const A = process.env.QA_TOKEN_A || process.env.OBRA_QA_TOKEN || '';
const conToken = { skip: A ? false : 'OBRA_QA_TOKEN no definido' };
async function rest(path, token, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json',
    Prefer: 'return=representation', ...(token ? { 'x-obra-token': token } : {}), ...(opts.headers || {}) } });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
const rpc = (n, t, a = {}) => rest(`rpc/${n}`, t, { method: 'POST', body: JSON.stringify(a) });

const HTML = `<table><tr><th>Documento</th><th>Fecha</th><th></th></tr>
<tr><td>Convocatoria</td><td>02/10/2026</td><td><a href="https://contratosadm.chihuahua.gob.mx/descarga_portal.aspx?hg=A&amp;ps=B">Descargar</a></td></tr>
<tr><td>Anexo técnico</td><td>02/10/2026</td><td><a href="https://contratosadm.chihuahua.gob.mx/descarga_portal.aspx?hg=C">Descargar</a></td></tr>
<tr><td>Anexo técnico</td><td>02/10/2026</td><td><a href="https://contratosadm.chihuahua.gob.mx/descarga_portal.aspx?hg=D">Descargar</a></td></tr>
<tr><td>Otro</td><td>x</td><td><a href="javascript:alert(1)">mal</a></td></tr></table>`;

test('US-848: documentos del detalle de Chihuahua (lista, ids estables, hosts permitidos, nombre legible)', () => {
  const d = conIds(parseDocumentos(HTML));
  assert.equal(d.length, 3, 'sólo enlaces http(s) o relativos');
  assert.equal(d[0].url, 'https://contratosadm.chihuahua.gob.mx/descarga_portal.aspx?hg=A&ps=B');
  assert.deepEqual(d.map((x) => x.id), ['convocatoria|02/10/2026|1', 'anexo tecnico|02/10/2026|1', 'anexo tecnico|02/10/2026|2'], 'tipo|fecha|n sin depender del token del enlace');
  assert.equal(urlPermitida(d[0].url), true);
  for (const u of ['http://contratosadm.chihuahua.gob.mx/x', 'https://evil.example/x', 'https://contratosadm.chihuahua.gob.mx.evil.io/', 'file:///etc/passwd']) assert.equal(urlPermitida(u), false, u);
  assert.equal(nombreArchivo('Convocatoria', '02/10/2026', 'attachment; filename=Convocatoria_05102026111027LAGHEKENVF.pdf', 'application/pdf'), 'Convocatoria 2026-10-02.pdf');
  assert.equal(nombreArchivo('Bases', '2/9/2026', null, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'Bases 2026-09-02.xlsx');
  assert.equal(nombreArchivo('A/B:C', null, 'attachment; filename="x.ZIP"', ''), 'A B C.zip');
});

test('US-848: plan de descarga (no duplica por id del portal; 50 MB por archivo; 60 archivos y 300 MB por convocatoria)', () => {
  const MB = 1048576;
  const lista = [{ id: 'a', nombre: 'a.pdf', tamano: 10 * MB }, { id: 'b', nombre: 'b.pdf', tamano: 51 * MB }, { id: 'c', nombre: 'c.pdf', tamano: 1 }];
  const p = C.planDescarga(lista, [{ origen_id: 'c', tamano: 1 }]);
  assert.deepEqual([p.bajar.map((x) => x.id), p.omitidos.map((x) => x.item.id), p.ya.map((x) => x.id)], [['a'], ['b'], ['c']]);
  assert.match(p.omitidos[0].motivo, /50 MB/);
  const muchos = Array.from({ length: 70 }, (_, i) => ({ id: 'x' + i, nombre: i + '.pdf', tamano: 1 }));
  const q = C.planDescarga(muchos, Array.from({ length: 5 }, (_, i) => ({ origen_id: 'viejo' + i, tamano: 1 })));
  assert.equal(q.bajar.length, 55, 'con 5 ya guardados sólo caben 55 más');
  assert.ok(q.omitidos.every((o) => /60 archivos/.test(o.motivo)));
  const grandes = Array.from({ length: 8 }, (_, i) => ({ id: 'g' + i, nombre: i + '.pdf', tamano: 45 * MB }));
  const g = C.planDescarga(grandes, []);
  assert.equal(g.bajar.length, 6, '6 × 45 MB = 270 MB; el séptimo pasaría de 300 MB');
  assert.equal(C.TOPE_ARCHIVOS, 60); assert.equal(C.TOPE_BYTES, 300 * MB);
  assert.equal(C.rutaDocumento(1, 1979, '0ac75c7ddc830f3452ee', 'NORMA D 2241-1 ñ.pdf'), 'empresa/1/convocatorias/1979/0ac75c7ddc83_NORMA_D_2241-1_n.pdf');
  assert.equal(C.mimeDocumento('Catálogo.XLSX'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(C.mimeDocumento('programa.exe'), null, 'tipos no admitidos no se suben');
});

test('US-849: «Nuevo» desde la visita anterior y convocatoria.json para revisión', () => {
  const arch = [{ id: 1, created_at: '2026-10-05T18:00:00Z' }, { id: 2, created_at: '2026-10-04T18:00:00Z' }];
  assert.deepEqual([...C.idsNuevos(arch, '2026-10-05T00:00:00Z')], [1]);
  assert.deepEqual([...C.idsNuevos(arch, null)], [], 'la primera visita no marca todo como nuevo');
  const j = C.convocatoriaJson({ fuente: 'comprasmx', numero_procedimiento: 'LO-1', titulo: 'Red de agua', descripcion: 'Construcción de red', tipo_contratacion: 'obra_publica',
    tipo_procedimiento: 'licitacion_publica', apertura: '2026-10-15T19:00:00Z', url_detalle: 'javascript:x' },
  [{ nombre: 'a.pdf', en_zip: 'a.pdf', anexo: 'CONVOCATORIA', tamano: 3, hash_sha256: 'h' }], [{ autor: 'Ricardo', created_at: 't', texto: 'ojo' }], '2026-10-05T00:00:00Z');
  assert.equal(j.formato, 'convocatoria-revision/v1');
  assert.match(j.instrucciones, /licitacion-bases\/v1/);
  assert.deepEqual([j.convocatoria.fuente, j.convocatoria.tipo_contratacion, j.convocatoria.tipo_procedimiento, j.convocatoria.url_detalle], ['ComprasMX', 'Obra pública', 'Licitación pública', null]);
  assert.deepEqual(j.archivos[0], { nombre: 'a.pdf', en_zip: 'a.pdf', anexo: 'CONVOCATORIA', tipo: null, tamano: 3, sha256: 'h', publicado_portal: null });
  assert.equal(j.notas[0].texto, 'ojo');
});

test('US-848/849 en el servidor: una descarga a la vez, avance, notas con autor, visitas y ruta del bucket', conToken, async () => {
  const b = await rpc('convocatorias_buscar', A, { p_solo_vigentes: false, p_fuentes: ['chihuahua'], p_limite: 2, p_offset: 101 });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const [c1, c2] = b.body;
  const borrar = async () => {
    for (const c of [c1, c2]) {
      await rest(`convocatoria_notas?convocatoria_id=eq.${c.id}`, A, { method: 'DELETE' });
      await rest(`convocatoria_archivos?convocatoria_id=eq.${c.id}`, A, { method: 'DELETE' });
      await rest(`convocatoria_descargas?convocatoria_id=eq.${c.id}`, A, { method: 'DELETE' });
    }
  };
  const previas = await rest(`convocatoria_descargas?convocatoria_id=in.(${c1.id},${c2.id})&select=id`, A);
  assert.equal(previas.body.length, 0, 'las convocatorias de prueba no tenían descargas');
  try {
    const d1 = await rpc('convocatoria_descarga_iniciar', A, { p_convocatoria_id: c1.id, p_motivo: 'manual' });
    assert.equal(d1.status, 200, JSON.stringify(d1.body));
    assert.equal(d1.body.estado, 'en_curso');
    const d2 = await rpc('convocatoria_descarga_iniciar', A, { p_convocatoria_id: c2.id, p_motivo: 'interesa' });
    assert.notEqual(d2.status, 200, 'otra convocatoria mientras una está en curso: rechazada');
    assert.match(JSON.stringify(d2.body), /una a la vez/);
    const av = await rpc('convocatoria_descarga_avance', A, { p_id: d1.body.id, p_estado: 'lista', p_total: 2, p_bajados: 1, p_omitidos: 1, p_bytes: 10, p_avisos: ['x'] });
    assert.equal(av.status, 200, JSON.stringify(av.body));
    assert.deepEqual([av.body.estado, av.body.bajados, av.body.omitidos, av.body.avisos], ['lista', 1, 1, ['x']]);
    const d3 = await rpc('convocatoria_descarga_iniciar', A, { p_convocatoria_id: c2.id, p_motivo: 'nuevos' });
    assert.equal(d3.status, 200, 'terminada la primera, ya se puede otra');
    assert.ok(d3.body.revisado_at, '«Buscar documentos nuevos» registra la revisión');
    await rpc('convocatoria_descarga_avance', A, { p_id: d3.body.id, p_estado: 'lista', p_total: 0, p_bajados: 0, p_omitidos: 0, p_bytes: 0 });
    assert.notEqual((await rest('convocatoria_descargas', A, { method: 'POST', body: JSON.stringify({ convocatoria_id: c1.id }) })).status, 201, 'la cola sólo se escribe por las RPC');
    // Notas: el autor lo pone el servidor
    const n = await rest('convocatoria_notas', A, { method: 'POST', body: JSON.stringify({ convocatoria_id: c1.id, texto: 'QA-K nota', autor: 'Falso', usuario_id: null }) });
    assert.equal(n.status, 201, JSON.stringify(n.body));
    assert.ok(n.body[0].autor && n.body[0].autor !== 'Falso' && n.body[0].usuario_id, 'autor y usuario de la sesión');
    // Visitas: la primera devuelve null; la segunda, la anterior
    const v1 = await rpc('convocatoria_visitar', A, { p_convocatoria_id: c1.id });
    const v2 = await rpc('convocatoria_visitar', A, { p_convocatoria_id: c1.id });
    assert.equal(v2.status, 200); assert.ok(v2.body, 'la segunda visita devuelve la anterior');
    // Bucket: empresa/<id>/convocatorias/<conv>/… se acepta con la sesión; otra carpeta no
    const emp = n.body[0].empresa_id;
    const ruta = `empresa/${emp}/convocatorias/${c1.id}/qa-k-${Date.now()}.txt`;
    const up = await fetch(`${SB}/storage/v1/object/licitaciones/${ruta}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-obra-token': A, 'Content-Type': 'text/plain' }, body: 'qa' });
    assert.equal(up.status, 200, await up.text());
    const ajena = await fetch(`${SB}/storage/v1/object/licitaciones/empresa/${emp}/otra-cosa/qa-k.txt`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-obra-token': A, 'Content-Type': 'text/plain' }, body: 'qa' });
    assert.notEqual(ajena.status, 200, 'otra carpeta no');
    const ins = await rest('convocatoria_archivos', A, { method: 'POST', body: JSON.stringify({ convocatoria_id: c1.id, nombre: 'qa.txt', tamano: 2, hash_sha256: 'a'.repeat(64), archivo_path: ruta, mime: 'text/plain', origen_id: 'qa-k' }) });
    assert.equal(ins.status, 201, JSON.stringify(ins.body));
    const dup = await rest('convocatoria_archivos', A, { method: 'POST', body: JSON.stringify({ convocatoria_id: c1.id, nombre: 'otro.txt', tamano: 2, hash_sha256: 'b'.repeat(64), archivo_path: ruta + '2', mime: 'text/plain', origen_id: 'qa-k' }) });
    assert.notEqual(dup.status, 201, 'el mismo documento del portal no se registra dos veces');
    await fetch(`${SB}/storage/v1/object/licitaciones`, { method: 'DELETE', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-obra-token': A, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [ruta] }) });
    assert.ok(v1.status === 200);
  } finally {
    await borrar();
  }
});

test('sin sesión no hay descargas, notas ni documentos; la función de Chihuahua no atiende ComprasMX', async () => {
  assert.notEqual((await rpc('convocatoria_descarga_iniciar', '', { p_convocatoria_id: 1 })).status, 200);
  assert.notEqual((await rpc('convocatoria_visitar', '', { p_convocatoria_id: 1 })).status, 200);
  assert.notEqual((await rpc('convocatoria_documentos_actualizar', '', { p_id: 1, p_documentos: [] })).status, 200, 'sólo service_role');
  assert.notEqual((await rpc('convocatoria_para_documentos', '', { p_id: 1 })).status, 200, 'sólo service_role');
  const n = await rest('convocatoria_notas?select=id&limit=1', '');
  assert.ok(n.status !== 200 || n.body.length === 0);
  const fn = (h, b) => fetch(`${SB}/functions/v1/convocatorias-documentos`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b || {}) });
  assert.equal((await fn({}, { accion: 'lista', convocatoria_id: 1 })).status, 401);
  assert.equal((await fn({ 'x-obra-token': 'qa-no-existe' }, { accion: 'lista', convocatoria_id: 1 })).status, 401);
  const pre = await fetch(`${SB}/functions/v1/convocatorias-documentos`, { method: 'OPTIONS' });
  assert.match(pre.headers.get('access-control-expose-headers') || '', /X-Archivo-Nombre/);
  if (A) {
    const f = await rpc('convocatorias_buscar', A, { p_fuentes: ['comprasmx'], p_solo_vigentes: false, p_limite: 1 });
    const r = await fn({ 'x-obra-token': A }, { accion: 'lista', convocatoria_id: f.body[0].id });
    assert.equal(r.status, 400, 'ComprasMX va por el conector, no por esta función');
    const x = await fn({ 'x-obra-token': A }, { accion: 'archivo', convocatoria_id: f.body[0].id, id: 'x' });
    assert.equal(x.status, 400);
  }
});
