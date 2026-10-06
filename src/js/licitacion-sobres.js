/**
 * Pestaña «Sobres» de la ficha de licitación: los requisitos agrupados en sobre legal, técnico y económico para
 * palomearlos a mano conforme se revisan, con sus archivos a la mano para corregirlos uno por uno:
 *   * Palomita (revisado_at / revisado_por, migración 115): independiente del estado del requisito.
 *   * Archivos base (archivos_base): Word, Excel y PDF generados de donde sale el anexo. El Word y el Excel se bajan para
 *     abrirlos en la computadora; el PDF se ve en el panel de la derecha (en el teléfono, en otra pestaña). Cada uno se
 *     puede reemplazar por la versión corregida o quitar. Si el mismo archivo lo usan varios anexos (p. ej. «Formas O.P.
 *     OK.docx»), reemplazarlo lo cambia en todos y el objeto sólo se borra cuando ya nadie lo usa.
 *   * PDF final (archivo_path): el que se entrega; se ve igual y se reemplaza con Licitaciones.subirArchivoRequisito.
 * Se engancha con Licitaciones.registrarPestana('ficha', {k:'sobres', ...}, 'requisitos'). Viaja con licitaciones.js:
 * en el build va en el mismo diferido de `lc`; sin build, licitaciones.js › conExtras lo pide.
 * Las funciones puras se exportan con module.exports (pruebas en scripts/qa/licitacion-sobres.test.mjs).
 */
