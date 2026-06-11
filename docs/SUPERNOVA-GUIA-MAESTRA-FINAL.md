# GUÍA MAESTRA FINAL - SUPERNOVA WORDPRESS AUTO MEJORADO

## Resumen Ejecutivo

### Métricas de Mejora

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|--------|
| Temas disponibles | 12 | 25 | +108% |
| Combinaciones únicas | ~60 | ~250 | +317% |
| Manejo de errores | Básico | 3 niveles | +++++ |
| Detección duplicados | No | Sí | Nuevo |
| SEO meta description | No | Sí | Nuevo |
| Links internos | No | 2-3 por post | Nuevo |
| Categorización | Fija | Dinámica (5 cat) | Nuevo |
| Polling Leonardo | Fijo 1 min | Inteligente 15s×8 | +Eficiencia |
| Compresión imagen | No | Opcional TinyPNG | -30% peso |
| Notificaciones error | Parcial | Completa | +++++ |

---

## Arquitectura Final del Workflow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SUPERNOVA WORDPRESS AUTO MEJORADO                    │
│                         Arquitectura Final v2.0                         │
└─────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │   TRIGGER    │
                              │  8:00 AM     │
                              └──────┬───────┘
                                     │
                                     ▼
                              ┌──────────────┐
                              │  TELEGRAM    │
                              │  ¿Aprobar?   │
                              └──────┬───────┘
                                     │
                         ┌───────────┴───────────┐
                         │                       │
                       TRUE                    FALSE
                         │                       │
                         ▼                       ▼
               ┌──────────────┐          ┌──────────────┐
               │   TEMA       │          │  Cancelar    │
               │  ALEATORIO   │          │  (Telegram)  │
               │  (25 temas)  │          └──────────────┘
               └──────┬───────┘
                      │
                      ▼
        ═══════════════════════════════════
        ║  VERIFICACIÓN DE DUPLICADOS     ║
        ═══════════════════════════════════
                      │
                      ▼
               ┌──────────────┐
               │ Buscar Posts │
               │ Existentes   │
               └──────┬───────┘
                      │
                      ▼
               ┌──────────────┐
               │  Verificar   │
               │  Similitud   │
               └──────┬───────┘
                      │
                      ▼
               ┌──────────────┐
               │ ¿Duplicado?  │
               └──────┬───────┘
                      │
           ┌──────────┴──────────┐
           │                     │
         FALSE                  TRUE
           │                     │
           ▼                     ▼
        ═══════════          ┌──────────────┐
        ║ CONTINUAR ║        │  Notificar   │
        ═══════════          │  Duplicado   │
           │                 └──────────────┘
           ▼
        ═══════════════════════════════════
        ║  GENERACIÓN DE CONTENIDO        ║
        ═══════════════════════════════════
           │
           ▼
    ┌──────────────┐
    │  PERPLEXITY  │
    │  Research    │
    │ (+meta desc) │
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │ Parse JSON   │
    │ (3 intentos) │
    └──────┬───────┘
           │
           ▼
        ═══════════════════════════════════
        ║  LINKS INTERNOS SEO             ║
        ═══════════════════════════════════
           │
           ▼
    ┌──────────────┐
    │ Buscar Posts │
    │ Relacionados │
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │  Inyectar    │
    │ Links (2-3)  │
    └──────┬───────┘
           │
           ▼
        ═══════════════════════════════════
        ║  GENERACIÓN DE IMAGEN           ║
        ═══════════════════════════════════
           │
           ▼
    ┌──────────────┐
    │ GPT Prompt   │
    │ para Imagen  │
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │ LEONARDO AI  │
    │ Crear Imagen │
    └──────┬───────┘
           │
           ▼
        ═══════════════════════════════════
        ║  POLLING INTELIGENTE            ║
        ═══════════════════════════════════
           │
           ▼
    ┌──────────────┐
    │ Inicializar  │
    │ Contador     │
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐◄─────────┐
    │ Wait 15 seg  │          │
    └──────┬───────┘          │
           │                  │
           ▼                  │
    ┌──────────────┐          │
    │Check Status  │          │
    └──────┬───────┘          │
           │                  │
           ▼                  │
    ┌──────────────┐          │
    │Evaluar Status│          │
    └──────┬───────┘          │
           │                  │
           ▼                  │
    ┌──────────────┐          │
    │ Switch       │          │
    │ Acción       │          │
    └──────┬───────┘          │
           │                  │
    ┌──────┼──────┬───────┐   │
    │      │      │       │   │
 COMPLETE  │   FAILED  TIMEOUT│
    │      │      │       │   │
    │   REINTENTAR│       │   │
    │      │      │       │   │
    │      └──────┼───────┼───┘
    │             │       │
    ▼             ▼       ▼
