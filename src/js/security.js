/**
 * Módulo de Seguridad y Auditoría
 * - Sanitización de inputs
 * - Validación de datos
 * - Sistema de auditoría
 * - Manejo seguro de errores
 */

const Security = {
  // ========== SANITIZACIÓN ==========

  // Escapar HTML para prevenir XSS
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // Sanitizar string para uso seguro
  sanitizeString(str) {
    if (!str) return '';
    return String(str)
      .replace(/[<>]/g, '') // Remover < >
      .replace(/javascript:/gi, '') // Remover javascript:
      .replace(/on\w+=/gi, '') // Remover event handlers
      .trim();
  },

  // Sanitizar objeto completo
  sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        sanitized[key] = this.sanitizeString(value);
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  },

  // Sanitizar para SQL (prevenir inyección básica)
  sanitizeForQuery(str) {
    if (!str) return '';
    return String(str)
      .replace(/'/g, "''")
      .replace(/;/g, '')
      .replace(/--/g, '')
      .replace(/\/\*/g, '')
      .replace(/\*\//g, '');
  },

  // ========== VALIDACIÓN ==========

  // Validar UUID
  isValidUUID(str) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  },

  // Validar email
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  // Validar RFC mexicano
  isValidRFC(rfc) {
    const rfcRegex = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/i;
    return rfcRegex.test(rfc);
  },

  // Validar teléfono mexicano
  isValidPhone(phone) {
    const cleaned = String(phone).replace(/\D/g, '');
    return cleaned.length === 10;
  },

  // Validar monto (número positivo)
  isValidAmount(amount) {
    const num = parseFloat(amount);
    return !isNaN(num) && num >= 0;
  },

  // Validar fecha
  isValidDate(dateStr) {
    const date = new Date(dateStr);
    return date instanceof Date && !isNaN(date);
  },

  // Validar porcentaje (0-100)
  isValidPercentage(value) {
    const num = parseFloat(value);
    return !isNaN(num) && num >= 0 && num <= 100;
  },

  // ========== VALIDACIÓN DE FORMULARIOS ==========

  validateForm(formData, rules) {
    const errors = [];

    for (const [field, fieldRules] of Object.entries(rules)) {
      const value = formData[field];

      for (const rule of fieldRules) {
        let isValid = true;
        let message = '';

        switch (rule.type) {
          case 'required':
            if (!value || String(value).trim() === '') {
              isValid = false;
              message = rule.message || `${field} es requerido`;
            }
            break;

          case 'email':
            if (value && !this.isValidEmail(value)) {
              isValid = false;
              message = rule.message || 'Email inválido';
            }
            break;

          case 'rfc':
            if (value && !this.isValidRFC(value)) {
              isValid = false;
              message = rule.message || 'RFC inválido';
            }
            break;

          case 'phone':
            if (value && !this.isValidPhone(value)) {
              isValid = false;
              message = rule.message || 'Teléfono inválido (10 dígitos)';
            }
            break;

          case 'amount':
            if (value && !this.isValidAmount(value)) {
              isValid = false;
              message = rule.message || 'Monto inválido';
            }
            break;

          case 'minLength':
            if (value && String(value).length < rule.min) {
              isValid = false;
              message = rule.message || `Mínimo ${rule.min} caracteres`;
            }
            break;

          case 'maxLength':
            if (value && String(value).length > rule.max) {
              isValid = false;
              message = rule.message || `Máximo ${rule.max} caracteres`;
            }
            break;

          case 'pattern':
            if (value && !rule.regex.test(value)) {
              isValid = false;
              message = rule.message || 'Formato inválido';
            }
            break;
        }

        if (!isValid) {
          errors.push({ field, message });
          break; // Solo un error por campo
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  },

  // ========== MANEJO DE ERRORES ==========

  handleError(error, context = '') {
    console.error(`[ERROR${context ? ' - ' + context : ''}]:`, error);

    // Log de auditoría
    Audit.log('error', {
      message: error.message || String(error),
      context,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    // Mensaje amigable para el usuario
    let userMessage = 'Ha ocurrido un error. Por favor intenta de nuevo.';

    if (error.message) {
      if (error.message.includes('network') || error.message.includes('fetch')) {
        userMessage = 'Error de conexión. Verifica tu internet.';
      } else if (error.message.includes('permission') || error.message.includes('denied')) {
        userMessage = 'No tienes permiso para realizar esta acción.';
      } else if (error.message.includes('duplicate') || error.message.includes('unique')) {
        userMessage = 'Este registro ya existe.';
      } else if (error.message.includes('not found') || error.message.includes('404')) {
        userMessage = 'El recurso solicitado no existe.';
      }
    }

    if (typeof Toast !== 'undefined') {
      Toast.error(userMessage);
    }

    return userMessage;
  },

  // ========== RATE LIMITING (Cliente) ==========

  _rateLimits: {},

  checkRateLimit(action, maxRequests = 10, windowMs = 60000) {
    const now = Date.now();
    const key = action;

    if (!this._rateLimits[key]) {
      this._rateLimits[key] = { count: 0, windowStart: now };
    }

    const limit = this._rateLimits[key];

    // Reset window si expiró
    if (now - limit.windowStart > windowMs) {
      limit.count = 0;
      limit.windowStart = now;
    }

    limit.count++;

    if (limit.count > maxRequests) {
      console.warn(`Rate limit exceeded for action: ${action}`);
      return false;
    }

    return true;
  }
};

// ========== SISTEMA DE AUDITORÍA ==========

const Audit = {
  STORAGE_KEY: 'obra_audit_log',
  MAX_ENTRIES: 500,

  // Registrar evento
  log(type, data) {
    const entry = {
      id: this.generateId(),
      type,
      data,
      timestamp: new Date().toISOString(),
      user: this.getCurrentUser(),
      url: window.location.href
    };

    // Guardar localmente
    this.saveLocal(entry);

    // Enviar a servidor si está disponible
    this.sendToServer(entry);

    return entry;
  },

  // Tipos de eventos comunes
  logLogin(userId, email) {
    return this.log('auth.login', { userId, email });
  },

  logLogout(userId) {
    return this.log('auth.logout', { userId });
  },

  logCreate(table, recordId, data) {
    return this.log('data.create', { table, recordId, summary: this.summarize(data) });
  },

  logUpdate(table, recordId, changes) {
    return this.log('data.update', { table, recordId, changes: this.summarize(changes) });
  },

  logDelete(table, recordId) {
    return this.log('data.delete', { table, recordId });
  },

  logExport(reportType, filters, count) {
    return this.log('report.export', { reportType, filters, recordCount: count });
  },

  logError(error, context) {
    return this.log('error', {
      message: error.message || String(error),
      context,
      stack: error.stack?.substring(0, 500)
    });
  },

  // Helpers
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  },

  getCurrentUser() {
    try {
      return {
        id: U?.id,
        email: U?.email,
        nombre: U?.nombre
      };
    } catch {
      return null;
    }
  },

  summarize(obj) {
    if (!obj) return null;
    // Solo incluir campos clave, no datos sensibles
    const safe = {};
    const allowedFields = ['id', 'nombre', 'concepto', 'monto', 'estatus', 'fecha', 'obra_id'];
    for (const field of allowedFields) {
      if (obj[field] !== undefined) {
        safe[field] = obj[field];
      }
    }
    return Object.keys(safe).length > 0 ? safe : { fieldsCount: Object.keys(obj).length };
  },

  // Almacenamiento local
  saveLocal(entry) {
    try {
      let logs = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
      logs.unshift(entry);

      // Limitar entradas
      if (logs.length > this.MAX_ENTRIES) {
        logs = logs.slice(0, this.MAX_ENTRIES);
      }

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(logs));
    } catch (e) {
      console.warn('Error saving audit log:', e);
    }
  },

  // Obtener logs locales
  getLocalLogs(limit = 100) {
    try {
      const logs = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
      return logs.slice(0, limit);
    } catch {
      return [];
    }
  },

  // Limpiar logs antiguos
  clearOldLogs(daysToKeep = 7) {
    try {
      const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
      let logs = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
      logs = logs.filter(log => new Date(log.timestamp).getTime() > cutoff);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(logs));
      return logs.length;
    } catch {
      return 0;
    }
  },

  // Enviar a servidor (si hay tabla de auditoría)
  async sendToServer(entry) {
    try {
      if (typeof sb !== 'undefined' && sb) {
        // Intentar guardar en Supabase si existe la tabla
        await sb.from('audit_log').insert({
          tipo: entry.type,
          datos: entry.data,
          usuario_id: entry.user?.id,
          empresa_id: typeof empresaId !== 'undefined' ? empresaId : null,
          created_at: entry.timestamp
        }).single();
      }
    } catch (e) {
      // Silenciar error si la tabla no existe
      if (!e.message?.includes('relation') && !e.message?.includes('does not exist')) {
        console.warn('Audit server log failed:', e);
      }
    }
  },

  // Mostrar visor de auditoría
  showViewer() {
    const logs = this.getLocalLogs(50);

    const typeColors = {
      'auth.login': 'bg-green-100 text-green-700',
      'auth.logout': 'bg-slate-100 text-slate-700',
      'data.create': 'bg-blue-100 text-blue-700',
      'data.update': 'bg-amber-100 text-amber-700',
      'data.delete': 'bg-red-100 text-red-700',
      'report.export': 'bg-purple-100 text-purple-700',
      'error': 'bg-red-100 text-red-700'
    };

    const rows = logs.map(log => {
      const color = typeColors[log.type] || 'bg-slate-100 text-slate-700';
      const time = new Date(log.timestamp).toLocaleString('es-MX');
      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50">
          <td class="py-2 px-3 text-xs text-slate-500">${time}</td>
          <td class="py-2 px-3"><span class="px-2 py-1 rounded text-xs ${color}">${log.type}</span></td>
          <td class="py-2 px-3 text-xs text-slate-600">${log.user?.email || '-'}</td>
          <td class="py-2 px-3 text-xs text-slate-500 max-w-xs truncate">${JSON.stringify(log.data).substring(0, 100)}</td>
        </tr>
      `;
    }).join('');

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.innerHTML = `
      <div class="bg-white rounded-2xl p-6 max-w-4xl w-full mx-4 shadow-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-slate-800">
            <i class="ri-file-list-3-line mr-2 text-blue-500"></i>Registro de Auditoría
          </h3>
          <div class="flex gap-2">
            <button onclick="Audit.clearOldLogs(7);Toast.success('Logs antiguos eliminados');this.closest('.fixed').remove();Audit.showViewer();"
                    class="text-xs px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600">
              Limpiar +7 días
            </button>
            <button onclick="this.closest('.fixed').remove()" class="text-slate-400 hover:text-slate-600">
              <i class="ri-close-line text-xl"></i>
            </button>
          </div>
        </div>
        <div class="overflow-auto flex-1">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 sticky top-0">
              <tr>
                <th class="py-2 px-3 text-left text-xs font-medium text-slate-500">Fecha</th>
                <th class="py-2 px-3 text-left text-xs font-medium text-slate-500">Tipo</th>
                <th class="py-2 px-3 text-left text-xs font-medium text-slate-500">Usuario</th>
                <th class="py-2 px-3 text-left text-xs font-medium text-slate-500">Datos</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="4" class="py-8 text-center text-slate-400">Sin registros</td></tr>'}</tbody>
          </table>
        </div>
        <div class="mt-4 pt-4 border-t border-slate-200 text-xs text-slate-500 text-center">
          Mostrando ${logs.length} de ${this.getLocalLogs(1000).length} registros
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }
};

// ========== WRAPPER SEGURO PARA OPERACIONES DE BD ==========

const SecureDB = {
  // Insert con sanitización
  async insert(table, data) {
    if (!Security.checkRateLimit(`insert_${table}`, 20)) {
      throw new Error('Demasiadas solicitudes. Espera un momento.');
    }

    const sanitizedData = Security.sanitizeObject(data);

    try {
      const { data: result, error } = await sb.from(table).insert(sanitizedData).select().single();

      if (error) throw error;

      Audit.logCreate(table, result?.id, sanitizedData);
      return result;
    } catch (error) {
      Security.handleError(error, `insert ${table}`);
      throw error;
    }
  },

  // Update con sanitización
  async update(table, id, data) {
    if (!Security.checkRateLimit(`update_${table}`, 30)) {
      throw new Error('Demasiadas solicitudes. Espera un momento.');
    }

    const sanitizedData = Security.sanitizeObject(data);

    try {
      const { data: result, error } = await sb.from(table).update(sanitizedData).eq('id', id).select().single();

      if (error) throw error;

      Audit.logUpdate(table, id, sanitizedData);
      return result;
    } catch (error) {
      Security.handleError(error, `update ${table}`);
      throw error;
    }
  },

  // Delete con confirmación
  async delete(table, id) {
    if (!Security.checkRateLimit(`delete_${table}`, 10)) {
      throw new Error('Demasiadas solicitudes. Espera un momento.');
    }

    try {
      const { error } = await sb.from(table).delete().eq('id', id);

      if (error) throw error;

      Audit.logDelete(table, id);
      return true;
    } catch (error) {
      Security.handleError(error, `delete ${table}`);
      throw error;
    }
  }
};

// Función global para ver auditoría
function showAuditLog() {
  Audit.showViewer();
}

// Limpiar logs antiguos al cargar
Audit.clearOldLogs(30);

console.log('Security & Audit module loaded');
