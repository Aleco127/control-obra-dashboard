// US-603: NavShell puro (src/js/nav-shell.js). Sin navegador: node --test scripts/qa/nav-shell.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NavShell = require('../../src/js/nav-shell.js');

const GRUPOS = () => [
  { k: 'inicio', t: 'Inicio', ic: 'ri-home-line', suelto: true, items: [{ k: 'd', t: 'Inicio', ic: 'ri-home-line' }] },
  { k: 'obra', t: 'Obra', ic: 'ri-building-2-line', items: [{ k: 'o', t: 'Obras', ic: 'ri-building-2-line' }, { k: 'w', t: 'Programa', ic: 'ri-calendar-check-line', badge: 2 }, { k: 'b', t: 'Bitácora', ic: 'ri-book-2-line' }] },
  { k: 'dinero', t: 'Dinero', ic: 'ri-money-dollar-circle-line', items: [{ k: 'g', t: 'Compras y gastos', ic: 'ri-shopping-cart-line', badge: 12 }, { k: 'pc', t: 'Pagos', ic: 'ri-bank-card-line' }] },
  { k: 'conta', t: 'Contabilidad', ic: 'ri-file-list-3-line', abierto: false, items: [{ k: 'cb', t: 'Contabilidad', ic: 'ri-file-list-3-line' }, { k: 'so', t: 'Socios', ic: 'ri-team-line', candado: true }, { k: 'rt', t: 'Retenciones', ic: 'ri-percent-line', secundario: true }, { k: 'su', t: 'SUA', ic: 'ri-hospital-line', secundario: true }] },
  { k: 'admin', t: 'Administración', ic: 'ri-settings-3-line', plano: true, separador: true, items: [{ k: 'q', t: 'Reportes', ic: 'ri-bar-chart-line' }, { k: 'z', t: 'Configuración', ic: 'ri-settings-3-line' }] },
];
const count = (html, re) => (html.match(re) || []).length;
const tagDe = (html, k) => (html.match(new RegExp(`<button\\b[^>]*\\bdata-k="${k}"[^>]*>`, 'g')) || []);

test('carga en Node y expone la API completa', () => {
  for (const f of ['render', 'visibles', 'conFijados', 'marcarActivo', 'alternarGrupo', 'alternarMas']) assert.equal(typeof NavShell[f], 'function', f);
  assert.deepEqual(Object.keys(NavShell.ICONOS_CLIENTE).slice(0, 6), ['inicio', 'avance', 'pagos', 'entregables', 'fotos', 'contacto']);
  const r = NavShell.render({ grupos: GRUPOS() });
  assert.equal(typeof r.aside, 'string'); assert.equal(typeof r.bottom, 'string');
});

test('visibles filtra por regla, quita grupos vacíos y no muta la entrada', () => {
  const g = GRUPOS();
  const v = NavShell.visibles(g, (it, grupo) => grupo.k !== 'conta' && it.k !== 'w');
  assert.deepEqual(v.map((x) => x.k), ['inicio', 'obra', 'dinero', 'admin']);
  assert.deepEqual(v[1].items.map((x) => x.k), ['o', 'b']);
  assert.equal(g[1].items.length, 3, 'la entrada no cambia');
  assert.equal(NavShell.visibles(g, () => { throw new Error('x'); }).length, 0, 'una regla que lanza equivale a no visible');
  assert.equal(NavShell.visibles(g).length, g.length, 'sin regla devuelve copia');
});

test('conFijados respeta el orden, ignora claves desconocidas y no repite', () => {
  const f = NavShell.conFijados(GRUPOS(), ['g', 'zz', 'o', 'g', 'w']);
  assert.deepEqual(f.map((x) => x.k), ['g', 'o', 'w']);
  assert.equal(f[0].grupo, 'dinero');
  assert.deepEqual(NavShell.conFijados(GRUPOS(), null), []);
});

