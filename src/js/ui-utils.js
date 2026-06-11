/**
 * Utilidades de UI para Control de Obra
 * - Skeleton loaders
 * - Toast notifications
 * - Validaciones
 * - Atajos de teclado
 */

// ========== TOAST NOTIFICATIONS ==========
const Toast = {
  container: null,

  init() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.id = 'toastContainer';
    this.container.className = 'fixed bottom-4 right-4 z-[9999] flex flex-col gap-2';
    document.body.appendChild(this.container);
  },

  show(message, type = 'info', duration = 3000) {
    this.init();

    const icons = {
      success: 'ri-check-line',
      error: 'ri-error-warning-line',
      warning: 'ri-alert-line',
      info: 'ri-information-line'
    };

    const colors = {
      success: 'bg-green-500',
      error: 'bg-red-500',
      warning: 'bg-amber-500',
      info: 'bg-blue-500'
    };

    const toast = document.createElement('div');
    toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-white transform translate-x-full transition-transform duration-300 ${colors[type]}`;
    toast.innerHTML = `
      <i class="${icons[type]} text-lg"></i>
      <span class="text-sm font-medium">${message}</span>
      <button onclick="this.parentElement.remove()" class="ml-2 hover:opacity-70">
        <i class="ri-close-line"></i>
      </button>
    `;

    this.container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.remove('translate-x-full');
    });

    // Auto remove
    if (duration > 0) {
      setTimeout(() => {
        toast.classList.add('translate-x-full');
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }

    return toast;
  },

  success(message, duration) { return this.show(message, 'success', duration); },
  error(message, duration) { return this.show(message, 'error', duration); },
  warning(message, duration) { return this.show(message, 'warning', duration); },
  info(message, duration) { return this.show(message, 'info', duration); }
};

// ========== SKELETON LOADERS ==========
const Skeleton = {
  // Generar skeleton para cards de dashboard
  cards(count = 4) {
    return Array(count).fill(0).map(() => `
      <div class="card p-4 animate-pulse">
        <div class="flex items-center justify-between mb-3">
          <div class="w-10 h-10 bg-slate-200 rounded-xl"></div>
          <div class="w-16 h-4 bg-slate-200 rounded"></div>
        </div>
        <div class="w-24 h-8 bg-slate-200 rounded mb-2"></div>
        <div class="w-32 h-3 bg-slate-200 rounded"></div>
      </div>
    `).join('');
  },

  // Skeleton para tabla
  table(rows = 5, cols = 4) {
    const header = `<div class="flex gap-4 p-3 border-b border-slate-200">
      ${Array(cols).fill(0).map(() => '<div class="flex-1 h-4 bg-slate-200 rounded"></div>').join('')}
    </div>`;

    const rowsHtml = Array(rows).fill(0).map(() => `
      <div class="flex gap-4 p-3 border-b border-slate-100">
        ${Array(cols).fill(0).map(() => '<div class="flex-1 h-4 bg-slate-200 rounded animate-pulse"></div>').join('')}
      </div>
    `).join('');

    return `<div class="card overflow-hidden">${header}${rowsHtml}</div>`;
  },

  // Skeleton para lista
  list(count = 5) {
    return `<div class="card divide-y divide-slate-100">
      ${Array(count).fill(0).map(() => `
        <div class="p-4 flex items-center gap-4 animate-pulse">
          <div class="w-10 h-10 bg-slate-200 rounded-full"></div>
          <div class="flex-1">
            <div class="w-32 h-4 bg-slate-200 rounded mb-2"></div>
            <div class="w-48 h-3 bg-slate-200 rounded"></div>
          </div>
          <div class="w-16 h-6 bg-slate-200 rounded-full"></div>
        </div>
      `).join('')}
    </div>`;
  },

  // Skeleton para chart
  chart() {
    return `
      <div class="card p-4 animate-pulse">
        <div class="flex items-center justify-between mb-4">
          <div class="w-32 h-5 bg-slate-200 rounded"></div>
          <div class="w-20 h-8 bg-slate-200 rounded"></div>
        </div>
        <div class="h-64 bg-slate-100 rounded-lg flex items-end justify-around p-4">
          ${Array(7).fill(0).map(() => `<div class="w-8 bg-slate-200 rounded-t" style="height:${Math.random()*80+20}%"></div>`).join('')}
        </div>
      </div>
    `;
  },

  // Skeleton para detalle de obra
  obraDetail() {
    return `
      <div class="animate-pulse">
        <div class="flex items-center gap-4 mb-6">
          <div class="w-16 h-16 bg-slate-200 rounded-xl"></div>
          <div>
            <div class="w-48 h-6 bg-slate-200 rounded mb-2"></div>
            <div class="w-32 h-4 bg-slate-200 rounded"></div>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          ${Array(3).fill(0).map(() => '<div class="h-24 bg-slate-200 rounded-xl"></div>').join('')}
        </div>
        <div class="h-64 bg-slate-200 rounded-xl"></div>
      </div>
    `;
  }
};

// ========== FORM VALIDATION ==========
const Validate = {
  // Validar email
  email(value) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(value);
  },

  // Validar RFC mexicano
  rfc(value) {
    const regex = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/i;
    return regex.test(value);
  },

  // Validar teléfono mexicano
  phone(value) {
    const cleaned = value.replace(/\D/g, '');
    return cleaned.length === 10;
  },

  // Validar número positivo
  positiveNumber(value) {
    const num = parseFloat(value);
    return !isNaN(num) && num >= 0;
  },

  // Validar campo requerido
  required(value) {
    return value !== null && value !== undefined && value.toString().trim() !== '';
  },

  // Validar longitud mínima
  minLength(value, min) {
    return value && value.length >= min;
  },

  // Validar fecha no en el pasado
  futureDate(value) {
    const date = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date >= today;
  },

  // Mostrar error en campo
  showError(inputId, message) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.classList.add('border-red-500');

    // Remover error previo
    const prevError = input.parentElement.querySelector('.field-error');
    if (prevError) prevError.remove();

    // Agregar nuevo error
    const errorEl = document.createElement('p');
    errorEl.className = 'field-error text-xs text-red-500 mt-1';
    errorEl.textContent = message;
    input.parentElement.appendChild(errorEl);
  },

  // Limpiar error de campo
  clearError(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.classList.remove('border-red-500');
    const error = input.parentElement.querySelector('.field-error');
    if (error) error.remove();
  },

  // Validar formulario completo
  form(formId, rules) {
    let isValid = true;

    for (const [fieldId, fieldRules] of Object.entries(rules)) {
      const input = document.getElementById(fieldId);
      if (!input) continue;

      const value = input.value;
      this.clearError(fieldId);

      for (const rule of fieldRules) {
        let valid = true;
        let message = '';

        if (rule.type === 'required' && !this.required(value)) {
          valid = false;
          message = rule.message || 'Este campo es requerido';
        } else if (rule.type === 'email' && value && !this.email(value)) {
          valid = false;
          message = rule.message || 'Email inválido';
        } else if (rule.type === 'rfc' && value && !this.rfc(value)) {
          valid = false;
          message = rule.message || 'RFC inválido';
        } else if (rule.type === 'phone' && value && !this.phone(value)) {
          valid = false;
          message = rule.message || 'Teléfono inválido (10 dígitos)';
        } else if (rule.type === 'minLength' && !this.minLength(value, rule.min)) {
          valid = false;
          message = rule.message || `Mínimo ${rule.min} caracteres`;
        } else if (rule.type === 'positiveNumber' && value && !this.positiveNumber(value)) {
          valid = false;
          message = rule.message || 'Debe ser un número positivo';
        }

        if (!valid) {
          this.showError(fieldId, message);
          isValid = false;
          break;
        }
      }
    }

    return isValid;
  }
};

// ========== KEYBOARD SHORTCUTS ==========
const Shortcuts = {
  registered: {},

  init() {
    document.addEventListener('keydown', (e) => {
      // Ignorar si está escribiendo en un input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      const key = this.getKeyCombo(e);
      const handler = this.registered[key];

      if (handler) {
        e.preventDefault();
        handler();
      }
    });
  },

  getKeyCombo(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    parts.push(e.key.toLowerCase());
    return parts.join('+');
  },

  register(combo, handler, description) {
    this.registered[combo.toLowerCase()] = handler;
    // Guardar descripción para mostrar ayuda
    if (!this._descriptions) this._descriptions = {};
    this._descriptions[combo] = description;
  },

  unregister(combo) {
    delete this.registered[combo.toLowerCase()];
  },

  // Mostrar ayuda de atajos
  showHelp() {
    if (!this._descriptions) return;

    const shortcuts = Object.entries(this._descriptions)
      .map(([key, desc]) => `<tr><td class="pr-4 py-1"><kbd class="px-2 py-1 bg-slate-100 rounded text-xs font-mono">${key}</kbd></td><td class="text-sm text-slate-600">${desc}</td></tr>`)
      .join('');

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `
      <div class="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-slate-800"><i class="ri-keyboard-line mr-2"></i>Atajos de Teclado</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-slate-400 hover:text-slate-600"><i class="ri-close-line text-xl"></i></button>
        </div>
        <table class="w-full">${shortcuts}</table>
        <p class="text-xs text-slate-400 mt-4 text-center">Presiona <kbd class="px-1 bg-slate-100 rounded">?</kbd> para ver esta ayuda</p>
      </div>
    `;
    document.body.appendChild(modal);
  }
};

// Inicializar shortcuts
Shortcuts.init();

// ========== UTILITY FUNCTIONS ==========
const UIUtils = {
  // Formatear moneda mexicana
  formatMoney(amount) {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount || 0);
  },

  // Formatear fecha
  formatDate(date, format = 'short') {
    if (!date) return '-';
    const d = new Date(date);
    if (format === 'short') {
      return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
    } else if (format === 'long') {
      return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } else if (format === 'relative') {
      const now = new Date();
      const diff = now - d;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      if (days === 0) return 'Hoy';
      if (days === 1) return 'Ayer';
      if (days < 7) return `Hace ${days} días`;
      if (days < 30) return `Hace ${Math.floor(days / 7)} semanas`;
      return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
    }
    return d.toLocaleDateString('es-MX');
  },

  // Formatear porcentaje
  formatPercent(value, decimals = 0) {
    return `${(value || 0).toFixed(decimals)}%`;
  },

  // Truncar texto
  truncate(text, length = 50) {
    if (!text || text.length <= length) return text;
    return text.substring(0, length) + '...';
  },

  // Debounce function
  debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Copiar al portapapeles
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      Toast.success('Copiado al portapapeles');
      return true;
    } catch (e) {
      Toast.error('Error al copiar');
      return false;
    }
  },

  // Confirmar acción
  confirm(message, onConfirm, onCancel) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <div class="text-center mb-4">
          <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-amber-100 flex items-center justify-center">
            <i class="ri-alert-line text-2xl text-amber-600"></i>
          </div>
          <p class="text-slate-700">${message}</p>
        </div>
        <div class="flex gap-3">
          <button id="confirmCancel" class="flex-1 py-2 px-4 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Cancelar</button>
          <button id="confirmOk" class="flex-1 py-2 px-4 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">Confirmar</button>
        </div>
      </div>
    `;

    modal.querySelector('#confirmCancel').onclick = () => {
      modal.remove();
      onCancel && onCancel();
    };

    modal.querySelector('#confirmOk').onclick = () => {
      modal.remove();
      onConfirm && onConfirm();
    };

    document.body.appendChild(modal);
  }
};

console.log('UI Utils loaded');
