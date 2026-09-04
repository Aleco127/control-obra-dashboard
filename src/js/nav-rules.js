/**
 * NavRules (US-606): visibilidad por rol para las 34 claves de la barra (tabla D3 del PRD de la barra de módulos).
 * Sustituye al permMap de N() (que sólo conocía 8 claves y dejaba pasar el resto). Ninguna clave cae en `true`
 * por omisión: una clave desconocida o un rol sin fila no se ve.
 *
 *   NavRules.moduloVisible(k, {nivel, rol, permisos}) → boolean
 *
 * Orden de decisión:
 *   1. Los permisos del usuario (currentUser.permisos: el preset del rol o su permisos_custom) mandan sobre la tabla
 *      para las claves que tienen un módulo de permisos (PERMISO_DE): `ver === false` oculta aunque el rol lo incluya y
 *      `ver === true` lo muestra aunque no. Un valor ausente o no booleano no decide.
 *   2. Si no decidieron los permisos, decide la fila del rol (VISIBILIDAD). Un rol desconocido cae a la fila del nivel
 *      más cercano hacia abajo (100 → admin_general, 80 → gerente_obra, 70 → supervisor_general, 50 → residente_obra,
 *      45 → contador_externo, 40 → inspector_calidad, resto → trabajador).
 *
 * No decide sobre empresa_modulos ni sobre los candados por nivel de `so` (≥ 100) y `ci` (≥ 45): eso sigue en
 * isModuloEnabled (index.html), que se evalúa antes. Tampoco toca el plan (Suscripcion.moduloPermitido).
 *
 * Sin dependencias: carga en el navegador como global y en Node con module.exports (scripts/qa/nav-rules.test.mjs).
 */
const NavRules = (function () {
  'use strict';

  const INICIO = ['d'];
  const OBRA = ['o', 'w', 'b', 'f', 'k', 'c'];
  const CALIDAD = ['r', 'u', 'y'];
  const DINERO = ['g', 'pc', 'p', 'ct', 'es', 's', 'm'];
  const EQUIPO = ['e', 'n', 't', 'v', 'l'];
  const CONTABILIDAD = ['cb', 'fc', 'ce', 'ci', 'so', 'rt', 'dc', 'rp', 'su'];
  const CONTA_SIN_SOCIOS = CONTABILIDAD.filter((k) => k !== 'so');
  const ADMINISTRACION = ['q', 'z', 'h'];

  /** Las 34 claves que existen en la barra (NAV_GRUPOS). «Todo» significa exactamente esta lista. */
  const TODAS = [].concat(INICIO, OBRA, CALIDAD, DINERO, EQUIPO, CONTABILIDAD, ADMINISTRACION);

  /** Tabla D3: qué ve cada rol. Sólo claves explícitas. */
  const VISIBILIDAD = {
    admin_general: TODAS,
    gerente_obra: TODAS.filter((k) => !['h', 'z', 'so', 'ci'].includes(k)),
    supervisor_general: [].concat(INICIO, OBRA, CALIDAD, ['g', 'pc', 'p', 'es'], ['e', 'v'], ['q']),
    contador: [].concat(INICIO, ['o', 'w', 'k'], DINERO, ['e', 'n', 'v', 'l'], CONTA_SIN_SOCIOS, ['q']),
    residente_obra: [].concat(INICIO, OBRA, CALIDAD, ['g', 'm', 's'], ['e', 't']),
    contador_externo: [].concat(INICIO, ['g', 'pc'], CONTA_SIN_SOCIOS, ['q']),
    inspector_calidad: [].concat(INICIO, ['o', 'w', 'b', 'f', 'k'], CALIDAD),
    trabajador: ['b', 'f', 't', 'o'],
  };

  /** Nivel mínimo de cada fila, para roles que no están en la tabla (de mayor a menor). */
  const POR_NIVEL = [
    [100, 'admin_general'],
    [80, 'gerente_obra'],
    [70, 'supervisor_general'],
    [50, 'residente_obra'],
    [45, 'contador_externo'],
    [40, 'inspector_calidad'],
    [0, 'trabajador'],
  ];

  /** Clave de la barra → módulo de `permisos` que la gobierna. */
  const PERMISO_DE = {
    o: 'obras',
    g: 'gastos',
    e: 'empleados',
    n: 'nomina',
    p: 'presupuesto',
    q: 'reportes',
    z: 'configuracion',
    h: 'usuarios',
    r: 'calidad',
    u: 'calidad',
    y: 'seguridad',
    t: 'tiempo',
    so: 'socios',
  };

  const conjuntos = {};
  Object.keys(VISIBILIDAD).forEach((rol) => { conjuntos[rol] = new Set(VISIBILIDAD[rol]); });
  const TODAS_SET = new Set(TODAS);

  function filaDe(usuario) {
    const rol = String((usuario && usuario.rol) || '').toLowerCase().trim();
    if (conjuntos[rol]) return rol;
    const nivel = Number(usuario && usuario.nivel);
    if (!Number.isFinite(nivel)) return null;
    for (const [min, r] of POR_NIVEL) if (nivel >= min) return r;
    return null;
  }

  /** true / false si los permisos deciden la clave; null si no la mencionan. */
  function decidePermiso(k, permisos) {
    const mod = PERMISO_DE[k];
    if (!mod || !permisos || typeof permisos !== 'object') return null;
    const p = permisos[mod];
    if (typeof p === 'boolean') return p;
    if (p && typeof p === 'object' && typeof p.ver === 'boolean') return p.ver;
    return null;
  }

  function moduloVisible(k, usuario) {
    if (typeof k !== 'string' || !TODAS_SET.has(k)) return false;
    if (!usuario || typeof usuario !== 'object') return false;
    const porPermiso = decidePermiso(k, usuario.permisos);
    if (porPermiso !== null) return porPermiso;
    const fila = filaDe(usuario);
    if (!fila) return false;
    return conjuntos[fila].has(k);
  }

  /** Lista de claves visibles para un usuario, en el orden de la barra. Útil para pruebas y Ctrl+K. */
  function visibles(usuario) {
    return TODAS.filter((k) => moduloVisible(k, usuario));
  }

  return { moduloVisible, visibles, filaDe, TODAS: TODAS.slice(), VISIBILIDAD, PERMISO_DE };
})();
if (typeof module !== 'undefined') module.exports = NavRules;
