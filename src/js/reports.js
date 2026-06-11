/**
 * Sistema de Reportes y Exportación
 * - Exportación a Excel (XLSX)
 * - Exportación a PDF
 * - Generación de reportes con filtros
 */

const Reports = {
  // Configuración de reportes disponibles
  REPORT_TYPES: {
    gastos: {
      title: 'Reporte de Gastos',
      columns: ['Fecha', 'Obra', 'Concepto', 'Categoría', 'Monto', 'Estado', 'Proveedor'],
      getData: () => D.g || [],
      mapRow: (item) => [
        Reports.formatDate(item.fecha_solicitud),
        Reports.getObraName(item.obra_id),
        item.concepto || '-',
        item.categoria || '-',
        Reports.formatMoney(item.monto),
        item.estatus || '-',
        Reports.getProveedorName(item.proveedor_id)
      ]
    },
    ordenes: {
      title: 'Reporte de Órdenes de Compra',
      columns: ['Folio', 'Fecha', 'Obra', 'Proveedor', 'Total', 'Estado'],
      getData: () => D.oc || [],
      mapRow: (item) => [
        item.folio || item.id,
        Reports.formatDate(item.created_at),
        Reports.getObraName(item.obra_id),
        Reports.getProveedorName(item.proveedor_id),
        Reports.formatMoney(item.total),
        item.estatus || '-'
      ]
    },
    empleados: {
      title: 'Reporte de Empleados',
      columns: ['Nombre', 'Puesto', 'Obra Asignada', 'Sueldo Base', 'Estatus'],
      getData: () => D.e || [],
      mapRow: (item) => [
        item.nombre_completo || '-',
        item.puesto || '-',
        Reports.getObraName(item.obra_asignada),
        Reports.formatMoney(item.sueldo_base),
        item.estatus || '-'
      ]
    },
    materiales: {
      title: 'Reporte de Inventario',
      columns: ['Material', 'Categoría', 'Unidad', 'Stock Actual', 'Stock Mínimo', 'Precio Unit.'],
      getData: () => D.mt || [],
      mapRow: (item) => [
        item.nombre || '-',
        item.categoria || '-',
        item.unidad || '-',
        item.stock_actual || 0,
        item.stock_minimo || 0,
        Reports.formatMoney(item.precio_unitario)
      ]
    },
    estimaciones: {
      title: 'Reporte de Estimaciones',
      columns: ['No.', 'Obra', 'Periodo', 'Monto', 'Estado', 'Fecha'],
      getData: () => D.est || [],
      mapRow: (item) => [
        item.numero_estimacion || item.id,
        Reports.getObraName(item.obra_id),
        item.periodo || '-',
        Reports.formatMoney(item.monto_total),
        item.estatus || '-',
        Reports.formatDate(item.created_at)
      ]
    },
    subcontratos: {
      title: 'Reporte de Subcontratos',
      columns: ['Contrato', 'Subcontratista', 'Obra', 'Monto', 'Anticipo', 'Estado'],
      getData: () => D.sc || [],
      mapRow: (item) => [
        item.numero_contrato || item.id,
        item.nombre_subcontratista || '-',
        Reports.getObraName(item.obra_id),
        Reports.formatMoney(item.monto_contrato),
        Reports.formatMoney(item.anticipo),
        item.estatus || '-'
      ]
    },
    obras: {
      title: 'Reporte de Obras',
      columns: ['Nombre', 'Cliente', 'Presupuesto', 'Avance', 'Estado', 'Fecha Inicio'],
      getData: () => D.o || [],
      mapRow: (item) => [
        item.nombre || '-',
        item.cliente || '-',
        Reports.formatMoney(item.presupuesto_total),
        (item.avance_real || 0) + '%',
        item.estatus || '-',
        Reports.formatDate(item.fecha_inicio)
      ]
    },
    proveedores: {
      title: 'Catálogo de Proveedores',
      columns: ['Nombre', 'RFC', 'Tipo', 'Teléfono', 'Email', 'Estado'],
      getData: () => D.pv || [],
      mapRow: (item) => [
        item.nombre_proveedor || '-',
        item.rfc || '-',
        item.tipo || '-',
        item.telefono || '-',
        item.email || '-',
        item.estatus || '-'
      ]
    },
    clientes: {
      title: 'Catálogo de Clientes',
      columns: ['Nombre', 'RFC', 'Teléfono', 'Email', 'Estado'],
      getData: () => D.cli || [],
      mapRow: (item) => [
        item.nombre_cliente || '-',
        item.rfc || '-',
        item.telefono || '-',
        item.email || '-',
        item.estatus || '-'
      ]
    },
    nomina: {
      title: 'Reporte de Nómina',
      columns: ['Empleado', 'Periodo', 'Sueldo', 'Deducciones', 'Neto', 'Fecha Pago'],
      getData: () => D.nom || [],
      mapRow: (item) => [
        Reports.getEmpleadoName(item.empleado_id),
        item.periodo || '-',
        Reports.formatMoney(item.sueldo_bruto),
        Reports.formatMoney(item.deducciones),
        Reports.formatMoney(item.sueldo_neto),
        Reports.formatDate(item.fecha_pago)
      ]
    }
  },

  // Helpers
  formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  },

  formatMoney(amount) {
    if (!amount) return '$0';
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 0
    }).format(amount);
  },

  getObraName(id) {
    if (!id || !D.o) return '-';
    const obra = D.o.find(o => o.id === id);
    return obra ? obra.nombre : '-';
  },

  getProveedorName(id) {
    if (!id || !D.pv) return '-';
    const prov = D.pv.find(p => p.id === id);
    return prov ? prov.nombre_proveedor : '-';
  },

  getEmpleadoName(id) {
    if (!id || !D.e) return '-';
    const emp = D.e.find(e => e.id === id);
    return emp ? emp.nombre_completo : '-';
  },

  // ========== EXPORTAR A EXCEL ==========
  async exportToExcel(reportType, filters = {}) {
    const config = this.REPORT_TYPES[reportType];
    if (!config) {
      Toast.error('Tipo de reporte no válido');
      return;
    }

    Toast.info('Generando Excel...');

    try {
      let data = config.getData();

      // Aplicar filtros
      data = this.applyFilters(data, filters);

      if (data.length === 0) {
        Toast.warning('No hay datos para exportar');
        return;
      }

      // Crear contenido CSV (compatible con Excel)
      const headers = config.columns.join('\t');
      const rows = data.map(item => config.mapRow(item).join('\t'));
      const content = [headers, ...rows].join('\n');

      // Agregar BOM para UTF-8
      const BOM = '\uFEFF';
      const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8' });

      // Descargar
      const filename = `${config.title.replace(/\s+/g, '_')}_${this.getDateString()}.csv`;
      this.downloadBlob(blob, filename);

      Toast.success(`Excel generado: ${data.length} registros`);
    } catch (error) {
      console.error('Error exportando Excel:', error);
      Toast.error('Error al generar Excel');
    }
  },

  // ========== EXPORTAR A PDF ==========
  async exportToPDF(reportType, filters = {}) {
    const config = this.REPORT_TYPES[reportType];
    if (!config) {
      Toast.error('Tipo de reporte no válido');
      return;
    }

    Toast.info('Generando PDF...');

    try {
      let data = config.getData();
      data = this.applyFilters(data, filters);

      if (data.length === 0) {
        Toast.warning('No hay datos para exportar');
        return;
      }

      // Generar HTML para imprimir como PDF
      const html = this.generatePDFHTML(config, data);

      // Abrir ventana de impresión
      const printWindow = window.open('', '_blank');
      printWindow.document.write(html);
      printWindow.document.close();

      // Esperar a que cargue y abrir diálogo de impresión
      printWindow.onload = () => {
        printWindow.print();
      };

      Toast.success('PDF listo para imprimir');
    } catch (error) {
      console.error('Error generando PDF:', error);
      Toast.error('Error al generar PDF');
    }
  },

  generatePDFHTML(config, data) {
    const rows = data.map(item => {
      const cells = config.mapRow(item).map(cell => `<td>${cell}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const headerCells = config.columns.map(col => `<th>${col}</th>`).join('');

    // Calcular totales si hay columnas de dinero
    let totalsRow = '';
    if (config.columns.some(col => col.toLowerCase().includes('monto') || col.toLowerCase().includes('total'))) {
      const totals = this.calculateTotals(config, data);
      if (totals) {
        totalsRow = `<tr class="totals">${totals.map(t => `<td>${t}</td>`).join('')}</tr>`;
      }
    }

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${config.title}</title>
  <style>
    @page { size: landscape; margin: 1cm; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 10px;
      color: #333;
      margin: 0;
      padding: 20px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #3b82f6;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    .header h1 {
      color: #1e40af;
      font-size: 18px;
      margin: 0;
    }
    .header .date {
      color: #666;
      font-size: 11px;
    }
    .header .company {
      font-weight: bold;
      color: #1e40af;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th {
      background: #1e40af;
      color: white;
      padding: 8px 6px;
      text-align: left;
      font-weight: 600;
      font-size: 9px;
      text-transform: uppercase;
    }
    td {
      padding: 6px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 10px;
    }
    tr:nth-child(even) { background: #f9fafb; }
    tr:hover { background: #eff6ff; }
    .totals {
      background: #dbeafe !important;
      font-weight: bold;
    }
    .totals td {
      border-top: 2px solid #3b82f6;
      padding-top: 10px;
    }
    .footer {
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px solid #e5e7eb;
      font-size: 9px;
      color: #666;
      display: flex;
      justify-content: space-between;
    }
    .summary {
      background: #f0f9ff;
      padding: 10px;
      border-radius: 6px;
      margin-bottom: 15px;
      display: flex;
      gap: 20px;
    }
    .summary-item {
      text-align: center;
    }
    .summary-item .value {
      font-size: 16px;
      font-weight: bold;
      color: #1e40af;
    }
    .summary-item .label {
      font-size: 9px;
      color: #666;
    }
    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="company">Control de Obra</div>
      <h1>${config.title}</h1>
    </div>
    <div class="date">
      Generado: ${new Date().toLocaleDateString('es-MX', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })}
    </div>
  </div>

  <div class="summary">
    <div class="summary-item">
      <div class="value">${data.length}</div>
      <div class="label">Total Registros</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>${headerCells}</tr>
    </thead>
    <tbody>
      ${rows}
      ${totalsRow}
    </tbody>
  </table>

  <div class="footer">
    <span>Control de Obra - Sistema de Gestión</span>
    <span>Página 1</span>
  </div>
</body>
</html>`;
  },

  calculateTotals(config, data) {
    const totals = config.columns.map(() => '');
    let hasTotal = false;

    config.columns.forEach((col, idx) => {
      const colLower = col.toLowerCase();
      if (colLower.includes('monto') || colLower.includes('total') ||
          colLower.includes('sueldo') || colLower.includes('precio') ||
          colLower.includes('neto') || colLower.includes('anticipo')) {
        let sum = 0;
        data.forEach(item => {
          const row = config.mapRow(item);
          const val = row[idx];
          if (typeof val === 'string') {
            const num = parseFloat(val.replace(/[$,]/g, ''));
            if (!isNaN(num)) sum += num;
          } else if (typeof val === 'number') {
            sum += val;
          }
        });
        totals[idx] = this.formatMoney(sum);
        hasTotal = true;
      }
    });

    if (hasTotal) {
      totals[0] = 'TOTAL';
      return totals;
    }
    return null;
  },

  // ========== FILTROS ==========
  applyFilters(data, filters) {
    if (!filters || Object.keys(filters).length === 0) return data;

    return data.filter(item => {
      // Filtro por obra
      if (filters.obraId && item.obra_id !== filters.obraId) return false;

      // Filtro por fecha desde
      if (filters.fechaDesde) {
        const itemDate = new Date(item.fecha_solicitud || item.created_at || item.fecha);
        if (itemDate < new Date(filters.fechaDesde)) return false;
      }

      // Filtro por fecha hasta
      if (filters.fechaHasta) {
        const itemDate = new Date(item.fecha_solicitud || item.created_at || item.fecha);
        if (itemDate > new Date(filters.fechaHasta)) return false;
      }

      // Filtro por estado
      if (filters.estatus && item.estatus !== filters.estatus) return false;

      // Filtro por proveedor
      if (filters.proveedorId && item.proveedor_id !== filters.proveedorId) return false;

      // Filtro por categoría
      if (filters.categoria && item.categoria !== filters.categoria) return false;

      return true;
    });
  },

  // ========== UTILIDADES ==========
  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  getDateString() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  },

  // ========== MODAL DE REPORTES ==========
  showReportModal() {
    const reportOptions = Object.entries(this.REPORT_TYPES).map(([key, config]) =>
      `<option value="${key}">${config.title}</option>`
    ).join('');

    const obraOptions = (D.o || []).map(o =>
      `<option value="${o.id}">${o.nombre}</option>`
    ).join('');

    const modal = document.createElement('div');
    modal.id = 'reportModal';
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.innerHTML = `
      <div class="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl">
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-lg font-bold text-slate-800">
            <i class="ri-file-chart-line mr-2 text-blue-500"></i>Generar Reporte
          </h3>
          <button onclick="this.closest('.fixed').remove()" class="text-slate-400 hover:text-slate-600">
            <i class="ri-close-line text-xl"></i>
          </button>
        </div>

        <div class="space-y-4">
          <!-- Tipo de reporte -->
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Tipo de Reporte</label>
            <select id="reportType" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              ${reportOptions}
            </select>
          </div>

          <!-- Filtro por obra -->
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Filtrar por Obra (opcional)</label>
            <select id="reportObra" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="">Todas las obras</option>
              ${obraOptions}
            </select>
          </div>

          <!-- Rango de fechas -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Fecha Desde</label>
              <input type="date" id="reportFechaDesde" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Fecha Hasta</label>
              <input type="date" id="reportFechaHasta" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500">
            </div>
          </div>

          <!-- Filtro por estado -->
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Estado (opcional)</label>
            <select id="reportEstatus" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="aprobado">Aprobado</option>
              <option value="rechazado">Rechazado</option>
              <option value="pagado">Pagado</option>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
              <option value="en_proceso">En Proceso</option>
              <option value="completado">Completado</option>
            </select>
          </div>
        </div>

        <!-- Preview de registros -->
        <div id="reportPreview" class="mt-4 p-3 bg-slate-50 rounded-lg text-sm text-slate-600">
          <i class="ri-information-line mr-1"></i>
          Selecciona las opciones y presiona previsualizar
        </div>

        <!-- Botones -->
        <div class="flex gap-3 mt-6">
          <button onclick="Reports.previewReport()" class="flex-1 py-2 px-4 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors">
            <i class="ri-eye-line mr-1"></i>Previsualizar
          </button>
          <button onclick="Reports.exportFromModal('excel')" class="flex-1 py-2 px-4 rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors">
            <i class="ri-file-excel-line mr-1"></i>Excel
          </button>
          <button onclick="Reports.exportFromModal('pdf')" class="flex-1 py-2 px-4 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">
            <i class="ri-file-pdf-line mr-1"></i>PDF
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  },

  getModalFilters() {
    return {
      obraId: document.getElementById('reportObra')?.value || null,
      fechaDesde: document.getElementById('reportFechaDesde')?.value || null,
      fechaHasta: document.getElementById('reportFechaHasta')?.value || null,
      estatus: document.getElementById('reportEstatus')?.value || null
    };
  },

  previewReport() {
    const reportType = document.getElementById('reportType')?.value;
    const filters = this.getModalFilters();
    const config = this.REPORT_TYPES[reportType];

    if (!config) return;

    let data = config.getData();
    data = this.applyFilters(data, filters);

    const preview = document.getElementById('reportPreview');
    if (preview) {
      preview.innerHTML = `
        <div class="flex items-center justify-between">
          <span><i class="ri-database-2-line mr-1"></i>${data.length} registros encontrados</span>
          <span class="text-xs text-slate-500">${config.title}</span>
        </div>
      `;
    }
  },

  exportFromModal(format) {
    const reportType = document.getElementById('reportType')?.value;
    const filters = this.getModalFilters();

    if (format === 'excel') {
      this.exportToExcel(reportType, filters);
    } else if (format === 'pdf') {
      this.exportToPDF(reportType, filters);
    }
  },

  // ========== REPORTE RÁPIDO ==========
  quickExport(reportType, format = 'excel') {
    if (format === 'excel') {
      this.exportToExcel(reportType);
    } else {
      this.exportToPDF(reportType);
    }
  }
};

// Función global para abrir modal de reportes
function openReportModal() {
  Reports.showReportModal();
}

console.log('Reports module loaded');
