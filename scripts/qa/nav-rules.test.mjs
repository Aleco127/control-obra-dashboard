// US-606: NavRules puro (src/js/nav-rules.js). Sin navegador: node --test scripts/qa/nav-rules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NavRules = require('../../src/js/nav-rules.js');
const NAV_GRUPOS = require('../../src/js/nav-grupos.js');

const CLAVES = NAV_GRUPOS.flatMap((g) => g.items.map((x) => x.k));
const ROLES = { admin_general: 100, gerente_obra: 80, supervisor_general: 70, contador: 70, residente_obra: 50, contador_externo: 45, inspector_calidad: 40, trabajador: 10 };
const u = (rol, extra) => Object.assign({ rol, nivel: ROLES[rol], permisos: {} }, extra || {});
const ve = (usuario) => CLAVES.filter((k) => NavRules.moduloVisible(k, usuario));

test('carga en Node y conoce exactamente las claves de NAV_GRUPOS', () => {
  assert.equal(typeof NavRules.moduloVisible, 'function');
  assert.deepEqual([...NavRules.TODAS].sort(), [...CLAVES].sort(), 'la tabla D3 y NAV_GRUPOS deben tener las mismas claves');
  assert.equal(new Set(CLAVES).size, CLAVES.length, 'sin claves repetidas en NAV_GRUPOS');
  for (const rol of Object.keys(ROLES)) assert.ok(Array.isArray(NavRules.VISIBILIDAD[rol]), 'fila para ' + rol);
});

test('trabajador ve exactamente Bitácora, Fotos, Asistencia y Obras', () => {
  assert.deepEqual(ve(u('trabajador')).sort(), ['b', 'f', 'o', 't']);
});

test('inspector no ve Compras y gastos; ve Calidad y parte de Obra', () => {
  const v = ve(u('inspector_calidad'));
  assert.ok(!v.includes('g'));
  assert.deepEqual(v, ['d', 'o', 'w', 'b', 'f', 'k', 'r', 'u', 'y']);
});

test('contador_externo no ve Socios ni Usuarios; ve Contabilidad con secundarios y Reportes', () => {
  const v = ve(u('contador_externo'));
  assert.ok(!v.includes('so'));
  assert.ok(!v.includes('h'));
  assert.deepEqual(v, ['d', 'g', 'pc', 'cb', 'fc', 'ce', 'ci', 'rt', 'dc', 'rp', 'su', 'q']);
});

test('gerente no ve Usuarios, Configuración, Socios ni Cierres', () => {
  const v = ve(u('gerente_obra'));
  for (const k of ['h', 'z', 'so', 'ci']) assert.ok(!v.includes(k), k + ' oculta');
  assert.equal(v.length, CLAVES.length - 4);
});

test('admin ve las 34 claves de la barra (el PRD las llama «27 módulos»)', () => {
  assert.deepEqual(ve(u('admin_general')), CLAVES);
});

test('supervisor, contador y residente siguen la tabla D3', () => {
  assert.deepEqual(ve(u('supervisor_general')), ['d', 'o', 'w', 'b', 'f', 'k', 'c', 'r', 'u', 'y', 'g', 'pc', 'p', 'es', 'e', 'v', 'q']);
  assert.deepEqual(ve(u('contador')), ['d', 'o', 'w', 'k', 'g', 'pc', 'p', 'ct', 'es', 's', 'm', 'e', 'n', 'v', 'l', 'cb', 'fc', 'ce', 'ci', 'rt', 'dc', 'rp', 'su', 'q']);
  assert.deepEqual(ve(u('residente_obra')), ['d', 'o', 'w', 'b', 'f', 'k', 'c', 'r', 'u', 'y', 'g', 's', 'm', 'e', 't']);
});

test('ninguna clave cae en true por omisión', () => {
  assert.equal(NavRules.moduloVisible('zz', u('admin_general')), false, 'clave desconocida');
  assert.equal(NavRules.moduloVisible('x', u('admin_general')), false, 'clave legado x (órdenes) ya no existe en la barra');
  assert.equal(NavRules.moduloVisible('g', null), false, 'sin usuario');
  assert.equal(NavRules.moduloVisible('g', {}), false, 'sin rol ni nivel');
  assert.equal(NavRules.moduloVisible(undefined, u('admin_general')), false);
  assert.deepEqual(ve({ rol: 'trabajador', nivel: 10 }), ['o', 'b', 'f', 't'], 'sin permisos decide la tabla');
});