┌───────┐   ┌────────┐ ┌────────┐
│Get    │   │Error   │ │Timeout │
│Image  │   │Telegram│ │Telegram│
└───┬───┘   └────────┘ └────────┘
    │
    ▼
        ═══════════════════════════════════
        ║  COMPRESIÓN (OPCIONAL)          ║
        ═══════════════════════════════════
    │
    ▼
┌──────────────┐
│ TinyPNG      │ (opcional)
│ Comprimir    │
└──────┬───────┘
       │
       ▼
        ═══════════════════════════════════
        ║  PUBLICACIÓN WORDPRESS          ║
        ═══════════════════════════════════
       │
       ▼
┌──────────────┐
│ Upload Image │
│ WordPress    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Add ALT      │
│ (SEO)        │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Crear Post   │
│ (cat dinámica│
│ + excerpt)   │
└──────┬───────┘
       │
       ▼
        ═══════════════════════════════════
        ║  REGISTRO Y NOTIFICACIÓN        ║
        ═══════════════════════════════════
       │
       ▼
┌──────────────┐
│Google Sheets │
│(+métricas)   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Telegram     │
│ Confirmación │
└──────────────┘
```

---

## LISTA COMPLETA DE NODOS

### Nodos Existentes (Actualizar)

| # | Nodo | Cambio Requerido |
|---|------|------------------|
| 1 | Seleccionar Tema Aleatorio | Expandir a 25 temas + categorías |
| 2 | Research Topic- Perplexity1 | Agregar meta_description y excerpt |
| 3 | Get Title, Content... | Parsing robusto 3 niveles |
| 4 | Wait | Cambiar de 1 min a 15 seg |
| 5 | If2 | Conectar rama FALSE |
| 6 | Crear Post en Wordpress1 | Categoría dinámica + excerpt |
| 7 | Publicaciones Wordpress SUPERNOVA1 | Agregar métricas |

### Nodos Nuevos (Crear)

| # | Nodo | Tipo | Prioridad |
|---|------|------|-----------|
| 8 | Error Leonardo AI | Telegram | Alta |
| 9 | Buscar Posts Existentes | HTTP Request | Media |
| 10 | Verificar Similitud | Code | Media |
| 11 | ¿Es Duplicado? | IF | Media |
| 12 | Notificar Duplicado | Telegram | Media |
| 13 | Buscar Posts Relacionados | HTTP Request | Baja |
| 14 | Inyectar Links Internos | Code | Baja |
| 15 | Inicializar Contador Polling | Code | Baja |
| 16 | Evaluar Status Leonardo | Code | Baja |
| 17 | Switch Acción Leonardo | Switch | Baja |
| 18 | Timeout Leonardo AI | Telegram | Baja |
| 19 | Comprimir Imagen TinyPNG | HTTP Request | Baja (Opcional) |
| 20 | Descargar Imagen Comprimida | HTTP Request | Baja (Opcional) |

---

## CÓDIGO COMPLETO DE TODOS LOS NODOS

### 1. Seleccionar Tema Aleatorio (25 temas)

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

### 2. Get Title, Content... (Parsing Robusto)

```javascript
const rawContent = $input.first().json.choices[0].message.content;

