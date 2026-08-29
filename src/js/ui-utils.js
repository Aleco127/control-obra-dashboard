/**
 * Utilidades de UI para Control de Obra
 * - Toast notifications
 * - Dialog (confirmaciones accesibles, sustituye confirm())
 * - EmptyState
 * - humanizeError (errores de Supabase/Postgres en español accionable)
 * - numeroALetras (importes con letra para recibos)
 * - Skeleton loaders
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
    this.container.setAttribute('role', 'status');
    this.container.setAttribute('aria-live', 'polite');
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
      success: 'bg-green-700',
      error: 'bg-red-700',
      warning: 'bg-amber-700',
      info: 'bg-blue-700'
    };

    const toast = document.createElement('div');
    toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-white transform translate-x-full transition-transform duration-300 ${colors[type]}`;
    toast.innerHTML = `
      <i class="${icons[type]} text-lg" aria-hidden="true"></i>
      <span class="text-sm font-medium">${message}</span>
      <button onclick="this.parentElement.remove()" class="ml-2 hover:opacity-70 min-w-[32px] min-h-[32px]" aria-label="Cerrar aviso">
        <i class="ri-close-line" aria-hidden="true"></i>
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
  error(message, duration) { return this.show(message, 'error', duration === undefined ? 5000 : duration); },
  warning(message, duration) { return this.show(message, 'warning', duration); },
  info(message, duration) { return this.show(message, 'info', duration); }
};

// ========== DIALOG (sustituye confirm()) ==========
// Uso: if(!await Dialog.confirm({title:'Eliminar obra', body:'Se borrarán...', confirmText:'Eliminar obra', tone:'danger'})) return;
const Dialog = {
  _el: null,
  _resolve: null,

  _ensure() {
    if (this._el) return this._el;
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.setAttribute('aria-labelledby', 'dlgTitle');
    d.setAttribute('aria-describedby', 'dlgText');
    d.innerHTML = `
      <div class="dlg-body">
        <div id="dlgIcon" class="dlg-icon default"><i class="ri-question-line" aria-hidden="true"></i></div>
        <h2 id="dlgTitle" class="dlg-title"></h2>
        <p id="dlgText" class="dlg-text"></p>
      </div>
      <div class="dlg-actions">
        <button type="button" id="dlgCancel" class="btn btn-s">Cancelar</button>
        <button type="button" id="dlgOk" class="btn btn-p">Confirmar</button>
      </div>`;
    document.body.appendChild(d);
    d.querySelector('#dlgCancel').addEventListener('click', () => this._close(false));
    d.querySelector('#dlgOk').addEventListener('click', () => this._close(true));
    // Clic fuera (en el backdrop)
    d.addEventListener('click', (e) => { if (e.target === d) this._close(false); });
    // Esc
    d.addEventListener('cancel', (e) => { e.preventDefault(); this._close(false); });
    this._el = d;
    return d;
  },

  _close(value) {
    const d = this._el;
    if (!d || !d.open) return;
    d.close();
    const r = this._resolve; this._resolve = null;
    if (r) r(value);
  },

  /**
   * @param {object|string} opts  {title, body, confirmText, cancelText, tone:'danger'|'default', icon}
   *                              o un string (se usa como body y se infiere el resto)
   * @returns {Promise<boolean>}
   */
  confirm(opts) {
    if (typeof opts === 'string') opts = Dialog.fromMessage(opts);
    const d = this._ensure();
    const tone = opts.tone === 'danger' ? 'danger' : 'default';
    d.querySelector('#dlgTitle').textContent = opts.title || 'Confirmar';
    d.querySelector('#dlgText').textContent = opts.body || '';
    const icon = d.querySelector('#dlgIcon');
    icon.className = 'dlg-icon ' + tone;
    icon.innerHTML = `<i class="${opts.icon || (tone === 'danger' ? 'ri-delete-bin-line' : 'ri-question-line')}" aria-hidden="true"></i>`;
    const ok = d.querySelector('#dlgOk');
    ok.textContent = opts.confirmText || 'Confirmar';
    ok.className = 'btn ' + (tone === 'danger' ? 'btn-danger' : 'btn-p');
    d.querySelector('#dlgCancel').textContent = opts.cancelText || 'Cancelar';
    return new Promise((resolve) => {
      this._resolve = resolve;
      if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
      // El foco inicial cae en Cancelar (la acción segura)
      d.querySelector('#dlgCancel').focus();
    });
  },

  /**
   * Convierte el texto de un confirm() clásico en {title, body, confirmText, tone}
   * "¿Eliminar este gasto?\n\nEsta acción no se puede deshacer." → título "Eliminar gasto", botón "Eliminar gasto"
   */
  fromMessage(msg) {
    const clean = String(msg || '').replace(/\r/g, '');
    const parts = clean.split(/\n+/).map(s => s.trim()).filter(Boolean);
    let first = (parts[0] || clean).trim();
    let rest = parts.slice(1).join('\n');
    // Si la primera línea trae contexto + pregunta ("El monto excede... ¿Continuar?"), la pregunta es el título
    const q = first.match(/^(.*?)(¿[^?]*\?)\s*$/);
    if (q && q[1].trim()) { rest = [q[1].trim(), rest].filter(Boolean).join('\n'); first = q[2]; }
    first = first.replace(/^¿/, '').replace(/\?$/, '').trim();
    const lower = first.toLowerCase();
    const danger = /elimin|borrar|cancelar|limpiar|desactivar|deshacer/.test(lower);
    // Título: la primera oración sin signos, acotada
    let title = first;
    if (title.length > 60) title = title.slice(0, 57) + '...';
    // Botón: verbo + objeto (primeras 3 palabras significativas)
    const verbMatch = first.match(/^(eliminar|archivar|aprobar|cambiar|crear|timbrar|marcar|continuar|limpiar|cerrar|desactivar|activar|está seguro de cancelar|cancelar)\b/i);
    let confirmText = 'Confirmar';
    if (verbMatch) {
      const verb = verbMatch[1].toLowerCase().startsWith('está') ? 'Cancelar' : verbMatch[1];
      // Objeto: sin comillas ni determinantes; hasta 2 palabras y se detiene en preposiciones
      const afterVerb = first.slice(verbMatch[0].length).replace(/"[^"]*"|'[^']*'/g, '').trim();
      const obj = afterVerb.replace(/^(a |el |la |los |las |este |esta |estos |estas |de |del |todos los |el estatus de )/i, '').split(/[\s,?]+/).filter(Boolean);
      let objWords = [];
      for (const w of obj) {
        if (objWords.length >= 2) break;
        if (/^(de|del|y|a|la|el|los|las|ante|en|con|como|seleccionad[oa]s?|registros?)$/i.test(w) && objWords.length) break;
        if (/^\d/.test(w)) continue;
        objWords.push(w);
      }
      confirmText = (verb.charAt(0).toUpperCase() + verb.slice(1).toLowerCase() + ' ' + objWords.join(' ')).trim();
      if (/^cerrar sesi/i.test(first)) confirmText = 'Cerrar sesión';
      if (/^continuar/i.test(first)) confirmText = 'Continuar';
    } else if (/¿continuar|continuar de todos modos/i.test(clean)) {
      confirmText = 'Continuar';
    }
    return { title, body: rest || (parts.length === 1 ? '' : clean), confirmText, tone: danger ? 'danger' : 'default' };
  }
};

