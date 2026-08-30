// Suscripción y planes (US-212 a US-218): estado de la prueba, límites del plan, pantalla Configuración › Plan,
// pago con Openpay y facturas. Depende de: sb, currentUser, D, S, fmt, Toast, Dialog, setReadOnly, Telemetry, SB.
const Suscripcion = (() => {
  let info = null; // {plan, sub, uso, planes}
  const FEATURE_MODULO = { so: 'socios', ci: 'cierres' };
  const FEATURE_LABEL = { socios: 'Socios y reparto de utilidades', cierres: 'Cierre mensual', portal: 'Portal del cliente', cfdi_emision: 'Facturación electrónica', conciliacion: 'Conciliación bancaria', export_contable: 'Exportación contable', advanced_reports: 'Reportes avanzados' };
  const fecha = (iso) => iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const dias = (iso) => iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000) : null;

  async function cargar() {
    try {
      const { data, error } = await sb.rpc('get_mi_plan');
      if (error) throw error;
      info = data; D.plan = data;
      aplicarEstado();
    } catch (e) { console.warn('get_mi_plan', e); }
    return info;
  }
  const get = () => info;
  const feature = (f) => !!(info && info.plan && info.plan.features && info.plan.features[f]);
  const moduloPermitido = (key) => { const f = FEATURE_MODULO[key]; return f ? feature(f) : true; };

  function aplicarEstado() {
    if (!info || !currentUser) return;
    const s = info.sub || {}; const nivel = currentUser.nivel || 0;
    const cta = nivel >= 100 ? '<button type="button" class="btn btn-p text-xs" onclick="Suscripcion.irAPlan()"><i class="ri-vip-crown-line" aria-hidden="true"></i> Elegir plan</button>' : '';
    let old = $('subBanner'); if (old) old.remove();
    if (s.estado === 'lectura' || s.estado === 'cancelada') {
      setReadOnly(true, 'suscripción vencida', `<span><i class="ri-lock-line" aria-hidden="true"></i> Tu prueba terminó y la cuenta está en modo lectura. Tus datos siguen aquí; elige un plan para seguir capturando.</span>${cta}`);
      return;
    }
    if (String(window.READ_ONLY_MOTIVO).startsWith('suscripci')) setReadOnly(false);
    let html = '', tone = 'info';
    if (s.estado === 'trial') {
      const d = dias(s.trial_ends_at);
      if (d !== null && d <= 10) { html = `<span><i class="ri-time-line" aria-hidden="true"></i> Prueba gratuita: ${d > 0 ? `quedan <strong>${d} día${d === 1 ? '' : 's'}</strong>` : 'termina hoy'} (hasta el ${fecha(s.trial_ends_at)}).</span>${cta}`; tone = d <= 3 ? 'warn' : 'info'; }
    } else if (s.estado === 'vencida') {
      html = `<span><i class="ri-alert-line" aria-hidden="true"></i> Tu prueba terminó. Tienes hasta el <strong>${fecha(s.gracia_hasta)}</strong> para elegir un plan antes de que la cuenta pase a modo lectura.</span>${cta}`; tone = 'warn';
    } else if (s.estado === 'pago_fallido') {
      html = `<span><i class="ri-bank-card-line" aria-hidden="true"></i> No pudimos cobrar tu suscripción. Actualiza tu tarjeta antes del <strong>${fecha(s.gracia_hasta)}</strong>.</span>${nivel >= 100 ? '<button type="button" class="btn btn-p text-xs" onclick="Suscripcion.irAPlan()">Actualizar tarjeta</button>' : ''}`; tone = 'warn';
    }
    if (!html) return;
    const bar = document.createElement('div'); bar.id = 'subBanner'; bar.setAttribute('role', 'status');
    bar.className = 'px-4 py-2 text-sm flex flex-wrap items-center gap-2 justify-between';
    bar.style.cssText = tone === 'warn' ? 'background:var(--warn-soft,#fef3c7);color:var(--warn,#b45309);border-bottom:1px solid var(--warn,#b45309)' : 'background:var(--info-soft,#e0f2fe);color:var(--info,#075985);border-bottom:1px solid var(--info,#075985)';
    bar.innerHTML = html;
    const main = $('main'); if (main) main.parentNode.insertBefore(bar, main);
  }

  function irAPlan() { M = 'z'; R(); setTimeout(() => { const el = $('cfgPlan'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 300); }

  // Intercepta errores PLAN_LIMIT / SUBSCRIPTION_INACTIVE de cualquier RPC
  function manejarError(err) {
    const msg = String((err && err.message) || err || '');
    if (msg.includes('PLAN_LIMIT:')) {
      let d = {}; try { d = JSON.parse(msg.slice(msg.indexOf('PLAN_LIMIT:') + 11)); } catch (e) {}
      mostrarLimite(d); return true;
    }
    if (msg.includes('SUBSCRIPTION_INACTIVE')) { Toast.warning(msg.replace('SUBSCRIPTION_INACTIVE: ', ''), 6000); return true; }
    return false;
  }
  const NOMBRE_RECURSO = { obras_activas: 'obras activas', obras: 'obras activas', usuarios: 'usuarios', storage_mb: 'MB de almacenamiento' };
  async function mostrarLimite(d) {
    const recurso = NOMBRE_RECURSO[d.resource] || (d.resource || '').replace('feature:', '');
    const esFeature = String(d.resource || '').startsWith('feature:');
    const titulo = esFeature ? 'Esta función no está en tu plan' : `Llegaste al límite de ${recurso}`;
    const cuerpo = esFeature
      ? `<p class="mb-2"><strong>${S(FEATURE_LABEL[recurso] || recurso)}</strong> está disponible en los planes Estudio o Constructora. Tu plan actual es <strong>${S(d.plan || '')}</strong>.</p>`
      : `<p class="mb-2">Tu plan <strong>${S(d.plan || '')}</strong> incluye <strong>${d.limit}</strong> ${S(recurso)} y ya usas <strong>${d.used}</strong>.</p><p class="text-xs text-slate-600">Puedes archivar obras terminadas o desactivar usuarios para liberar espacio, o ampliar el plan.</p>`;
    if (typeof Telemetry !== 'undefined') Telemetry.track('plan_limit', { resource: d.resource, plan: d.plan_slug });
    const ok = await Dialog.confirm({ title: titulo, bodyHtml: cuerpo, confirmText: 'Ver planes', cancelText: 'Ahora no', icon: 'ri-vip-crown-line' });
    if (ok) irAPlan();
  }
  async function verificarFeature(f) {
    if (feature(f)) return true;
    await mostrarLimite({ resource: 'feature:' + f, plan: info && info.plan ? info.plan.nombre : '' });
    return false;
  }

  // ---------- Configuración › Plan ----------
  function barra(label, used, limit, unidad) {
    const ilim = limit === null || limit === undefined || limit < 0;
    const pct = ilim ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
    const color = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warn)' : 'var(--ok)';
    return `<div class="mb-2"><div class="flex justify-between text-xs"><span>${S(label)}</span><span class="tabular-nums">${used}${unidad || ''} de ${ilim ? 'ilimitado' : limit + (unidad || '')}</span></div><div class="h-2 rounded-full mt-1" style="background:var(--surface-2,#f1f5f9)"><div class="h-2 rounded-full" style="width:${ilim ? 100 : pct}%;background:${ilim ? 'var(--ok)' : color};opacity:${ilim ? .35 : 1}"></div></div></div>`;
  }
  function estadoTexto(s) {
    switch (s.estado) {
      case 'trial': return `Prueba gratuita hasta el ${fecha(s.trial_ends_at)}`;
      case 'activa': return `Activa · siguiente cobro el ${fecha(s.current_period_end) || 'por definir'}${s.card_last4 ? ` · ${S(s.card_brand || 'tarjeta')} terminada en ${S(s.card_last4)}` : ''}`;
      case 'cortesia': return 'Cortesía de Supernova Arquitectos (sin cobro)';
      case 'vencida': return `Prueba terminada · modo lectura a partir del ${fecha(s.gracia_hasta)}`;
      case 'pago_fallido': return `Cobro rechazado · modo lectura a partir del ${fecha(s.gracia_hasta)}`;
      case 'lectura': return 'Modo lectura: elige un plan para volver a capturar';
      case 'cancelada': return 'Cancelada';
      default: return s.estado || 'Sin suscripción';
    }
  }
  function html() {
    if (!info) return '<div class="g rounded-xl p-4" id="cfgPlan"><p class="text-sm text-slate-600">Cargando plan…</p></div>';
    const p = info.plan, s = info.sub || {}, u = info.uso || {}; const nivel = currentUser.nivel || 0;
    const planes = (info.planes || []).map((pl) => {
      const actual = pl.slug === p.slug && !['lectura', 'cancelada', 'vencida'].includes(s.estado);
      const f = pl.features || {};
      const incluye = [`${pl.max_obras < 0 ? 'Obras ilimitadas' : pl.max_obras + ' obra' + (pl.max_obras === 1 ? '' : 's') + ' activa' + (pl.max_obras === 1 ? '' : 's')}`, `${pl.max_usuarios} usuario${pl.max_usuarios === 1 ? '' : 's'}`, `${pl.max_storage_mb >= 1024 ? (pl.max_storage_mb / 1024) + ' GB' : pl.max_storage_mb + ' MB'} de archivos`]
        .concat(Object.keys(FEATURE_LABEL).filter((k) => f[k]).map((k) => FEATURE_LABEL[k]));
      return `<div class="rounded-xl p-4 border flex flex-col" style="border-color:${actual ? 'var(--accent)' : 'var(--line)'};background:${actual ? 'var(--accent-soft)' : 'var(--surface)'}">
        <div class="flex items-baseline justify-between"><h4 class="font-bold">${S(pl.nombre)}</h4>${actual ? '<span class="chip">Tu plan</span>' : ''}</div>
        <p class="text-2xl font-bold mt-1 tabular-nums">${pl.precio_mensual > 0 ? fmt(pl.precio_mensual) : 'Gratis'}<span class="text-xs font-normal text-slate-600">${pl.precio_mensual > 0 ? ' /mes + IVA' : ''}</span></p>
        ${pl.precio_anual > 0 ? `<p class="text-xs text-slate-600">o ${fmt(pl.precio_anual)} al año (2 meses gratis)</p>` : ''}
        <p class="text-xs text-slate-600 mt-2">${S(pl.descripcion || '')}</p>
        <ul class="text-xs mt-2 space-y-1 flex-1">${incluye.map((i) => `<li><i class="ri-check-line" aria-hidden="true" style="color:var(--ok)"></i> ${S(i)}</li>`).join('')}</ul>
        ${nivel >= 100 && !actual ? `<button type="button" class="btn ${pl.precio_mensual > 0 ? 'btn-p' : 'btn-s'} w-full mt-3 text-sm" onclick="Suscripcion.elegir('${S(pl.slug)}')">${pl.precio_mensual > 0 ? 'Elegir ' + S(pl.nombre) : 'Cambiar a Gratis'}</button>` : ''}
      </div>`;
    }).join('');
    return `<div class="g rounded-xl p-4" id="cfgPlan">
      <div class="flex items-center justify-between mb-2"><h3 class="font-bold text-sm"><i class="ri-vip-crown-line n" aria-hidden="true"></i> Plan y suscripción</h3>${s.estado === 'activa' && nivel >= 100 ? '<button type="button" class="text-xs link" onclick="Suscripcion.cancelar()">Cancelar suscripción</button>' : ''}</div>
      <p class="text-sm"><strong>${S(p.nombre)}</strong> · ${S(estadoTexto(s))}</p>
      <div class="mt-3 grid md:grid-cols-3 gap-3">${barra('Obras activas', u.obras_activas || 0, p.max_obras)}${barra('Usuarios', u.usuarios || 0, p.max_usuarios)}${barra('Archivos', u.storage_mb || 0, p.max_storage_mb, ' MB')}</div>
      <div class="grid md:grid-cols-3 gap-3 mt-4">${planes}</div>
      <div id="subFacturas" class="mt-4"></div>
    </div>`;
  }

  // ---------- Pago (US-215): se completa con Openpay ----------
  async function elegir(slug) {
    const pl = (info.planes || []).find((x) => x.slug === slug); if (!pl) return;
    if (pl.precio_mensual === 0) {
      const ok = await Dialog.confirm({ title: 'Cambiar al plan Gratis', body: 'El plan Gratis permite 1 obra activa y 2 usuarios. Si hoy usas más, la app quedará en modo lectura hasta que archives obras o desactives usuarios. El cambio aplica al terminar tu periodo actual.', confirmText: 'Cambiar a Gratis', tone: 'danger' });
      if (!ok) return;
      const { data, error } = await sb.rpc('cambiar_plan_gratis');
      if (error || !data || !data.success) { Toast.error((data && data.error) || humanizeError(error, 'cambiar de plan')); return; }
      Toast.success('Listo: pasarás al plan Gratis al terminar tu periodo actual.'); await cargar(); if (M === 'z') R();
      return;
    }
    if (typeof Suscripcion.checkout === 'function') return Suscripcion.checkout(pl);
    Toast.info('El pago con tarjeta se activa en unos días. Escríbenos por WhatsApp para contratar.');
  }
  async function cancelar() {
    const ok = await Dialog.confirm({ title: 'Cancelar suscripción', body: 'Seguirás con todas las funciones hasta el fin del periodo pagado; después la cuenta pasa al plan Gratis. Puedes reactivar cuando quieras.', confirmText: 'Cancelar al fin del periodo', tone: 'danger' });
    if (!ok) return;
    const { data, error } = await sb.rpc('cancelar_suscripcion');
    if (error || !data || !data.success) { Toast.error((data && data.error) || humanizeError(error, 'cancelar')); return; }
    Toast.success('Suscripción cancelada al fin del periodo.'); await cargar(); if (M === 'z') R();
  }

  return { cargar, get, feature, moduloPermitido, aplicarEstado, irAPlan, manejarError, mostrarLimite, verificarFeature, html, elegir, cancelar, FEATURE_LABEL };
})();
