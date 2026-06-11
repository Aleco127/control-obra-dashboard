# Mejoras Baja Prioridad - SUPERNOVA WORDPRESS AUTO MEJORADO

## Resumen de Cambios

| Mejora | Impacto | Complejidad |
|--------|---------|-------------|
| Links internos | SEO ++++ | Alta |
| Compresión imagen | Performance +++ | Media |
| Polling inteligente | Eficiencia ++ | Media |

---

## 1. INYECCIÓN DE LINKS INTERNOS

### Objetivo
Agregar 2-3 enlaces a posts relacionados dentro del contenido generado para mejorar SEO y retención de usuarios.

### Ubicación en el flujo:
```
Get Title, Content... → [NUEVO] Buscar Posts Relacionados → [NUEVO] Inyectar Links → Message a model
```

---

### Paso 1: Crear nodo HTTP Request "Buscar Posts Relacionados"

**Tipo:** HTTP Request
**Posición:** Después de "Get Title, Content, and Image FileName1"

**Configuración:**
- Method: GET
- URL: `https://supernovarquitectos.com/wp-json/wp/v2/posts`
- Authentication: HTTP Basic Auth
- Query Parameters:
  - `categories`: `{{ $('Seleccionar Tema Aleatorio').item.json.categoria }}`
  - `per_page`: `10`
  - `status`: `publish`
  - `orderby`: `date`
  - `order`: `desc`

---

### Paso 2: Crear nodo Code "Inyectar Links Internos"

**Tipo:** Code (JavaScript)

```javascript
// Obtener datos del contenido actual
const contentData = $('Get Title, Content, and Image FileName1').item.json;
const postsRelacionados = $input.first().json;

// Título actual para evitar auto-referencia
const tituloActual = contentData.title.toLowerCase();

// Filtrar posts válidos (excluyendo el actual si existiera)
let postsValidos = [];
if (Array.isArray(postsRelacionados)) {
  postsValidos = postsRelacionados.filter(post => {
    const titulo = (post.title?.rendered || '').toLowerCase();
    // Excluir posts con título muy similar al actual
    return !titulo.includes(tituloActual.substring(0, 20)) &&
           titulo !== tituloActual;
  }).slice(0, 5); // Máximo 5 candidatos
}

// Si no hay posts relacionados, devolver contenido sin cambios
if (postsValidos.length === 0) {
  return [{
    json: {
      ...contentData,
      links_agregados: 0,
      links_info: []
    }
  }];
}

// Seleccionar 2-3 posts aleatorios para enlazar
const numLinks = Math.min(3, postsValidos.length);
const postsSeleccionados = [];
const indicesUsados = new Set();

while (postsSeleccionados.length < numLinks && indicesUsados.size < postsValidos.length) {
  const randomIndex = Math.floor(Math.random() * postsValidos.length);
  if (!indicesUsados.has(randomIndex)) {
    indicesUsados.add(randomIndex);
    postsSeleccionados.push(postsValidos[randomIndex]);
  }
}

// Función para limpiar título HTML
function limpiarTitulo(html) {
  return html.replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#039;/g, "'")
             .replace(/<[^>]*>/g, '');
}

// Crear sección de artículos relacionados
let seccionRelacionados = `
<h2>Artículos Relacionados</h2>
<p>Si te interesó este tema, te recomendamos explorar estos artículos:</p>
<ul>
`;

const linksInfo = [];
postsSeleccionados.forEach(post => {
  const titulo = limpiarTitulo(post.title?.rendered || 'Artículo relacionado');
  const url = post.link || '#';
  seccionRelacionados += `  <li><a href="${url}" title="${titulo}">${titulo}</a></li>\n`;
  linksInfo.push({ titulo, url });
});

seccionRelacionados += `</ul>`;

// Insertar la sección antes del último párrafo o al final
let contenidoModificado = contentData.content;

// Buscar el último </p> para insertar antes de la reflexión final
const ultimoParrafo = contenidoModificado.lastIndexOf('</p>');
if (ultimoParrafo > contenidoModificado.length * 0.7) {
  // Insertar antes del último párrafo si está en el último 30% del contenido
  contenidoModificado =
    contenidoModificado.substring(0, ultimoParrafo) +
    '</p>\n\n' + seccionRelacionados + '\n\n<p>' +
    contenidoModificado.substring(ultimoParrafo + 4);
} else {
  // Si no, agregar al final
  contenidoModificado += '\n\n' + seccionRelacionados;
}

return [{
  json: {
    title: contentData.title,
    content: contenidoModificado,
    image_filename: contentData.image_filename,
    meta_description: contentData.meta_description,
    excerpt: contentData.excerpt,
    links_agregados: postsSeleccionados.length,
    links_info: linksInfo
  }
}];
```

---

### Paso 3: Actualizar conexiones

**Antes:**
```
Get Title, Content... → Message a model
```

**Después:**
```
Get Title, Content... → Buscar Posts Relacionados → Inyectar Links Internos → Message a model
```

---

