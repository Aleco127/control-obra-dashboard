/**
 * Entrada con cuenta (US-701A): pantalla de usuario y contraseña, y cambio de contraseña (obligatorio la primera vez).
 */
(function () {
  'use strict';
  const E = window.PortalEstado, API = window.PortalAPI;
  const { $, esc } = window.PortalUI;

  function pantallaLogin(msg) {
    $('#app').innerHTML = `<div class="login">
    <div class="marca"><h1>Avance de tu obra</h1><p class="sub">Entra con el usuario y la contraseña que te dio tu constructor.</p></div>
    <form class="card" id="formLogin">
      <div class="campos">
        <div class="campo"><label for="lgUsuario">Usuario</label>
          <input id="lgUsuario" type="text" inputmode="text" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="username" required></div>
        <div class="campo"><label for="lgPass">Contraseña</label>
          <input id="lgPass" type="password" autocomplete="current-password" required></div>
      </div>
      ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
      <button class="btn" id="lgBtn" type="submit">Entrar</button>
    </form>
    <p class="ayuda">¿Olvidaste tu contraseña? Pídele a tu constructor que te la reinicie.</p></div>`;
    $('#formLogin').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const b = $('#lgBtn'); b.disabled = true; b.textContent = 'Entrando…';
      const d = await API.rpc('portal_login', { p_usuario: $('#lgUsuario').value.trim(), p_password: $('#lgPass').value, p_user_agent: navigator.userAgent });
      if (!d || !d.ok) return pantallaLogin((d && d.error) || 'Usuario o contraseña incorrectos.');
      E.sesion = d.token; localStorage.setItem('portal_sesion', E.sesion); E.usuario = d.usuario; E.obras = d.obras || [];
      if (E.usuario.debe_cambiar) return pantallaPassword(true);
      window.abrirObra(E.obras.length ? E.obras[0].id : null);
    });
  }

  function pantallaPassword(obligatorio, msg) {
    $('#app').innerHTML = `<div class="login">
    <div class="marca"><h1>${obligatorio ? 'Elige tu contraseña' : 'Cambiar contraseña'}</h1>
      ${obligatorio ? '<p class="sub">Es tu primera vez aquí. Cambia la contraseña que te dieron por una tuya.</p>' : ''}</div>
    <form class="card" id="formPass">
      <div class="campos">
        <div class="campo"><label for="pwAct">Contraseña actual</label>
          <input id="pwAct" type="password" autocomplete="current-password" required></div>
        <div class="campo"><label for="pwNue">Contraseña nueva</label>
          <input id="pwNue" type="password" autocomplete="new-password" minlength="8" required>
          <p class="vacio" style="font-size:12px;margin:6px 0 0">Al menos 8 caracteres.</p></div>
      </div>
      ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
      <button class="btn" id="pwBtn" type="submit">Guardar</button>
      ${obligatorio ? '' : '<p class="pie"><button type="button" class="txt" onclick="volver()">Cancelar</button></p>'}
    </form>
    <p class="pie"><button class="txt" onclick="salir()">Cerrar sesión</button></p></div>`;
    $('#formPass').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const b = $('#pwBtn'); b.disabled = true; b.textContent = 'Guardando…';
      const d = await API.rpc('portal_password', { p_token: E.sesion, p_actual: $('#pwAct').value, p_nueva: $('#pwNue').value });
      if (!d || !d.ok) return pantallaPassword(obligatorio, (d && d.error) || 'No se pudo cambiar la contraseña.');
      const s = await API.rpc('portal_sesion', { p_token: E.sesion });
      if (s && s.ok) { E.usuario = s.usuario; E.obras = s.obras || []; }
      window.volver();
    });
  }

  window.PortalVistas = Object.assign(window.PortalVistas || {}, { pantallaLogin, pantallaPassword });
  window.pantallaPassword = pantallaPassword;   // la llaman onclick de Contacto, del menú de cuenta y de la barra
})();
