/**
 * Outbox (US-023, US-243): cola local en IndexedDB para capturas sin señal.
 * - Outbox.enqueue({tabla, payload, tipo:'insert'|'foto'|'gasto', meta})  → guarda y trata de enviar
 * - Outbox.flush(manual)                                                   → reintenta todo lo pendiente
 * - Outbox.count() / Outbox.all()                                          → pendientes
 * - Outbox.panel()                                                         → lista con reintentar y descartar
 * Se reintenta al evento `online`, al volver a la pestaña, cada 60 s y cuando el service worker recibe Background Sync.
 * Un error que no es de red (obra cerrada, mes cerrado, validación) deja el elemento en la cola marcado con el motivo
 * para que el usuario decida (reintentar o descartar) en lugar de perderlo en silencio.
 * Depende de: sb (supabase), Toast, D, Cache, currentUser, Dialog (opcional), S.
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
  async function put(item) { return tx('readwrite', st => st.put(item)); }

  function isOffline(err) { const m = String(err?.message || err || '').toLowerCase(); return !navigator.onLine || /failed to fetch|network|load failed|timeout|err_internet|offline/.test(m); }

  /** Comprime una imagen (dataURL) a menos de ~1 MB y 1600 px de lado mayor. */
  async function comprimir(dataUrl, maxLado = 1600, calidad = 0.82) {
    try {
      if (!dataUrl || !dataUrl.startsWith('data:image/') || dataUrl.length < 900 * 1024) return dataUrl;
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
      const esc = Math.min(1, maxLado / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * esc); c.height = Math.round(img.height * esc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let q = calidad, out = c.toDataURL('image/jpeg', q);
      while (out.length > 1024 * 1024 * 1.37 && q > 0.4) { q -= 0.12; out = c.toDataURL('image/jpeg', q); }
      return out;
    } catch (e) { return dataUrl; }
  }

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

  async function registrarSync() {
    try { const reg = await navigator.serviceWorker?.ready; if (reg && 'sync' in reg) await reg.sync.register('outbox'); } catch (e) { /* sin Background Sync: se reintenta al abrir */ }
  }

  /** Intenta enviar; si no hay red, guarda en la cola. Devuelve {sent:boolean, data} */
  async function enqueue(item) {
    item.created_at = new Date().toISOString();
    if (item.tipo === 'foto' && item.payload?.dataUrl) item.payload.dataUrl = await comprimir(item.payload.dataUrl);
    if (item.tipo === 'gasto' && item.payload?.foto?.dataUrl) item.payload.foto.dataUrl = await comprimir(item.payload.foto.dataUrl);
    try {
      if (!navigator.onLine) throw new Error('offline');
      const data = await send(item);
      return { sent: true, data };
    } catch (err) {
      if (!isOffline(err)) throw err; // error real de validación: se muestra al usuario
      await tx('readwrite', st => st.add(item));
      await updatePill(); registrarSync();
      Toast.warning('Sin conexión: se guardó en el teléfono y se enviará cuando vuelva la señal.', 5000);
      return { sent: false };
    }
  }

  async function flush(manual = false, soloId = null) {
    if (flushing) return; flushing = true;
    try {
      let items = await all();
      if (soloId) items = items.filter(i => i.id === soloId);
      if (!items.length) { await updatePill(); return; }
      if (!navigator.onLine) { if (manual) Toast.warning('Todavía no hay conexión.'); return; }
      let ok = 0, fail = 0, conflictos = 0;
      for (const it of items) {
        if (it.error && !manual) continue; // espera decisión del usuario
        try { await send(it); await remove(it.id); ok++; }
        catch (err) {
          if (isOffline(err)) { fail++; break; }
          it.error = (typeof humanizeError === 'function' ? humanizeError(err) : String(err?.message || err)).slice(0, 200); it.error_at = new Date().toISOString();
          await put(it); conflictos++;
        }
      }
      if (ok) { Toast.success(`${ok} registro${ok > 1 ? 's' : ''} pendiente${ok > 1 ? 's' : ''} enviado${ok > 1 ? 's' : ''}.`); try { Cache.saveAppData(D, currentUser?.empresa_id || 'global'); } catch (e) { } if (typeof R === 'function' && ['b', 'f', 'g', 'd'].includes(typeof M !== 'undefined' ? M : window.M)) R(); }
      if (conflictos) Toast.warning(`${conflictos} registro${conflictos > 1 ? 's' : ''} no se pudo${conflictos > 1 ? 'ieron' : ''} enviar; revisa la lista de pendientes.`, 6000);
      await updatePill();
      const dlg = document.getElementById('dlgOutbox'); if (dlg && dlg.open) await renderPanel();
    } finally { flushing = false; }
  }

  async function discard(id, sinConfirmar) {
    if (!sinConfirmar && typeof Dialog !== 'undefined' && !(await Dialog.confirm({ title: 'Descartar registro', body: 'Se borrará del teléfono y no se enviará. Esta acción no se puede deshacer.', confirmText: 'Descartar', tone: 'danger' }))) return;
    await remove(id); await updatePill(); await renderPanel();
  }

  function resumen(it) {
    const obra = (id) => { const o = (D.o || []).find(x => x.id == id); return o ? (o.codigo_obra || o.nombre_obra) : ''; };
    const esc = (v) => (typeof S === 'function' ? S(v) : String(v ?? ''));
    if (it.tipo === 'foto') return { icon: 'ri-camera-line', titulo: 'Foto de obra', sub: `${esc(obra(it.payload?.registro?.obra_id))} · ${esc(it.payload?.registro?.titulo || it.payload?.registro?.fecha_foto || '')}` };
    if (it.tipo === 'gasto') return { icon: 'ri-shopping-bag-3-line', titulo: 'Gasto: ' + esc(it.payload?.rpc?.p_descripcion || ''), sub: `${esc(obra(it.payload?.rpc?.p_obra_id))} · ${typeof fmt === 'function' ? fmt(it.payload?.rpc?.p_monto_neto || it.payload?.rpc?.p_monto || 0) : ''}` };
    if (it.tabla === 'bitacora_obra') return { icon: 'ri-book-2-line', titulo: 'Bitácora ' + esc(it.payload?.fecha || ''), sub: `${esc(obra(it.payload?.obra_id))} · ${esc(String(it.payload?.actividades_realizadas || '').slice(0, 60))}` };
    return { icon: 'ri-file-line', titulo: esc(it.tabla || it.tipo), sub: '' };
  }
  async function renderPanel() {
    const dlg = document.getElementById('dlgOutbox'); if (!dlg) return;
    const items = await all();
    const rel = (f) => { const m = (Date.now() - new Date(f).getTime()) / 60000; return m < 60 ? `hace ${Math.max(1, Math.round(m))} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
    dlg.innerHTML = `<div class="p-4"><div class="flex items-center justify-between mb-2"><h2 class="font-bold"><i class="ri-cloud-off-line" aria-hidden="true"></i> Pendientes de enviar</h2><button type="button" class="btn-icon" aria-label="Cerrar" onclick="this.closest('dialog').close()"><i class="ri-close-line" aria-hidden="true"></i></button></div>
<p class="text-xs text-ink-subtle mb-3">${items.length ? `${items.length} registro${items.length === 1 ? '' : 's'} guardado${items.length === 1 ? '' : 's'} en este teléfono. ${navigator.onLine ? 'Hay conexión: puedes reintentar.' : 'Sin conexión: se enviarán solos cuando vuelva la señal.'}` : 'No hay nada pendiente.'}</p>
${items.length ? `<ul class="divide-y divide-line">${items.map(it => { const r = resumen(it); return `<li class="py-2 flex items-start gap-2"><i class="${r.icon} text-lg ${it.error ? 'text-danger' : 'text-warn'}" aria-hidden="true"></i><div class="flex-1 min-w-0"><p class="text-sm font-medium truncate">${r.titulo}</p><p class="text-xs text-ink-subtle truncate">${r.sub}</p><p class="text-xs text-ink-subtle">${rel(it.created_at)}${it.error ? ` · <span class="text-danger">${(typeof S === 'function' ? S(it.error) : it.error)}</span>` : ''}</p></div><div class="flex gap-1 shrink-0"><button type="button" class="btn btn-s text-xs py-1 px-2 min-h-0" onclick="Outbox.flush(true,${it.id})" ${navigator.onLine ? '' : 'disabled'}>Reintentar</button><button type="button" class="btn btn-s text-xs py-1 px-2 min-h-0" style="color:var(--danger)" onclick="Outbox.discard(${it.id})">Descartar</button></div></li>`; }).join('')}</ul>
<div class="flex gap-2 mt-3"><button type="button" class="btn btn-p text-sm flex-1" onclick="Outbox.flush(true)" ${navigator.onLine ? '' : 'disabled'}><i class="ri-refresh-line" aria-hidden="true"></i> Reintentar todo</button></div>` : ''}</div>`;
  }
  async function panel() {
    let dlg = document.getElementById('dlgOutbox');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'dlgOutbox'; dlg.className = 'dlg'; dlg.style.maxWidth = '520px'; document.body.appendChild(dlg); }
    await renderPanel(); if (!dlg.open) dlg.showModal();
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
      pill.onclick = () => panel();
      host.prepend(pill);
    }
    pill.innerHTML = `<i class="ri-cloud-off-line" aria-hidden="true"></i> ${n} pendiente${n === 1 ? '' : 's'} de enviar`;
    pill.title = 'Ver pendientes, reintentar o descartar';
    pill.classList.toggle('ac', n > 0);
  }

  window.addEventListener('online', () => flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
  setInterval(() => { if (navigator.onLine) flush(); }, 60000);
  document.addEventListener('DOMContentLoaded', () => setTimeout(updatePill, 1500));
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data === 'OUTBOX_FLUSH') flush(); });

  return { enqueue, flush, count, updatePill, all, panel, discard, comprimir };
})();
