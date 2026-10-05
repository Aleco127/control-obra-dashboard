// convocatorias-ingesta (US-842): normalización pura (sin red) con un expediente real de ComprasMX guardado
// (IO-67-010-908029999-N-36-2026, 4-oct-2026; sin correo ni nombre del servidor público), y la autenticación de la
// función por la API real: sin secreto de servidor responde 401 aunque traiga un token de usuario.
// Con CONVOCATORIAS_INGESTA_SECRET en el entorno prueba además que un lote inválido se descarta sin escribir nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizar, entidad, estatus, fechaMx, tipoContratacion } from '../../supabase/functions/convocatorias-ingesta/normalizar.mjs';

const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co';
const FN = `${SB}/functions/v1/convocatorias-ingesta`;
const fx = JSON.parse(readFileSync(new URL('./fixtures/comprasmx-expediente.json', import.meta.url), 'utf8'));

test('expediente de ComprasMX con detalle → convocatoria normalizada', () => {
  const c = normalizar({ ...fx.registro, detalle: fx.detalle });
  assert.equal(c.fuente, 'comprasmx');
  assert.equal(c.id_externo, '8734b5ab82b04fca9231c4adaf2c901f');
  assert.equal(c.numero_procedimiento, 'IO-67-010-908029999-N-36-2026');
  assert.equal(c.tipo_procedimiento, 'invitacion');
  assert.equal(c.tipo_contratacion, 'obra_publica');
  assert.equal(c.entidad, 'Chihuahua');
  assert.equal(c.estatus, 'vigente');
  assert.equal(c.dependencia, 'INSTITUTO CHIHUAHUENSE DE INFRAESTRUCTURA FÍSICA EDUCATIVA');
  assert.equal(c.publicacion, '2026-09-22T11:29:00-06:00');
  assert.equal(c.junta_aclaraciones, '2026-09-29T13:00:00-06:00');
  assert.equal(c.apertura, '2026-10-06T10:00:00-06:00');
  assert.equal(c.fallo, '2026-10-13T13:00:00-06:00');
  assert.equal(c.url_detalle, 'https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/8734b5ab82b04fca9231c4adaf2c901f/procedimiento');
  assert.ok(c.detalle_at);
  assert.ok(!('detalle' in c.datos.expediente), 'no duplica el detalle dentro del expediente');
});

test('sin detalle no manda la dependencia (sólo siglas) para no pisar el nombre completo', () => {
  const c = normalizar(fx.registro);
  assert.equal(c.dependencia, null);
  assert.equal(c.publicacion, null);
  assert.equal(c.apertura, '2026-10-06T10:00:00-06:00');
  assert.ok(!('detalle_at' in c));
});

test('catálogos y fechas', () => {
  assert.equal(entidad('NUEVO LEÓN'), 'Nuevo León');
  assert.equal(entidad('MÉXICO'), 'Estado de México');
  assert.equal(entidad('COAHUILA DE ZARAGOZA'), 'Coahuila');
  assert.equal(tipoContratacion('SERVICIOS RELACIONADOS CON LA OBRA'), 'servicios_obra');
  assert.equal(tipoContratacion('ADQUISICIONES'), 'adquisicion');
  assert.equal(estatus('VIGENTE PAP'), 'vigente');
  assert.equal(estatus('EN SEGUIMIENTO'), 'en_seguimiento');
  assert.equal(fechaMx('2026-10-06T10:00'), '2026-10-06T10:00:00-06:00');
  assert.equal(fechaMx(null), null);
  assert.equal(fechaMx('basura'), null);
});

test('valida lo ya normalizado: rechaza fuente o id inválidos y limpia enums, url y fechas', () => {
  assert.equal(normalizar({ fuente: 'otra', id_externo: '1' }), null);
  assert.equal(normalizar({ fuente: 'chihuahua' }), null);
  assert.equal(normalizar([1, 2]), null);
  assert.equal(normalizar({ uuid_procedimiento: 'no-es-uuid' }), null);
  const c = normalizar({ fuente: 'chihuahua', id_externo: ' 99 ', titulo: '  Obra  x ', tipo_contratacion: 'nave_espacial',
    estatus: 'vigente', url_detalle: 'javascript:alert(1)', apertura: 'mañana', entidad: 'chihuahua', datos: [1] });
  assert.equal(c.id_externo, '99');
  assert.equal(c.titulo, 'Obra x');
  assert.equal(c.tipo_contratacion, null);
  assert.equal(c.estatus, 'vigente');
  assert.equal(c.url_detalle, null);
  assert.equal(c.apertura, null);
  assert.equal(c.entidad, 'Chihuahua');
  assert.deepEqual(c.datos, {});
});

test('la función exige el secreto de servidor (un token de usuario no basta)', async () => {
  const sinNada = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"accion":"estado"}' });
  assert.equal(sinNada.status, 401);
  const conToken = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-obra-token': process.env.OBRA_QA_TOKEN || 'qa-x', 'x-convocatorias-secret': 'x'.repeat(64) }, body: '{"accion":"estado"}' });
  assert.equal(conToken.status, 401);
  const chih = await fetch(`${SB}/functions/v1/convocatorias-chihuahua`, { method: 'POST', body: '{}' });
  assert.equal(chih.status, 401, 'el recolector de Chihuahua tampoco corre sin llave');
});

const SECRETO = process.env.CONVOCATORIAS_INGESTA_SECRET || '';
test('con secreto: lote inválido se descarta, acciones desconocidas y lotes grandes se rechazan', { skip: SECRETO ? false : 'CONVOCATORIAS_INGESTA_SECRET no definido' }, async () => {
  const post = (b) => fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-convocatorias-secret': SECRETO }, body: JSON.stringify(b) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
  const r = await post({ accion: 'lote', items: [{ fuente: 'otra', id_externo: 'x' }, { nada: 1 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.descartadas, 2);
  assert.equal(r.body.nuevas, 0);
  assert.equal((await post({ accion: 'borrar_todo' })).status, 400);
  assert.equal((await post({ accion: 'lote', items: Array.from({ length: 201 }, () => ({})) })).status, 413);
  const e = await post({ accion: 'estado' });
  assert.equal(e.status, 200);
  assert.deepEqual(e.body.fuentes.map((f) => f.fuente).sort(), ['chihuahua', 'comprasmx']);
  const c = await post({ accion: 'config' });
  assert.equal(c.status, 200);
  assert.ok(Array.isArray(c.body.entidades));
});