test('render: cada módulo aparece en su grupo, los fijados se repiten arriba y hay un solo aria-current', () => {
  const { aside } = NavShell.render({ grupos: GRUPOS(), fijados: ['g', 'o'], activo: 'g' });
  assert.equal(tagDe(aside, 'g').length, 2, 'g está en Mi trabajo y en Dinero');
  assert.equal(tagDe(aside, 'o').length, 2);
  assert.equal(tagDe(aside, 'b').length, 1);
  assert.equal(count(aside, /aria-current="page"/g), 1, 'un solo aria-current en la barra');
  assert.ok(/class="nvs-item nvs-fijado active"[^>]*aria-current="page"/.test(aside), 'el fijado (primera aparición) lleva aria-current');
  assert.equal(count(aside, /\bactive\b/g), 2, 'las dos apariciones del activo llevan .active');
  assert.ok(aside.includes('<div class="nvs-fijados" role="group" aria-label="Mi trabajo">'));
  assert.ok(/<section class="nvs-grupo nvs-grupo-activo" data-grupo="dinero">/.test(aside), 'el grupo del activo se marca');
  assert.ok(/<button type="button" class="nvs-item nvs-suelto"[^>]*data-k="d"/.test(aside), 'Inicio va suelto, sin cabecera');
});

test('candado: clase, marca de datos, ícono y aviso en aria-label', () => {
  const { aside } = NavShell.render({ grupos: GRUPOS(), activo: 'cb' });
  const so = tagDe(aside, 'so')[0];
  assert.ok(so.includes('nvs-locked') && so.includes('data-candado="1"'), so);
  assert.ok(so.includes('aria-label="Socios (no incluido en tu plan)"'), so);
  assert.ok(/data-k="so"[^>]*>[\s\S]*?<span class="nvs-lock"/.test(aside));
  const todoLock = NavShell.render({ grupos: [{ k: 'x', t: 'Extras', items: [{ k: 'a', t: 'A', candado: true }, { k: 'b', t: 'B', candado: true }] }] }).aside;
  assert.ok(todoLock.includes('nvs-grupo-locked') && /class="nvs-grupo-h"[^>]*>[\s\S]*?<span class="nvs-lock"/.test(todoLock), 'si todo el grupo está bloqueado la cabecera lleva candado');
});

test('secundarios ocultos por defecto detrás de «Más» y visibles si el activo es uno de ellos', () => {
  const a = NavShell.render({ grupos: GRUPOS(), activo: 'cb' }).aside;
  assert.ok(/<button type="button" class="nvs-mas" data-mas="conta" aria-expanded="false"/.test(a));
  assert.ok(/<div class="nvs-sec" id="nvs-g-conta-sec" hidden>[\s\S]*data-k="rt"[\s\S]*data-k="su"/.test(a), 'rt y su dentro de .nvs-sec oculto');
  assert.ok(!/<div class="nvs-grupo-items" id="nvs-g-conta">[\s\S]*?data-k="rt"[\s\S]*?<button type="button" class="nvs-mas"/.test(a), 'los secundarios no van antes del botón Más');
  const b = NavShell.render({ grupos: GRUPOS(), activo: 'rt' }).aside;
  assert.ok(/class="nvs-mas" data-mas="conta" aria-expanded="true"/.test(b));
  assert.ok(/<div class="nvs-sec" id="nvs-g-conta-sec">/.test(b), 'sin hidden cuando el activo es secundario');
});

