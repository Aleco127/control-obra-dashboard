/**
 * Reglas de clasificación de gastos (US-104): sugieren categoría y destino a partir de la descripción
 * y del nombre del proveedor. Función pura, sin acceso a D ni al DOM, para poder probarla con node --test.
 *
 *   GastosRules.sugerirClasificacion('Telmex oficina agosto', '')  → {categoria:'Telefonía e internet', destino:'indirecto', naturaleza:'indirecto', motivo:'telmex'}
 *
 * destino: 'obra' (costo directo de una obra), 'indirecto' (administración, se prorratea), 'socio' (gasto personal).
 */
const GastosRules = (() => {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

  // Orden importa: la primera regla que coincide gana. Las de "socio" van antes que las de obra.
  const REGLAS = [
    // Personal del socio
    { re: /\b(costco|cosco|sams?|walmart super|casa habitacion|bebe|calenton|personal|regalo|ropa|farmacia|doctor|dentista|escuela|colegiatura|netflix|spotify)\b/, categoria: 'Gasto personal de socio', destino: 'socio' },
    // Indirectos
    { re: /\b(multa|recargo|actualizacion fiscal|infraccion|tenencia)/, categoria: 'Multas y recargos', destino: 'indirecto' },
    { re: /\b(telmex|izzi|totalplay|megacable|telcel|at&t|att\b|internet|telefon)/, categoria: 'Telefonía e internet', destino: 'indirecto' },
    { re: /\b(meta|facebook|instagram|google ads|adwords|anuncio|publicidad|campa[ñn]a|verified|palomita|volante|lona publicitaria|impresion de tarjetas)/, categoria: 'Publicidad', destino: 'indirecto' },
    { re: /\b(contabilidad|contador|despacho|notario|notaria|abogado|legal|honorarios contables|sat\b|declaracion)/, categoria: 'Honorarios contables y legales', destino: 'indirecto' },
    { re: /\b(dominio|hosting|suscripcion|software|licencia de software|office 365|microsoft|adobe|autodesk|autocad|revit|canva|chatgpt|openai|claude|supabase|hostinger|godaddy|apple\.com|icloud)/, categoria: 'Software y suscripciones', destino: 'indirecto' },
    { re: /\b(renta oficina|renta de oficina|oficina|cfe oficina|luz oficina|luz ofi|agua oficina|jmas|limpieza oficina|mantenimiento oficina)/, categoria: 'Renta y servicios de oficina', destino: 'indirecto' },
    { re: /\b(papeleria|office depot|hojas|toner|tinta|impresora|copias|engargolado|plumas)/, categoria: 'Papelería y oficina', destino: 'indirecto' },
    // Directos de obra
    { re: /\b(gasolina|gas\b|diesel|oxxo ?gas|pemex|combustible|vuelta a|vuelta [a-z]+|viaje a|casetas?|peaje)/, categoria: 'Combustible', destino: 'obra' },
    { re: /\b(mano de obra|chalan|albanil|albañil|maestro|cuadrilla|jornal|raya|destajo|yesero|pintor|plomero|electricista|soldador|carpintero|ayudante|dro\b|d\.r\.o|perito|director responsable)/, categoria: 'Mano de obra', destino: 'obra' },
    { re: /\b(subcontrat|instalacion electrica|instalacion hidraulica|canceleria|cancel\b|herreria|carpinteria|impermeabiliz|tablaroca|aluminio|vidrio templado)/, categoria: 'Subcontratos', destino: 'obra' },
    { re: /\b(renta de (maquina|equipo|andamio|revolvedora|compactadora|bailarina|grua|retro)|andamio|revolvedora|retroexcavadora|grua|maquinaria)/, categoria: 'Renta de equipo', destino: 'obra' },
    { re: /\b(flete|acarreo|escombro|camion de volteo|volteo|transporte de material|envio|mudanza)/, categoria: 'Fletes y transporte', destino: 'obra' },
    { re: /\b(taladro|rotomartillo|broca|disco de corte|esmeril|sierra|escalera|carretilla|pala|cincel|martillo|nivel laser|flexometro|herramienta)/, categoria: 'Herramientas', destino: 'obra' },
    { re: /\b(casco|chaleco|guantes|lentes de seguridad|botas|arnes|extintor|botiquin|señalamiento|senalamiento|cinta de precaucion)/, categoria: 'Seguridad', destino: 'obra' },
    { re: /\b(tacos|burritos|lonche|torta|pizza|sodas?|refresco|coca|agua para|comida|hamburguesa|wendys|burger|cafe|desayuno|cena|birria|carne seca|hielo)/, categoria: 'Viáticos y alimentos', destino: 'obra' },
    { re: /\b(cemento|mortero|varilla|acero|block|ladrillo|arena|grava|yeso|pintura|thinner|tornillo|clavo|madera|triplay|cable|material electrico|material hidraulico|tuberia|pvc|cpvc|azulejo|loseta|porcelanato|pegazulejo|boquilla|impermeabilizante|sellador|silicon|lija|home depot|ferreteria|ferre|construrama|myers|hagalo|maderera|aceros|concreto|electriluz|americas|interceramic)/, categoria: 'Materiales', destino: 'obra' }
  ];

  const NATURALEZA = { 'Gasto personal de socio': 'personal', 'Multas y recargos': 'no_deducible' };
  const INDIRECTAS = new Set(['Telefonía e internet', 'Publicidad', 'Honorarios contables y legales', 'Software y suscripciones', 'Renta y servicios de oficina', 'Papelería y oficina', 'Multas y recargos']);

  function sugerirClasificacion(descripcion, proveedorNombre, opts = {}) {
    const texto = norm(descripcion) + ' ' + norm(proveedorNombre);
    for (const r of REGLAS) {
      const m = texto.match(r.re);
      if (m) {
        return { categoria: r.categoria, destino: r.destino, naturaleza: NATURALEZA[r.categoria] || (INDIRECTAS.has(r.categoria) ? 'indirecto' : 'directo'), motivo: m[0].trim() };
      }
    }
    // Sin coincidencia: si no hay obra elegida y el usuario lo marcó como administrativo, indirecto; si no, Materiales de obra
    if (opts.sinObra) return { categoria: 'Otros', destino: 'indirecto', naturaleza: 'indirecto', motivo: '' };
    return { categoria: opts.categoriaDefault || 'Materiales', destino: 'obra', naturaleza: 'directo', motivo: '' };
  }

  /** Devuelve los gastos cuya clasificación actual difiere de la sugerida (para la reclasificación asistida). */
  function revisar(gastos, proveedores) {
    const byId = new Map((proveedores || []).map(p => [p.id, p]));
    const out = [];
    (gastos || []).forEach(g => {
      const sug = sugerirClasificacion(g.descripcion || g.comentarios, byId.get(g.proveedor_id)?.nombre_proveedor);
      if (!sug.motivo) return;
      const destinoActual = g.destino || (g.obra_id ? 'obra' : 'indirecto');
      const cambiaDestino = sug.destino !== destinoActual && !(sug.destino === 'socio' && destinoActual === 'socio');
      const cambiaCategoria = norm(sug.categoria) !== norm(g.categoria);
      if (cambiaDestino || cambiaCategoria) out.push({ gasto: g, sugerencia: sug, cambiaDestino, cambiaCategoria });
    });
    return out;
  }

  return { sugerirClasificacion, revisar, REGLAS, norm };
})();
if (typeof module !== 'undefined') module.exports = GastosRules;
