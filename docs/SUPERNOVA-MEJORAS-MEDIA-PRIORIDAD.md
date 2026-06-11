# Mejoras Prioridad Media - SUPERNOVA WORDPRESS AUTO MEJORADO

## Resumen de Cambios

---

## 1. NUEVO NODO: "Verificar Duplicados WordPress"

### Ubicación en el flujo:
```
Seleccionar Tema Aleatorio → [NUEVO] Verificar Duplicados → Research Topic Perplexity
```

### Paso 1: Crear nodo HTTP Request "Buscar Posts Existentes"

**Tipo:** HTTP Request
**Posición:** Entre "Seleccionar Tema Aleatorio" y "Research Topic- Perplexity1"

**Configuración:**
- Method: GET
- URL: `https://supernovarquitectos.com/wp-json/wp/v2/posts`
- Authentication: HTTP Basic Auth (mismas credenciales de WordPress)
- Query Parameters:
  - `search`: `{{ $json.tema }}`
  - `per_page`: `5`
  - `status`: `publish`

---

### Paso 2: Crear nodo Code "Verificar Similitud"

**Tipo:** Code (JavaScript)
**Posición:** Después de "Buscar Posts Existentes"

```javascript
// Verificar si ya existe un post similar sobre el tema
const temaActual = $('Seleccionar Tema Aleatorio').item.json.tema.toLowerCase();
const postsExistentes = $input.first().json;

// Función para calcular similitud básica
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

// Verificar duplicados
let esDuplicado = false;
let postSimilar = null;

if (Array.isArray(postsExistentes) && postsExistentes.length > 0) {
  for (const post of postsExistentes) {
    const tituloPost = post.title?.rendered || '';
    const similitud = calcularSimilitud(temaActual, tituloPost);

    // Si hay más de 60% de similitud, considerarlo duplicado
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

// Pasar datos del tema original
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

### Paso 3: Crear nodo IF "¿Es Duplicado?"

**Tipo:** IF
**Condición:**
- Left Value: `{{ $json.verificacion.es_duplicado }}`
- Operation: equal
- Right Value: `true`

**Conexiones:**
- TRUE → Nuevo nodo "Notificar Duplicado" (Telegram)
- FALSE → "Research Topic- Perplexity1"

---

### Paso 4: Crear nodo Telegram "Notificar Duplicado"

**Tipo:** Telegram - Send Message
**Configuración:**

```
Chat ID: 6074722648
Message: ⚠️ TEMA DUPLICADO DETECTADO

El tema "{{ $json.tema }}" ya tiene un post similar:

📝 Título existente: {{ $json.verificacion.post_similar.titulo }}
📅 Fecha: {{ $json.verificacion.post_similar.fecha }}
📊 Similitud: {{ $json.verificacion.post_similar.similitud }}

