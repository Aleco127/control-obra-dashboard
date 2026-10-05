// Funciones puras de la épica C (US-813 a US-821) en src/js/licitaciones.js. Sin red:
//   node --test scripts/qa/licitaciones-ficha.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const L = require('../../src/js/licitaciones.js');

test('US-813: filtros por estatus y año, años presentes y año de una licitación', () => {
  const lics = [
    { id: 1, estatus: 'en_preparacion', presentacion: '2026-10-20T16:00:00Z' },
    { id: 2, estatus: 'ganada', presentacion: '2025-11-03T16:00:00Z' },
    { id: 3, estatus: 'en_preparacion', presentacion: null, created_at: '2026-01-05T10:00:00Z' },
    { id: 4, estatus: 'perdida', presentacion: '2026-01-01T05:00:00Z' }, // 31-dic-2025 a las 23:00 en México
  ];
  assert.equal(L.anioDe(lics[3]), '2025', 'el año sale de la fecha civil de México');
  assert.deepEqual(L.aniosDe(lics), ['2026', '2025']);
  assert.deepEqual(L.filtrar(lics, { estatus: 'en_preparacion', anio: '' }).map((l) => l.id), [1, 3]);
  assert.deepEqual(L.filtrar(lics, { estatus: '', anio: '2025' }).map((l) => l.id), [2, 4]);
  assert.deepEqual(L.filtrar(lics, {}).length, 4);
});

test('US-814: fechas en hora de México para inputs y para guardar', () => {
  assert.equal(L.aLocalMx('2026-10-20T16:00:00Z'), '2026-10-20T10:00');
  assert.equal(L.aLocalMx('2026-10-21T05:30:00+00:00'), '2026-10-20T23:30', 'la noche del 20 en México');
  assert.equal(L.aLocalMx(null), '');
  assert.equal(L.aIsoMx('2026-10-20T10:00'), '2026-10-20T10:00:00-06:00');
  assert.equal(L.aIsoMx('2026-10-20'), '2026-10-20T10:00:00-06:00', 'una fecha sola queda a las 10:00');
  assert.equal(L.aIsoMx(''), null);
  assert.equal(L.aIsoMx('20/10/2026'), null);
  assert.equal(L.aLocalMx(L.aIsoMx('2026-03-15T08:45')), '2026-03-15T08:45', 'ida y vuelta sin horario de verano');
});

test('US-814: avance de requisitos por sobre (de «Listo» en adelante cuenta como hecho)', () => {
  const reqs = [
    { sobre: 'legal', estado: 'listo' }, { sobre: 'legal', estado: 'pendiente' }, { sobre: 'legal', estado: 'validado' },
    { sobre: 'tecnico', estado: 'en_revision' }, { sobre: 'economico', estado: 'firmado' },
  ];
  const a = L.avancePorSobre(reqs);
  assert.deepEqual(a.legal, { total: 3, hechos: 2, pct: 67 });
  assert.deepEqual(a.tecnico, { total: 1, hechos: 0, pct: 0 });
  assert.deepEqual(a.economico, { total: 1, hechos: 1, pct: 100 });
  assert.deepEqual(a.total, { total: 5, hechos: 3, pct: 60 });
  assert.deepEqual(L.avancePorSobre([]).total, { total: 0, hechos: 0, pct: 0 });
  assert.deepEqual(L.ESTADOS_HECHOS, ['listo', 'firmado', 'escaneado', 'foliado', 'validado']);
});

test('US-814: eventos del Calendario con tipo propio, id negativo estable y texto escapado', () => {
  const lics = [
    { id: 7, codigo: 'MC-<057>', nombre: 'Archivo "Municipal"', convocante: 'Municipio', estatus: 'en_preparacion',
      visita: '2026-08-20T16:00:00Z', junta_aclaraciones: '2026-09-03T16:00:00Z', presentacion: '2026-09-14T19:30:00Z', fallo: null },
    { id: 8, codigo: 'X', nombre: 'Cancelada', estatus: 'cancelada', presentacion: '2026-09-14T19:30:00Z' },
  ];
  const ev = L.eventosDeLicitacion(lics, '2026-09-04');
  assert.equal(ev.length, 3, 'sin fallo y sin la cancelada');
  assert.deepEqual(ev.map((e) => e.id), [-71, -72, -73]);
  assert.ok(ev.every((e) => e.tipo === 'Licitación' && e._lic === 7 && e.obra_id === null));
  assert.equal(ev[2].fecha_inicio, '2026-09-14');
  assert.equal(ev[2].hora_inicio, '13:30:00');
  assert.equal(ev[2].titulo, 'Presentación · MC-&lt;057&gt;');
  assert.equal(ev[2].descripcion, 'Archivo &quot;Municipal&quot;');
  assert.equal(ev[0].estatus, 'Completado');
  assert.equal(ev[2].estatus, 'Pendiente');
});

