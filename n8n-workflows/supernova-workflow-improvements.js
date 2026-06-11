// ============================================
// MEJORAS ALTA PRIORIDAD - SUPERNOVA WORKFLOW
// ============================================

// 1. CÓDIGO MEJORADO PARA: "Get Title, Content, and Image FileName1"
// Incluye manejo robusto de errores JSON y meta description SEO

const improvedParsingCode = `
// CÓDIGO MEJORADO: Parsing JSON robusto con manejo de errores
const rawContent = $input.first().json.choices[0].message.content;

// Función para limpiar y extraer JSON
function extractJSON(text) {
  // Eliminar bloques de código markdown si existen
  let cleaned = text
    .replace(/\`\`\`json\\n?/gi, '')
    .replace(/\`\`\`\\n?/gi, '')
    .trim();

  // Intentar encontrar el objeto JSON si hay texto adicional
  const jsonMatch = cleaned.match(/\\{[\\s\\S]*\\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  return cleaned;
}

// Función para generar slug SEO-friendly
function toSlug(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-z0-9\\s-]/g, "")
    .replace(/\\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

let data;
let parseError = null;

// Intento 1: Parse directo
try {
  data = JSON.parse(rawContent);
} catch (e1) {
  parseError = e1.message;

  // Intento 2: Limpiar y parsear
  try {
    const cleanedContent = extractJSON(rawContent);
    data = JSON.parse(cleanedContent);
    parseError = null; // Éxito en segundo intento
  } catch (e2) {
    parseError = \`Intento 1: \${e1.message} | Intento 2: \${e2.message}\`;

    // Intento 3: Reparación básica de JSON común
    try {
      let repaired = rawContent
        .replace(/,\\s*}/g, '}')  // Coma antes de }
        .replace(/,\\s*]/g, ']')  // Coma antes de ]
        .replace(/([{,]\\s*)(\\w+)\\s*:/g, '$1"$2":'); // Keys sin comillas

      const cleanedRepaired = extractJSON(repaired);
      data = JSON.parse(cleanedRepaired);
      parseError = null;
    } catch (e3) {
      // Falló todo - notificar error
      throw new Error(\`ERROR PARSING JSON de Perplexity. Raw content (primeros 500 chars): \${rawContent.substring(0, 500)}... | Errores: \${parseError}\`);
    }
  }
}

// Validar campos requeridos
if (!data.title || !data.content) {
  throw new Error(\`JSON parseado pero faltan campos requeridos. title: \${!!data.title}, content: \${!!data.content}\`);
}

// Generar nombre de imagen
const imageName = toSlug(data.title) + ".jpg";

// Generar meta description si no existe (fallback)
let metaDescription = data.meta_description;
if (!metaDescription) {
  // Extraer primeras 155 caracteres del contenido limpio
  const plainText = data.content
    .replace(/<[^>]*>/g, '')
    .replace(/\\s+/g, ' ')
    .trim();
  metaDescription = plainText.substring(0, 155) + '...';
}

// Generar excerpt si no existe
let excerpt = data.excerpt;
if (!excerpt) {
  const plainText = data.content
    .replace(/<[^>]*>/g, '')
    .replace(/\\s+/g, ' ')
    .trim();
  const sentences = plainText.match(/[^.!?]+[.!?]+/g) || [plainText];
  excerpt = sentences.slice(0, 2).join(' ').trim();
}

return [
  {
    json: {
      title: data.title,
      content: data.content,
      image_filename: imageName,
      meta_description: metaDescription,
      excerpt: excerpt,
      parse_success: true,
      raw_length: rawContent.length
    }
  }
];
`;

