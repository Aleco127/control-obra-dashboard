// node --test scripts/qa/gastos-rules.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../../src/js/gastos-rules.js');

const casos = [
  ['Telmex oficina', '', 'Telefonía e internet', 'indirecto'],
  ['Telmex agosto', '', 'Telefonía e internet', 'indirecto'],
  ['Anuncios Meta', '', 'Publicidad', 'indirecto'],
  ['Meta verified (Palomita azul)', '', 'Publicidad', 'indirecto'],
  ['Contabilidad SUPERNOVA', '', 'Honorarios contables y legales', 'indirecto'],
  ['Dominio web supernovarquitectos.com', '', 'Software y suscripciones', 'indirecto'],
  ['Luz ofi', '', 'Renta y servicios de oficina', 'indirecto'],
  ['Agua', 'JMAS', 'Renta y servicios de oficina', 'indirecto'],
  ['Hojas y tóner', 'OFFICE DEPOT DE MEXICO', 'Papelería y oficina', 'indirecto'],
  ['Calenton bebe Home', '', 'Gasto personal de socio', 'socio'],
  ['Cosco', 'Costco', 'Gasto personal de socio', 'socio'],
  ['Gasolina cosco SN', '', 'Gasto personal de socio', 'socio'],
  ['Visita de obra meoqui', '', 'Materiales', 'obra'],
  ['Vuelta delicias 21 ene', '', 'Combustible', 'obra'],
  ['Gasolina', 'Oxxogas', 'Combustible', 'obra'],
  ['Casetas Cuauhtemoc', '', 'Combustible', 'obra'],
  ['Pepe Loera D.R.O.', '', 'Mano de obra', 'obra'],
  ['Chalan', '', 'Mano de obra', 'obra'],
  ['Mano de obra 2 mil yeso', '', 'Mano de obra', 'obra'],
  ['Cancel Fact', '', 'Subcontratos', 'obra'],
  ['Escombro', '', 'Fletes y transporte', 'obra'],
  ['Broca', '', 'Herramientas', 'obra'],
  ['Tacos y cafe', '', 'Viáticos y alimentos', 'obra'],
  ['Burritos y sodas', '', 'Viáticos y alimentos', 'obra'],
  ['Thinner Sayer', '', 'Materiales', 'obra'],
  ['Material eléctrico', '', 'Materiales', 'obra'],
  ['Tornillos', 'Home Depot Chihuahua', 'Materiales', 'obra'],
  ['Varilla 3/8', 'Aceros del Norte SA', 'Materiales', 'obra'],
  ['Multa por obra sin licencia', '', 'Multas y recargos', 'indirecto'],
  ['Renta de andamio', '', 'Renta de equipo', 'obra']
];

for (const [desc, prov, cat, dest] of casos) {
  test(`${desc} → ${cat} / ${dest}`, () => {
    const s = R.sugerirClasificacion(desc, prov);
    assert.equal(s.categoria, cat);
    assert.equal(s.destino, dest);
  });
}

test('sin coincidencia y sin obra → indirecto Otros', () => {
  const s = R.sugerirClasificacion('xyz', '', { sinObra: true });
  assert.equal(s.destino, 'indirecto');
  assert.equal(s.motivo, '');
});

test('revisar() detecta gastos de oficina cargados a obra', () => {
  const gastos = [
    { id: 1, descripcion: 'Telmex agosto', obra_id: 1, destino: 'obra', categoria: 'Servicios' },
    { id: 2, descripcion: 'Cemento 10 bultos', obra_id: 1, destino: 'obra', categoria: 'Materiales' }
  ];
  const r = R.revisar(gastos, []);
  assert.equal(r.length, 1);
  assert.equal(r[0].gasto.id, 1);
  assert.equal(r[0].cambiaDestino, true);
});
