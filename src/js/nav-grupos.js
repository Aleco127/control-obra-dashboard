/**
 * NAV_GRUPOS (US-605): arquitectura de información de la barra de la constructora.
 * Siete grupos por lo que hace la persona (Inicio, Obra, Calidad, Dinero, Equipo, Contabilidad, Administración),
 * no por el nombre del departamento. Es la ÚNICA fuente de los 27 módulos: `sec` (breadcrumb, Ctrl+K, barra
 * inferior, favoritos) se deriva de aquí en index.html y nunca se edita a mano.
 *
 * Forma (compatible con el modelo de NavShell.render):
 *   [{ k, t, ic, items: [{ k, ic, t, secundario? }], suelto?, plano?, separador?, abierto? }]
 *   - suelto: el grupo se pinta como un solo ítem sin cabecera (Inicio).
 *   - plano: los ítems van sin cabecera plegable (Administración), separador: línea arriba del grupo.
 *   - secundario: el ítem va detrás de «Más» dentro de su grupo (los cuatro fiscales sin uso humano).
 *
 * Sin dependencias: carga en el navegador como global y en Node con module.exports (scripts/qa/nav-shell.test.mjs).
 */
const NAV_GRUPOS = (function () {
  'use strict';
  const it = (k, ic, t, extra) => Object.assign({ k, ic, t }, extra || {});
  return [
    { k: 'inicio', t: 'Inicio', ic: 'ri-home-5-line', suelto: true, items: [it('d', 'ri-dashboard-3-line', 'Inicio')] },
    { k: 'obra', t: 'Obra', ic: 'ri-building-line', items: [
      it('o', 'ri-building-2-line', 'Obras'),
      it('w', 'ri-bar-chart-horizontal-line', 'Programa'),
      it('b', 'ri-book-2-line', 'Bitácora'),
      it('f', 'ri-image-line', 'Fotos'),
      it('k', 'ri-folder-3-line', 'Documentos'),
      it('c', 'ri-calendar-line', 'Calendario'),
    ] },
    { k: 'calidad', t: 'Calidad', ic: 'ri-shield-check-line', items: [
      it('r', 'ri-questionnaire-line', 'RFIs'),
      it('u', 'ri-checkbox-circle-line', 'Punch list'),
      it('y', 'ri-verified-badge-line', 'Seguridad'),
    ] },
    { k: 'dinero', t: 'Dinero', ic: 'ri-money-dollar-circle-line', items: [
      it('g', 'ri-wallet-3-line', 'Compras y gastos'),
      it('pc', 'ri-bank-card-line', 'Pagos'),
      it('p', 'ri-money-dollar-circle-line', 'Presupuesto'),
      it('ct', 'ri-file-list-2-line', 'Cotizaciones'),
      it('es', 'ri-calculator-line', 'Estimaciones'),
      it('s', 'ri-handshake-line', 'Subcontratos'),
      it('m', 'ri-archive-line', 'Materiales'),
    ] },
    { k: 'equipo', t: 'Equipo', ic: 'ri-group-line', items: [
      it('e', 'ri-user-star-line', 'Empleados'),
      it('n', 'ri-money-dollar-box-line', 'Nómina'),
      it('t', 'ri-time-line', 'Asistencia'),
      it('v', 'ri-store-2-line', 'Proveedores'),
      it('l', 'ri-user-heart-line', 'Clientes'),
    ] },
    { k: 'contabilidad', t: 'Contabilidad', ic: 'ri-file-list-3-line', items: [
      it('cb', 'ri-pie-chart-2-line', 'Contabilidad'),
      it('fc', 'ri-bill-line', 'Facturas CFDI'),
      it('ce', 'ri-file-mark-line', 'CFDIs emitidos'),
      it('ci', 'ri-archive-drawer-line', 'Cierres'),
      it('so', 'ri-team-line', 'Socios'),
      it('rt', 'ri-percent-line', 'Retenciones', { secundario: true }),
      it('dc', 'ri-file-chart-line', 'Declaraciones', { secundario: true }),
      it('rp', 'ri-government-line', 'REPSE', { secundario: true }),
      it('su', 'ri-hospital-line', 'SUA', { secundario: true }),
    ] },
    { k: 'administracion', t: 'Administración', ic: 'ri-settings-3-line', plano: true, separador: true, items: [
      it('q', 'ri-bar-chart-box-line', 'Reportes'),
      it('z', 'ri-settings-4-line', 'Configuración'),
      it('h', 'ri-user-settings-line', 'Usuarios'),
    ] },
  ];
})();
if (typeof module !== 'undefined') module.exports = NAV_GRUPOS;
