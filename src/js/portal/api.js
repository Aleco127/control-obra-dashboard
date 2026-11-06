/**
 * PortalAPI (US-701A): toda la red del portal pasa por aquí (RPC de Supabase y la función de borde portal-archivo).
 * Las vistas no llaman a fetch.
 */
(function () {
  'use strict';
  const SB = 'https://cpjdlaiarmxojiyhhpxt.supabase.co', ANON = 'sb_publishable_4UKToEePHAO3b_IlI8HlcQ_z_hKUa2y';

  async function rpc(fn, body) {
    try {
      const r = await fetch(SB + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const d = await r.json().catch(() => null);
      if (!r.ok) return { error: (d && (d.message || d.error)) || 'No se pudo conectar. Revisa tu internet.' };
      return d || {};
    } catch (e) { return { error: 'No se pudo conectar. Revisa tu internet.' }; }
  }
  // Ligas firmadas de 5 minutos para documentos y facturas
  async function pedirArchivo(cuerpo) {
    try {
      const r = await fetch(SB + '/functions/v1/portal-archivo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      return await r.json().catch(() => null);
    } catch (e) { return null; }
  }

  window.PortalAPI = { rpc, pedirArchivo };
})();
