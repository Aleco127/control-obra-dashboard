// Onboarding (US-219 a US-222): asistente de primer ingreso, obra de ejemplo, checklist de activación y recorrido.
// Depende de: sb, currentUser, D, S, Toast, Dialog, WizardObra, Telemetry, M, R, L, EmptyState.
const Onboarding = (() => {
  let estado = null;
  const PASOS_TOUR = [
    { sel: '#nv', titulo: 'Tu menú', texto: 'Aquí están los módulos: obras, compras y gastos, pagos, socios y configuración. En el celular aparece abajo.' },
    { sel: '[data-key="o"], a[href="#o"]', titulo: 'Obras', texto: 'Cada obra tiene su ficha 360: presupuesto, programa por semanas, cobros y el resultado real con semáforo.' },
    { sel: '[data-key="g"], a[href="#g"]', titulo: 'Compras y gastos', texto: 'Captura gastos con la foto del ticket desde el celular; la app sugiere categoría y destino y puedes pedir la factura por WhatsApp.' },
    { sel: '[data-key="pc"], a[href="#pc"]', titulo: 'Pagos', texto: 'Cobros de clientes, pagos a proveedores, flujo de caja real y conciliación con tu banco.' },
    { sel: '[data-key="so"], a[href="#so"]', titulo: 'Socios', texto: 'Cuenta corriente de cada socio y reparto de utilidades con acta. Disponible en Estudio y Constructora.' },
  ];

  async function cargar() {
    try { const { data, error } = await sb.rpc('get_activacion'); if (!error) estado = data; } catch (e) {}
    return estado;
  }

  // ---------- Asistente de primer ingreso (3 pasos) ----------
  async function iniciar() {
    if (!currentUser || (currentUser.nivel || 0) < 100) return;
    await cargar();
    if (!estado || estado.onboarding_completado_at || estado.obra) return;
    if (sessionStorage.getItem('onboardingVisto')) return;
    sessionStorage.setItem('onboardingVisto', '1');
    Telemetry.track('onboarding_paso', { paso: 0 });
    paso1();
  }
  async function paso1() {
    const ok = await Dialog.confirm({ title: `Bienvenido, ${S(currentUser.nombre.split(' ')[0])}`, icon: 'ri-hand-heart-line', confirmText: 'Continuar', cancelText: 'Saltar',
      bodyHtml: `<p class="mb-3">Tres pasos y estás listo para tu primera obra. ¿A qué se dedica <strong>${S(currentUser.empresa_nombre || 'tu empresa')}</strong>?</p>
      <div class="grid gap-2">
        <label class="seg-btn cursor-pointer"><input type="radio" name="obGiro" value="despacho" checked> Despacho de arquitectura o diseño</label>
        <label class="seg-btn cursor-pointer"><input type="radio" name="obGiro" value="constructora"> Constructora</label>
        <label class="seg-btn cursor-pointer"><input type="radio" name="obGiro" value="contratista"> Contratista o remodelaciones</label>
      </div>` });
    const giro = (document.querySelector('input[name=obGiro]:checked') || {}).value || 'despacho';
    await sb.rpc('marcar_onboarding', { p_giro: giro, p_completado: !ok });
    Telemetry.track('onboarding_paso', { paso: 1, saltado: !ok, giro });
    if (!ok) return;
    paso2(giro);
  }
  async function paso2(giro) {
    const ok = await Dialog.confirm({ title: '¿Hay socios que se reparten utilidades?', icon: 'ri-user-star-line', confirmText: 'Guardar socios', cancelText: 'No por ahora',
      bodyHtml: `<p class="mb-2 text-sm">Con los socios y su porcentaje la app calcula cuánto le toca a cada quien en cada obra. Puedes cambiarlo después en Socios.</p>
      <div class="grid grid-cols-[1fr_80px] gap-2"><input id="obS1" class="inp" placeholder="Nombre del socio 1" value="${S(currentUser.nombre)}"><input id="obP1" class="inp" type="number" min="0" max="100" value="50" aria-label="Porcentaje socio 1"></div>
      <div class="grid grid-cols-[1fr_80px] gap-2 mt-2"><input id="obS2" class="inp" placeholder="Nombre del socio 2"><input id="obP2" class="inp" type="number" min="0" max="100" value="50" aria-label="Porcentaje socio 2"></div>` });
    if (ok) {
      const socios = [[$('obS1').value, $('obP1').value], [$('obS2').value, $('obP2').value]].filter((s) => s[0] && s[0].trim());
      const suma = socios.reduce((a, s) => a + Number(s[1] || 0), 0);
      if (socios.length && suma <= 100) {
        for (const [nombre, pct] of socios) await sb.from('socios').insert({ empresa_id: currentUser.empresa_id, nombre: nombre.trim(), porcentaje: Number(pct || 0), activo: true, fecha_ingreso: hoyISO(), usuario_id: nombre.trim() === currentUser.nombre ? currentUser.id : null });
        Toast.success('Socios guardados');
      } else if (suma > 100) Toast.warning('Los porcentajes suman más de 100; ajústalos en Socios.');
    }
    Telemetry.track('onboarding_paso', { paso: 2, saltado: !ok });
    paso3(giro);
  }
  async function paso3(giro) {
    const ok = await Dialog.confirm({ title: 'Crea tu primera obra', icon: 'ri-building-2-line', confirmText: 'Crear mi obra', cancelText: 'Ver una obra de ejemplo',
      bodyHtml: `<p class="text-sm mb-2">El asistente te guía en 5 pasos: datos, catálogo (puedes pegar tu presupuesto desde Excel), programa por semanas y plan de pagos.</p><p class="text-xs text-slate-600">Si prefieres explorar primero, cargamos una obra de ejemplo con catálogo, programa, gastos y cobros; se borra con un clic.</p>` });
    await sb.rpc('marcar_onboarding', { p_giro: giro, p_completado: true });
    Telemetry.track('onboarding_paso', { paso: 3, ejemplo: !ok });
    if (ok) { if (typeof WizardObra !== 'undefined') WizardObra.open({}); else { M = 'o'; R(); } return; }
    await crearEjemplo(giro);
  }

  // ---------- Obra de ejemplo (US-220) ----------
  async function crearEjemplo(giro) {
    const { data, error } = await sb.rpc('crear_obra_ejemplo', { p_giro: giro || (estado && estado.giro) || 'despacho' });
    if (error || !data || !data.success) { Toast.error((data && data.error) || humanizeError(error, 'crear la obra de ejemplo')); return; }
    Telemetry.track('obra_ejemplo_creada', { giro });
    Toast.success('Obra de ejemplo lista. Explórala y bórrala cuando quieras.', 6000);
    await L(); selectedObra = String(data.obra_id); M = 'o'; R();
  }
  async function borrarEjemplo() {
    if (!await Dialog.confirm({ title: 'Borrar datos de ejemplo', body: 'Se eliminan la obra de ejemplo, su catálogo, programa, gastos, cobros y proveedores de ejemplo. Tus datos reales no se tocan.', confirmText: 'Borrar ejemplo', tone: 'danger' })) return;
    const { data, error } = await sb.rpc('borrar_datos_ejemplo');
    if (error || !data || !data.success) { Toast.error(humanizeError(error, 'borrar el ejemplo')); return; }
    Telemetry.track('obra_ejemplo_borrada');
    Toast.success('Datos de ejemplo eliminados'); selectedObra = null; await L(); R();
  }

  // ---------- Checklist de activación (US-221) ----------
  async function checklist(c) {
    if (!currentUser || (currentUser.nivel || 0) < 80) return;
    if (localStorage.getItem('checklistCerrado_' + currentUser.empresa_id)) return;
    await cargar(); if (!estado) return;
    const pasos = [
      ['obra', 'Crea tu primera obra', "M='o';R();"],
      ['catalogo', 'Carga el catálogo de conceptos (mínimo 5)', "M='p';R();"],
      ['gastos', 'Registra 5 gastos con ticket', "M='g';R();"],
      ['cobro', 'Registra el primer cobro del cliente', "M='pc';R();"],
      ['usuario', 'Invita a un usuario de tu equipo', "M='h';R();"],
    ];
    if (Suscripcion && Suscripcion.feature('socios')) pasos.push(['socios', 'Configura los socios y su porcentaje', "M='so';R();"]);
    const hechos = pasos.filter((p) => estado[p[0]]).length;
    if (hechos === pasos.length) { localStorage.setItem('checklistCerrado_' + currentUser.empresa_id, '1'); return; }
    if (estado.recien_activada) Toast.success('Tu cuenta ya está activada: obra, catálogo, gastos y cobro capturados. Bien hecho.', 7000);
    const card = document.createElement('div');
    card.id = 'checklistActivacion'; card.className = 'g rounded-xl p-4 mb-4';
    card.innerHTML = `<div class="flex items-start justify-between gap-2"><div><h3 class="font-bold text-sm"><i class="ri-rocket-line" aria-hidden="true"></i> Primeros pasos · ${hechos} de ${pasos.length}</h3><p class="text-xs text-slate-600">Con esto la app empieza a decirte cuánto ganas en cada obra.</p></div><div class="flex gap-2"><button type="button" class="btn btn-s text-xs" onclick="Onboarding.tour()"><i class="ri-map-pin-line" aria-hidden="true"></i> Recorrido</button>${estado.ejemplo ? '<button type="button" class="btn btn-s text-xs" onclick="Onboarding.borrarEjemplo()">Borrar ejemplo</button>' : '<button type="button" class="btn btn-s text-xs" onclick="Onboarding.crearEjemplo()">Obra de ejemplo</button>'}<button type="button" class="btn btn-s text-xs" aria-label="Cerrar primeros pasos" onclick="localStorage.setItem('checklistCerrado_${currentUser.empresa_id}','1');$('checklistActivacion').remove()"><i class="ri-close-line" aria-hidden="true"></i></button></div></div>
      <div class="h-2 rounded-full mt-3" style="background:var(--surface-2,#f1f5f9)"><div class="h-2 rounded-full" style="width:${Math.round(hechos / pasos.length * 100)}%;background:var(--ok)"></div></div>
      <ul class="mt-3 grid md:grid-cols-2 gap-1 text-sm">${pasos.map((p) => `<li>${estado[p[0]] ? '<i class="ri-checkbox-circle-fill" aria-hidden="true" style="color:var(--ok)"></i> <span class="text-slate-500 line-through">' + S(p[1]) + '</span>' : '<i class="ri-checkbox-blank-circle-line" aria-hidden="true"></i> <button type="button" class="link" onclick="' + p[2] + '">' + S(p[1]) + '</button>'}</li>`).join('')}</ul>`;
    const cont = c || $('c'); if (cont) cont.prepend(card);
  }

  // ---------- Recorrido de 5 pasos (US-222) ----------
  let tourIdx = 0, tourBox = null;
  function tour() { tourIdx = 0; Telemetry.track('tour_inicio'); pintarTour(); }
  function pintarTour() {
    cerrarTour(false);
    const p = PASOS_TOUR[tourIdx]; if (!p) { cerrarTour(true); return; }
    const el = document.querySelector(p.sel);
    tourBox = document.createElement('div'); tourBox.id = 'tourBox'; tourBox.setAttribute('role', 'dialog'); tourBox.setAttribute('aria-label', p.titulo);
    tourBox.style.cssText = 'position:fixed;z-index:var(--z-toast,1200);max-width:320px;background:var(--surface,#fff);color:var(--ink,#1e293b);border:1px solid var(--line,#e2e8f0);border-radius:var(--radius-md,10px);box-shadow:0 12px 32px rgba(15,23,42,.18);padding:14px 16px';
    tourBox.innerHTML = `<div class="text-xs text-slate-500 mb-1">Paso ${tourIdx + 1} de ${PASOS_TOUR.length}</div><h4 class="font-bold mb-1">${S(p.titulo)}</h4><p class="text-sm mb-3">${S(p.texto)}</p><div class="flex justify-between gap-2"><button type="button" class="btn btn-s text-xs" onclick="Onboarding.cerrarTour(true)">Salir</button><span class="flex gap-2">${tourIdx > 0 ? '<button type="button" class="btn btn-s text-xs" onclick="Onboarding.tourPaso(-1)">Atrás</button>' : ''}<button type="button" class="btn btn-p text-xs" onclick="Onboarding.tourPaso(1)">${tourIdx === PASOS_TOUR.length - 1 ? 'Terminar' : 'Siguiente'}</button></span></div>`;
    document.body.appendChild(tourBox);
    if (el) { el.classList.add('tour-target'); const r = el.getBoundingClientRect(); const top = Math.min(window.innerHeight - tourBox.offsetHeight - 16, Math.max(16, r.top)); const left = r.right + 12 + 320 < window.innerWidth ? r.right + 12 : Math.max(16, r.left - 332); tourBox.style.top = top + 'px'; tourBox.style.left = (window.innerWidth < 640 ? 16 : left) + 'px'; if (window.innerWidth < 640) tourBox.style.bottom = '80px'; }
    else { tourBox.style.top = '50%'; tourBox.style.left = '50%'; tourBox.style.transform = 'translate(-50%,-50%)'; }
    tourBox.querySelector('.btn-p').focus();
  }
  function tourPaso(d) { tourIdx += d; if (tourIdx >= PASOS_TOUR.length) { cerrarTour(true); Telemetry.track('tour_fin'); return; } pintarTour(); }
  function cerrarTour(fin) { document.querySelectorAll('.tour-target').forEach((e) => e.classList.remove('tour-target')); if (tourBox) { tourBox.remove(); tourBox = null; } if (fin && tourIdx < PASOS_TOUR.length - 1) Telemetry.track('tour_salida', { paso: tourIdx }); }

  return { iniciar, cargar, crearEjemplo, borrarEjemplo, checklist, tour, tourPaso, cerrarTour, get: () => estado };
})();
