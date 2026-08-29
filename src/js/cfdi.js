/**
 * CFDI (fase 2: US-116): lectura de XML 3.3 / 4.0 en el navegador, emparejamiento con gastos y cobros,
 * e importación a facturas_recibidas / cfdis_emitidos.
 *   CFDI.parse(xmlText)             → objeto plano (sin DOM: funciona en node para las pruebas)
 *   CFDI.abrirImportador()          → modal: arrastra .xml o .zip, revisa el emparejamiento, confirma
 * Depende de globales en el navegador: D, S, F, fmt, $, currentUser, sb, Toast, Dialog, humanizeError, JSZip, Telemetry, Compras.
 */
const CFDI = (() => {
  const num = (v) => parseFloat(v) || 0;
  const r2 = (v) => Math.round(v * 100) / 100;

  // --- Tokenizador mínimo de XML (sólo etiquetas y atributos; el CFDI no usa texto) ---
  function tokens(xml) {
    const out = []; const re = /<\/?([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g; let m;
    xml = xml.replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    while ((m = re.exec(xml))) {
      const cierre = m[0].startsWith('</');
      const attrs = {}; const ra = /([\w:.-]+)\s*=\s*"([^"]*)"/g; let a;
      while ((a = ra.exec(m[2] || ''))) attrs[a[1]] = a[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'");
      out.push({ name: m[1].replace(/^[\w-]+:/, ''), attrs, cierre, vacio: !!m[3] });
    }
    return out;
  }
  function arbol(xml) {
    const root = { name: '#', attrs: {}, hijos: [] }; const pila = [root];
    tokens(xml).forEach(t => {
      if (t.cierre) { if (pila.length > 1) pila.pop(); return; }
      const n = { name: t.name, attrs: t.attrs, hijos: [], padre: pila[pila.length - 1] };
      pila[pila.length - 1].hijos.push(n);
      if (!t.vacio) pila.push(n);
    });
    return root;
  }
  const hijo = (n, name) => (n?.hijos || []).find(h => h.name === name);
  const hijos = (n, name) => (n?.hijos || []).filter(h => h.name === name);
  function buscar(n, name) { if (!n) return null; if (n.name === name) return n; for (const h of n.hijos || []) { const r = buscar(h, name); if (r) return r; } return null; }

  /** Devuelve los datos relevantes del CFDI. Lanza error si no es un CFDI. */
  function parse(xml) {
    if (!xml || !/Comprobante/.test(xml)) throw new Error('El archivo no es un CFDI');
    const root = arbol(xml);
    const comp = buscar(root, 'Comprobante'); if (!comp) throw new Error('El archivo no es un CFDI');
    const a = comp.attrs;
    const emisor = hijo(comp, 'Emisor')?.attrs || {}; const receptor = hijo(comp, 'Receptor')?.attrs || {};
    const tfd = buscar(comp, 'TimbreFiscalDigital')?.attrs || {};
    const impuestos = hijo(comp, 'Impuestos'); // el de nivel Comprobante (totales)
    let iva = 0, ivaTasa = null, isrRet = 0, ivaRet = 0, otrosTras = 0;
    if (impuestos) {
      hijos(hijo(impuestos, 'Traslados'), 'Traslado').forEach(t => { const imp = t.attrs.Impuesto; const importe = num(t.attrs.Importe); if (imp === '002') { iva += importe; if (ivaTasa == null && t.attrs.TasaOCuota) ivaTasa = num(t.attrs.TasaOCuota) * 100; } else otrosTras += importe; });
      hijos(hijo(impuestos, 'Retenciones'), 'Retencion').forEach(t => { const imp = t.attrs.Impuesto; const importe = num(t.attrs.Importe); if (imp === '001') isrRet += importe; else if (imp === '002') ivaRet += importe; });
      if (!iva && impuestos.attrs.TotalImpuestosTrasladados) iva = num(impuestos.attrs.TotalImpuestosTrasladados);
    }
    const conceptos = hijos(hijo(comp, 'Conceptos'), 'Concepto').map(c => ({ clave: c.attrs.ClaveProdServ || '', descripcion: c.attrs.Descripcion || '', cantidad: num(c.attrs.Cantidad), unidad: c.attrs.ClaveUnidad || c.attrs.Unidad || '', valorUnitario: num(c.attrs.ValorUnitario), importe: num(c.attrs.Importe) }));
    const uuid = (tfd.UUID || '').toUpperCase();
    return {
      version: a.Version || a.version || '', uuid, fecha: (a.Fecha || '').slice(0, 10), fechaHora: a.Fecha || '', fechaTimbrado: tfd.FechaTimbrado || null,
      serie: a.Serie || '', folio: a.Folio || '', tipoComprobante: a.TipoDeComprobante || 'I', formaPago: a.FormaPago || '', metodoPago: a.MetodoPago || '', moneda: a.Moneda || 'MXN',
      subtotal: r2(num(a.SubTotal)), descuento: r2(num(a.Descuento)), total: r2(num(a.Total)), iva: r2(iva), ivaTasa: ivaTasa != null ? r2(ivaTasa) : (iva > 0 ? 16 : 0), isrRet: r2(isrRet), ivaRet: r2(ivaRet), otrosTrasladados: r2(otrosTras),
      emisorRfc: (emisor.Rfc || '').toUpperCase(), emisorNombre: emisor.Nombre || '', emisorRegimen: emisor.RegimenFiscal || '',
      receptorRfc: (receptor.Rfc || '').toUpperCase(), receptorNombre: receptor.Nombre || '', receptorUso: receptor.UsoCFDI || '', receptorCp: receptor.DomicilioFiscalReceptor || '',
      conceptos, descripcion: conceptos.map(c => c.descripcion).filter(Boolean).slice(0, 3).join('; ')
    };
  }

  // --- Browser: lectura de archivos y emparejamiento ---
  let filas = [];
  async function leerArchivos(files) {
    const out = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        if (typeof JSZip === 'undefined') { out.push({ nombre: f.name, error: 'No se pudo abrir el ZIP (falta JSZip)' }); continue; }
        try { const z = await JSZip.loadAsync(f); for (const [name, entry] of Object.entries(z.files)) { if (entry.dir || !/\.xml$/i.test(name)) continue; const xml = await entry.async('string'); out.push(await procesar(name, xml)); } }
        catch (e) { out.push({ nombre: f.name, error: 'ZIP inválido' }); }
      } else if (/\.xml$/i.test(f.name)) { out.push(await procesar(f.name, await f.text())); }
      else out.push({ nombre: f.name, error: 'Sólo .xml o .zip' });
    }
    return out;
  }
  async function procesar(nombre, xml) {
    try { const c = parse(xml); return { nombre, xml, c }; } catch (e) { return { nombre, error: e.message }; }
  }
  async function empresaRfc() {
    if (window._empRfc !== undefined) return window._empRfc;
    try { const { data } = await sb.from('empresas').select('rfc').eq('id', currentUser.empresa_id).single(); window._empRfc = (data?.rfc || '').toUpperCase(); } catch (e) { window._empRfc = ''; }
    return window._empRfc;
  }
  function difDias(a, b) { return Math.abs((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000); }
  function candidatosGasto(c) {
    const prov = (D.pv || []).find(p => p.rfc && p.rfc.toUpperCase() === c.emisorRfc);
    const tol = Math.max(1, c.total * 0.01);
    return (D.g || []).filter(g => g.estatus_pago !== 'Rechazado' && g.destino !== 'socio' && (g.comprobacion !== 'facturado' || (g.folio_fiscal || '').toUpperCase() === c.uuid))
      .map(g => { let score = 0; if ((g.folio_fiscal || '').toUpperCase() === c.uuid) score += 100; if (prov && g.proveedor_id === prov.id) score += 30; if (Math.abs(num(g.monto_neto) - c.total) <= tol) score += 40; else if (Math.abs(num(g.subtotal) - c.subtotal) <= tol) score += 30; const dd = difDias(String(g.fecha_solicitud || '').slice(0, 10) || '1970-01-01', c.fecha); if (dd <= 7) score += 20; else if (dd <= 30) score += 5; return { g, score, dd }; })
      .filter(x => x.score >= 40).sort((a, b) => b.score - a.score || a.dd - b.dd).slice(0, 5);
  }
  function candidatosCobro(c) {
    const tol = Math.max(1, c.total * 0.01);
    return (D.prc || []).map(p => { let score = 0; if (Math.abs(num(p.monto) - c.total) <= tol) score += 50; else if (Math.abs(num(p.monto) - c.subtotal) <= tol) score += 30; const dd = difDias(String(p.fecha_pago || '').slice(0, 10) || '1970-01-01', c.fecha); if (dd <= 15) score += 20; else if (dd <= 45) score += 5; if ((p.factura_numero || '').toUpperCase() === c.uuid) score += 100; return { p, score, dd }; })
      .filter(x => x.score >= 50).sort((a, b) => b.score - a.score || a.dd - b.dd).slice(0, 5);
  }

  function ensureModal() {
    if ($('mdlCfdiImp')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="mdlCfdiImp" class="modal"><div class="g rounded-2xl p-5 w-full max-w-4xl mx-4 max-h-[92vh] overflow-y-auto"><div id="mdlCfdiImpBody"></div></div></div>`);
  }
  function abrirImportador() {
    ensureModal(); filas = [];
    $('mdlCfdiImpBody').innerHTML = `<div class="flex justify-between items-center mb-3"><h2 class="text-lg font-bold">Importar XML de facturas</h2><button type="button" class="btn-icon" onclick="closeMdl('mdlCfdiImp')" aria-label="Cerrar"><i class="ri-close-line" aria-hidden="true"></i></button></div>
<p class="text-sm text-ink-muted mb-3">Suelta los XML que te mandan los proveedores (o el ZIP del SAT). Cada factura busca sola el gasto que le corresponde por RFC, monto y fecha; las facturas emitidas por la empresa se emparejan con los cobros.</p>
<label class="block border-2 border-dashed border-line rounded-xl p-6 text-center cursor-pointer hover:bg-slate-50" id="cfdiDrop"><i class="ri-upload-cloud-2-line text-3xl text-ink-subtle" aria-hidden="true"></i><p class="text-sm mt-1">Arrastra aquí o toca para elegir <b>.xml</b> o <b>.zip</b></p><input type="file" class="hidden" multiple accept=".xml,.zip,application/xml,text/xml,application/zip" onchange="CFDI.cargar(this.files)"></label>
<div id="cfdiLista" class="mt-3"></div>
<div class="flex justify-end gap-2 mt-3"><button type="button" class="btn btn-s" onclick="closeMdl('mdlCfdiImp')">Cerrar</button><button type="button" class="btn btn-p hidden" id="cfdiConfirmar" onclick="CFDI.confirmar()">Importar</button></div>`;
    const drop = $('cfdiDrop');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('bg-slate-50'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('bg-slate-50'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('bg-slate-50'); cargar(e.dataTransfer.files); });
    openMdl('mdlCfdiImp');
  }
  async function cargar(files) {
    const box = $('cfdiLista'); box.innerHTML = '<p class="text-sm text-ink-muted">Leyendo archivos…</p>';
    const rfc = await empresaRfc();
    const nuevas = await leerArchivos([...files]);
    nuevas.forEach(r => {
      if (r.error) { r.tipo = 'error'; return; }
      const c = r.c;
      if ((D.fr || []).some(f => (f.uuid_cfdi || '').toUpperCase() === c.uuid) || (D.cfdi || []).some(f => (f.uuid || '').toUpperCase() === c.uuid)) { r.tipo = 'duplicada'; return; }
      if (filas.some(x => x.c && x.c.uuid === c.uuid)) { r.tipo = 'duplicada'; return; }
      if (rfc && c.emisorRfc === rfc) { r.tipo = 'emitida'; r.cands = candidatosCobro(c); r.sel = r.cands[0] ? 'p:' + r.cands[0].p.id : 'sin'; }
      else if (!rfc || c.receptorRfc === rfc) { r.tipo = 'recibida'; r.cands = candidatosGasto(c); r.sel = r.cands[0] ? 'g:' + r.cands[0].g.id : 'crear'; }
      else { r.tipo = 'ajena'; }
    });
    filas = filas.concat(nuevas);
    pintar();
  }
  function pintar() {
    const box = $('cfdiLista'); if (!box) return;
    if (!filas.length) { box.innerHTML = ''; return; }
    const obraTxt = (g) => { const o = (D.o || []).find(x => x.id === g.obra_id); return o ? (o.codigo_obra || o.nombre_obra) : (g.destino === 'indirecto' ? 'indirecto' : ''); };
    box.innerHTML = `<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-slate-50 text-xs text-ink-muted"><tr><th class="p-2 text-left">Factura</th><th class="p-2 text-left">Emisor / receptor</th><th class="p-2 text-right">Total</th><th class="p-2 text-left">Se vincula con</th></tr></thead><tbody>
${filas.map((r, i) => {
      if (r.tipo === 'error') return `<tr class="border-t border-line"><td class="p-2" colspan="4"><span class="text-danger">${S(r.nombre)}: ${S(r.error)}</span></td></tr>`;
      const c = r.c;
      const base = `<td class="p-2"><div class="font-medium">${S(c.serie)}${S(c.folio)}${c.serie || c.folio ? ' · ' : ''}${c.fecha}</div><div class="text-[11px] font-mono text-ink-subtle">${S(c.uuid)}</div><div class="text-xs text-ink-subtle truncate max-w-[260px]" title="${S(c.descripcion)}">${S(c.descripcion)}</div></td>`;
      if (r.tipo === 'duplicada') return `<tr class="border-t border-line opacity-60">${base}<td class="p-2 text-xs">${S(c.emisorNombre)}</td><td class="p-2 text-right">${F(c.total)}</td><td class="p-2 text-xs text-warn">Ya estaba importada</td></tr>`;
      if (r.tipo === 'ajena') return `<tr class="border-t border-line opacity-60">${base}<td class="p-2 text-xs">${S(c.emisorNombre)} → ${S(c.receptorRfc)}</td><td class="p-2 text-right">${F(c.total)}</td><td class="p-2 text-xs text-danger">El receptor no es la empresa: no se importa</td></tr>`;
      if (r.tipo === 'emitida') return `<tr class="border-t border-line">${base}<td class="p-2 text-xs"><span class="chip chip-obra">Emitida</span> a ${S(c.receptorNombre || c.receptorRfc)}</td><td class="p-2 text-right">${F(c.total)}<div class="text-[11px] text-ink-subtle">IVA ${F(c.iva)}</div></td><td class="p-2"><select class="inp text-xs py-1" onchange="CFDI.elegir(${i},this.value)" aria-label="Cobro relacionado">${r.cands.map(x => `<option value="p:${x.p.id}" ${r.sel === 'p:' + x.p.id ? 'selected' : ''}>Cobro ${S(x.p.numero_pago || '')} ${String(x.p.fecha_pago || '').slice(0, 10)} · ${F(x.p.monto)}</option>`).join('')}<option value="sin" ${r.sel === 'sin' ? 'selected' : ''}>Sin vincular a un cobro</option></select></td></tr>`;
      return `<tr class="border-t border-line">${base}<td class="p-2 text-xs"><span class="chip chip-ind">Recibida</span> ${S(c.emisorNombre)}<div class="text-ink-subtle">${S(c.emisorRfc)}</div></td><td class="p-2 text-right">${F(c.total)}<div class="text-[11px] text-ink-subtle">IVA ${F(c.iva)}</div></td><td class="p-2"><select class="inp text-xs py-1" onchange="CFDI.elegir(${i},this.value)" aria-label="Gasto relacionado">${r.cands.map(x => `<option value="g:${x.g.id}" ${r.sel === 'g:' + x.g.id ? 'selected' : ''}>${String(x.g.fecha_solicitud || '').slice(0, 10)} ${S((x.g.descripcion || x.g.categoria || '').slice(0, 40))} · ${F(x.g.monto_neto)} · ${S(obraTxt(x.g))}</option>`).join('')}<option value="crear" ${r.sel === 'crear' ? 'selected' : ''}>Crear gasto nuevo con esta factura</option><option value="sin" ${r.sel === 'sin' ? 'selected' : ''}>Sólo guardar la factura</option></select>${r.sel === 'crear' ? `<select class="inp text-xs py-1 mt-1" onchange="CFDI.obra(${i},this.value)" aria-label="Destino del gasto nuevo"><option value="">Indirecto</option>${(D.o || []).filter(o => !['Archivada', 'Completada'].includes(o.estatus)).map(o => `<option value="${o.id}" ${r.obraId == o.id ? 'selected' : ''}>${S(o.codigo_obra || o.nombre_obra)}</option>`).join('')}</select>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
    const n = filas.filter(r => ['recibida', 'emitida'].includes(r.tipo)).length;
    const btn = $('cfdiConfirmar'); btn.classList.toggle('hidden', !n); btn.textContent = `Importar ${n} factura${n === 1 ? '' : 's'}`;
  }
  function elegir(i, v) { filas[i].sel = v; pintar(); }
  function obra(i, v) { filas[i].obraId = parseInt(v) || null; }

  async function subirXml(r) {
    const path = `empresa/${currentUser.empresa_id}/xml/${r.c.uuid || Date.now()}.xml`;
    const { error } = await sb.storage.from('comprobantes').upload(path, new Blob([r.xml], { type: 'application/xml' }), { contentType: 'application/xml', upsert: true });
    if (error) throw error; return path;
  }
  async function confirmar() {
    const btn = $('cfdiConfirmar'); btn.disabled = true;
    let ok = 0, emparejadas = 0, creadas = 0; const errores = [];
    try {
      for (const r of filas) {
        if (!['recibida', 'emitida'].includes(r.tipo)) continue;
        const c = r.c;
        try {
          const path = await subirXml(r);
          if (r.tipo === 'recibida') {
            let g = null;
            if (r.sel.startsWith('g:')) g = (D.g || []).find(x => x.id === parseInt(r.sel.slice(2)));
            let prov = (D.pv || []).find(p => p.rfc && p.rfc.toUpperCase() === c.emisorRfc) || (g && (D.pv || []).find(p => p.id === g.proveedor_id));
            if (!prov && c.emisorRfc) { const { data } = await sb.from('proveedores').insert({ nombre_proveedor: c.emisorNombre || c.emisorRfc, rfc: c.emisorRfc, regimen_fiscal: c.emisorRegimen || null, empresa_id: currentUser.empresa_id, estatus: 'Activo', tipo: 'Materiales' }).select().single(); if (data) { (D.pv = D.pv || []).push(data); prov = data; } }
            if (r.sel === 'crear') {
              const sug = typeof GastosRules !== 'undefined' ? GastosRules.sugerirClasificacion(c.descripcion, c.emisorNombre, { sinObra: !r.obraId }) : { categoria: 'Materiales', destino: r.obraId ? 'obra' : 'indirecto' };
              const { data: res, error } = await sb.rpc('crear_gasto', { p_user_id: currentUser.id, p_obra_id: r.obraId || null, p_fecha_solicitud: c.fecha, p_estatus_pago: 'Pendiente', p_tipo_comprobante: 'Fiscal', p_categoria: sug.categoria, p_monto_neto: c.total, p_proveedor_id: prov?.id || null, p_descripcion: (c.descripcion || 'Factura ' + c.serie + c.folio).slice(0, 200), p_folio_fiscal: c.uuid, p_factura_numero: (c.serie + c.folio) || null, p_destino: r.obraId ? 'obra' : 'indirecto', p_subtotal: c.subtotal, p_iva: c.iva, p_comprobacion: 'facturado', p_comprobante_url: path, p_aprobado: true });
              if (error) throw error; if (!res?.success) throw new Error(res?.error);
              const { data: row } = await sb.from('gastos').select('*').eq('id', res.gasto_id).single(); if (row) { (D.g = D.g || []).unshift(row); g = row; creadas++; }
            } else if (g) {
              const upd = { folio_fiscal: c.uuid, factura_numero: (c.serie + c.folio) || g.factura_numero, subtotal: c.subtotal, iva: c.iva, tipo_comprobante: 'Fiscal', comprobacion: 'facturado', updated_at: new Date().toISOString() };
              if (!g.proveedor_id && prov) upd.proveedor_id = prov.id;
              if (!g.comprobante_url) upd.comprobante_url = path;
              const { data: row, error } = await sb.from('gastos').update(upd).eq('id', g.id).select().single(); if (error) throw error; Object.assign(g, row); emparejadas++;
            }
            const { data: fr, error: e2 } = await sb.from('facturas_recibidas').insert({ empresa_id: currentUser.empresa_id, obra_id: g?.obra_id || null, proveedor_id: prov?.id || g?.proveedor_id || null, uuid_cfdi: c.uuid, serie: c.serie || null, folio: c.folio || null, fecha_emision: c.fecha, fecha_timbrado: c.fechaTimbrado, rfc_emisor: c.emisorRfc, nombre_emisor: c.emisorNombre, uso_cfdi: c.receptorUso || null, subtotal: c.subtotal, descuento: c.descuento, iva_tasa: c.ivaTasa, iva_monto: c.iva, isr_retenido: c.isrRet, iva_retenido: c.ivaRet, total: c.total, metodo_pago: c.metodoPago, forma_pago: c.formaPago, moneda: c.moneda, tipo_comprobante: c.tipoComprobante, categoria: g?.categoria || null, es_deducible: true, estatus: g && g.estatus_pago === 'Pagado' ? 'Pagada' : 'Registrada', fecha_pago: g && g.estatus_pago === 'Pagado' ? (g.fecha_solicitud || null) : null, gasto_id: g?.id || null, archivo_path: path }).select().single();
            if (e2) throw e2; (D.fr = D.fr || []).unshift(fr);
          } else {
            let pago = null; if (r.sel.startsWith('p:')) pago = (D.prc || []).find(x => x.id === parseInt(r.sel.slice(2)));
            const { data: ce, error: e3 } = await sb.from('cfdis_emitidos').insert({ empresa_id: currentUser.empresa_id, obra_id: pago?.obra_id || null, uuid: c.uuid, serie: c.serie || null, folio: parseInt(c.folio) || null, fecha_emision: c.fechaHora || c.fecha, fecha_timbrado: c.fechaTimbrado, tipo_comprobante: c.tipoComprobante, forma_pago: c.formaPago, metodo_pago: c.metodoPago, uso_cfdi: c.receptorUso, receptor_rfc: c.receptorRfc, receptor_nombre: c.receptorNombre, receptor_domicilio_cp: c.receptorCp || null, subtotal: c.subtotal, descuento: c.descuento, iva_tasa: c.ivaTasa, iva_monto: c.iva, isr_retenido: c.isrRet, iva_retenido: c.ivaRet, total: c.total, moneda: c.moneda, conceptos: c.conceptos, estatus: 'Vigente', pago_recibido_id: pago?.id || null, archivo_path: path, created_by: currentUser.nombre || null }).select().single();
            if (e3) throw e3; (D.cfdi = D.cfdi || []).unshift(ce);
            if (pago) { await sb.from('pagos_recibidos').update({ factura_numero: c.uuid }).eq('id', pago.id); pago.factura_numero = c.uuid; emparejadas++; }
          }
          ok++;
        } catch (e) { errores.push(`${r.nombre}: ${e.message || e}`); }
      }
      try { Cache.saveAppData(D, currentUser?.empresa_id || 'global'); } catch (e) { }
      try { Telemetry.track('xml_importado', { n: ok, emparejadas, creadas, errores: errores.length }); } catch (e) { }
      if (ok) Toast.success(`${ok} factura${ok === 1 ? '' : 's'} importada${ok === 1 ? '' : 's'}: ${emparejadas} emparejadas, ${creadas} gastos nuevos.`, 6000);
      if (errores.length) Toast.error('No se importaron: ' + errores.slice(0, 3).join(' | '), 8000);
      closeMdl('mdlCfdiImp');
      if (typeof Compras !== 'undefined') Compras.refrescar(); else if (typeof R === 'function') R();
    } finally { btn.disabled = false; }
  }

  return { parse, tokens, abrirImportador, cargar, elegir, obra, confirmar, candidatosGasto, candidatosCobro };
})();
if (typeof module !== 'undefined') module.exports = CFDI;
