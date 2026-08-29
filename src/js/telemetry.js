/**
 * Telemetry (US-029): eventos de uso de la interfaz → control_obra.ui_events (vía vista public.ui_events).
 * Sin datos personales: sólo empresa_id, user_id (uuid), evento, módulo, obra_id, ancho de viewport y meta técnica.
 *   Telemetry.track('modulo_abierto', {modulo:'pc'})
 * Cola en memoria, envío por lotes cada 10 s, al ocultar la pestaña y al cerrar.
 * Se puede desactivar con localStorage.telemetryOff = '1'.
 */
const Telemetry = (() => {
  const queue = [];
  let timer = null, sending = false;
  const PII = /correo|email|telefono|tel|rfc|password|contrase|nombre|direccion|calle|notas|descripcion|referencia|banco/i;

  function cleanMeta(meta) {
    const out = {};
    Object.entries(meta || {}).forEach(([k, v]) => {
      if (PII.test(k)) return;
      if (v == null) return;
      if (typeof v === 'string') { if (v.length > 80) return; out[k] = v; }
      else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    });
    return out;
  }

  function track(evento, meta = {}) {
    try {
      if (localStorage.getItem('telemetryOff') === '1') return;
      if (!window.currentUser?.empresa_id) return;
      const m = cleanMeta(meta);
      queue.push({
        empresa_id: currentUser.empresa_id,
        user_id: currentUser.id || null,
        evento: String(evento).slice(0, 60),
        modulo: (m.modulo || window.M || null),
        obra_id: m.obra_id ? parseInt(m.obra_id) : (window.selectedObra ? parseInt(window.selectedObra) || null : null),
        viewport_w: window.innerWidth,
        meta: m,
        created_at: new Date().toISOString()
      });
      if (queue.length >= 25) flush();
      else if (!timer) timer = setTimeout(flush, 10000);
    } catch (e) { }
  }

  async function flush(useBeacon = false) {
    clearTimeout(timer); timer = null;
    if (!queue.length || sending) return;
    const batch = queue.splice(0, queue.length);
    if (useBeacon && navigator.sendBeacon) {
      try {
        const url = `${SB}/rest/v1/ui_events`;
        const blob = new Blob([JSON.stringify(batch)], { type: 'application/json' });
        // sendBeacon no permite headers: se usa apikey en query y el token de sesión no viaja; RLS de ui_events acepta insert por empresa_id con apikey
        navigator.sendBeacon(url + `?apikey=${encodeURIComponent(SK)}`, blob);
        return;
      } catch (e) { }
    }
    sending = true;
    try {
      const { error } = await sb.from('ui_events').insert(batch);
      if (error) console.warn('[Telemetry]', error.message);
    } catch (e) { } finally { sending = false; }
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
  window.addEventListener('pagehide', () => flush(true));
  // Errores de UI (sin mensaje completo: sólo los primeros 80 caracteres, sin datos del usuario)
  window.addEventListener('error', e => track('error_ui', { msg: String(e.message || '').slice(0, 80) }));

  return { track, flush, get pending() { return queue.length; } };
})();