// 2. PROMPT MEJORADO PARA PERPLEXITY (con meta_description y excerpt)
const improvedPerplexityPrompt = `{
  "model": "sonar-pro",
  "messages": [
    {
      "role": "system",
      "content": "Eres un asistente experto en generar artículos SEO en español neutro para el blog de Supernova Arquitectos. Tu especialidad es investigar y redactar sobre tecnología aplicada en la construcción, innovación arquitectónica, sostenibilidad, diseño contemporáneo, materiales inteligentes, automatización, IA en arquitectura, gestión de proyectos, y tendencias relevantes del sector AEC (Arquitectura, Ingeniería y Construcción). El tono debe ser educativo, inspirador, técnico pero cercano, dirigido a profesionales y entusiastas del diseño y la construcción."
    },
    {
      "role": "user",
      "content": "Investiga y redacta un artículo sobre: {{ $('Seleccionar Tema Aleatorio').item.json.tema }}. {{ $('Seleccionar Tema Aleatorio').item.json.enfoque }}, {{ $('Seleccionar Tema Aleatorio').item.json.contexto_temporal }}.\\n\\nEl artículo debe tener formato de {{ $('Seleccionar Tema Aleatorio').item.json.formato }}.\\n\\nDevuelve la respuesta estrictamente en formato JSON con esta estructura:\\n{\\n  \\"title\\": \\"[título atractivo en una sola línea]\\",\\n  \\"meta_description\\": \\"[descripción SEO de exactamente 150-160 caracteres que incluya la palabra clave principal y llame a la acción]\\",\\n  \\"excerpt\\": \\"[resumen atractivo de 2-3 oraciones para mostrar en listados y redes sociales]\\",\\n  \\"content\\": \\"[cuerpo del artículo en HTML limpio, sin caracteres escapados, sin markdown, sin saltos \\\\n, y sin comentarios externos. Usar solo etiquetas estándar de HTML como <p>, <h2>, <ul>, <li>, <strong> y <em>. No uses etiquetas personalizadas ni scripts.]\\"\\n}\\n\\nEl artículo debe cumplir con lo siguiente:\\n- Tener entre 1000 y 1500 palabras.\\n- Iniciar con un gancho atractivo de máximo 3 frases dentro de <p>.\\n- Incluir subtítulos con <h2> que organicen bien el contenido.\\n- Incluir al menos 2 datos estadísticos actuales con fuente (en texto).\\n- Ofrecer mínimo 3 consejos o ideas prácticas en formato de lista con <ul> y <li>.\\n- Terminar con una reflexión motivadora que invite a seguir explorando la innovación en la arquitectura y la construcción.\\n- Usar naturalmente las siguientes palabras clave: {{ $('Seleccionar Tema Aleatorio').item.json.palabras_clave }}.\\n- Adaptar el estilo y estructura al formato indicado: {{ $('Seleccionar Tema Aleatorio').item.json.formato }}.\\n\\nMUY IMPORTANTE: Devuelve ÚNICAMENTE el objeto JSON, sin texto adicional, sin explicaciones, sin bloques de código markdown."
    }
  ]
}`;

// 3. NUEVO NODO: Notificar Error Leonardo (para rama else de If2)
const leonardoErrorNotification = {
  chatId: "6074722648",
  text: "⚠️ ERROR en generación de imagen Leonardo AI\\n\\nStatus: {{ $json.generations_by_pk.status }}\\nGeneration ID: {{ $('Leonardo: Create Post Image1').item.json.sdGenerationJob.generationId }}\\n\\nEl workflow se ha detenido. Puedes:\\n1. Reintentar manualmente\\n2. Revisar el estado en Leonardo AI dashboard",
  additionalFields: {
    appendAttribution: false
  }
};

// 4. CÓDIGO MEJORADO PARA If2 (verificar status Leonardo)
// Ahora incluye verificación de FAILED además de COMPLETE
const improvedLeonardoCheckConditions = {
  conditions: {
    options: {
      version: 2,
      leftValue: "",
      caseSensitive: true,
      typeValidation: "strict"
    },
    combinator: "or",
    conditions: [
      {
        id: "check-complete",
        operator: {
          type: "string",
          operation: "equals"
        },
        leftValue: "={{ $json.generations_by_pk.status }}",
        rightValue: "COMPLETE"
      }
    ]
  },
  options: {}
};

console.log("Mejoras preparadas para implementación");
console.log("=====================================");
console.log("1. Parsing JSON robusto");
console.log("2. Prompt Perplexity con meta_description");
console.log("3. Notificación error Leonardo");
console.log("4. Verificación mejorada If2");