## 2. COMPRESIÓN DE IMAGEN

### Opción A: Usando TinyPNG API (Recomendado)

**Requiere:** API Key de TinyPNG (https://tinypng.com/developers)

### Paso 1: Crear nodo HTTP Request "Comprimir Imagen TinyPNG"

**Ubicación:** Entre "Get Leonardo Image1" y "Upload Image to Wordpress1"

**Configuración:**
- Method: POST
- URL: `https://api.tinify.com/shrink`
- Authentication: HTTP Basic Auth
  - Username: `api`
  - Password: `TU_API_KEY_TINYPNG`
- Headers:
  - Content-Type: `application/json`
- Body (JSON):
```json
{
  "source": {
    "url": "{{ $json.generations_by_pk.generated_images[0].url }}"
  }
}
```

---

### Paso 2: Crear nodo HTTP Request "Descargar Imagen Comprimida"

**Configuración:**
- Method: GET
- URL: `{{ $json.output.url }}`
- Response Format: File

---

### Opción B: Sin API externa (Reducir calidad en Leonardo)

**Alternativa más simple:** Modificar parámetros de Leonardo para generar imágenes más ligeras.

**Nodo:** `Leonardo: Create Post Image1`

**Actualizar JSON Body:**
```json
{
  "prompt": "{{ $json.message.content }}",
  "modelId": "6bef9f1b-29cb-40c7-b9df-32b51c1f67d3",
  "width": 1200,
  "height": 628,
  "sd_version": "v2",
  "num_images": 1,
  "promptMagic": true,
  "promptMagicStrength": 0.5,
  "public": false,
  "scheduler": "LEONARDO",
  "guidance_scale": 7,
  "photoReal": false,
  "presetStyle": "CINEMATIC"
}
```

**Cambios:**
- Dimensiones: 1280x720 → 1200x628 (tamaño óptimo Google Discover)
- Esto reduce el peso ~15-20%

---

## 3. POLLING INTELIGENTE PARA LEONARDO

### Objetivo
Reemplazar el Wait fijo de 1 minuto por un sistema de polling que:
- Verifica cada 15 segundos
- Máximo 8 intentos (2 minutos total)
- Continúa inmediatamente si está listo
- Notifica si falla después de todos los intentos

---

### Implementación: Loop con Contador

### Paso 1: Crear nodo Code "Inicializar Contador Polling"

**Ubicación:** Después de "Leonardo: Create Post Image1"

```javascript
// Inicializar contador de polling
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

### Paso 2: Modificar nodo "Wait"

**Configuración actualizada:**
- Amount: `15`
- Unit: `Seconds`

---

### Paso 3: Crear nodo HTTP Request "Check Leonardo Status"

**Reemplaza o actualiza:** `Get Leonardo Image Status1`

**Configuración:**
- Method: GET
- URL: `https://cloud.leonardo.ai/api/rest/v1/generations/{{ $json.generationId }}`
- Authentication: HTTP Bearer Auth (Leonardo)
- Headers:
  - accept: `application/json`

---

### Paso 4: Crear nodo Code "Evaluar Status Leonardo"

```javascript
const statusResponse = $input.first().json;
const pollingData = $('Inicializar Contador Polling').item.json;

const currentStatus = statusResponse.generations_by_pk?.status || 'UNKNOWN';
const intentosActuales = pollingData.intentos + 1;

// Determinar siguiente acción
let accion = 'REINTENTAR';
let imageUrl = null;

if (currentStatus === 'COMPLETE') {
  accion = 'COMPLETADO';
  imageUrl = statusResponse.generations_by_pk.generated_images[0]?.url;
} else if (currentStatus === 'FAILED') {
  accion = 'FALLIDO';
} else if (intentosActuales >= pollingData.maxIntentos) {
  accion = 'TIMEOUT';
} else {
  accion = 'REINTENTAR';
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

### Paso 5: Crear nodo Switch "Acción Leonardo"

**Tipo:** Switch
**Routing Rules:**

| Valor | Output | Conexión |
|-------|--------|----------|
| `COMPLETADO` | 0 | → Get Leonardo Image1 |
| `REINTENTAR` | 1 | → Wait (loop) |
| `FALLIDO` | 2 | → Error Leonardo AI |
| `TIMEOUT` | 3 | → Timeout Leonardo AI |

**Configuración:**
- Mode: Rules
- Data Type: String
- Value: `{{ $json.accion }}`

---

### Paso 6: Crear nodo Telegram "Timeout Leonardo AI"

```
⏱️ TIMEOUT en generación de imagen Leonardo AI

La imagen no se generó después de {{ $json.tiempoTranscurrido }}.

Generation ID: {{ $json.generationId }}
Último status: {{ $json.status }}
Intentos: {{ $json.intentos }}/{{ $json.maxIntentos }}
Tema: {{ $('Seleccionar Tema Aleatorio').item.json.tema }}

Posibles causas:
1. Alta demanda en Leonardo AI
2. Prompt muy complejo
3. Problema temporal del servicio

Recomendación: Reintentar en 5-10 minutos.
```

---

### Diagrama del Polling Inteligente

```
┌───────────────────┐
│ Leonardo: Create  │
│ Post Image        │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Inicializar       │
│ Contador Polling  │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Wait 15 seg       │◄─────────────┐
└─────────┬─────────┘              │
          │                        │
          ▼                        │
┌───────────────────┐              │
│ Check Leonardo    │              │
│ Status            │              │
└─────────┬─────────┘              │
          │                        │
          ▼                        │
┌───────────────────┐              │
│ Evaluar Status    │              │
└─────────┬─────────┘              │
          │                        │
          ▼                        │
┌───────────────────┐              │
│ Switch Acción     │              │
└─────────┬─────────┘              │
          │                        │
    ┌─────┼─────┬─────────┐        │
    │     │     │         │        │
 COMPLETE │  FAILED    TIMEOUT     │
    │     │     │         │        │
    ▼     │     ▼         ▼        │
┌──────┐  │ ┌───────┐ ┌────────┐   │
│Get   │  │ │Error  │ │Timeout │   │
│Image │  │ │Telegram│ │Telegram│   │
└──────┘  │ └───────┘ └────────┘   │
          │                        │
       REINTENTAR                  │
          │                        │
          └────────────────────────┘
```

---

## 4. ACTUALIZAR GOOGLE SHEETS CON MÉTRICAS

### Agregar campos de tracking

**Nodo:** `Publicaciones Wordpress SUPERNOVA1`

**Nuevos campos:**

| Campo | Valor |
|-------|-------|
| LINKS_INTERNOS | `={{ $('Inyectar Links Internos').item.json.links_agregados }}` |
| TIEMPO_IMAGEN | `={{ $('Evaluar Status Leonardo').item.json.tiempoTranscurrido }}` |
| INTENTOS_LEONARDO | `={{ $('Evaluar Status Leonardo').item.json.intentos }}` |

---

## 5. STICKY NOTES ACTUALIZADAS

### Sticky Note - Polling Inteligente

```
## ⚡ POLLING INTELIGENTE

Sistema de verificación dinámica:
- Intervalo: 15 segundos
- Máx intentos: 8 (2 min total)
- Acciones: COMPLETADO, REINTENTAR, FALLIDO, TIMEOUT

Beneficios:
✅ No espera innecesariamente
✅ Notifica errores específicos
✅ Registra tiempo de generación
```

### Sticky Note - Links Internos

```
## 🔗 LINKS INTERNOS SEO

Agrega automáticamente 2-3 enlaces a posts
de la misma categoría.

Beneficios:
✅ Mejora SEO (link juice interno)
✅ Aumenta tiempo en sitio
✅ Reduce bounce rate
✅ Mejora indexación
```

---

## Resumen de Nuevos Nodos

| Nodo | Tipo | Propósito |
|------|------|-----------|
| Buscar Posts Relacionados | HTTP Request | Obtener posts de misma categoría |
| Inyectar Links Internos | Code | Agregar sección de artículos relacionados |
| Comprimir Imagen TinyPNG | HTTP Request | (Opcional) Reducir peso de imagen |
| Descargar Imagen Comprimida | HTTP Request | (Opcional) Obtener imagen optimizada |
| Inicializar Contador Polling | Code | Configurar sistema de reintentos |
| Evaluar Status Leonardo | Code | Determinar siguiente acción |
| Switch Acción Leonardo | Switch | Enrutar según resultado |
| Timeout Leonardo AI | Telegram | Notificar timeout |

---

## Orden de Implementación

### Fase 1: Links Internos
1. ⬜ Crear nodo "Buscar Posts Relacionados"
2. ⬜ Crear nodo "Inyectar Links Internos"
3. ⬜ Reconectar flujo

### Fase 2: Polling Inteligente
4. ⬜ Crear nodo "Inicializar Contador Polling"
5. ⬜ Modificar Wait a 15 segundos
6. ⬜ Crear nodo "Evaluar Status Leonardo"
7. ⬜ Crear nodo Switch "Acción Leonardo"
8. ⬜ Crear nodo "Timeout Leonardo AI"
9. ⬜ Reconectar loop

### Fase 3: Compresión (Opcional)
10. ⬜ Obtener API Key TinyPNG
11. ⬜ Crear nodos de compresión
12. ⬜ O ajustar parámetros de Leonardo

### Fase 4: Tracking
13. ⬜ Agregar columnas en Google Sheets
14. ⬜ Actualizar mapping del nodo Sheets

---

## Configuración de Credenciales

### TinyPNG (si se usa)
1. Ir a https://tinypng.com/developers
2. Registrarse con email
3. Obtener API Key (500 compresiones/mes gratis)
4. Crear credencial HTTP Basic Auth en n8n:
   - Username: `api`
   - Password: `TU_API_KEY`

---

**Generado:** 2024-11-27
**Workflow:** SUPERNOVA - WORDPRESS AUTO MEJORADO
**ID:** L8n2DAmhwdbf8yUA
