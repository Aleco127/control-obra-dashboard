/**
 * Outbox (US-023): cola local en IndexedDB para inserciones cuando no hay señal.
 * - Outbox.enqueue({tabla, payload, tipo:'insert'|'foto', meta})   → guarda y trata de enviar
 * - Outbox.flush()                                                   → reintenta todo lo pendiente
 * - Outbox.count()                                                   → pendientes
 * Se reintenta al evento `online`, al volver a la pestaña y cada 60 s. El indicador vive en el header (#outboxPill).
 * Depende de: sb (supabase), Toast, D, Cache, currentUser.
 */
const Outbox = (() => {
  const DB = 'obra_outbox', STORE = 'items';
  let dbp = null, flushing = false;

  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB no disponible'));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode); const st = t.objectStore(STORE);
      const r = fn(st);
      t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : r);
      t.onerror = () => reject(t.error);
    });
  }
  async function all() { const db = await openDb(); return new Promise((res, rej) => { const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); }
  async function count() { try { return (await all()).length; } catch (e) { return 0; } }
  async function remove(id) { return tx('readwrite', st => st.delete(id)); }

  function isOffline(err) { const m = String(err?.message || err || '').toLowerCase(); return !navigator.onLine || /failed to fetch|network|load failed|timeout|err_internet/.test(m); }

  /** Ejecuta un item contra Supabase. Devuelve el registro creado. */
  async function send(item) {
    if (item.tipo === 'foto') {
      // payload: {path, dataUrl, mime, registro:{...fotos_obra}}
      const blob = await (await fetch(item.payload.dataUrl)).blob();
      const { error: e1 } = await sb.storage.from('fotos').upload(item.payload.path, blob, { contentType: item.payload.mime || 'image/jpeg', upsert: true });
      if (e1) throw e1;
      const { data: u } = sb.storage.from('fotos').getPublicUrl(item.payload.path);
      const reg = { ...item.payload.registro, url_foto: u.publicUrl };
      const { data, error } = await sb.from('fotos_obra').insert(reg).select().single();
      if (error) throw error;
      if (Array.isArray(D.fot)) D.fot.unshift(data);
      return data;
    }
    if (item.tipo === 'gasto') {
      // payload: {rpc:{...params de crear_gasto}, foto:{dataUrl,mime,ext}|null, pagado_por_socio_id}
      const p = { ...item.payload.rpc };
      if (item.payload.foto?.dataUrl) {
        const f = item.payload.foto;
        const path = `empresa/${currentUser?.empresa_id}/gastos/${(crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36))}.${f.ext || 'jpg'}`;
        const blob = await (await fetch(f.dataUrl)).blob();
        const { error: e1 } = await sb.storage.from('comprobantes').upload(path, blob, { contentType: f.mime || 'image/jpeg', upsert: false });
        if (e1) throw e1;
        p.p_comprobante_url = path; p.p_comprobacion = p.p_folio_fiscal ? 'facturado' : 'ticket';
      }
      const { data: result, error } = await sb.rpc('crear_gasto', p);
      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || 'No se pudo crear el gasto');
      const upd = {};
      if (item.payload.pagado_por_socio_id) upd.pagado_por_socio_id = item.payload.pagado_por_socio_id;
      let row = null;
      if (Object.keys(upd).length) { const r = await sb.from('gastos').update(upd).eq('id', result.gasto_id).select().single(); row = r.data; }
      if (!row) { const r = await sb.from('gastos').select('*').eq('id', result.gasto_id).single(); row = r.data; }
      if (row && Array.isArray(D.g)) D.g.unshift(row);
      return row;
    }
    const { data, error } = await sb.from(item.tabla).insert(item.payload).select().single();
    if (error) throw error;
    const key = { bitacora_obra: 'bt', gastos: 'g', fotos_obra: 'fot' }[item.tabla];
    if (key && Array.isArray(D[key])) D[key].unshift(data);
    return data;
  }

  /** Intenta enviar; si no hay red, guarda en la cola. Devuelve {sent:boolean, data} */
  async function enqueue(item) {
    item.created_at = new Date().toISOString();
    try {
      if (!navigator.onLine) throw new Error('offline');
      const data = await send(item);
      return { sent: true, data };
    } catch (err) {
      if (!isOffline(err)) throw err; // error real de validación: se muestra al usuario
      await tx('readwrite', st => st.add(item));
      await updatePill();
      Toast.warning('Sin conexión: se guardó en el teléfono y se enviará cuando vuelva la señal.', 5000);
      return { sent: false };
    }
  }

  async function flush(manual = false) {
    if (flushing) return; flushing = true;
    try {
      const items = await all();
      if (!items.length) { await updatePill(); return; }
      if (!navigator.onLine) { if (manual) Toast.warning('Todavía no hay conexión.'); return; }
      let ok = 0, fail = 0;
      for (const it of items) {
        try { await send(it); await remove(it.id); ok++; }
        catch (err) { if (isOffline(err)) { fail++; break; } else { console.warn('Outbox: item inválido, se descarta', it, err); await remove(it.id); fail++; } }
      }
      if (ok) { Toast.success(`${ok} registro${ok > 1 ? 's' : ''} pendiente${ok > 1 ? 's' : ''} enviado${ok > 1 ? 's' : ''}.`); try { Cache.saveAppData(D, currentUser?.empresa_id || 'global'); } catch (e) { } if (typeof R === 'function' && ['b', 'f', 'g', 'd'].includes(typeof M!=='undefined'?M:window.M)) R(); }
      await updatePill();
    } finally { flushing = false; }
  }

  async function updatePill() {
    const n = await count();
    let pill = document.getElementById('outboxPill');
    if (!pill) {
      const host = document.querySelector('header .flex.items-center.gap-2.sm\\:gap-4') || document.querySelector('header');
      if (!host) return;
      pill = document.createElement('button');
      pill.id = 'outboxPill'; pill.type = 'button'; pill.className = 'outbox-pill';
      pill.setAttribute('aria-live', 'polite');
      pill.onclick = () => flush(true);
      host.prepend(pill);
    }
    pill.innerHTML = `<i class="ri-cloud-off-line" aria-hidden="true"></i> ${n} pendiente${n === 1 ? '' : 's'} de enviar`;
    pill.title = 'Toca para reintentar el envío';
    pill.classList.toggle('ac', n > 0);
  }

  window.addEventListener('online', () => flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
  setInterval(() => { if (navigator.onLine) flush(); }, 60000);
  document.addEventListener('DOMContentLoaded', () => setTimeout(updatePill, 1500));

  return { enqueue, flush, count, updatePill, all };
})();