test('US-814: secciones de Bases cubren lo que guarda bases.json y leen/escriben cada tipo de campo', () => {
  const claves = L.SECCIONES_BASES.map((s) => s.k);
  for (const k of ['objeto', 'plazo', 'anticipo', 'garantias', 'fechas', 'criterios', 'desechamiento']) assert.ok(claves.includes(k), k);
  const campos = L.SECCIONES_BASES.flatMap((s) => s.campos);
  const cols = campos.filter((c) => c.col).map((c) => c.col);
  const sql = readFileSync(new URL('../../migrations/092_licitaciones_rpc.sql', import.meta.url), 'utf8');
  for (const c of cols) assert.match(sql, new RegExp(`\\b${c}\\s+= CASE WHEN p \\? '${c}'`), `guardar_licitacion actualiza ${c}`);
  const sub = campos.find((c) => c.tipo === 'subcriterios');
  assert.deepEqual(L.leerCampo(sub, 'Experiencia | 30\nPrecio|70 %\n|5'), [{ criterio: 'Experiencia', peso: 30 }, { criterio: 'Precio', peso: 70 }]);
  assert.equal(L.valorCampo({ bases: { criterios_evaluacion: { subcriterios: [{ criterio: 'A', peso: 1 }] } } }, sub), 'A | 1');
  const lista = campos.find((c) => c.tipo === 'lista');
  assert.deepEqual(L.leerCampo(lista, ' uno \n\n dos '), ['uno', 'dos']);
  assert.equal(L.leerCampo({ tipo: 'num' }, '$1,234.50'), 1234.5);
  assert.equal(L.leerCampo({ tipo: 'int' }, '100'), 100);
  assert.equal(L.leerCampo({ tipo: 'num' }, ''), null);
  assert.equal(L.leerCampo({ tipo: 'fh' }, '2026-09-14T13:30'), '2026-09-14T13:30:00-06:00');
  const o = { a: { b: 1 } };
  L.setRuta(o, 'x.y.z', 'v'); L.setRuta(o, 'a.b', null);
  assert.deepEqual(o, { a: {}, x: { y: { z: 'v' } } });
});

test('Pestañas ampliables: la lista y la ficha aceptan pestañas nuevas sin duplicar', () => {
  assert.deepEqual(L.FICHA_PESTANAS.map((p) => p.k), ['resumen', 'bases', 'archivos', 'requisitos', 'precios', 'cierre']);
  assert.equal(L.registrarPestana('lista', { k: 'convocatorias', t: 'Convocatorias', pintar() {} }), true);
  assert.equal(L.registrarPestana('lista', { k: 'convocatorias', t: 'Otra vez', pintar() {} }), false);
  assert.equal(L.registrarPestana('ficha', { k: 'x', t: 'X', pintar() {} }, 'bases'), true);
  assert.deepEqual(L.FICHA_PESTANAS.map((p) => p.k).slice(0, 3), ['resumen', 'bases', 'x']);
  assert.equal(L.registrarPestana('ficha', { k: 'sin-pintar' }), false);
  L.FICHA_PESTANAS.splice(2, 1); L.LISTA_PESTANAS.pop();
});

test('errTxt: el mensaje en español de una RPC pasa tal cual; lo técnico va por humanizeError', () => {
  assert.equal(L.errTxt({ message: 'Ya existe otra licitación con el código X.' }, 'No se guardó'), 'No se guardó: Ya existe otra licitación con el código X.');
  globalThis.humanizeError = (e, c) => `${c}: genérico`;
  assert.equal(L.errTxt({ message: 'duplicate key value violates unique constraint' }, 'Ctx'), 'Ctx: genérico');
  delete globalThis.humanizeError;
});