const LicitacionSobres = (() => {
  'use strict';
  const BUCKET = 'licitaciones';
  const SOBRES = { legal: 'Legal', tecnico: 'Técnico', economico: 'Económico' };
  const TIPOS = {
    word: { ic: 'ri-file-word-2-line', t: 'Word' }, excel: { ic: 'ri-file-excel-2-line', t: 'Excel' },
    pdf: { ic: 'ri-file-pdf-2-line', t: 'PDF' }, otro: { ic: 'ri-file-line', t: 'Archivo' },
  };
  const ACCEPT = '.docx,.xlsx,.pdf';
  const MAX_BYTES = 50 * 1024 * 1024;

  // ---- Funciones puras ------------------------------------------------------------------------------------------------
  /** Tipo de archivo base por extensión. */
  function tipoArchivo(nombre) {
    const ext = String(nombre || '').toLowerCase().split('.').pop();
    if (ext === 'docx' || ext === 'doc') return 'word';
    if (ext === 'xlsx' || ext === 'xls') return 'excel';
    if (ext === 'pdf') return 'pdf';
    return 'otro';
  }
  /** Revisados / total por sobre y en general. */
  function resumenRevision(reqs) {
    const r = { total: { total: 0, revisados: 0 } };
    for (const k of Object.keys(SOBRES)) r[k] = { total: 0, revisados: 0 };
    for (const q of reqs || []) {
      const s = r[q.sobre] ? q.sobre : null; const hecho = !!q.revisado_at;
      if (s) { r[s].total++; if (hecho) r[s].revisados++; }
      r.total.total++; if (hecho) r.total.revisados++;
    }
    return r;
  }
  /** Requisitos (ids) que usan un objeto del bucket como archivo base, sin contar exceptoId. */
  function usosDe(reqs, path, exceptoId) {
    return (reqs || []).filter((q) => q.id !== exceptoId && (q.archivos_base || []).some((a) => a && a.path === path)).map((q) => q.id);
  }
  /** Lista de archivos base con uno reemplazado (misma posición) o quitado (nuevo = null). */
  function cambiarArchivo(lista, path, nuevo) {
    const out = [];
    for (const a of lista || []) { if (a.path === path) { if (nuevo) out.push(nuevo); } else out.push(a); }
    return out;
  }
  /** Requisitos de un sobre en su orden, con filtro opcional de sólo pendientes de palomear. */
  function filasSobre(reqs, sobre, soloPendientes) {
    return (reqs || []).filter((q) => q.sobre === sobre && (!soloPendientes || !q.revisado_at))
      .sort((a, b) => (a.orden - b.orden) || (a.id - b.id));
  }

  // ---- Estado y utilidades del navegador ------------------------------------------------------------------------------
  const st = { soloPendientes: false, vista: null, cerrados: {} };   // vista: {reqId, path, nombre, url}
  const L = () => Licitaciones;
  const F = () => L().ficha;
  const errTxt = (e, ctx) => L().errTxt(e, ctx);
  const reqPorId = (id) => (F() && F().reqs.find((q) => q.id === id)) || null;
  function reemplazarReq(id, cambios) { const r = reqPorId(id); if (r) Object.assign(r, cambios); }
  const icono = (t) => (TIPOS[t] || TIPOS.otro).ic;
  const nombreCorto = (n) => { const s = String(n || ''); return s.length > 46 ? s.slice(0, 30) + '…' + s.slice(-13) : s; };
  const esMovil = () => typeof window !== 'undefined' && window.matchMedia && !window.matchMedia('(min-width: 1024px)').matches;

  function pintar(el, ctx) {
    const res = resumenRevision(ctx.reqs);
    if (!ctx.reqs.length) {
      el.innerHTML = EmptyState({ icon: 'ri-inbox-archive-line', title: 'Todavía no hay requisitos', body: 'Captura o genera los requisitos en la pestaña Requisitos; aquí los revisas por sobre.', action: { label: 'Ir a Requisitos', icon: 'ri-checkbox-multiple-line', onClick: "Licitaciones.tabFicha('requisitos')" } });
      return;
    }
    const pct = res.total.total ? Math.round((res.total.revisados / res.total.total) * 100) : 0;
    const secciones = Object.entries(SOBRES).map(([k, t]) => seccionHtml(k, t, ctx, res[k])).join('');
    el.innerHTML = `<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
<div><p class="text-sm">Palomea cada anexo cuando lo revises. El Word y el Excel se bajan para abrirlos en tu computadora; el PDF se ve aquí mismo (en el teléfono, en otra pestaña).</p>
<p class="text-sm text-ink-muted mt-1" id="lcSbTotal">${res.total.revisados} de ${res.total.total} revisados · ${pct} %</p></div>
<label class="flex items-center gap-2 text-sm min-h-[44px] cursor-pointer"><input type="checkbox" class="w-5 h-5" ${st.soloPendientes ? 'checked' : ''} onchange="LicitacionSobres.soloPendientes(this.checked)"> Sólo los que faltan</label></div>
<div class="lc-sb-grid">
<div class="min-w-0">${secciones}</div>
<aside class="lc-sb-vista g rounded-xl p-3" aria-label="Vista previa del PDF" id="lcSbVista">${vistaHtml()}</aside></div>
<input type="file" id="lcSbFile" class="hidden" accept="${ACCEPT}" onchange="LicitacionSobres.archivoElegido(this.files)">`;
  }
  function seccionHtml(k, t, ctx, r) {
    const filas = filasSobre(ctx.reqs, k, st.soloPendientes);
    const pct = r.total ? Math.round((r.revisados / r.total) * 100) : 0;
    const completo = r.total && r.revisados === r.total;
    return `<details class="g rounded-xl mb-3" ${st.cerrados[k] ? '' : 'open'} ontoggle="LicitacionSobres.toggleSobre('${k}', this.open)">
<summary class="flex items-center justify-between gap-3 p-4 cursor-pointer min-h-[44px]"><span class="font-bold">Sobre ${S(t.toLowerCase())}</span>
<span class="flex items-center gap-2 text-sm ${completo ? 'text-ok' : 'text-ink-muted'}">${completo ? '<i class="ri-checkbox-circle-fill" aria-hidden="true"></i>' : ''}${r.revisados} de ${r.total}
<span class="lc-sb-barra" aria-hidden="true"><span style="width:${pct}%"></span></span></span></summary>
${filas.length ? `<ul class="lc-sb-lista">${filas.map((q) => filaHtml(q)).join('')}</ul>` : `<p class="text-sm text-ink-muted px-4 pb-4">${r.total ? 'Todo este sobre ya está palomeado.' : 'Sin requisitos en este sobre.'}</p>`}</details>`;
  }
  function filaHtml(q) {
    const base = (q.archivos_base || []).filter(Boolean);
    const quien = q.revisado_at ? `Revisado el ${new Date(q.revisado_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' })}` : 'Sin revisar';
    const activo = (p) => st.vista && st.vista.reqId === q.id && st.vista.path === p;
    const chip = (a) => `<span class="lc-sb-arch ${activo(a.path) ? 'is-activo' : ''}"><button type="button" class="lc-sb-arch-b" onclick="LicitacionSobres.abrirBase(${+q.id}, '${encodeURIComponent(a.path)}')" title="${a.tipo === 'pdf' ? 'Ver' : 'Bajar para abrir en'} ${S(a.nombre)}"><i class="${icono(a.tipo)}" aria-hidden="true"></i><span>${S(nombreCorto(a.nombre))}</span><span class="sr-only">${a.tipo === 'pdf' ? '(ver)' : '(bajar)'}</span></button>
<button type="button" class="btn-icon" onclick="LicitacionSobres.reemplazarBase(${+q.id}, '${encodeURIComponent(a.path)}')" aria-label="Reemplazar ${S(a.nombre)} por la versión corregida" title="Reemplazar por la versión corregida"><i class="ri-upload-2-line" aria-hidden="true"></i></button>
<button type="button" class="btn-icon" onclick="LicitacionSobres.quitarBase(${+q.id}, '${encodeURIComponent(a.path)}')" aria-label="Quitar ${S(a.nombre)}" title="Quitar"><i class="ri-close-line" aria-hidden="true"></i></button></span>`;
    const final = q.archivo_path
      ? `<span class="lc-sb-arch lc-sb-final ${activo(q.archivo_path) ? 'is-activo' : ''}"><button type="button" class="lc-sb-arch-b" onclick="LicitacionSobres.verFinal(${+q.id})" title="Ver el PDF final"><i class="ri-file-check-line" aria-hidden="true"></i><span>PDF final</span></button>
<button type="button" class="btn-icon" onclick="LicitacionSobres.reemplazarFinal(${+q.id})" aria-label="Reemplazar el PDF final de ${S(q.anexo_id)}" title="Reemplazar el PDF final"><i class="ri-upload-2-line" aria-hidden="true"></i></button></span>`
      : `<button type="button" class="btn btn-s btn-xs" onclick="LicitacionSobres.reemplazarFinal(${+q.id})"><i class="ri-file-upload-line" aria-hidden="true"></i> Subir PDF final</button>`;
    return `<li class="lc-sb-fila ${q.revisado_at ? 'is-hecho' : ''}" id="lcSb-${+q.id}">
<label class="lc-sb-check" title="${S(quien)}"><input type="checkbox" ${q.revisado_at ? 'checked' : ''} onchange="LicitacionSobres.palomear(${+q.id}, this.checked)" aria-label="Revisado: ${S(q.anexo_id)} ${S(q.descripcion || '')}"></label>
<div class="min-w-0 flex-1"><p class="text-sm"><span class="font-mono text-xs mr-1">${S(q.anexo_id)}</span>${S(q.descripcion || '')}</p>
<p class="text-xs text-ink-muted">${q.responsable ? S(q.responsable) + ' · ' : ''}${S(quien)}</p>
<div class="flex flex-wrap items-center gap-1.5 mt-2">${final}${base.map(chip).join('')}
<button type="button" class="btn btn-s btn-xs" onclick="LicitacionSobres.agregarBase(${+q.id})"><i class="ri-add-line" aria-hidden="true"></i> Archivo base</button></div></div></li>`;
  }
  function vistaHtml() {
    const v = st.vista;
    if (!v) return `<div class="lc-sb-vacia"><i class="ri-file-pdf-2-line text-3xl" aria-hidden="true"></i><p class="text-sm mt-2">Elige un PDF de la lista para verlo aquí.</p><p class="text-xs text-ink-muted mt-1">El Word y el Excel se bajan para abrirlos en tu computadora; corrige, guarda y súbelos con <i class="ri-upload-2-line" aria-hidden="true"></i>.</p></div>`;
    const q = reqPorId(v.reqId);
    return `<div class="flex items-center justify-between gap-2 mb-2"><p class="text-sm font-semibold min-w-0 truncate">${q ? `<span class="font-mono text-xs">${S(q.anexo_id)}</span> · ` : ''}${S(v.nombre)}</p>
<span class="flex shrink-0">${v.url ? `<a class="btn-icon" href="${S(v.url)}" target="_blank" rel="noopener" aria-label="Abrir en otra pestaña" title="Abrir en otra pestaña"><i class="ri-external-link-line" aria-hidden="true"></i></a>` : ''}<button type="button" class="btn-icon" onclick="LicitacionSobres.cerrarVista()" aria-label="Cerrar la vista previa" title="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></span></div>
${v.url ? `<iframe class="lc-sb-iframe" src="${S(v.url)}" title="Vista previa de ${S(v.nombre)}"></iframe>` : `<div class="lc-sb-vacia" aria-busy="true"><i class="ri-loader-4-line animate-spin text-2xl" aria-hidden="true"></i><p class="text-sm mt-2">Cargando…</p></div>`}`;
  }
  function repintar() { if (L().estado.tab === 'sobres') L().repintar(); }
  function repintarVista() { const a = document.getElementById('lcSbVista'); if (a) a.innerHTML = vistaHtml(); }

  // ---- Acciones -------------------------------------------------------------------------------------------------------
  function soloPendientes(v) { st.soloPendientes = !!v; repintar(); }
  function toggleSobre(k, abierto) { st.cerrados[k] = !abierto; }
  async function palomear(id, si) {
    const q = reqPorId(id); if (!q) return;
    const antes = { revisado_at: q.revisado_at, revisado_por: q.revisado_por };
    reemplazarReq(id, { revisado_at: si ? new Date().toISOString() : null });
    const li = document.getElementById('lcSb-' + id); if (li) li.classList.toggle('is-hecho', !!si);
    actualizarConteos();
    try {
      const r = await L().rpc('marcar_requisito_revisado', { p_id: id, p_revisado: !!si });
      reemplazarReq(id, { revisado_at: r.revisado_at, revisado_por: r.revisado_por });
      if (st.soloPendientes && si) setTimeout(repintar, 350);
    } catch (e) {
      reemplazarReq(id, antes); repintar();
      Toast.error(errTxt(e, 'No se guardó la palomita'));
    }
  }
  function actualizarConteos() {
    const res = resumenRevision(F().reqs);
    const t = document.getElementById('lcSbTotal');
    if (t) t.textContent = `${res.total.revisados} de ${res.total.total} revisados · ${res.total.total ? Math.round((res.total.revisados / res.total.total) * 100) : 0} %`;
    document.querySelectorAll('#lcPanel details.g > summary').forEach((s, i) => {
      const k = Object.keys(SOBRES)[i]; const r = res[k]; if (!r) return;
      const sp = s.querySelector('span:last-child'); if (!sp) return;
      const pct = r.total ? Math.round((r.revisados / r.total) * 100) : 0; const completo = r.total && r.revisados === r.total;
      sp.className = `flex items-center gap-2 text-sm ${completo ? 'text-ok' : 'text-ink-muted'}`;
      sp.innerHTML = `${completo ? '<i class="ri-checkbox-circle-fill" aria-hidden="true"></i>' : ''}${r.revisados} de ${r.total} <span class="lc-sb-barra" aria-hidden="true"><span style="width:${pct}%"></span></span>`;
    });
  }
  async function blobUrl(path) {
    const u = await L().urlFirmada(path);
    const resp = await fetch(u); if (!resp.ok) throw new Error(`No se pudo bajar el archivo (${resp.status}).`);
    const b = await resp.blob();
    return { url: URL.createObjectURL(new Blob([b], { type: 'application/pdf' })), firmada: u };
  }
  async function mostrarPdf(reqId, path, nombre) {
    if (esMovil()) {   // en el teléfono no hay panel: otra pestaña
      const w = window.open('', '_blank');
      try { const u = await L().urlFirmada(path); if (w) { w.opener = null; w.location.href = u; } else window.location.assign(u); }
      catch (e) { if (w) w.close(); Toast.error(errTxt(e, 'No se pudo abrir el PDF')); }
      return;
    }
    if (st.vista && st.vista.url) URL.revokeObjectURL(st.vista.url);
    st.vista = { reqId, path, nombre, url: null };
    repintar();
    try {
      const { url } = await blobUrl(path);
      if (!st.vista || st.vista.path !== path) { URL.revokeObjectURL(url); return; }
      st.vista.url = url; repintarVista();
    } catch (e) { st.vista = null; repintarVista(); Toast.error(errTxt(e, 'No se pudo mostrar el PDF')); }
  }
  function cerrarVista() { if (st.vista && st.vista.url) URL.revokeObjectURL(st.vista.url); st.vista = null; repintar(); }
  function verFinal(id) { const q = reqPorId(id); if (q && q.archivo_path) mostrarPdf(id, q.archivo_path, `PDF final ${q.anexo_id}`); }
  async function abrirBase(id, pathEnc) {
    const path = decodeURIComponent(pathEnc); const q = reqPorId(id); if (!q) return;
    const a = (q.archivos_base || []).find((x) => x.path === path); if (!a) return;
    if (a.tipo === 'pdf') return mostrarPdf(id, path, a.nombre);
    try {   // Word / Excel: se baja con su nombre para abrirlo en la computadora
      const u = await L().urlFirmada(path, a.nombre);
      const x = document.createElement('a'); x.href = u; x.rel = 'noopener'; document.body.appendChild(x); x.click(); x.remove();
      Toast.info(`«${a.nombre}» se está bajando: ábrelo, corrige y súbelo con el botón de reemplazar.`);
    } catch (e) { Toast.error(errTxt(e, 'No se pudo bajar el archivo')); }
  }

  // Subidas: un solo <input type=file>; `pendiente` dice qué hacer con lo elegido
  let pendiente = null;
  function elegir(accion, multiple) {
    pendiente = accion;
    const i = document.getElementById('lcSbFile'); if (!i) return;
    i.multiple = !!multiple; i.accept = accion.tipo === 'final' ? '.pdf' : ACCEPT; i.value = ''; i.click();
  }
  function agregarBase(id) { elegir({ tipo: 'agregar', id }, true); }
  function reemplazarBase(id, pathEnc) { elegir({ tipo: 'reemplazar', id, path: decodeURIComponent(pathEnc) }); }
  function reemplazarFinal(id) { elegir({ tipo: 'final', id }); }
  async function subirObjeto(file) {
    if (file.size > MAX_BYTES) throw new Error(`«${file.name}» pesa ${L().fmtBytes(file.size)}: comprímelo o divídelo (máximo 50 MB).`);
    const mime = L().mimeDe(file.name, file.type); if (!mime) throw new Error(`«${file.name}»: tipo no admitido (Word, Excel o PDF).`);
    const buf = await file.arrayBuffer();
    const hash = await L().sha256Hex(buf);
    const path = L().rutaArchivo(currentUser.empresa_id, F().lic.id, 'base', file.name);
    const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
    if (up.error) throw up.error;
    return { path, nombre: file.name, tipo: tipoArchivo(file.name), tamano: file.size, hash };
  }
  async function guardarLista(id, lista) {
    const r = await L().rpc('guardar_archivos_base_requisito', { p_id: id, p_archivos: lista });
    reemplazarReq(id, { archivos_base: r.archivos_base });
  }
  async function borrarSiHuerfano(path) {
    if (usosDe(F().reqs, path, null).length) return;
    try { await sb.storage.from(BUCKET).remove([path]); } catch (e) { /* un objeto huérfano no bloquea */ }
  }
  async function archivoElegido(files) {
    const acc = pendiente; pendiente = null;
    const lista = [...(files || [])]; if (!acc || !lista.length) return;
    const q = reqPorId(acc.id); if (!q) return;
    if (acc.tipo === 'final') { await L().subirArchivoRequisito(lista[0], acc.id); if (L().estado.tab !== 'sobres') L().tabFicha('sobres'); return; }
    if (acc.tipo === 'agregar') {
      const nuevos = [];
      try {
        for (const f of lista) nuevos.push(await subirObjeto(f));
        await guardarLista(acc.id, [...(q.archivos_base || []), ...nuevos]);
        Toast.success(`${q.anexo_id}: ${nuevos.length} archivo${nuevos.length === 1 ? '' : 's'} base agregado${nuevos.length === 1 ? '' : 's'}`);
      } catch (e) {
        if (nuevos.length) await sb.storage.from(BUCKET).remove(nuevos.map((n) => n.path)).catch(() => {});
        Toast.error(errTxt(e, 'No se agregó el archivo'));
      }
      return repintar();
    }
    // Reemplazar: en todos los anexos que usan el mismo archivo
    const viejo = (q.archivos_base || []).find((a) => a.path === acc.path); if (!viejo) return;
    const otros = usosDe(F().reqs, acc.path, acc.id).map(reqPorId).filter(Boolean);
    if (otros.length) {
      const ok = await Dialog.confirm({ title: 'Reemplazar en todos los anexos', body: `«${viejo.nombre}» también lo usan ${otros.map((o) => o.anexo_id).join(', ')}. Se reemplaza en todos con «${lista[0].name}».`, confirmText: 'Reemplazar en todos' });
      if (!ok) return;
    }
    let nuevo = null;
    try {
      nuevo = await subirObjeto(lista[0]);
      for (const r of [q, ...otros]) await guardarLista(r.id, cambiarArchivo(r.archivos_base, acc.path, nuevo));
      await borrarSiHuerfano(acc.path);
      if (st.vista && st.vista.path === acc.path) { const v = st.vista; st.vista = null; await mostrarPdf(v.reqId, nuevo.path, nuevo.nombre); }
      Toast.success(`«${viejo.nombre}» reemplazado${otros.length ? ` en ${otros.length + 1} anexos` : ''}`);
    } catch (e) {
      if (nuevo && !usosDe(F().reqs, nuevo.path, null).length) await sb.storage.from(BUCKET).remove([nuevo.path]).catch(() => {});
      Toast.error(errTxt(e, 'No se reemplazó el archivo'));
    }
    repintar();
  }
  async function quitarBase(id, pathEnc) {
    const path = decodeURIComponent(pathEnc); const q = reqPorId(id); if (!q) return;
    const a = (q.archivos_base || []).find((x) => x.path === path); if (!a) return;
    const otros = usosDe(F().reqs, path, id).length;
    const ok = await Dialog.confirm({ title: 'Quitar archivo base', body: `Se quita «${a.nombre}» de ${q.anexo_id}.${otros ? ` Los otros ${otros} anexos que lo usan lo conservan.` : ' Como ningún otro anexo lo usa, se borra el archivo.'}`, confirmText: 'Quitar archivo', tone: 'danger' });
    if (!ok) return;
    try {
      await guardarLista(id, cambiarArchivo(q.archivos_base, path, null));
      await borrarSiHuerfano(path);
      if (st.vista && st.vista.path === path && st.vista.reqId === id) cerrarVista();
      Toast.success('Archivo quitado');
    } catch (e) { Toast.error(errTxt(e, 'No se quitó el archivo')); }
    repintar();
  }

  if (typeof Licitaciones !== 'undefined' && Licitaciones.registrarPestana) {
    Licitaciones.registrarPestana('ficha', { k: 'sobres', t: 'Sobres', ic: 'ri-inbox-archive-line', pintar }, 'requisitos');
  }

  return {
    pintar, soloPendientes, toggleSobre, palomear, verFinal, abrirBase, cerrarVista, agregarBase, reemplazarBase, reemplazarFinal,
    archivoElegido, quitarBase,
    // puras
    tipoArchivo, resumenRevision, usosDe, cambiarArchivo, filasSobre, SOBRES, TIPOS,
  };
})();
if (typeof module !== 'undefined') module.exports = LicitacionSobres;
