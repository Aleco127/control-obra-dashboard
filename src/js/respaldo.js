// Respaldo completo de la empresa (US-204): JSON con todas las tablas cargadas en D,
// un Excel con una hoja por tabla y los comprobantes del bucket privado, todo en un ZIP.
// Depende de: D, currentUser, sb, XLSX, JSZip, Toast, hoyISO, EMPRESA_INFO.
const Respaldo = (() => {
  // Nombre legible por clave de D (las que no aparecen usan la clave tal cual)
  const NOMBRES = {
    o: 'obras', e: 'empleados', g: 'gastos', u: 'usuarios', oc: 'ordenes_compra', pv: 'proveedores', bt: 'bitacora',
    cc: 'catalogo_conceptos', pg: 'programas_obra', ap: 'actividades_programa', cli: 'clientes', cxc: 'cuentas_por_cobrar',
    prc: 'pagos_recibidos', ppv: 'pagos_proveedores', fot: 'fotos_obra', doc: 'documentos', est: 'estimaciones', estp: 'estimaciones_partidas',
    cot: 'cotizaciones', cotp: 'cotizaciones_partidas', nom: 'nomina', nomd: 'nomina_distribucion', gad: 'gastos_admin_distribucion',
    catg: 'categorias_gasto', soc: 'socios', msoc: 'movimientos_socio', rep: 'repartos', repd: 'reparto_detalle', fcfg: 'finanzas_config',
    conc: 'conciliaciones', fr: 'facturas_recibidas', cfe: 'cfdis_emitidos', ci: 'cierres_mensuales', mt: 'materiales', sc: 'subcontratos',
    r: 'rfis', a: 'asistencia', ev: 'eventos', cal: 'calendario', lb: 'libro_obra', rec: 'recibos', ar: 'archivos', ret: 'retiros', mf: 'movimientos_financieros',
  };
  const CARPETAS = ['gastos', 'xml', 'repartos', 'cierres', 'emitidos', 'suscripcion'];

  function tablas() {
    const out = {};
    Object.keys(D || {}).forEach((k) => {
      const v = D[k];
      if (Array.isArray(v)) out[NOMBRES[k] || k] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v) && ['fcfg'].includes(k)) out[NOMBRES[k] || k] = [v];
    });
    return out;
  }

  // Lista recursiva del bucket comprobantes bajo empresa/<id>/
  async function listarArchivos(prefix, depth = 0) {
    const files = [];
    const { data, error } = await sb.storage.from('comprobantes').list(prefix, { limit: 1000 });
    if (error || !data) return files;
    for (const it of data) {
      const path = prefix + '/' + it.name;
      if (it.id === null && depth < 4) files.push(...(await listarArchivos(path, depth + 1)));
      else if (it.id) files.push(path);
    }
    return files;
  }

  async function completo() {
    if (!currentUser) return;
    const t = tablas();
    const resumen = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.length]));
    Toast.info('Preparando respaldo: ' + Object.keys(t).length + ' tablas');
    const zip = new JSZip();
    const fecha = hoyISO();
    const base = `control-obra_${EMPRESA_INFO.slug}_${fecha}`;
    zip.file('respaldo.json', JSON.stringify({ exportDate: new Date().toISOString(), empresa: { id: currentUser.empresa_id, nombre: EMPRESA_INFO.nombre }, version: 3, resumen, config: typeof configData !== 'undefined' ? configData : null, tablas: t }, null, 2));
    // Excel: una hoja por tabla (máximo 31 caracteres por nombre de hoja)
    try {
      const wb = XLSX.utils.book_new();
      const usados = new Set();
      Object.entries(t).forEach(([k, rows]) => {
        let name = k.slice(0, 31); let i = 2;
        while (usados.has(name)) name = (k.slice(0, 28) + '_' + i++);
        usados.add(name);
        const plain = rows.map((r) => Object.fromEntries(Object.entries(r).map(([c, v]) => [c, v && typeof v === 'object' ? JSON.stringify(v) : v])));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(plain.length ? plain : [{}]), name);
      });
      zip.file(base + '.xlsx', XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
    } catch (e) { console.warn('Excel del respaldo', e); }
    // Comprobantes del bucket privado
    let nArchivos = 0;
    try {
      const raiz = `empresa/${currentUser.empresa_id}`;
      let paths = [];
      for (const c of CARPETAS) paths.push(...(await listarArchivos(`${raiz}/${c}`)));
      paths = [...new Set(paths)];
      if (paths.length) {
        for (let i = 0; i < paths.length; i += 20) {
          const lote = paths.slice(i, i + 20);
          const { data: urls } = await sb.storage.from('comprobantes').createSignedUrls(lote, 300);
          await Promise.all((urls || []).map(async (u) => {
            if (!u.signedUrl) return;
            try { const r = await fetch(u.signedUrl); if (r.ok) { zip.file('comprobantes/' + u.path.replace(raiz + '/', ''), await r.arrayBuffer()); nArchivos++; } } catch (e) {}
          }));
          Toast.info(`Comprobantes: ${Math.min(i + 20, paths.length)} de ${paths.length}`, 1500);
        }
      }
    } catch (e) { console.warn('Comprobantes del respaldo', e); }
    zip.file('LEEME.txt', `Respaldo de ${EMPRESA_INFO.nombre} generado el ${fecha} desde Control de Obra.\n\nrespaldo.json: todas las tablas (${Object.keys(t).length}) en formato JSON.\n${base}.xlsx: las mismas tablas, una hoja por tabla.\ncomprobantes/: ${nArchivos} archivos (tickets, facturas XML/PDF, actas, cierres).\n\nLos datos son propiedad de la empresa. Puede importarlos en otro sistema o solicitar ayuda en soporte@supernovarquitectos.com.\n`);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = base + '.zip'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    Toast.success(`Respaldo listo: ${Object.keys(t).length} tablas y ${nArchivos} comprobantes`);
    if (typeof Telemetry !== 'undefined') Telemetry.track('respaldo_completo', { tablas: Object.keys(t).length, archivos: nArchivos });
    return { resumen, archivos: nArchivos };
  }

  return { completo, tablas, listarArchivos };
})();