// ========== EMPTY STATE ==========
// EmptyState({icon:'ri-building-2-line', title:'Aún no hay obras', body:'Crea la primera con el asistente.', action:{label:'Crear obra', onClick:'WizardObra.open()'}, secondary:{label:'Quitar filtro', onClick:'clearObraFilter()'}})
function EmptyState(o = {}) {
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const action = o.action ? `<button type="button" class="btn btn-p" onclick="${esc(o.action.onClick)}"><i class="${esc(o.action.icon || 'ri-add-line')}" aria-hidden="true"></i> ${esc(o.action.label)}</button>` : '';
  const secondary = o.secondary ? `<button type="button" class="btn btn-s" onclick="${esc(o.secondary.onClick)}">${esc(o.secondary.label)}</button>` : '';
  return `<div class="empty g rounded-xl" role="status">
    <i class="${esc(o.icon || 'ri-inbox-line')}" aria-hidden="true"></i>
    <p class="empty-title">${esc(o.title || 'Nada por aquí todavía')}</p>
    ${o.body ? `<p class="empty-body">${esc(o.body)}</p>` : ''}
    <div class="flex flex-wrap gap-2 justify-center">${action}${secondary}</div>
  </div>`;
}

// ========== ERRORES EN ESPAÑOL ==========
// Convierte errores de Supabase/PostgREST/red en un texto que dice qué falló y cómo corregirlo
function humanizeError(err, contexto) {
  if (!err) return 'Ocurrió un error desconocido. Intenta de nuevo.';
  const code = err.code || err.status || '';
  const msg = String(err.message || err.error_description || err.details || err || '');
  const ctx = contexto ? contexto + ': ' : '';
  const map = {
    '23505': 'Ya existe un registro con esos datos (clave o folio duplicado). Cambia el valor y vuelve a guardar.',
    '23503': 'El registro está vinculado a otros datos (por ejemplo cobros o actividades). Elimina primero lo relacionado o desvincúlalo.',
    '23502': 'Falta un dato obligatorio. Revisa los campos marcados con asterisco.',
    '23514': 'Un valor no cumple las reglas del sistema (por ejemplo un porcentaje fuera de 0 a 100). Corrígelo e intenta de nuevo.',
    '22P02': 'Un campo tiene un formato inválido (texto donde va número o fecha). Revisa los valores capturados.',
    '22003': 'Un importe es demasiado grande para el campo. Revisa las cantidades.',
    '42501': 'Tu usuario no tiene permiso para esta acción. Pide al administrador que lo habilite.',
    '42703': 'La base de datos no reconoce uno de los campos. Reporta este error al soporte técnico.',
    '428C9': 'Se intentó guardar una columna calculada (importe, subtotal o pendiente). Reporta este error al soporte técnico.',
    'PGRST116': 'No se encontró el registro. Puede que otra persona lo haya eliminado; actualiza la página.',
    'PGRST301': 'Tu sesión expiró. Vuelve a iniciar sesión.',
    '401': 'Tu sesión expiró. Vuelve a iniciar sesión.',
    '403': 'No tienes permiso para esta acción.',
    '404': 'No se encontró el recurso solicitado.',
    '409': 'Conflicto con datos existentes. Actualiza la página e intenta de nuevo.',
    '500': 'El servidor tuvo un problema. Espera unos segundos e intenta de nuevo.',
    '503': 'El servicio no está disponible en este momento. Intenta más tarde.'
  };
  if (map[String(code)]) return ctx + map[String(code)];
  const low = msg.toLowerCase();
  if (/failed to fetch|networkerror|network request failed|load failed|err_internet/.test(low)) return ctx + 'Sin conexión a internet. Tus datos no se enviaron; revisa la señal e intenta de nuevo.';
  if (/timeout|timed out/.test(low)) return ctx + 'El servidor tardó demasiado en responder. Intenta de nuevo.';
  if (/jwt|token|sesi[oó]n/.test(low)) return ctx + 'Tu sesión expiró. Vuelve a iniciar sesión.';
  if (/duplicate key|already exists/.test(low)) return ctx + map['23505'];
  if (/violates foreign key/.test(low)) return ctx + map['23503'];
  if (/null value in column/.test(low)) return ctx + map['23502'];
  if (/generated column/.test(low)) return ctx + map['428C9'];
  if (/permission denied|row-level security/.test(low)) return ctx + map['42501'];
  if (/invalid input syntax/.test(low)) return ctx + map['22P02'];
  // Fallback: mensaje original acotado, en tono claro
  const short = msg.length > 140 ? msg.slice(0, 137) + '...' : msg;
  return ctx + 'No se pudo completar la acción. Detalle: ' + short;
}

