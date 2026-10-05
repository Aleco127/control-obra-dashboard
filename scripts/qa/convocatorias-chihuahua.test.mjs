// Parser del recolector de Contrataciones Chihuahua (US-840), sin red: fixtures guardados del portal real
// (búsqueda y detalle de OP-174-2026, 4-oct-2026). Si el portal cambia de forma, estas pruebas lo dicen primero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formBusqueda, tokenCsrf, normalizarFila, parseDetalle, conDetalle, fechaIso, tipoContratacion, tipoProcedimiento,
  estatus, municipio,
} from '../../supabase/functions/convocatorias-chihuahua/parse.mjs';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('el formulario manda -1 en los select vacíos (con "" el portal responde [])', () => {
  const f = formBusqueda('tok', { materia: '3', estatus: '0' });
  assert.equal(f.get('Tipo_de_Licitaci_n'), '-1');
  assert.equal(f.get('TipoProc'), '3');
  assert.equal(f.get('Estatus'), '0');
  assert.equal(f.get('rdFechas'), '2');
  assert.equal(f.get('csrfmiddlewaretoken'), 'tok');
  assert.equal(f.get('Unidades_Responsables'), '');
});

test('token CSRF: del JS de la página o del input oculto', () => {
  assert.equal(tokenCsrf('data: { csrfmiddlewaretoken: "abc123" }'), 'abc123');
  assert.equal(tokenCsrf('<input name="csrfmiddlewaretoken" type="text" value="zz9">'), 'zz9');
  assert.equal(tokenCsrf('<html></html>'), null);
});

test('catálogos a slugs sin acentos', () => {
  assert.equal(tipoContratacion('Obra pública'), 'obra_publica');
  assert.equal(tipoContratacion('Servicios relacionados con obra pública'), 'servicios_obra');
  assert.equal(tipoContratacion('Servicios (orden administrativo)'), 'servicios');
  assert.equal(tipoContratacion('Adquisición'), 'adquisicion');
  assert.equal(tipoProcedimiento('Invitación a cuando menos tres proveedores/contratistas'), 'invitacion');
  assert.equal(tipoProcedimiento('Adjudicación directa'), 'adjudicacion_directa');
  assert.equal(estatus('En seguimiento'), 'en_seguimiento');
  assert.equal(estatus('Cancelado'), 'cancelado');
  assert.equal(municipio('Municipio de Cuauhtémoc'), 'Cuauhtémoc');
  assert.equal(municipio('Instituto Chihuahuense de Infraestructura Física Educativa'), null);
});

test('renglón de la búsqueda → convocatoria normalizada', () => {
  const filas = JSON.parse(fx('chihuahua-busqueda.json'));
  const c = normalizarFila(filas[0]);
  assert.equal(c.fuente, 'chihuahua');
  assert.equal(c.id_externo, '274240');
  assert.equal(c.numero_procedimiento, 'OP-174-2026');
  assert.equal(c.tipo_procedimiento, 'licitacion_publica');
  assert.equal(c.tipo_contratacion, 'obra_publica');
  assert.equal(c.estatus, 'vigente');
  assert.equal(c.entidad, 'Chihuahua');
  assert.equal(c.municipio, 'Juárez');
  assert.equal(c.url_detalle, 'https://contrataciones.chihuahua.gob.mx/licitaciones/274240/');
  assert.ok(c.titulo.startsWith('Trabajos de Construcción de Cancha'));
  assert.equal(normalizarFila({}), null);
});

test('detalle: fechas con hora de Chihuahua, estatus y documentos', () => {
  const d = parseDetalle(fx('chihuahua-detalle-274240.html'));
  assert.equal(d.estatus, 'vigente');
  assert.equal(d.publicacion, '2026-10-03T00:00:00-06:00');
  assert.equal(d.junta_aclaraciones, '2026-10-09T10:00:00-06:00');
  assert.equal(d.apertura, '2026-10-20T11:30:00-06:00');
  assert.equal(d.fallo, '2026-11-06T14:45:00-06:00');
  assert.equal(d.campos['Costo de participación'], '$2346.2 MEX');
  assert.deepEqual(d.documentos.map((x) => x.tipo), ['Convocatoria', 'Bases', 'Oficio de autorización del estudio de impacto urbano y ambiental']);
  assert.ok(d.documentos.every((x) => x.url.startsWith('https://contratosadm.chihuahua.gob.mx/descarga_portal.aspx?') && !x.url.includes('&amp;')));
  const c = conDetalle(normalizarFila(JSON.parse(fx('chihuahua-busqueda.json'))[0]), d, '2026-10-04T12:00:00Z');
  assert.equal(c.apertura, d.apertura);
  assert.equal(c.detalle_at, '2026-10-04T12:00:00Z');
  assert.equal(c.datos.detalle.documentos.length, 3);
  assert.ok(c.datos.busqueda, 'conserva lo que vino de la búsqueda');
});

test('fechaIso sin hora y con basura', () => {
  assert.equal(fechaIso('5/1/2027'), '2027-01-05T00:00:00-06:00');
  assert.equal(fechaIso('5/1/2027', '9:05'), '2027-01-05T09:05:00-06:00');
  assert.equal(fechaIso(''), null);
  assert.equal(fechaIso(null), null);
});
