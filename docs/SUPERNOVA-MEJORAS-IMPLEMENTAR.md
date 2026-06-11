# Mejoras Alta Prioridad - SUPERNOVA WORDPRESS AUTO MEJORADO

## Resumen de Cambios

Las siguientes mejoras deben aplicarse manualmente en n8n:

---

## 1. NODO: "Get Title, Content, and Image FileName1"

**Reemplazar** todo el código JavaScript por:

```javascript
// CÓDIGO MEJORADO: Parsing JSON robusto con manejo de errores
const rawContent = $input.first().json.choices[0].message.content;

// Función para limpiar y extraer JSON
function extractJSON(text) {
  // Eliminar bloques de código markdown si existen
  let cleaned = text
    .replace(/```json\n?/gi, '')
    .replace(/```\n?/gi, '')
    .trim();

  // Intentar encontrar el objeto JSON si hay texto adicional
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
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
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
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
    parseError = null;
  } catch (e2) {
    parseError = `Intento 1: ${e1.message} | Intento 2: ${e2.message}`;

    // Intento 3: Reparación básica de JSON común
    try {
      let repaired = rawContent
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');

      const cleanedRepaired = extractJSON(repaired);
      data = JSON.parse(cleanedRepaired);
      parseError = null;
    } catch (e3) {
      throw new Error(`ERROR PARSING JSON de Perplexity. Raw (500 chars): ${rawContent.substring(0, 500)}...`);
    }
  }
}

// Validar campos requeridos
if (!data.title || !data.content) {
  throw new Error(`JSON parseado pero faltan campos. title: ${!!data.title}, content: ${!!data.content}`);
}

const imageName = toSlug(data.title) + ".jpg";

// Generar meta description si no existe
let metaDescription = data.meta_description;
if (!metaDescription) {
  const plainText = data.content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  metaDescription = plainText.substring(0, 155) + '...';
}

// Generar excerpt si no existe
let excerpt = data.excerpt;
if (!excerpt) {
  const plainText = data.content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
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
      excerpt: excerpt
    }
  }
];
```

---

## 2. NODO: "Research Topic- Perplexity1"

**Reemplazar** el JSON Body por:

```json
{
  "model": "sonar-pro",
  "messages": [
    {
      "role": "system",
      "content": "Eres un asistente experto en generar artículos SEO en español neutro para el blog de Supernova Arquitectos. Tu especialidad es investigar y redactar sobre tecnología aplicada en la construcción, innovación arquitectónica, sostenibilidad, diseño contemporáneo, materiales inteligentes, automatización, IA en arquitectura, gestión de proyectos, y tendencias relevantes del sector AEC (Arquitectura, Ingeniería y Construcción). El tono debe ser educativo, inspirador, técnico pero cercano, dirigido a profesionales y entusiastas del diseño y la construcción."
    },
    {
      "role": "user",
      "content": "Investiga y redacta un artículo sobre: {{ $('Seleccionar Tema Aleatorio').item.json.tema }}. {{ $('Seleccionar Tema Aleatorio').item.json.enfoque }}, {{ $('Seleccionar Tema Aleatorio').item.json.contexto_temporal }}.\n\nEl artículo debe tener formato de {{ $('Seleccionar Tema Aleatorio').item.json.formato }}.\n\nDevuelve la respuesta estrictamente en formato JSON con esta estructura:\n{\n  \"title\": \"[título atractivo en una sola línea]\",\n  \"meta_description\": \"[descripción SEO de exactamente 150-160 caracteres que incluya la palabra clave principal y llame a la acción]\",\n  \"excerpt\": \"[resumen atractivo de 2-3 oraciones para mostrar en listados y redes sociales]\",\n  \"content\": \"[cuerpo del artículo en HTML limpio, sin caracteres escapados, sin markdown, sin saltos \\n, y sin comentarios externos. Usar solo etiquetas estándar de HTML como <p>, <h2>, <ul>, <li>, <strong> y <em>. No uses etiquetas personalizadas ni scripts.]\"\n}\n\nEl artículo debe cumplir con lo siguiente:\n- Tener entre 1000 y 1500 palabras.\n- Iniciar con un gancho atractivo de máximo 3 frases dentro de <p>.\n- Incluir subtítulos con <h2> que organicen bien el contenido.\n- Incluir al menos 2 datos estadísticos actuales con fuente (en texto).\n- Ofrecer mínimo 3 consejos o ideas prácticas en formato de lista con <ul> y <li>.\n- Terminar con una reflexión motivadora que invite a seguir explorando la innovación en la arquitectura y la construcción.\n- Usar naturalmente las siguientes palabras clave: {{ $('Seleccionar Tema Aleatorio').item.json.palabras_clave }}.\n- Adaptar el estilo y estructura al formato indicado: {{ $('Seleccionar Tema Aleatorio').item.json.formato }}.\n\nMUY IMPORTANTE: Devuelve ÚNICAMENTE el objeto JSON, sin texto adicional, sin explicaciones, sin bloques de código markdown."
    }
  ]
}
```

---

## 3. NODO: "If2" - Agregar conexión "false"

### Paso 1: Verificar que If2 tenga 2 salidas
- Salida **true** → `Get Leonardo Image1` (ya existe)
- Salida **false** → NUEVO nodo de error

### Paso 2: Crear nuevo nodo Telegram "Error Leonardo AI"

**Tipo:** Telegram
**Operación:** Send Message
**Configuración:**

```
Chat ID: 6074722648
Message: ⚠️ ERROR en generación de imagen Leonardo AI

Status: {{ $json.generations_by_pk.status }}
Generation ID: {{ $('Leonardo: Create Post Image1').item.json.sdGenerationJob.generationId }}
Tema: {{ $('Seleccionar Tema Aleatorio').item.json.tema }}

El workflow se ha detenido. Opciones:
1. Revisar créditos en Leonardo AI
2. Reintentar manualmente el workflow
3. Verificar el prompt de imagen generado
```

### Paso 3: Conectar la rama FALSE de If2 al nuevo nodo

---

## 4. NODO: "Crear Post en Wordpress1"

**Actualizar** el JSON Body para incluir excerpt:

```json
{
  "title": "{{ $('Get Title, Content, and Image FileName1').item.json.title }}",
  "content": "{{ $('Get Title, Content, and Image FileName1').item.json.content }}",
  "excerpt": "{{ $('Get Title, Content, and Image FileName1').item.json.excerpt }}",
  "status": "publish",
  "categories": [
    916
  ],
  "featured_media": {{ $('Upload Image to Wordpress1').item.json.id }}
}
```

---

## 5. NUEVO: Sticky Note de Mejoras

Agregar un Sticky Note cerca del nodo de parsing con:

```
## ✅ MEJORAS IMPLEMENTADAS (Nov 2024)

1. Parsing JSON robusto con 3 niveles de intento
2. Meta description SEO automática
3. Excerpt para redes sociales
4. Notificación de errores Leonardo AI
5. Validación de campos requeridos

Si hay errores de parsing, revisa los logs del nodo
"Get Title, Content, and Image FileName1"
```

---

## Diagrama de Flujo Actualizado

```
                    ┌─────────────────┐
                    │  If2 (Leonardo) │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
         TRUE │                        FALSE│
              ▼                             ▼
    ┌─────────────────┐          ┌──────────────────┐
    │Get Leonardo     │          │Error Leonardo AI │
    │Image1           │          │(Telegram)        │
    └─────────────────┘          └──────────────────┘
```

---

## Verificación Post-Implementación

1. [ ] Ejecutar workflow manualmente una vez
2. [ ] Verificar que el JSON se parsea correctamente
3. [ ] Confirmar que meta_description aparece en el output
4. [ ] Probar rama de error desconectando Leonardo temporalmente
5. [ ] Verificar que el excerpt aparece en WordPress

---

**Archivo generado:** 2024-11-27
**Workflow ID:** L8n2DAmhwdbf8yUA
