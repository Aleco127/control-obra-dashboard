/**
 * Contacto (US-701A): datos de la constructora y, con sesión de cuenta, las acciones de la cuenta.
 */
(function () {
  'use strict';
  const E = window.PortalEstado, V = (window.PortalVistas = window.PortalVistas || {});
  const { esc } = window.PortalUI;

  function vistaContacto() {
    const e = E.ctx.e;
    const tel = String(e.telefono || '').trim();
    const telHref = 'tel:+52' + tel.replace(/\D/g, '').replace(/^52/, '');
    const filas = [];
    if (E.ctx.wa) filas.push(`<a href="${E.ctx.wa}" target="_blank" rel="noopener"><span class="et">WhatsApp</span>${esc(tel)}</a>`);
    else if (tel) filas.push(`<a href="${esc(telHref)}"><span class="et">Teléfono</span>${esc(tel)}</a>`);
    if (e.email) filas.push(`<a href="mailto:${esc(e.email)}"><span class="et">Correo</span>${esc(e.email)}</a>`);
    if (e.sitio_web) filas.push(`<a href="${esc(e.sitio_web)}" target="_blank" rel="noopener"><span class="et">Sitio web</span>${esc(String(e.sitio_web).replace(/^https?:\/\//, ''))}</a>`);
    const contacto = `<div class="card"><h2>¿Tienes una duda sobre tu obra?</h2>
      <p style="margin:0 0 12px;font-size:14px;color:var(--muted)">Escríbenos y te contestamos. Menciona el nombre de tu proyecto para atenderte más rápido.</p>
      <p style="margin:0 0 10px;font-size:15px;font-weight:600">${esc(e.nombre)}</p>
      ${filas.length ? `<div class="contacto">${filas.join('')}</div>` : '<p class="vacio">Tu constructor todavía no publica sus datos de contacto.</p>'}
      ${E.ctx.wa ? `<a class="btn" href="${E.ctx.wa}" target="_blank" rel="noopener">Escribir por WhatsApp</a>` : ''}</div>`;
    const cuenta = E.sesion
      ? `<div class="card"><h2>Tu cuenta</h2>
        <p style="margin:0 0 10px;font-size:14px;color:var(--muted)">Entraste como <strong>${esc((E.usuario && E.usuario.usuario) || '')}</strong>. Tu acceso es personal: no compartas tu contraseña.</p>
        <p style="margin:0"><button class="btn s" onclick="pantallaPassword(false)">Cambiar mi contraseña</button>
        <button class="btn s" style="margin-left:6px" onclick="salir()">Cerrar sesión</button></p></div>`
      : `<div class="card"><h2>Sobre este enlace</h2><p class="vacio" style="margin:0">Este enlace es privado y muestra el avance de tu obra. Compártelo sólo con quien deba verlo.</p></div>`;
    return contacto + cuenta;
  }

  V.contacto = vistaContacto;
})();