test('escape de HTML en marca, títulos, badges y handlers', () => {
  const { aside, bottom } = NavShell.render({
    marca: { nombre: '<img src=x onerror=alert(1)>', sub: 'Ricardo "R" <b>', logo: 'javascript:alert(1)' },
    grupos: [{ k: 'g1', t: 'Grupo <i>', items: [{ k: 'a', t: 'Ítem <script>', badge: '<b>' }] }],
    contexto: { titulo: '<u>obra</u>', onClick: "x('\")" },
    onItem: (k) => `ir('${k}')"><img src=x>`,
    acciones: [{ k: 'salir', t: 'Salir <x>', onClick: '1<2' }],
  });
  for (const h of [aside, bottom]) {
    assert.ok(!/<img src=x/.test(h), 'no se inyecta HTML');
    assert.ok(!h.includes('<script>'), 'sin script');
  }
  assert.ok(aside.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(aside.includes('Ricardo &quot;R&quot; &lt;b&gt;'));
  assert.ok(!aside.includes('javascript:'), 'logo con esquema peligroso se descarta');
  assert.ok(aside.includes('<span class="nvs-badge" aria-hidden="true">&lt;b&gt;</span>'));
  assert.ok(aside.includes(`onclick="ir(&#39;a&#39;)&quot;&gt;&lt;img src=x&gt;"`) || aside.includes(`onclick="ir(&#x27;a&#x27;)&quot;&gt;&lt;img src=x&gt;"`));
  assert.ok(aside.includes('onclick="1&lt;2"'));
  assert.ok(aside.includes('&lt;u&gt;obra&lt;/u&gt;'));
});

test('grupos: abiertos por defecto; cerrado lleva aria-expanded=false e items hidden; plano y separador', () => {
  const a = NavShell.render({ grupos: GRUPOS() }).aside;
  assert.ok(/<button type="button" class="nvs-grupo-h" aria-expanded="true" aria-controls="nvs-g-obra"/.test(a));
  assert.ok(/<div class="nvs-grupo-items" id="nvs-g-obra">/.test(a));
  assert.ok(/<button type="button" class="nvs-grupo-h" aria-expanded="false" aria-controls="nvs-g-conta"/.test(a));
  assert.ok(/<div class="nvs-grupo-items" id="nvs-g-conta" hidden>/.test(a));
  assert.ok(/<div class="nvs-grupo nvs-plano nvs-sep" data-grupo="admin" role="group" aria-label="Administración">/.test(a), 'Administración va plano y separado');
  assert.ok(a.includes('onclick="NavShell.alternarGrupo(this)"'), 'sin onGrupo la cabecera usa el alternador interno');
  const b = NavShell.render({ grupos: GRUPOS(), onGrupo: (k) => `tg('${k}')` }).aside;
  assert.ok(b.includes('onclick="tg(&#39;obra&#39;)"') || b.includes('onclick="tg(&#x27;obra&#x27;)"'));
});

test('badges: número con texto accesible, true como punto, 0 y vacío no pintan', () => {
  const a = NavShell.render({ grupos: GRUPOS(), fijados: ['g'] }).aside;
  assert.ok(a.includes('<span class="nvs-badge" aria-hidden="true">12</span>'));
  assert.ok(a.includes('aria-label="Compras y gastos (12 pendientes)"'));
  assert.ok(a.includes('aria-label="Programa (2 pendientes)"'));
  const c = NavShell.render({ modo: 'cliente', grupos: [{ k: 's', t: 'Secciones', items: [{ k: 'pagos', t: 'Pagos', ic: 'pagos', badge: true }, { k: 'fotos', t: 'Fotos', ic: 'fotos', badge: 0 }, { k: 'x', t: 'X', badge: 1 }] }] }).aside;
  assert.ok(c.includes('<span class="nvs-badge nvs-dot" aria-hidden="true"></span>') && c.includes('aria-label="Pagos (novedades)"'));
  assert.ok(!/data-k="fotos"[^>]*>[^<]*(<[^>]*>[^<]*)*?nvs-badge/.test(tagDe(c, 'fotos')[0] || ''), 'badge 0 no pinta');
  assert.ok(c.includes('aria-label="X (1 pendiente)"'), 'singular');
});

test('barra inferior: constructora con «+» y «Más» (2 + plus + 2 + más); cliente hasta 5 sin plus', () => {
  const { bottom } = NavShell.render({ grupos: GRUPOS(), activo: 'b', inferior: { items: ['b', 'w', 'g', 'pc', 'o'], plus: { onClick: 'abrirSheet()' }, mas: { onClick: 'abrirHoja()' } } });
  const orden = [...bottom.matchAll(/data-k="([a-z]+)"|data-accion="([a-z]+)"/g)].map((m) => m[1] || m[2]);
  assert.deepEqual(orden, ['b', 'w', 'plus', 'g', 'pc', 'mas'], 'sólo 4 ítems cuando hay plus/más');
  assert.ok(/class="nvs-item nvs-bottom-item active" aria-current="page" data-k="b"/.test(bottom));
  assert.equal(count(bottom, /aria-current="page"/g), 1);
  assert.ok(bottom.includes('class="nvs-bottom-plus" data-accion="plus" aria-label="Captura rápida" aria-haspopup="dialog" onclick="abrirSheet()"'));
  assert.ok(bottom.includes('data-accion="mas" aria-label="Más módulos" aria-haspopup="dialog" onclick="abrirHoja()"'));
  const cli = NavShell.render({ modo: 'cliente', grupos: [{ k: 's', t: 'Secciones', items: ['inicio', 'avance', 'pagos', 'entregables', 'fotos', 'contacto'].map((k) => ({ k, t: k, ic: k })) }], activo: 'avance' }).bottom;
  assert.deepEqual([...cli.matchAll(/data-k="([a-z]+)"/g)].map((m) => m[1]), ['inicio', 'avance', 'pagos', 'entregables', 'fotos'], 'sin inferior.items toma los primeros 5');
  assert.ok(cli.startsWith('<div class="nvs-bottom nvs-cliente" data-modo="cliente">'));
  const sinInf = NavShell.render({ grupos: GRUPOS(), fijados: ['pc', 'b'] }).bottom;
  assert.deepEqual([...sinInf.matchAll(/data-k="([a-z]+)"/g)].map((m) => m[1]), ['pc', 'b'], 'sin inferior.items usa los fijados');
});

test('marcarActivo sobre HTML: mueve active y aria-current, un solo aria-current, idempotente', () => {
  const { aside } = NavShell.render({ grupos: GRUPOS(), fijados: ['g', 'o'], activo: 'g' });
  const una = NavShell.marcarActivo(aside, 'o');
  const dos = NavShell.marcarActivo(una, 'o');
  assert.equal(una, dos, 'idempotente');
  assert.equal(count(una, /aria-current="page"/g), 1);
  assert.equal(count(una, /\bactive\b/g), 2, 'o aparece fijado y en Obra');
  assert.ok(/class="nvs-item nvs-fijado active" aria-current="page" data-k="o"/.test(una));
  assert.ok(!/data-k="g"[^>]*aria-current/.test(una) && !/class="[^"]*active[^"]*"[^>]*data-k="g"/.test(una), 'g dejó de estar activo');
  assert.ok(/<section class="nvs-grupo nvs-grupo-activo" data-grupo="obra">/.test(una));
  assert.ok(/<section class="nvs-grupo" data-grupo="dinero">/.test(una), 'Dinero ya no es el grupo activo');
  const otra = NavShell.marcarActivo(aside, 'g');
  assert.equal(otra, aside, 'marcar el que ya está activo no cambia nada');
  const sinActivo = NavShell.marcarActivo(aside, 'zz');
  assert.equal(count(sinActivo, /aria-current|\bactive\b|nvs-grupo-activo/g), 0);
  // Sólo cambian clases y aria-current: quitando esos atributos el HTML es idéntico
  const limpia = (h) => h.replace(/\s?aria-current="page"/g, '').replace(/\s?\bactive\b/g, '').replace(/\s?nvs-grupo-activo/g, '');
  assert.equal(limpia(una), limpia(aside));
});

// DOM mínimo para probar la rama de Element sin navegador
function nodo(tag, attrs = {}, hijos = []) {
  const el = { tag, attrs: { ...attrs }, hijos, padre: null, innerHTMLSet: 0 };
  el.classList = {
    add: (c) => { const s = new Set((el.attrs.class || '').split(/\s+/).filter(Boolean)); s.add(c); el.attrs.class = [...s].join(' '); },
    remove: (c) => { el.attrs.class = (el.attrs.class || '').split(/\s+/).filter((x) => x && x !== c).join(' '); },
    contains: (c) => (el.attrs.class || '').split(/\s+/).includes(c),
  };
  el.getAttribute = (a) => (a in el.attrs ? el.attrs[a] : null);
  el.setAttribute = (a, v) => { el.attrs[a] = String(v); };
  el.removeAttribute = (a) => { delete el.attrs[a]; };
  Object.defineProperty(el, 'innerHTML', { set() { el.innerHTMLSet++; }, get() { return ''; } });
  const todos = (n, acc = []) => { for (const h of n.hijos) { acc.push(h); todos(h, acc); } return acc; };
  const cumple = (n, sel) => {
    const m = sel.match(/^\[data-k(?:="([^"]*)")?\]$/); if (m) return m[1] === undefined ? 'data-k' in n.attrs : n.attrs['data-k'] === m[1];
    if (sel.startsWith('.')) return n.classList.contains(sel.slice(1));
    return false;
  };
  el.querySelectorAll = (sel) => todos(el).filter((n) => cumple(n, sel));
  el.querySelector = (sel) => el.querySelectorAll(sel)[0] || null;
  el.closest = (sel) => { let n = el; while (n) { if (cumple(n, sel)) return n; n = n.padre; } return null; };
  el.dispatchEvent = () => true;
  for (const h of hijos) { h.padre = el; h.parentNode = el; }
  return el;
}

test('marcarActivo sobre Element: toca sólo clases y aria-current, nunca innerHTML; idempotente', () => {
  const g = nodo('button', { class: 'nvs-item nvs-fijado active', 'aria-current': 'page', 'data-k': 'g' });
  const o = nodo('button', { class: 'nvs-item', 'data-k': 'o' });
  const g2 = nodo('button', { class: 'nvs-item active', 'data-k': 'g' });
  const secObra = nodo('section', { class: 'nvs-grupo', 'data-grupo': 'obra' }, [o]);
  const secDinero = nodo('section', { class: 'nvs-grupo nvs-grupo-activo', 'data-grupo': 'dinero' }, [g2]);
  const root = nodo('div', { class: 'nvs' }, [g, secObra, secDinero]);
  NavShell.marcarActivo(root, 'o');
  assert.equal(o.attrs.class, 'nvs-item active'); assert.equal(o.attrs['aria-current'], 'page');
  assert.equal(g.attrs.class, 'nvs-item nvs-fijado'); assert.ok(!('aria-current' in g.attrs));
  assert.equal(g2.attrs.class, 'nvs-item');
  assert.equal(secObra.attrs.class, 'nvs-grupo nvs-grupo-activo'); assert.equal(secDinero.attrs.class, 'nvs-grupo');
  const foto = JSON.stringify(root, (k, v) => (k === 'padre' || k === 'parentNode' ? undefined : v));
  NavShell.marcarActivo(root, 'o');
  assert.equal(JSON.stringify(root, (k, v) => (k === 'padre' || k === 'parentNode' ? undefined : v)), foto, 'segunda llamada no cambia nada');
  assert.equal([root, g, o, g2, secObra, secDinero].reduce((a, n) => a + n.innerHTMLSet, 0), 0, 'nadie repintó');
  NavShell.marcarActivo(root, 'g');
  assert.equal(g.attrs['aria-current'], 'page'); assert.ok(!('aria-current' in g2.attrs), 'sólo la primera aparición');
  assert.ok(g2.classList.contains('active'));
});

test('alternarGrupo y alternarMas cambian aria-expanded/hidden sin repintar', () => {
  const cab = nodo('button', { class: 'nvs-grupo-h', 'aria-expanded': 'true' });
  const items = nodo('div', { class: 'nvs-grupo-items' });
  const sec = nodo('section', { class: 'nvs-grupo', 'data-grupo': 'obra' }, [cab, items]);
  nodo('div', { class: 'nvs' }, [sec]);
  assert.equal(NavShell.alternarGrupo(cab), false);
  assert.equal(cab.attrs['aria-expanded'], 'false'); assert.equal(items.attrs.hidden, '');
  assert.equal(NavShell.alternarGrupo(sec, true), true); assert.ok(!('hidden' in items.attrs));
  const mas = nodo('button', { class: 'nvs-mas', 'aria-expanded': 'false', 'aria-controls': 'x-sec' });
  const secn = nodo('div', { class: 'nvs-sec', hidden: '' });
  nodo('div', { class: 'nvs-grupo-items' }, [mas, secn]);
  assert.equal(NavShell.alternarMas(mas), true); assert.ok(!('hidden' in secn.attrs)); assert.equal(mas.attrs['aria-expanded'], 'true');
  assert.equal(NavShell.alternarMas(mas), false); assert.equal(secn.attrs.hidden, '');
  assert.equal(NavShell.alternarGrupo(null), null);
});

test('colapsado: clase nvs-col, title en ítems y cabeceras, ítems en flyout sin hidden', () => {
  const a = NavShell.render({ grupos: GRUPOS(), fijados: ['g'], colapsado: true, acciones: [{ k: 'salir', t: 'Salir', ic: 'ri-logout-box-line' }] }).aside;
  assert.ok(a.startsWith('<div class="nvs nvs-constructora nvs-col" data-modo="constructora">'));
  assert.ok(tagDe(a, 'g')[0].includes('title="Compras y gastos (12 pendientes)"'));
  assert.ok(/class="nvs-grupo-h" aria-expanded="false" aria-controls="nvs-g-conta" title="Contabilidad"/.test(a));
  assert.ok(/<div class="nvs-grupo-items nvs-fly" id="nvs-g-conta">/.test(a), 'colapsado: el grupo cerrado no lleva hidden porque el flyout lo muestra al pasar el cursor');
  assert.ok(a.includes('data-accion="salir" aria-label="Salir" title="Salir"'));
  const b = NavShell.render({ grupos: GRUPOS() }).aside;
  assert.ok(!b.includes(' title='), 'expandido: sin title');
});

test('modo cliente: íconos SVG inlineados, sin clases ri-, logo por URL', () => {
  const secciones = ['inicio', 'avance', 'pagos', 'entregables', 'fotos', 'contacto'];
  const { aside, bottom } = NavShell.render({ modo: 'cliente', marca: { nombre: 'Supernova Arquitectos', sub: 'Pedro', logo: 'https://x.test/logo.png' }, grupos: [{ k: 's', t: 'Secciones', items: secciones.map((k) => ({ k, t: k, ic: k })) }], activo: 'inicio', acciones: [{ k: 'salir', t: 'Salir', ic: 'cuenta' }] });
  assert.ok(aside.startsWith('<div class="nvs nvs-cliente" data-modo="cliente">'));
  assert.equal(count(aside, /<span class="nvs-ic"><svg/g), 8, '6 secciones + cabecera del grupo (sin ic cae al genérico SVG) + acción');
  assert.ok(!/class="ri-/.test(aside) && !/class="ri-/.test(bottom), 'el portal no carga Remix Icon');
  assert.ok(aside.includes('<img class="nvs-logo-img" src="https://x.test/logo.png" alt="">'));
  assert.ok(aside.includes('<span class="nvs-marca-nombre">Supernova Arquitectos</span><span class="nvs-marca-sub">Pedro</span>'));
  const raro = NavShell.render({ modo: 'cliente', grupos: [{ k: 's', t: 'S', ic: 'ri-folder-line', items: [{ k: 'a', t: 'A', ic: 'ri-home-line' }, { k: 'b', t: 'B', ic: 'inexistente' }] }] }).aside;
  assert.ok(raro.includes('<i class="ri-home-line nvs-ic" aria-hidden="true"></i>'), 'un ri- explícito se respeta');
  assert.equal(count(raro, /<span class="nvs-ic"><svg/g), 1, 'ícono desconocido cae al genérico SVG');
});

test('contexto (obra activa): tarjeta con avance, semáforo, acción; sin contexto no se pinta', () => {
  const a = NavShell.render({ grupos: GRUPOS(), contexto: { titulo: 'ALTOZANO-PH', sub: 'Casa Altozano Cimarrón', avance: 20.4, semaforo: 'ok', onClick: 'abrirFichaObra(19)', onAccion: 'elegirObra()' } }).aside;
  assert.ok(a.includes('<div class="nvs-ctx"><div class="nvs-ctx-cab"><span class="nvs-eyebrow">Obra activa</span><button type="button" class="nvs-ctx-accion" data-accion="ctx-accion" onclick="elegirObra()">Cambiar</button></div>'));
  assert.ok(a.includes('<button type="button" class="nvs-ctx-btn" data-accion="ctx" onclick="abrirFichaObra(19)" aria-label="Abrir ALTOZANO-PH">'));
  assert.ok(a.includes('<span class="nvs-sem nvs-sem-ok" role="img" aria-label="Al día"></span><span class="nvs-ctx-avance">20 %</span>'));
  assert.ok(a.includes('<span class="nvs-ctx-bar" aria-hidden="true"><span style="width:20%"></span></span>'));
  const b = NavShell.render({ grupos: GRUPOS(), contexto: { avance: 250, semaforo: 'morado', onAccion: 'elegirObra()' } }).aside;
  assert.ok(b.includes('<div class="nvs-ctx-btn"><span class="nvs-ctx-sub">Sin obra activa</span></div>'), 'sin título: aviso y sin botón principal');
  assert.ok(!b.includes('nvs-sem-morado'));
  const c = NavShell.render({ grupos: GRUPOS() }).aside;
  assert.ok(!c.includes('nvs-ctx'));
  const d = NavShell.render({ grupos: GRUPOS(), contexto: { titulo: 'X', avance: 250 } }).aside;
  assert.ok(d.includes('<span class="nvs-ctx-avance">100 %</span>'), 'avance acotado a 100');
});

test('acciones del pie con data-accion, atajo y tono; onItem como plantilla {k}', () => {
  const a = NavShell.render({ grupos: GRUPOS(), onItem: "irA('{k}')", acciones: [{ k: 'buscar', t: 'Buscar', ic: 'ri-search-line', onClick: 'abrirCmdk()', atajo: 'Ctrl+K' }, { k: 'salir', t: 'Cerrar sesión', ic: 'ri-logout-box-line', onClick: 'doLogout()', tono: 'peligro' }] }).aside;
  assert.ok(a.includes('<button type="button" class="nvs-accion" data-accion="buscar" aria-label="Buscar (Ctrl+K)" onclick="abrirCmdk()">'));
  assert.ok(a.includes('<kbd class="nvs-kbd" aria-hidden="true">Ctrl+K</kbd>'));
  assert.ok(a.includes('class="nvs-accion nvs-peligro" data-accion="salir" aria-label="Cerrar sesión" onclick="doLogout()"'));
  assert.ok(tagDe(a, 'g')[0].includes('onclick="irA(&#39;g&#39;)"') || tagDe(a, 'g')[0].includes('onclick="irA(&#x27;g&#x27;)"'));
  assert.ok(!tagDe(NavShell.render({ grupos: GRUPOS() }).aside, 'g')[0].includes('onclick'), 'sin onItem no hay onclick: el anfitrión delega por [data-k]');
});

test('claves raras se escapan y un modelo vacío no rompe', () => {
  const a = NavShell.render({ grupos: [{ k: 'x"y', t: 'X', items: [{ k: '<b>', t: 'B' }] }] }).aside;
  assert.ok(!a.includes('<b>') && a.includes('data-k="&lt;b&gt;"'));
  assert.ok(a.includes('data-grupo="x&quot;y"'));
  const v = NavShell.render();
  assert.ok(v.aside.includes('<span class="nvs-marca-nombre">Control de Obra</span>'));
  assert.equal(v.bottom, '<div class="nvs-bottom nvs-constructora" data-modo="constructora"></div>');
  assert.deepEqual(NavShell.render({ grupos: 'no' }).aside.includes('nvs-grupos'), true);
});

// ---- US-605: NAV_GRUPOS (src/js/nav-grupos.js) es la única fuente de los 27 módulos ----
const NAV_GRUPOS = require('../../src/js/nav-grupos.js');
// La lista explícita del PRD (US-605) trae 34 claves aunque el texto diga «27»: la lista manda (el sec anterior también tenía 34).
const CLAVES_PRD = 'd o p w g pc ct es cb fc ce rt dc rp su ci so s m b c r u y k f e n t v l q z h'.split(' ');

test('NAV_GRUPOS carga en Node con los 7 grupos del PRD y exactamente las claves del PRD sin repetir', () => {
  assert.deepEqual(NAV_GRUPOS.map((g) => g.k), ['inicio', 'obra', 'calidad', 'dinero', 'equipo', 'contabilidad', 'administracion']);
  const claves = NAV_GRUPOS.flatMap((g) => g.items.map((it) => it.k));
  assert.equal(CLAVES_PRD.length, 34, 'la lista del PRD tiene 34 claves');
  assert.equal(claves.length, CLAVES_PRD.length);
  assert.equal(new Set(claves).size, claves.length, 'ninguna clave se repite');
  assert.deepEqual([...claves].sort(), [...CLAVES_PRD].sort());
  for (const g of NAV_GRUPOS) {
    assert.equal(new Set(g.items.map((it) => it.k)).size, g.items.length, `grupo ${g.k} sin repetidos`);
    for (const it of g.items) { assert.match(it.ic, /^ri-[a-z0-9-]+$/, `${it.k} lleva ícono Remix`); assert.ok(it.t && it.t.trim(), `${it.k} lleva título`); }
  }
});

test('NAV_GRUPOS: Inicio suelto, Administración plana y separada, fiscales sin uso bajo «Más», cb se llama Contabilidad', () => {
  const por = Object.fromEntries(NAV_GRUPOS.map((g) => [g.k, g]));
  assert.equal(por.inicio.suelto, true); assert.deepEqual(por.inicio.items.map((it) => it.k), ['d']);
  assert.equal(por.administracion.plano, true); assert.equal(por.administracion.separador, true);
  assert.deepEqual(por.obra.items.map((it) => it.k), ['o', 'w', 'b', 'f', 'k', 'c']);
  assert.deepEqual(por.calidad.items.map((it) => it.k), ['r', 'u', 'y']);
  assert.deepEqual(por.dinero.items.map((it) => it.k), ['g', 'pc', 'p', 'ct', 'es', 's', 'm']);
  assert.deepEqual(por.equipo.items.map((it) => it.k), ['e', 'n', 't', 'v', 'l']);
  assert.deepEqual(por.contabilidad.items.filter((it) => it.secundario).map((it) => it.k), ['rt', 'dc', 'rp', 'su']);
  assert.deepEqual(por.contabilidad.items.filter((it) => !it.secundario).map((it) => it.k), ['cb', 'fc', 'ce', 'ci', 'so']);
  assert.equal(por.contabilidad.items.find((it) => it.k === 'cb').t, 'Contabilidad');
  assert.equal(NAV_GRUPOS.flatMap((g) => g.items).filter((it) => it.secundario).length, 4, 'sólo los 4 fiscales son secundarios');
});

test('sec derivado de NAV_GRUPOS conserva la forma {t,k,ic,i:[[k,ic,t]]} y NavShell pinta todas las claves', () => {
  const sec = NAV_GRUPOS.map((g) => ({ t: g.t, k: g.k, ic: g.ic, i: g.items.map((x) => [x.k, x.ic, x.t]) }));
  assert.equal(sec.flatMap((s) => s.i).length, CLAVES_PRD.length);
  for (const s of sec) for (const x of s.i) { assert.equal(x.length, 3); assert.equal(typeof x[0], 'string'); }
  assert.equal(sec.find((s) => s.i.some((x) => x[0] === 'g')).t, 'Dinero', 'breadcrumb: Dinero › Compras y gastos');
  const r = NavShell.render({ modo: 'constructora', grupos: NAV_GRUPOS, activo: 'cb' });
  for (const k of CLAVES_PRD) assert.equal(tagDe(r.aside, k).length, 1, `ítem ${k} presente una vez`);
  assert.equal(count(r.aside, /aria-current="page"/g), 1);
});
