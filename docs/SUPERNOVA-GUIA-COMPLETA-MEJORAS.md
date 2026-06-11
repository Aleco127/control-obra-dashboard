# GUÍA COMPLETA DE MEJORAS - SUPERNOVA WORDPRESS AUTO

## Índice
1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Mejoras Alta Prioridad](#mejoras-alta-prioridad)
3. [Mejoras Media Prioridad](#mejoras-media-prioridad)
4. [Orden de Implementación](#orden-de-implementación)
5. [Código Completo](#código-completo)

---

## Resumen Ejecutivo

| Métrica | Antes | Después |
|---------|-------|---------|
| Temas disponibles | 12 | 25 |
| Combinaciones únicas | ~60 | ~250 |
| Manejo de errores | Básico | Robusto (3 niveles) |
| Detección duplicados | No | Sí |
| SEO meta description | No | Sí |
| Categorización | Fija | Dinámica |
| Notificación errores | Parcial | Completa |

---

## Mejoras Alta Prioridad

### 1. Parsing JSON Robusto

**Nodo:** `Get Title, Content, and Image FileName1`

```javascript
// CÓDIGO MEJORADO: Parsing JSON robusto con manejo de errores
const rawContent = $input.first().json.choices[0].message.content;

function extractJSON(text) {
  let cleaned = text
    .replace(/```json\n?/gi, '')
    .replace(/```\n?/gi, '')
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }
  return cleaned;
}

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

    // Intento 3: Reparación básica
    try {
      let repaired = rawContent
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');

      const cleanedRepaired = extractJSON(repaired);
      data = JSON.parse(cleanedRepaired);
      parseError = null;
    } catch (e3) {
      throw new Error(`ERROR PARSING JSON: ${rawContent.substring(0, 500)}...`);
    }
  }
}

if (!data.title || !data.content) {
  throw new Error(`Faltan campos requeridos. title: ${!!data.title}, content: ${!!data.content}`);
}

const imageName = toSlug(data.title) + ".jpg";

let metaDescription = data.meta_description;
if (!metaDescription) {
  const plainText = data.content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  metaDescription = plainText.substring(0, 155) + '...';
}

let excerpt = data.excerpt;
if (!excerpt) {
  const plainText = data.content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const sentences = plainText.match(/[^.!?]+[.!?]+/g) || [plainText];
  excerpt = sentences.slice(0, 2).join(' ').trim();
}

return [{
  json: {
    title: data.title,
    content: data.content,
    image_filename: imageName,
    meta_description: metaDescription,
    excerpt: excerpt
  }
}];
```

---

### 2. Prompt Perplexity con Meta Description

**Nodo:** `Research Topic- Perplexity1`

**JSON Body:**
```json
{
  "model": "sonar-pro",
  "messages": [
    {
      "role": "system",
      "content": "Eres un asistente experto en generar artículos SEO en español neutro para el blog de Supernova Arquitectos. Tu especialidad es investigar y redactar sobre tecnología aplicada en la construcción, innovación arquitectónica, sostenibilidad, diseño contemporáneo, materiales inteligentes, automatización, IA en arquitectura, gestión de proyectos, y tendencias relevantes del sector AEC."
    },
    {
      "role": "user",
      "content": "Investiga y redacta un artículo sobre: {{ $('Seleccionar Tema Aleatorio').item.json.tema }}. {{ $('Seleccionar Tema Aleatorio').item.json.enfoque }}, {{ $('Seleccionar Tema Aleatorio').item.json.contexto_temporal }}.\n\nFormato: {{ $('Seleccionar Tema Aleatorio').item.json.formato }}.\n\nDevuelve ÚNICAMENTE un objeto JSON con esta estructura:\n{\n  \"title\": \"[título atractivo]\",\n  \"meta_description\": \"[150-160 caracteres SEO con keyword principal]\",\n  \"excerpt\": \"[2-3 oraciones para redes sociales]\",\n  \"content\": \"[HTML limpio con <p>, <h2>, <ul>, <li>, <strong>, <em>]\"\n}\n\nRequisitos del artículo:\n- 1000-1500 palabras\n- Gancho atractivo inicial\n- Subtítulos <h2>\n- 2+ datos estadísticos con fuente\n- 3+ consejos prácticos en lista\n- Reflexión final motivadora\n- Palabras clave: {{ $('Seleccionar Tema Aleatorio').item.json.palabras_clave }}\n\nNO incluyas texto fuera del JSON."
    }
  ]
}
```

---

### 3. Notificación Error Leonardo

**NUEVO Nodo Telegram:** `Error Leonardo AI`

**Configuración:**
- Chat ID: `6074722648`
- Message:
```
⚠️ ERROR en generación de imagen Leonardo AI

Status: {{ $json.generations_by_pk.status }}
Generation ID: {{ $('Leonardo: Create Post Image1').item.json.sdGenerationJob.generationId }}
Tema: {{ $('Seleccionar Tema Aleatorio').item.json.tema }}

Opciones:
1. Revisar créditos en Leonardo AI
2. Reintentar workflow manualmente
3. Verificar prompt de imagen
```

**Conectar:** Rama FALSE de `If2` → `Error Leonardo AI`

---

## Mejoras Media Prioridad

### 4. Verificación de Duplicados

**NUEVO Nodo HTTP Request:** `Buscar Posts Existentes`

- Method: GET
- URL: `https://supernovarquitectos.com/wp-json/wp/v2/posts`
- Auth: HTTP Basic (WordPress)
- Query Params:
  - `search`: `{{ $json.tema }}`
  - `per_page`: `5`
  - `status`: `publish`

---

**NUEVO Nodo Code:** `Verificar Similitud`

```javascript
const temaActual = $('Seleccionar Tema Aleatorio').item.json.tema.toLowerCase();
const postsExistentes = $input.first().json;

function calcularSimilitud(str1, str2) {
  const palabras1 = str1.toLowerCase().split(/\s+/);
  const palabras2 = str2.toLowerCase().split(/\s+/);

  let coincidencias = 0;
  palabras1.forEach(p1 => {
    if (palabras2.some(p2 => p2.includes(p1) || p1.includes(p2))) {
      coincidencias++;
    }
  });

  return coincidencias / Math.max(palabras1.length, palabras2.length);
}

let esDuplicado = false;
let postSimilar = null;

if (Array.isArray(postsExistentes) && postsExistentes.length > 0) {
  for (const post of postsExistentes) {
    const tituloPost = post.title?.rendered || '';
    const similitud = calcularSimilitud(temaActual, tituloPost);

    if (similitud > 0.6) {
      esDuplicado = true;
      postSimilar = {
        id: post.id,
        titulo: tituloPost,
        fecha: post.date,
        similitud: Math.round(similitud * 100) + '%'
      };
      break;
    }
  }
}

const temaData = $('Seleccionar Tema Aleatorio').item.json;

return [{
  json: {
    ...temaData,
    verificacion: {
      es_duplicado: esDuplicado,
      post_similar: postSimilar,
      posts_revisados: Array.isArray(postsExistentes) ? postsExistentes.length : 0
    }
  }
}];
```

---

**NUEVO Nodo IF:** `¿Es Duplicado?`

- Condición: `{{ $json.verificacion.es_duplicado }}` equals `true`
- TRUE → Notificar Duplicado
- FALSE → Research Perplexity

---

**NUEVO Nodo Telegram:** `Notificar Duplicado`

```
⚠️ TEMA DUPLICADO DETECTADO

El tema "{{ $json.tema }}" ya tiene un post similar:

📝 Título: {{ $json.verificacion.post_similar.titulo }}
📅 Fecha: {{ $json.verificacion.post_similar.fecha }}
📊 Similitud: {{ $json.verificacion.post_similar.similitud }}

Workflow detenido para evitar contenido duplicado.
```

---

### 5. Temas Expandidos (25 temas)

**Nodo:** `Seleccionar Tema Aleatorio`

```javascript
const topics = [
  // TECNOLOGÍA Y DIGITALIZACIÓN (cat 916)
  { tema: "BIM y gemelos digitales", enfoque: "Explica cómo la tecnología BIM y los gemelos digitales están transformando la gestión de proyectos arquitectónicos", formato: "guía práctica", palabras_clave: "BIM, gemelos digitales, gestión de proyectos, modelado 3D", categoria: 916 },
  { tema: "IA en el diseño arquitectónico", enfoque: "Descubre cómo la inteligencia artificial está revolucionando el proceso de diseño", formato: "caso de estudio", palabras_clave: "inteligencia artificial, diseño generativo, automatización, machine learning", categoria: 916 },
  { tema: "Realidad virtual y aumentada en arquitectura", enfoque: "Descubre cómo VR y AR están mejorando la presentación de proyectos", formato: "artículo educativo", palabras_clave: "realidad virtual, realidad aumentada, visualización arquitectónica", categoria: 916 },
  { tema: "Impresión 3D en construcción", enfoque: "Explora las posibilidades de la impresión 3D para construir viviendas", formato: "reporte de innovación", palabras_clave: "impresión 3D, construcción aditiva, fabricación digital", categoria: 916 },
  { tema: "Drones en topografía y construcción", enfoque: "Analiza cómo los drones optimizan el levantamiento topográfico", formato: "artículo técnico", palabras_clave: "drones, topografía, fotogrametría, supervisión de obra", categoria: 916 },
  { tema: "Software de renderizado en tiempo real", enfoque: "Compara Enscape, Twinmotion y Lumion", formato: "análisis comparativo", palabras_clave: "renderizado, tiempo real, Enscape, Twinmotion", categoria: 916 },
  { tema: "Automatización de planos con IA", enfoque: "Explora herramientas que automatizan la generación de planos", formato: "guía de herramientas", palabras_clave: "automatización, planos, IA arquitectura", categoria: 916 },

  // SUSTENTABILIDAD (cat 917)
  { tema: "Materiales sustentables", enfoque: "Analiza los materiales de construcción más innovadores y ecológicos", formato: "análisis comparativo", palabras_clave: "materiales sustentables, construcción ecológica, economía circular", categoria: 917 },
  { tema: "Energías renovables en edificios", enfoque: "Analiza la integración de paneles solares y otras tecnologías", formato: "guía de implementación", palabras_clave: "energía solar, eficiencia energética, net zero", categoria: 917 },
  { tema: "Certificaciones verdes (LEED, BREEAM)", enfoque: "Explica los beneficios y proceso de certificación", formato: "guía paso a paso", palabras_clave: "LEED, BREEAM, certificación verde", categoria: 917 },
  { tema: "Diseño bioclimático", enfoque: "Investiga estrategias que aprovechan condiciones climáticas locales", formato: "guía de diseño", palabras_clave: "diseño bioclimático, arquitectura pasiva, confort térmico", categoria: 917 },
  { tema: "Arquitectura regenerativa", enfoque: "Explora edificios que generan más recursos de los que consumen", formato: "artículo conceptual", palabras_clave: "arquitectura regenerativa, impacto positivo, sostenibilidad", categoria: 917 },
  { tema: "Techos y muros verdes", enfoque: "Analiza beneficios y técnicas de vegetación en edificios", formato: "guía técnica", palabras_clave: "techos verdes, muros vegetales, jardines verticales", categoria: 917 },
  { tema: "Captación de agua pluvial", enfoque: "Diseña sistemas de recolección de agua de lluvia", formato: "manual técnico", palabras_clave: "captación pluvial, sustentabilidad hídrica", categoria: 917 },

  // CONSTRUCCIÓN E INGENIERÍA (cat 918)
  { tema: "Construcción modular y prefabricada", enfoque: "Investiga cómo reduce tiempos y costos", formato: "análisis técnico", palabras_clave: "construcción modular, prefabricación, industrialización", categoria: 918 },
  { tema: "Domótica y edificios inteligentes", enfoque: "Explora tendencias en automatización residencial", formato: "artículo de tendencias", palabras_clave: "domótica, smart buildings, IoT", categoria: 918 },
  { tema: "Estructuras de madera de gran altura", enfoque: "Analiza el auge de edificios de madera y CLT", formato: "caso de estudio", palabras_clave: "madera laminada, CLT, edificios de madera", categoria: 918 },
  { tema: "Concreto de ultra alto rendimiento", enfoque: "Explora propiedades y aplicaciones del UHPC", formato: "artículo técnico", palabras_clave: "UHPC, concreto avanzado, resistencia estructural", categoria: 918 },
  { tema: "Retrofitting y renovación energética", enfoque: "Estrategias para actualizar edificios existentes", formato: "guía de implementación", palabras_clave: "retrofitting, renovación, eficiencia energética", categoria: 918 },

  // GESTIÓN Y METODOLOGÍAS (cat 919)
  { tema: "Gestión de proyectos con metodologías ágiles", enfoque: "Explora cómo Scrum se aplica en construcción", formato: "caso práctico", palabras_clave: "metodologías ágiles, Scrum, gestión de proyectos", categoria: 919 },
  { tema: "Lean Construction", enfoque: "Implementa principios Lean para reducir desperdicios", formato: "guía de implementación", palabras_clave: "lean construction, eficiencia, mejora continua", categoria: 919 },
  { tema: "Contratos colaborativos IPD", enfoque: "Explora Integrated Project Delivery", formato: "artículo educativo", palabras_clave: "IPD, contratos colaborativos, gestión integrada", categoria: 919 },

  // DISEÑO Y TENDENCIAS (cat 920)
  { tema: "Arquitectura paramétrica", enfoque: "Descubre cómo el diseño paramétrico crea formas únicas", formato: "análisis de tendencias", palabras_clave: "diseño paramétrico, Grasshopper, geometría compleja", categoria: 920 },
  { tema: "Neuroarquitectura", enfoque: "Explora cómo el diseño afecta bienestar y productividad", formato: "artículo científico", palabras_clave: "neuroarquitectura, bienestar, espacios saludables", categoria: 920 },
  { tema: "Diseño biofílico", enfoque: "Integra elementos naturales para mejorar calidad de vida", formato: "guía de diseño", palabras_clave: "diseño biofílico, naturaleza, bienestar", categoria: 920 }
];

const temporalContext = [
  "considerando las tendencias más recientes del mercado",
  "tomando en cuenta las innovaciones de este año",
  "con enfoque en soluciones aplicables en México",
  "destacando casos de éxito recientes",
  "con proyección hacia el futuro cercano",
  "analizando el impacto post-pandemia",
  "considerando la inflación y optimización de costos",
  "con énfasis en soluciones para clima cálido",
  "destacando proyectos latinoamericanos",
  "con visión de implementación inmediata"
];

const randomTopic = topics[Math.floor(Math.random() * topics.length)];
const randomContext = temporalContext[Math.floor(Math.random() * temporalContext.length)];

return {
  json: {
    tema: randomTopic.tema,
    enfoque: randomTopic.enfoque,
    formato: randomTopic.formato,
    palabras_clave: randomTopic.palabras_clave,
    categoria: randomTopic.categoria,
    contexto_temporal: randomContext
  }
};
```

---

### 6. Categorías Dinámicas en WordPress

**Nodo:** `Crear Post en Wordpress1`

```json
{
  "title": "{{ $('Get Title, Content, and Image FileName1').item.json.title }}",
  "content": "{{ $('Get Title, Content, and Image FileName1').item.json.content }}",
  "excerpt": "{{ $('Get Title, Content, and Image FileName1').item.json.excerpt }}",
  "status": "publish",
  "categories": [
    {{ $('Seleccionar Tema Aleatorio').item.json.categoria }}
  ],
  "featured_media": {{ $('Upload Image to Wordpress1').item.json.id }}
}
```

---

## Orden de Implementación

### Fase 1: Alta Prioridad (Estabilidad)
1. ✅ Actualizar código de parsing JSON
2. ✅ Actualizar prompt de Perplexity
3. ✅ Crear nodo Error Leonardo AI
4. ✅ Conectar rama FALSE de If2

### Fase 2: Media Prioridad (Funcionalidad)
5. ⬜ Crear nodo Buscar Posts Existentes
6. ⬜ Crear nodo Verificar Similitud
7. ⬜ Crear nodo IF ¿Es Duplicado?
8. ⬜ Crear nodo Notificar Duplicado
9. ⬜ Actualizar código de temas (25)
10. ⬜ Actualizar JSON de WordPress con categoría dinámica

### Fase 3: Configuración
11. ⬜ Crear categorías 916-920 en WordPress (si no existen)
12. ⬜ Agregar columnas en Google Sheets
13. ⬜ Probar workflow completo

---

## Diagrama Final

```
┌─────────────┐
│  Schedule   │
│  8:00 AM    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Telegram   │
│  Aprobar?   │
└──────┬──────┘
       │
   ┌───┴───┐
   │       │
  YES     NO
   │       │
   ▼       ▼
┌──────┐  ┌────────┐
│Tema  │  │Cancelar│
│Random│  └────────┘
└──┬───┘
   │
   ▼
┌──────────────┐
│Buscar Posts  │ ← NUEVO
│Existentes    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│Verificar     │ ← NUEVO
│Similitud     │
└──────┬───────┘
       │
   ┌───┴───┐
   │       │
  NO      YES
   │       │
   ▼       ▼
┌──────┐  ┌──────────┐
│Perplex│ │Notificar │ ← NUEVO
│ity   │  │Duplicado │
└──┬───┘  └──────────┘
   │
   ▼
┌──────────────┐
│Parse JSON    │ ← MEJORADO
│(3 intentos)  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│GPT Prompt    │
│para Imagen   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│Leonardo AI   │
│Crear Imagen  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│Wait 1 min    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│Check Status  │
└──────┬───────┘
       │
   ┌───┴───┐
   │       │
COMPLETE  OTRO
   │       │
   ▼       ▼
┌──────┐  ┌──────────┐
│Get   │  │Error     │ ← NUEVO
│Image │  │Leonardo  │
└──┬───┘  └──────────┘
   │
   ▼
┌──────────────┐
│Upload WP     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│Add ALT       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│Create Post   │ ← MEJORADO
│(cat dinámica)│
└──────┬───────┘
       │
       ▼
┌──────────────┐
│Google Sheets │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│Telegram OK   │
└──────────────┘
```

---

**Generado:** 2024-11-27
**Workflow:** SUPERNOVA - WORDPRESS AUTO MEJORADO
**ID:** L8n2DAmhwdbf8yUA