El workflow se ha detenido para evitar contenido duplicado.
Ejecuta manualmente mañana o modifica el selector de temas.
```

---

## 2. NODO ACTUALIZADO: "Seleccionar Tema Aleatorio"

### Reemplazar código completo con versión expandida (25 temas):

```javascript
// VERSIÓN EXPANDIDA: 25 temas para mayor variedad
const topics = [
  // === TECNOLOGÍA Y DIGITALIZACIÓN ===
  {
    tema: "BIM y gemelos digitales",
    enfoque: "Explica cómo la tecnología BIM y los gemelos digitales están transformando la gestión de proyectos arquitectónicos",
    formato: "guía práctica",
    palabras_clave: "BIM, gemelos digitales, gestión de proyectos, modelado 3D",
    categoria: 916
  },
  {
    tema: "IA en el diseño arquitectónico",
    enfoque: "Descubre cómo la inteligencia artificial está revolucionando el proceso de diseño",
    formato: "caso de estudio",
    palabras_clave: "inteligencia artificial, diseño generativo, automatización, machine learning en arquitectura",
    categoria: 916
  },
  {
    tema: "Realidad virtual y aumentada en arquitectura",
    enfoque: "Descubre cómo VR y AR están mejorando la presentación de proyectos y la experiencia del cliente",
    formato: "artículo educativo",
    palabras_clave: "realidad virtual, realidad aumentada, visualización arquitectónica, experiencia inmersiva",
    categoria: 916
  },
  {
    tema: "Impresión 3D en construcción",
    enfoque: "Explora las posibilidades de la impresión 3D para construir viviendas y estructuras",
    formato: "reporte de innovación",
    palabras_clave: "impresión 3D, construcción aditiva, fabricación digital, innovación constructiva",
    categoria: 916
  },
  {
    tema: "Drones en topografía y construcción",
    enfoque: "Analiza cómo los drones están optimizando el levantamiento topográfico y la supervisión de obras",
    formato: "artículo técnico",
    palabras_clave: "drones, topografía, fotogrametría, supervisión de obra",
    categoria: 916
  },
  {
    tema: "Software de renderizado en tiempo real",
    enfoque: "Compara las mejores herramientas de renderizado en tiempo real como Enscape, Twinmotion y Lumion",
    formato: "análisis comparativo",
    palabras_clave: "renderizado, tiempo real, Enscape, Twinmotion, visualización",
    categoria: 916
  },
  {
    tema: "Automatización de planos con IA",
    enfoque: "Explora herramientas que automatizan la generación de planos arquitectónicos",
    formato: "guía de herramientas",
    palabras_clave: "automatización, planos, IA arquitectura, productividad",
    categoria: 916
  },

  // === SUSTENTABILIDAD Y MEDIO AMBIENTE ===
  {
    tema: "Materiales sustentables",
    enfoque: "Analiza los materiales de construcción más innovadores y ecológicos del momento",
    formato: "análisis comparativo",
    palabras_clave: "materiales sustentables, construcción ecológica, economía circular, materiales reciclados",
    categoria: 917
  },
  {
    tema: "Energías renovables en edificios",
    enfoque: "Analiza la integración de paneles solares, aerogeneradores y otras tecnologías de energía limpia",
    formato: "guía de implementación",
    palabras_clave: "energía solar, aerogeneradores, eficiencia energética, net zero",
    categoria: 917
  },
  {
    tema: "Certificaciones verdes (LEED, BREEAM)",
    enfoque: "Explica los beneficios y el proceso para obtener certificaciones de sostenibilidad",
    formato: "guía paso a paso",
    palabras_clave: "LEED, BREEAM, certificación verde, construcción sustentable",
    categoria: 917
  },
  {
    tema: "Diseño bioclimático",
    enfoque: "Investiga las estrategias de diseño que aprovechan las condiciones climáticas locales",
    formato: "guía de diseño",
    palabras_clave: "diseño bioclimático, arquitectura pasiva, confort térmico, ventilación natural",
    categoria: 917
  },
  {
    tema: "Arquitectura regenerativa",
    enfoque: "Explora el concepto de edificios que generan más recursos de los que consumen",
    formato: "artículo conceptual",
    palabras_clave: "arquitectura regenerativa, impacto positivo, sostenibilidad avanzada, diseño regenerativo",
    categoria: 917
  },
  {
    tema: "Techos y muros verdes",
    enfoque: "Analiza los beneficios y técnicas de implementación de vegetación en edificios",
    formato: "guía técnica",
    palabras_clave: "techos verdes, muros vegetales, jardines verticales, infraestructura verde",
    categoria: 917
  },
  {
    tema: "Captación de agua pluvial en edificios",
    enfoque: "Diseña sistemas eficientes de recolección y reutilización de agua de lluvia",
    formato: "manual técnico",
    palabras_clave: "captación pluvial, agua lluvia, sustentabilidad hídrica, edificios verdes",
    categoria: 917
  },

  // === CONSTRUCCIÓN E INGENIERÍA ===
  {
    tema: "Construcción modular y prefabricada",
    enfoque: "Investiga cómo la construcción modular está reduciendo tiempos y costos",
    formato: "análisis técnico",
    palabras_clave: "construcción modular, prefabricación, industrialización, eficiencia constructiva",
    categoria: 918
  },
  {
    tema: "Domótica y edificios inteligentes",
    enfoque: "Explora las últimas tendencias en automatización residencial y edificios inteligentes",
    formato: "artículo de tendencias",
    palabras_clave: "domótica, smart buildings, IoT, automatización del hogar",
    categoria: 918
  },
  {
    tema: "Estructuras de madera de gran altura",
    enfoque: "Analiza el auge de los edificios de madera y la tecnología CLT",
    formato: "caso de estudio",
    palabras_clave: "madera laminada, CLT, edificios de madera, construcción sustentable",
    categoria: 918
  },
  {
    tema: "Concreto de ultra alto rendimiento",
    enfoque: "Explora las propiedades y aplicaciones del UHPC en arquitectura moderna",
    formato: "artículo técnico",
    palabras_clave: "UHPC, concreto avanzado, materiales innovadores, resistencia estructural",
    categoria: 918
  },
  {
    tema: "Retrofitting y renovación energética",
    enfoque: "Estrategias para actualizar edificios existentes a estándares modernos de eficiencia",
    formato: "guía de implementación",
    palabras_clave: "retrofitting, renovación, eficiencia energética, edificios existentes",
    categoria: 918
  },

  // === GESTIÓN Y METODOLOGÍAS ===
  {
    tema: "Gestión de proyectos con metodologías ágiles",
    enfoque: "Explora cómo Scrum y otras metodologías ágiles se aplican en la construcción",
    formato: "caso práctico",
    palabras_clave: "metodologías ágiles, Scrum, gestión de proyectos, colaboración",
    categoria: 919
  },
  {
    tema: "Lean Construction",
    enfoque: "Implementa principios Lean para reducir desperdicios y optimizar procesos constructivos",
    formato: "guía de implementación",
    palabras_clave: "lean construction, eficiencia, reducción desperdicios, mejora continua",
    categoria: 919
  },
  {
    tema: "Contratos colaborativos IPD",
    enfoque: "Explora el modelo Integrated Project Delivery y sus beneficios",
    formato: "artículo educativo",
    palabras_clave: "IPD, contratos colaborativos, gestión integrada, trabajo en equipo",
    categoria: 919
  },

  // === DISEÑO Y TENDENCIAS ===
  {
    tema: "Arquitectura paramétrica",
    enfoque: "Descubre cómo el diseño paramétrico está creando formas arquitectónicas únicas",
    formato: "análisis de tendencias",
    palabras_clave: "diseño paramétrico, Grasshopper, geometría compleja, arquitectura digital",
    categoria: 920
  },
  {
    tema: "Neuroarquitectura",
    enfoque: "Explora cómo el diseño de espacios afecta el bienestar y la productividad",
    formato: "artículo científico",
    palabras_clave: "neuroarquitectura, bienestar, diseño centrado en humanos, espacios saludables",
    categoria: 920
  },
  {
    tema: "Diseño biofílico",
    enfoque: "Integra elementos naturales en el diseño arquitectónico para mejorar la calidad de vida",
    formato: "guía de diseño",
    palabras_clave: "diseño biofílico, naturaleza, bienestar, conexión natural",
    categoria: 920
  }
];