// ========== NÚMERO A LETRAS (MXN) ==========
// numeroALetras(85320.95) → "OCHENTA Y CINCO MIL TRESCIENTOS VEINTE PESOS 95/100 M.N."
function numeroALetras(num, moneda = 'PESOS', fraccion = 'M.N.') {
  const n = Math.round((Number(num) || 0) * 100) / 100;
  const entero = Math.floor(Math.abs(n));
  const centavos = Math.round((Math.abs(n) - entero) * 100);
  const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIÚN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  function tresCifras(x) {
    if (x === 0) return '';
    if (x === 100) return 'CIEN';
    const c = Math.floor(x / 100), r = x % 100;
    let s = CENTENAS[c];
    if (r > 0) {
      if (r < 30) s += (s ? ' ' : '') + UNIDADES[r];
      else {
        const d = Math.floor(r / 10), u = r % 10;
        s += (s ? ' ' : '') + DECENAS[d] + (u ? ' Y ' + UNIDADES[u] : '');
      }
    }
    return s;
  }
  function seccion(x, singular, plural) {
    if (x === 0) return '';
    if (x === 1) return singular;
    return tresCifras(x) + ' ' + plural;
  }
  function convertir(x) {
    if (x === 0) return 'CERO';
    const millones = Math.floor(x / 1000000);
    const miles = Math.floor((x % 1000000) / 1000);
    const resto = x % 1000;
    const partes = [];
    if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : tresCifras(millones) + ' MILLONES');
    if (miles) partes.push(miles === 1 ? 'MIL' : tresCifras(miles) + ' MIL');
    if (resto) partes.push(tresCifras(resto));
    return partes.join(' ').replace(/\s+/g, ' ').trim();
  }
  let letras = convertir(entero);
  // "UN" → "UNO" al final de la cantidad (UNO PESOS no se usa; en pesos mexicanos se escribe "UN PESO")
  const monedaTxt = entero === 1 ? moneda.replace(/S$/, '') : moneda;
  if (entero >= 1000000 && entero % 1000000 === 0) letras += ' DE';
  return `${n < 0 ? 'MENOS ' : ''}${letras} ${monedaTxt} ${String(centavos).padStart(2, '0')}/100 ${fraccion}`.replace(/\s+/g, ' ').trim();
}

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
    input.setAttribute('aria-invalid', 'true');

    // Remover error previo
    const prevError = input.parentElement.querySelector('.field-error');
    if (prevError) prevError.remove();

    // Agregar nuevo error
    const errorEl = document.createElement('p');
    errorEl.className = 'field-error text-xs text-red-500 mt-1';
    errorEl.setAttribute('role', 'alert');
    errorEl.textContent = message;
    input.parentElement.appendChild(errorEl);
  },

  // Limpiar error de campo
  clearError(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.classList.remove('border-red-500');
    input.removeAttribute('aria-invalid');
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
          message = rule.message || 'Este campo es obligatorio';
        } else if (rule.type === 'email' && value && !this.email(value)) {
          valid = false;
          message = rule.message || 'Escribe un correo válido, por ejemplo nombre@empresa.com';
        } else if (rule.type === 'rfc' && value && !this.rfc(value)) {
          valid = false;
          message = rule.message || 'El RFC debe tener 12 o 13 caracteres, por ejemplo XAXX010101000';
        } else if (rule.type === 'phone' && value && !this.phone(value)) {
          valid = false;
          message = rule.message || 'El teléfono debe tener 10 dígitos';
        } else if (rule.type === 'minLength' && !this.minLength(value, rule.min)) {
          valid = false;
          message = rule.message || `Escribe al menos ${rule.min} caracteres`;
        } else if (rule.type === 'positiveNumber' && value && !this.positiveNumber(value)) {
          valid = false;
          message = rule.message || 'Debe ser un número mayor o igual a cero';
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
      const key = this.getKeyCombo(e);
      // Ctrl+K siempre disponible (paleta de comandos), incluso dentro de un input
      if (key !== 'ctrl+k' && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
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
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center';
    modal.style.zIndex = 'var(--z-modal)';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Atajos de teclado');
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `
      <div class="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-slate-800"><i class="ri-keyboard-line mr-2" aria-hidden="true"></i>Atajos de teclado</h3>
          <button onclick="this.closest('.fixed').remove()" class="btn-icon" aria-label="Cerrar"><i class="ri-close-line text-xl" aria-hidden="true"></i></button>
        </div>
        <table class="w-full">${shortcuts}</table>
        <p class="text-xs text-slate-500 mt-4 text-center">Presiona <kbd class="px-1 bg-slate-100 rounded">?</kbd> para ver esta ayuda</p>
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
      Toast.error('No se pudo copiar. Selecciona el texto y usa Ctrl+C.');
      return false;
    }
  },

  // Confirmar acción (compatibilidad: delega en Dialog)
  confirm(message, onConfirm, onCancel) {
    Dialog.confirm(message).then(ok => { if (ok) onConfirm && onConfirm(); else onCancel && onCancel(); });
  }
};

console.log('UI Utils loaded');
