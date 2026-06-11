/**
 * Cargador de Datos Optimizado
 * - Carga datos en grupos prioritarios
 * - Usa caché para carga instantánea
 * - Actualiza en segundo plano
 */

const DataLoader = {
  // Grupos de tablas por prioridad
  PRIORITY_HIGH: ['obras', 'gastos', 'ordenes_compra', 'empleados', 'proveedores'],
  PRIORITY_MEDIUM: ['estimaciones', 'materiales', 'bitacora_obra', 'subcontratos'],
  PRIORITY_LOW: ['fotos', 'documentos', 'calendario_eventos', 'rfi_items', 'punch_list'],

  // Mapeo de nombres cortos a nombres de tabla
  TABLE_MAP: {
    o: 'obras',
    e: 'empleados',
    g: 'gastos',
    oc: 'ordenes_compra',
    pv: 'proveedores',
    bt: 'bitacora_obra',
    mt: 'materiales',
    mm: 'materiales_movimientos',
    sc: 'subcontratos',
    sp: 'subcontratos_pagos',
    ev: 'calendario_eventos',
    est: 'estimaciones',
    estp: 'estimaciones_partidas',
    doc: 'documentos',
    fot: 'fotos',
    rfi: 'rfi_items',
    pl: 'punch_list',
    seg: 'seguridad_obra',
    cli: 'clientes',
    nom: 'nomina',
    asi: 'asistencia',
    cot: 'cotizaciones',
    cotp: 'cotizaciones_partidas',
    fr: 'facturas_recibidas',
    ret: 'retenciones',
    cfdi: 'cfdis_emitidos'
  },

  // Consultas optimizadas con select específico
  OPTIMIZED_QUERIES: {
    obras: '*',
    empleados: 'id,nombre_completo,puesto,estatus,sueldo_base,obra_asignada,empresa_id',
    gastos: '*',
    ordenes_compra: '*',
    proveedores: 'id,nombre_proveedor,rfc,tipo,estatus,empresa_id',
    estimaciones: '*',
    materiales: 'id,nombre,unidad,categoria,stock_actual,stock_minimo,precio_unitario,empresa_id',
    clientes: 'id,nombre_cliente,rfc,email,telefono,estatus,empresa_id'
  },

  // Cargar datos con caché
  async loadWithCache(sb, empresaId, onProgress) {
    const startTime = Date.now();

    // 1. Intentar cargar desde caché primero
    const cachedData = Cache.loadAppData(empresaId);
    if (cachedData) {
      console.log('⚡ Datos cargados desde caché en', Date.now() - startTime, 'ms');
      onProgress && onProgress(100, 'Cargado desde caché');

      // Actualizar en segundo plano
      setTimeout(() => this.refreshInBackground(sb, empresaId), 1000);

      return cachedData;
    }

    // 2. Cargar desde servidor
    return await this.loadFromServer(sb, empresaId, onProgress);
  },

  // Cargar desde servidor
  async loadFromServer(sb, empresaId, onProgress) {
    const startTime = Date.now();
    const data = {};

    onProgress && onProgress(10, 'Conectando...');

    // Helper para queries con filtro de empresa
    const query = (table, select = '*') => {
      let q = sb.from(table).select(select);
      if (empresaId) q = q.eq('empresa_id', empresaId);
      return q;
    };

    try {
      // Grupo 1: Datos críticos (paralelo)
      onProgress && onProgress(20, 'Cargando datos principales...');
      const [obras, gastos, ordenes, empleados, proveedores] = await Promise.all([
        query('obras'),
        query('gastos').order('fecha_solicitud', { ascending: false }),
        query('ordenes_compra').order('created_at', { ascending: false }),
        query('empleados'),
        query('proveedores').order('nombre_proveedor')
      ]);

      data.o = obras.data || [];
      data.g = gastos.data || [];
      data.oc = ordenes.data || [];
      data.e = empleados.data || [];
      data.pv = proveedores.data || [];

      onProgress && onProgress(50, 'Cargando módulos secundarios...');

      // Grupo 2: Datos secundarios (paralelo)
      const [estimaciones, estimPartidas, materiales, matMov, subcontratos, subPagos] = await Promise.all([
        query('estimaciones').order('created_at', { ascending: false }),
        query('estimaciones_partidas'),
        query('materiales').order('nombre'),
        query('materiales_movimientos').order('fecha', { ascending: false }),
        query('subcontratos').order('created_at', { ascending: false }),
        query('subcontratos_pagos').order('fecha_pago', { ascending: false })
      ]);

      data.est = estimaciones.data || [];
      data.estp = estimPartidas.data || [];
      data.mt = materiales.data || [];
      data.mm = matMov.data || [];
      data.sc = subcontratos.data || [];
      data.sp = subPagos.data || [];

      onProgress && onProgress(70, 'Cargando catálogos...');

      // Grupo 3: Catálogos y extras (paralelo)
      const [usuarios, roles, asignaciones, bitacora, eventos, clientes] = await Promise.all([
        empresaId ? sb.from('obra_usuarios').select('*,obra_roles(*)').eq('empresa_id', empresaId) : sb.from('obra_usuarios').select('*,obra_roles(*)'),
        sb.from('obra_roles').select('*').order('nivel_acceso', { ascending: false }),
        sb.from('obra_asignaciones').select('*,obras(*)'),
        query('bitacora_obra').order('fecha', { ascending: false }).limit(100),
        query('calendario_eventos').order('fecha_inicio', { ascending: false }),
        query('clientes').order('nombre_cliente')
      ]);

      data.u = usuarios.data || [];
      data.r = roles.data || [];
      data.a = asignaciones.data || [];
      data.bt = bitacora.data || [];
      data.ev = eventos.data || [];
      data.cli = clientes.data || [];

      onProgress && onProgress(85, 'Cargando documentos...');

      // Grupo 4: Documentos y fotos (paralelo)
      const [cotizaciones, cotPartidas, docs, fotos, rfi, punchList, seguridad] = await Promise.all([
        query('cotizaciones').order('created_at', { ascending: false }),
        query('cotizaciones_partidas'),
        query('documentos').order('created_at', { ascending: false }).limit(200),
        query('fotos').order('created_at', { ascending: false }).limit(200),
        query('rfi_items').order('created_at', { ascending: false }),
        query('punch_list').order('created_at', { ascending: false }),
        query('seguridad_obra').order('fecha', { ascending: false })
      ]);

      data.cot = cotizaciones.data || [];
      data.cotp = cotPartidas.data || [];
      data.doc = docs.data || [];
      data.fot = fotos.data || [];
      data.rfi = rfi.data || [];
      data.pl = punchList.data || [];
      data.seg = seguridad.data || [];

      onProgress && onProgress(95, 'Finalizando...');

      // Grupo 5: Contabilidad y nómina
      const [facturas, retenciones, cfdi, nomina, asistencia, programa, presupuesto] = await Promise.all([
        query('facturas_recibidas').order('fecha_factura', { ascending: false }),
        query('retenciones').order('created_at', { ascending: false }),
        query('cfdis_emitidos').order('fecha_emision', { ascending: false }),
        query('nomina').order('fecha_pago', { ascending: false }),
        query('asistencia').order('fecha', { ascending: false }).limit(500),
        query('actividades_programa'),
        query('presupuesto_partidas')
      ]);

      data.fr = facturas.data || [];
      data.ret = retenciones.data || [];
      data.cfdi = cfdi.data || [];
      data.nom = nomina.data || [];
      data.asi = asistencia.data || [];
      data.ap = programa.data || [];
      data.pg = presupuesto.data || [];

      // Tablas adicionales con valores por defecto
      data.cc = [];
      data.dnl = [];
      data.lb = [];
      data.alb = [];
      data.rec = [];
      data.ar = [];
      data.mf = [];
      data.dm = [];
      data.cd = [];
      data.cal = [];
      data.pac = [];

      // Guardar en caché
      Cache.saveAppData(data, empresaId);

      const loadTime = Date.now() - startTime;
      console.log('📊 Datos cargados desde servidor en', loadTime, 'ms');
      console.log('📊 Totales - Obras:', data.o.length, 'Gastos:', data.g.length, 'OC:', data.oc.length);

      onProgress && onProgress(100, 'Completado');
      return data;

    } catch (error) {
      console.error('Error cargando datos:', error);
      onProgress && onProgress(100, 'Error');
      throw error;
    }
  },

  // Actualizar datos en segundo plano
  async refreshInBackground(sb, empresaId) {
    console.log('🔄 Actualizando datos en segundo plano...');
    try {
      const freshData = await this.loadFromServer(sb, empresaId, null);
      // Los datos ya se guardaron en caché dentro de loadFromServer
      console.log('✅ Datos actualizados en segundo plano');
      return freshData;
    } catch (e) {
      console.warn('⚠️ Error actualizando en segundo plano:', e);
    }
  },

  // Invalidar caché y recargar
  async forceRefresh(sb, empresaId, onProgress) {
    Cache.clear();
    return await this.loadFromServer(sb, empresaId, onProgress);
  }
};