function extractJSON(text) {
  let cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];
  return cleaned;
}

function toSlug(text) {
  return text.toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

let data;

// Intento 1
try {
  data = JSON.parse(rawContent);
} catch (e1) {
  // Intento 2
  try {
    data = JSON.parse(extractJSON(rawContent));
  } catch (e2) {
    // Intento 3
    try {
      let repaired = rawContent
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
      data = JSON.parse(extractJSON(repaired));
    } catch (e3) {
      throw new Error(`ERROR PARSING: ${rawContent.substring(0, 500)}...`);
    }
  }
}

if (!data.title || !data.content) {
  throw new Error(`Faltan campos: title=${!!data.title}, content=${!!data.content}`);
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

### 3. Verificar Similitud (Duplicados)

```javascript
const temaActual = $('Seleccionar Tema Aleatorio').item.json.tema.toLowerCase();
const postsExistentes = $input.first().json;

function calcularSimilitud(str1, str2) {
  const p1 = str1.toLowerCase().split(/\s+/);
  const p2 = str2.toLowerCase().split(/\s+/);
  let coincidencias = 0;
  p1.forEach(palabra => {
    if (p2.some(p => p.includes(palabra) || palabra.includes(p))) coincidencias++;
  });
  return coincidencias / Math.max(p1.length, p2.length);
}

let esDuplicado = false;
let postSimilar = null;

if (Array.isArray(postsExistentes) && postsExistentes.length > 0) {
  for (const post of postsExistentes) {
    const titulo = post.title?.rendered || '';
    const similitud = calcularSimilitud(temaActual, titulo);
    if (similitud > 0.6) {
      esDuplicado = true;
      postSimilar = {
        id: post.id,
        titulo: titulo,
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

### 4. Inyectar Links Internos

```javascript
const contentData = $('Get Title, Content, and Image FileName1').item.json;
const postsRelacionados = $input.first().json;
const tituloActual = contentData.title.toLowerCase();

let postsValidos = [];
if (Array.isArray(postsRelacionados)) {
  postsValidos = postsRelacionados.filter(post => {
    const titulo = (post.title?.rendered || '').toLowerCase();
    return !titulo.includes(tituloActual.substring(0, 20)) && titulo !== tituloActual;
  }).slice(0, 5);
}

if (postsValidos.length === 0) {
  return [{ json: { ...contentData, links_agregados: 0, links_info: [] } }];
}

const numLinks = Math.min(3, postsValidos.length);
const postsSeleccionados = [];
const indicesUsados = new Set();

while (postsSeleccionados.length < numLinks && indicesUsados.size < postsValidos.length) {
  const idx = Math.floor(Math.random() * postsValidos.length);
  if (!indicesUsados.has(idx)) {
    indicesUsados.add(idx);
    postsSeleccionados.push(postsValidos[idx]);
  }
}

function limpiarTitulo(html) {
  return html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/<[^>]*>/g, '');
}

let seccion = `<h2>Artículos Relacionados</h2><p>Si te interesó este tema, te recomendamos:</p><ul>`;
const linksInfo = [];

postsSeleccionados.forEach(post => {
  const titulo = limpiarTitulo(post.title?.rendered || 'Artículo');
  const url = post.link || '#';
  seccion += `<li><a href="${url}" title="${titulo}">${titulo}</a></li>`;
  linksInfo.push({ titulo, url });
});
seccion += `</ul>`;

let contenido = contentData.content;
const ultimoP = contenido.lastIndexOf('</p>');
if (ultimoP > contenido.length * 0.7) {
  contenido = contenido.substring(0, ultimoP) + '</p>' + seccion + '<p>' + contenido.substring(ultimoP + 4);
} else {
  contenido += seccion;
}

return [{
  json: {
    title: contentData.title,
    content: contenido,
    image_filename: contentData.image_filename,
    meta_description: contentData.meta_description,
    excerpt: contentData.excerpt,
    links_agregados: postsSeleccionados.length,
    links_info: linksInfo
  }
}];
```

---

### 5. Inicializar Contador Polling

```javascript
const leonardoResponse = $input.first().json;

return [{
  json: {
    generationId: leonardoResponse.sdGenerationJob.generationId,
    intentos: 0,
    maxIntentos: 8,
    intervaloSegundos: 15,
    status: 'PENDING'
  }
}];
```

---

### 6. Evaluar Status Leonardo

```javascript
const statusResponse = $input.first().json;
const pollingData = $('Inicializar Contador Polling').item.json;

const currentStatus = statusResponse.generations_by_pk?.status || 'UNKNOWN';
const intentosActuales = pollingData.intentos + 1;

let accion = 'REINTENTAR';
let imageUrl = null;

if (currentStatus === 'COMPLETE') {
  accion = 'COMPLETADO';
  imageUrl = statusResponse.generations_by_pk.generated_images[0]?.url;
} else if (currentStatus === 'FAILED') {
  accion = 'FALLIDO';
} else if (intentosActuales >= pollingData.maxIntentos) {
  accion = 'TIMEOUT';
}

return [{
  json: {
    ...pollingData,
    intentos: intentosActuales,
    status: currentStatus,
    accion: accion,
    imageUrl: imageUrl,
    tiempoTranscurrido: intentosActuales * pollingData.intervaloSegundos + ' segundos',
    statusResponse: statusResponse
  }
}];
```

---

## CHECKLIST DE IMPLEMENTACIÓN

### Fase 1: Alta Prioridad ⚡
- [ ] Actualizar código "Seleccionar Tema Aleatorio"
- [ ] Actualizar prompt "Research Topic- Perplexity1"
- [ ] Actualizar código "Get Title, Content..."
- [ ] Crear nodo "Error Leonardo AI" (Telegram)
- [ ] Conectar rama FALSE de If2

### Fase 2: Media Prioridad 🔧
- [ ] Crear nodo "Buscar Posts Existentes" (HTTP)
- [ ] Crear nodo "Verificar Similitud" (Code)
- [ ] Crear nodo "¿Es Duplicado?" (IF)
- [ ] Crear nodo "Notificar Duplicado" (Telegram)
- [ ] Actualizar "Crear Post en Wordpress1" (categoría dinámica)

### Fase 3: Baja Prioridad 🎯
- [ ] Crear nodo "Buscar Posts Relacionados" (HTTP)
- [ ] Crear nodo "Inyectar Links Internos" (Code)
- [ ] Crear nodo "Inicializar Contador Polling" (Code)
- [ ] Modificar "Wait" a 15 segundos
- [ ] Crear nodo "Evaluar Status Leonardo" (Code)
- [ ] Crear nodo "Switch Acción Leonardo" (Switch)
- [ ] Crear nodo "Timeout Leonardo AI" (Telegram)

### Fase 4: Opcional 🌟
- [ ] Obtener API Key TinyPNG
- [ ] Crear nodos de compresión
- [ ] Agregar columnas en Google Sheets
- [ ] Crear categorías 916-920 en WordPress

---

## ARCHIVOS DE REFERENCIA

| Archivo | Contenido |
|---------|-----------|
| `SUPERNOVA-MEJORAS-IMPLEMENTAR.md` | Alta prioridad detallada |
| `SUPERNOVA-MEJORAS-MEDIA-PRIORIDAD.md` | Media prioridad detallada |
| `SUPERNOVA-MEJORAS-BAJA-PRIORIDAD.md` | Baja prioridad detallada |
| `SUPERNOVA-GUIA-MAESTRA-FINAL.md` | **Este archivo (todo consolidado)** |

---

**Versión:** 2.0 Final
**Fecha:** 2024-11-27
**Workflow ID:** L8n2DAmhwdbf8yUA
**Autor:** Claude Code