test('US-815: tipo MIME admitido por el bucket, nombre seguro, ruta, tamaño y agrupación', async () => {
  assert.equal(L.mimeDe('Plano A-1.DWG', 'application/octet-stream'), 'image/vnd.dwg', '.dwg siempre con image/vnd.dwg');
  assert.equal(L.mimeDe('bases.pdf', ''), 'application/pdf');
  assert.equal(L.mimeDe('catalogo.xlsx', ''), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(L.mimeDe('viejo.xls', 'application/vnd.ms-excel'), null, 'el bucket no admite .xls');
  assert.equal(L.nombreSeguro('Acta de junta Nº 2 (firmada).pdf'), 'Acta_de_junta_N_2_firmada_.pdf');
  assert.equal(L.nombreSeguro('x'.repeat(150) + '.pdf').length, 100);
  assert.ok(L.nombreSeguro('x'.repeat(150) + '.pdf').endsWith('.pdf'));
  assert.equal(L.rutaArchivo(1, 42, 'bases', 'Bases MC 057.pdf', 123), 'empresa/1/licitaciones/42/bases/123_Bases_MC_057.pdf');
  assert.equal(L.fmtBytes(512), '512 B');
  assert.equal(L.fmtBytes(2048), '2 KB');
  assert.equal(L.fmtBytes(5 * 1048576), '5.0 MB');
  const g = L.agruparPorCategoria([{ categoria: 'plano' }, { categoria: 'bases' }, { categoria: 'plano' }]);
  assert.deepEqual(g.map((x) => [x.k, x.archivos.length]), [['bases', 1], ['plano', 2]], 'orden del catálogo');
  const h = await L.sha256Hex(new TextEncoder().encode('abc'));
  assert.equal(h, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const u = new Set();
  assert.deepEqual(['a.pdf', 'A.pdf', 'a.pdf'].map((n) => L.nombreUnico(u, n)), ['a.pdf', 'A (2).pdf', 'a (3).pdf']);
});

test('US-816: requisitos de un sobre en su orden, mover arriba/abajo y categorías del expediente = CHECK de 081', () => {
  const reqs = [{ id: 3, sobre: 'legal', orden: 2 }, { id: 1, sobre: 'legal', orden: 1 }, { id: 9, sobre: 'tecnico', orden: 1 }, { id: 2, sobre: 'legal', orden: 2 }];
  assert.deepEqual(L.delSobre(reqs, 'legal').map((r) => r.id), [1, 2, 3], 'empate en orden: por id');
  assert.deepEqual(L.moverEnLista([1, 2, 3], 3, -1), [1, 3, 2]);
  assert.deepEqual(L.moverEnLista([1, 2, 3], 1, 1), [2, 1, 3]);
  assert.equal(L.moverEnLista([1, 2, 3], 1, -1), null);
  assert.equal(L.moverEnLista([1, 2, 3], 3, 1), null);
  const sql = readFileSync(new URL('../../migrations/081_expediente_empresa.sql', import.meta.url), 'utf8');
  const cat = sql.match(/categoria\s+text NOT NULL CHECK \(categoria IN \(([\s\S]*?)\)\),/)[1];
  assert.deepEqual([...cat.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(), Object.keys(L.CATEGORIAS_EXPEDIENTE).sort());
  const est = readFileSync(new URL('../../migrations/092_licitaciones_rpc.sql', import.meta.url), 'utf8').match(/p_estado NOT IN \(([^)]*)\)/)[1];
  assert.deepEqual([...est.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(), Object.keys(L.ESTADOS_REQUISITO).sort(), 'los 7 estados de LicitaGen');
});

test('US-817: semillas de fábrica (ICHIFE 45, Municipio de Cuauhtémoc 55) válidas y faltantes de un perfil', () => {
  const sql = readFileSync(new URL('../../migrations/093_perfiles_convocante.sql', import.meta.url), 'utf8');
  const listas = [...sql.matchAll(/\$r\d\$([\s\S]*?)\$r\d\$/g)].map((m) => JSON.parse(m[1]));
  assert.equal(listas.length, 2);
  const [ichife, cuau] = listas;
  assert.equal(ichife.length, 45);
  assert.equal(cuau.length, 55);
  const cuenta = (l) => l.reduce((o, x) => { o[x.sobre] = (o[x.sobre] || 0) + 1; return o; }, {});
  assert.deepEqual(cuenta(ichife), { legal: 13, tecnico: 15, economico: 17 });
  for (const l of listas) {
    assert.equal(new Set(l.map((x) => x.anexo_id.toLowerCase())).size, l.length, 'sin anexos repetidos');
    for (const x of l) {
      assert.ok(L.SOBRES[x.sobre], x.anexo_id); assert.ok(L.ORIGENES[x.origen], x.anexo_id);
      if (x.categoria_expediente) assert.ok(L.CATEGORIAS_EXPEDIENTE[x.categoria_expediente], x.anexo_id);
      assert.equal(x.origen === 'expediente', !!x.categoria_expediente, `${x.anexo_id}: categoría sólo en los del expediente`);
    }
  }
  assert.match(sql, /empresa_id, nombre[\s\S]*VALUES\s*\(NULL, 'ICHIFE \(Chihuahua\)'[\s\S]*\(NULL, 'Municipio de Cuauhtémoc'/, 'perfiles de fábrica con empresa_id NULL');
  const falt = L.faltantesDelPerfil({ requisitos_json: [{ anexo_id: 'L-1' }, { anexo_id: 'l-2 ' }, { anexo_id: 'T-1' }] }, [{ anexo_id: 'L-2' }, { anexo_id: 'x' }]);
  assert.deepEqual(falt.map((x) => x.anexo_id), ['L-1', 'T-1']);
});