// Contextos temporales expandidos
const temporalContext = [
  "considerando las tendencias más recientes del mercado",
  "tomando en cuenta las innovaciones de este año",
  "con enfoque en soluciones aplicables en México",
  "destacando casos de éxito recientes",
  "con proyección hacia el futuro cercano",
  "analizando el impacto post-pandemia en el sector",
  "considerando la inflación y optimización de costos",
  "con énfasis en soluciones para clima cálido",
  "destacando proyectos latinoamericanos exitosos",
  "con visión de implementación inmediata"
];

// Seleccionar tema aleatorio
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

## 3. NODO ACTUALIZADO: "Crear Post en Wordpress1"

### Usar categoría dinámica según el tema:

**Actualizar JSON Body:**

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

## 4. ACTUALIZAR: Google Sheets con más datos

### Agregar columnas al nodo "Publicaciones Wordpress SUPERNOVA1":

Agrega estos campos adicionales al mapping:

| Campo | Valor |
|-------|-------|
| TEMA | `={{ $('Seleccionar Tema Aleatorio').item.json.tema }}` |
| CATEGORIA | `={{ $('Seleccionar Tema Aleatorio').item.json.categoria }}` |
| META_DESC | `={{ $('Get Title, Content, and Image FileName1').item.json.meta_description }}` |
| FORMATO | `={{ $('Seleccionar Tema Aleatorio').item.json.formato }}` |

**Nota:** Asegúrate de agregar estas columnas en tu Google Sheet primero.

---

## 5. NUEVO: Sticky Note de Categorías

Agregar sticky note con el mapeo de categorías:

```
## 📂 MAPEO DE CATEGORÍAS

ID    | Categoría
------|---------------------------
916   | Tecnología y Digitalización
917   | Sustentabilidad
918   | Construcción e Ingeniería
919   | Gestión y Metodologías
920   | Diseño y Tendencias

Nota: Crear estas categorías en WordPress
si no existen.
```

---

## Diagrama de Flujo Actualizado

```
┌──────────────────────┐
│ Schedule Trigger     │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Consultar Telegram   │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ If3 (Aprobado?)      │
└──────────┬───────────┘
           │ TRUE
           ▼
┌──────────────────────┐
│ Seleccionar Tema     │ ← 25 temas + categoría
│ Aleatorio            │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ [NUEVO] Buscar Posts │ ← WordPress API search
│ Existentes           │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ [NUEVO] Verificar    │
│ Similitud            │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ [NUEVO] ¿Es          │
│ Duplicado?           │
└──────────┬───────────┘
           │
     ┌─────┴─────┐
     │           │
   FALSE       TRUE
     │           │
     ▼           ▼
┌─────────┐  ┌──────────────┐
│Research │  │Notificar     │
│Perplexity│  │Duplicado     │
└─────────┘  │(Telegram)    │
             └──────────────┘
```

---

## Verificación Post-Implementación

### Checklist:

- [ ] Crear categorías 916-920 en WordPress si no existen
- [ ] Agregar columnas TEMA, CATEGORIA, META_DESC, FORMATO en Google Sheets
- [ ] Crear nodo "Buscar Posts Existentes"
- [ ] Crear nodo "Verificar Similitud"
- [ ] Crear nodo IF "¿Es Duplicado?"
- [ ] Crear nodo Telegram "Notificar Duplicado"
- [ ] Actualizar código de "Seleccionar Tema Aleatorio"
- [ ] Actualizar JSON de "Crear Post en Wordpress1"
- [ ] Conectar todos los nodos en el orden correcto
- [ ] Probar con ejecución manual

---

## Beneficios de las Mejoras

| Mejora | Beneficio |
|--------|-----------|
| 25 temas | 250+ combinaciones únicas (antes 60) |
| Verificación duplicados | Evita contenido repetido |
| Categorías dinámicas | Mejor organización SEO |
| Tracking expandido | Analytics más detallados |

---

**Archivo generado:** 2024-11-27
**Workflow ID:** L8n2DAmhwdbf8yUA