test('los permisos del usuario mandan sobre el preset del rol', () => {
  // false oculta aunque el rol lo incluya
  assert.equal(NavRules.moduloVisible('g', u('admin_general', { permisos: { gastos: { ver: false } } })), false);
  assert.equal(NavRules.moduloVisible('o', u('trabajador', { permisos: { obras: { ver: false } } })), false);
  assert.equal(NavRules.moduloVisible('r', u('inspector_calidad', { permisos: { calidad: { ver: false } } })), false, 'calidad gobierna RFIs');
  assert.equal(NavRules.moduloVisible('u', u('inspector_calidad', { permisos: { calidad: { ver: false } } })), false, 'calidad gobierna Punch list');
  assert.equal(NavRules.moduloVisible('so', u('admin_general', { permisos: { socios: false } })), false, 'booleano suelto (preset de contador_externo)');
  // true lo muestra aunque el rol no
  assert.equal(NavRules.moduloVisible('g', u('trabajador', { permisos: { gastos: { ver: true } } })), true);
  assert.equal(NavRules.moduloVisible('h', u('gerente_obra', { permisos: { usuarios: { ver: true } } })), true);
  assert.equal(NavRules.moduloVisible('n', u('inspector_calidad', { permisos: { nomina: { ver: true } } })), true);
  // un valor ausente o no booleano no decide
  assert.equal(NavRules.moduloVisible('g', u('trabajador', { permisos: { gastos: { crear: true } } })), false);
  assert.equal(NavRules.moduloVisible('g', u('trabajador', { permisos: { gastos: 'si' } })), false);
  assert.equal(NavRules.moduloVisible('g', u('admin_general', { permisos: { gastos: {} } })), true);
  assert.equal(NavRules.moduloVisible('g', u('admin_general', { permisos: null })), true);
  // las claves sin módulo de permisos no se ven afectadas
  assert.equal(NavRules.moduloVisible('b', u('trabajador', { permisos: { obras: { ver: false } } })), true, 'Bitácora no depende de obras');
});

test('con el preset real de la BD el trabajador sigue viendo sólo b f t o', () => {
  const presetTrabajador = { obras: { ver: true }, gastos: { ver: false }, nomina: { ver: false }, tiempo: { ver: true, crear: true }, reportes: { ver: false }, usuarios: { ver: false }, empleados: { ver: false }, presupuesto: { ver: false }, configuracion: { ver: false } };
  assert.deepEqual(ve(u('trabajador', { permisos: presetTrabajador })).sort(), ['b', 'f', 'o', 't']);
});

test('un rol desconocido cae a la fila de su nivel; el nombre del rol no distingue mayúsculas', () => {
  assert.equal(NavRules.filaDe({ rol: 'jefe_de_patio', nivel: 55 }), 'residente_obra');
  assert.equal(NavRules.filaDe({ rol: 'auditor', nivel: 45 }), 'contador_externo');
  assert.equal(NavRules.filaDe({ rol: 'nuevo', nivel: 100 }), 'admin_general');
  assert.equal(NavRules.filaDe({ rol: 'peon', nivel: 5 }), 'trabajador');
  assert.equal(NavRules.filaDe({ rol: 'Contador', nivel: 70 }), 'contador', 'contador y supervisor comparten nivel 70: decide el nombre');
  assert.equal(NavRules.filaDe({ rol: 'raro', nivel: 70 }), 'supervisor_general');
  assert.equal(NavRules.filaDe({ rol: 'raro' }), null);
  assert.deepEqual(ve({ rol: 'raro' }), []);
});

test('visibles devuelve las claves en el orden de la barra', () => {
  assert.deepEqual(NavRules.visibles(u('trabajador')), ['o', 'b', 'f', 't']);
  assert.deepEqual(NavRules.visibles(u('admin_general')), CLAVES);
});
