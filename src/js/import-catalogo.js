// ========== IMPORTAR CATALOGO MEJORADO ==========
let importCsvData = [];
let importCsvHeaders = [];
let importColumnMapping = {}; // {columnIndex: fieldName}
let importPreset = null; // "opus" | "neodata" | null (US-242)

const IMPORT_FIELDS = [
  {key:'clave', label:'Clave', icon:'ri-key-line', color:'bg-blue-500'},
  {key:'descripcion', label:'Descripcion', icon:'ri-file-text-line', color:'bg-purple-500'},
  {key:'unidad', label:'Unidad', icon:'ri-ruler-line', color:'bg-green-500'},
  {key:'cantidad', label:'Cantidad', icon:'ri-hashtag', color:'bg-amber-500'},
  {key:'precio_unitario', label:'P. Unitario', icon:'ri-money-dollar-circle-line', color:'bg-cyan-500'},
  {key:'partida', label:'Partida', icon:'ri-folder-line', color:'bg-pink-500'},
  {key:'categoria', label:'Categoria', icon:'ri-price-tag-3-line', color:'bg-indigo-500'}
];

function openMdlImportCatalogo(){
openMdl('mdlImportCatalogo');
importCsvData = [];
importCsvHeaders = [];
importColumnMapping = {};
$('mdlImportCatalogoContent').innerHTML=`
<h2 class="text-lg font-bold n mb-4"><i class="ri-upload-2-line mr-2"></i>Importar Catalogo de Conceptos</h2>
<div class="space-y-4">
<!-- Paso 1: Seleccionar archivo -->
<div id="importStep1">
<div class="g rounded-lg p-4 border-2 border-dashed border-gray-600 hover:border-cyan-500 transition-colors cursor-pointer" onclick="document.getElementById('csvFileInput').click()">
<input type="file" id="csvFileInput" accept=".csv,.txt,.tsv,.xlsx,.xls" class="hidden" onchange="handleCsvFile(event)">
<div class="text-center py-6">
<i class="ri-file-excel-2-line text-4xl text-cyan-400 mb-2"></i>
<p class="text-sm text-gray-300">Haz clic para seleccionar el archivo</p>
<p class="text-xs text-gray-500 mt-1">Excel exportado de OPUS o Neodata (.xlsx) o CSV. Las columnas se reconocen solas.</p>
</div>
</div>
<div class="text-center my-3 text-gray-500 text-xs">-- o pega los datos directamente --</div>
<textarea id="importPasteData" class="inp w-full text-xs" rows="4" placeholder="Pega aqui datos separados por coma, tabulador o punto y coma..."></textarea>
<button onclick="processPastedData()" class="mt-2 px-4 py-2 rounded bg-gray-700 text-sm hover:bg-gray-600 w-full">
<i class="ri-clipboard-line mr-1"></i>Procesar datos pegados
</button>
</div>

<!-- Paso 2: Mapear columnas con drag & drop -->
<div id="importStep2" class="hidden">
<div class="flex items-center justify-between mb-3">
<span class="text-sm text-gray-300"><i class="ri-drag-drop-line mr-1"></i>Arrastra los campos a las columnas <span id="importPresetBadge"></span></span>
<button onclick="resetImport()" class="text-xs text-cyan-400 hover:underline"><- Cambiar archivo</button>
</div>

<!-- Campos disponibles para arrastrar -->
<div class="g rounded-lg p-3 mb-3">
<p class="text-xs text-gray-400 mb-2">Campos disponibles (arrastra a las columnas):</p>
<div id="availableFields" class="flex flex-wrap gap-2"></div>
</div>

<!-- Tabla de columnas con drop zones -->
<div class="g rounded-lg p-3 mb-3 overflow-x-auto">
<p class="text-xs text-gray-400 mb-2">Vista previa - haz clic o arrastra para asignar campos:</p>
<div id="previewTable" class="text-xs"></div>
</div>

<div id="importPreview" class="g rounded-lg p-3 mb-3 hidden"></div>
<div class="flex gap-2 mt-4">
<button onclick="executeImport()" class="flex-1 py-2 rounded bg-gradient-to-r from-cyan-500 to-purple-600 text-white text-sm hover:opacity-90">
<i class="ri-upload-2-line mr-1"></i>Importar <span id="importCount">0</span> conceptos
</button>
<button onclick="closeMdl('mdlImportCatalogo');openMdlCatalogo()" class="px-4 py-2 rounded g text-sm">Cancelar</button>
</div>
</div>
</div>
`;
}

function handleCsvFile(event){
const file = event.target.files[0];
if(!file) return;
if(/\.xlsx?$/i.test(file.name)){
const rd = new FileReader();
rd.onload = function(e){
try{
const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:''}).map(r => r.map(v => v === null || v === undefined ? '' : v));
cargarFilas(rows);
}catch(err){ Toast.error('No se pudo leer el Excel: ' + (err.message||err)); }
};
rd.readAsArrayBuffer(file);
return;
}
const reader = new FileReader();
reader.onload = function(e){
// Limpiar caracteres problematicos de encoding
let content = e.target.result;
// Reemplazar caracteres mal codificados comunes
content = content.replace(/[^\x00-\x7F]/g, char => {
  // Mantener caracteres latinos comunes
  const latinChars = 'aeiouAEIOUnNuU';
  const accented = 'áéíóúÁÉÍÓÚñÑüÜ';
  const idx = accented.indexOf(char);
  if(idx >= 0) return char; // Mantener acentos validos
  return char; // Mantener otros caracteres
});
parseCsvContent(content);
};
// Intentar detectar encoding - primero UTF-8, luego ISO-8859-1
reader.readAsText(file, 'UTF-8');
}

function processPastedData(){
const text = $('importPasteData').value;
if(!text.trim()){
Toast.warning('Pega datos primero');
return;
}
parseCsvContent(text);
}

// Funcion auxiliar para parsear una linea CSV respetando comillas
function parseCSVLine(line, sep){
const cells = [];
let current = '';
let inQuotes = false;
for(let i = 0; i < line.length; i++){
const char = line[i];
const nextChar = line[i+1];
if(char === '"'){
if(inQuotes && nextChar === '"'){
// Comilla escapada dentro de campo ""
current += '"';
i++; // Saltar la siguiente comilla
} else {
// Toggle estado de comillas
inQuotes = !inQuotes;
}
} else if(char === sep && !inQuotes){
cells.push(current.trim());
current = '';
} else {
current += char;
}
}
cells.push(current.trim());
return cells;
}

function parseCsvContent(content){
const lines = content.split(/\r?\n/).filter(l => l.trim());
if(lines.length < 1){
Toast.error('No se encontraron datos');
return;
}

// Detectar separador probando cada uno y viendo cual da mas consistencia de columnas
const separators = ['\t', ';', ','];
let bestSep = ',';
let bestScore = -1;

separators.forEach(sep => {
const testLines = lines.slice(0, Math.min(10, lines.length));
const colCounts = testLines.map(line => parseCSVLine(line, sep).length);
const modeCount = colCounts.filter(c => c === colCounts[0]).length;
const avgCols = colCounts.reduce((a,b) => a+b, 0) / colCounts.length;
// Score = consistencia * promedio de columnas
const score = (modeCount / testLines.length) * avgCols;
console.log('CSV Parser - Probando separador "' + (sep === '\t' ? 'TAB' : sep) + '": cols=[' + colCounts.join(',') + '] score=' + score.toFixed(2));
if(score > bestScore && avgCols > 1){
bestScore = score;
bestSep = sep;
}
});

const separator = bestSep;
console.log('CSV Parser - Separador elegido:', separator === '\t' ? 'TAB' : separator);

// Parsear todas las lineas con el separador elegido y filtrar vacias
importCsvData = lines.map((line, lineIdx) => {
const cells = parseCSVLine(line, separator);
if(lineIdx < 3) console.log('CSV Parser - Linea ' + lineIdx + ':', cells);
return cells;
}).filter(cells => {
// Filtrar filas donde todas las celdas estan vacias
return cells.some(c => c && c.trim());
});

cargarFilas(importCsvData);
}

/** Recibe una matriz de filas (Excel o CSV), localiza los encabezados y detecta el preset (US-242). */
function cargarFilas(rows){
rows = (rows||[]).filter(r => r && r.some(c => String(c ?? '').trim()));
if(!rows.length){ Toast.error('No se encontraron datos'); return; }
const esHeader = (r) => { const t = r.map(c => String(c ?? '').toLowerCase()); return t.filter(Boolean).length >= 3 && t.some(c => /clave|codigo|código|desc|concepto/.test(c)) && t.some(c => /unidad|cantidad|precio|p\.u|unitario|importe/.test(c)); };
let hIdx = rows.slice(0, 25).findIndex(esHeader);
if(hIdx > 0){ rows = rows.slice(hIdx); }
importCsvData = rows.map(r => r.map(c => String(c ?? '').trim()));
// Usar primera fila como headers o generar
const firstRow = importCsvData[0];
const looksLikeHeaders = firstRow.some(cell => {
const lower = cell.toLowerCase();
return lower.includes('clave') || lower.includes('desc') || lower.includes('unidad') ||
       lower.includes('cantidad') || lower.includes('precio') || lower.includes('partida');
});

if(looksLikeHeaders){
importCsvHeaders = importCsvData.shift();
} else {
importCsvHeaders = firstRow.map((_, i) => `Columna ${i+1}`);
}

showMappingStep();
}


function showMappingStep(){
$('importStep1').classList.add('hidden');
$('importStep2').classList.remove('hidden');
$('importCount').textContent = importCsvData.length;

// Analizar datos para detectar columnas con contenido
const columnStats = importCsvHeaders.map((_, i) => {
let hasData = 0, isNumeric = 0, isUnit = 0, maxLen = 0;
importCsvData.slice(0,10).forEach(row => {
const val = (row[i] || '').trim();
if(val) {
hasData++;
maxLen = Math.max(maxLen, val.length);
const cleanNum = val.replace(/[$,\s]/g, '');
if(!isNaN(parseFloat(cleanNum))) isNumeric++;
if(['m2','m3','ml','pza','kg','lt','lote','jgo','m','un','und'].includes(val.toLowerCase())) isUnit++;
}
});
return { idx: i, hasData, isNumeric, isUnit, maxLen };
});

// Auto-detectar mapeo
importColumnMapping = {};
const colsWithData = columnStats.filter(c => c.hasData > 0);

// Por nombre de header
importCsvHeaders.forEach((h, i) => {
const hl = h.toLowerCase();
if(hl.includes('clave') || hl.includes('codigo') || hl.includes('code')) importColumnMapping[i] = 'clave';
else if(hl.includes('desc') || hl.includes('concepto') || hl.includes('nombre')) importColumnMapping[i] = 'descripcion';
else if(hl.includes('unidad') || hl.includes('unit') || hl === 'u') importColumnMapping[i] = 'unidad';
else if(hl.includes('cant') || hl.includes('qty')) importColumnMapping[i] = 'cantidad';
else if(hl.includes('precio') || hl.includes('pu') || hl.includes('unitario') || hl.includes('costo')) importColumnMapping[i] = 'precio_unitario';
else if(hl.includes('partida') || hl.includes('capitulo')) importColumnMapping[i] = 'partida';
else if(hl.includes('categ') || hl.includes('tipo')) importColumnMapping[i] = 'categoria';
});

// Por contenido si no se detecto por header
if(!Object.values(importColumnMapping).includes('unidad')){
const unitCol = colsWithData.find(c => c.isUnit > 0);
if(unitCol) importColumnMapping[unitCol.idx] = 'unidad';
}
if(!Object.values(importColumnMapping).includes('descripcion')){
const descCol = colsWithData.filter(c => c.isNumeric < c.hasData/2 && !importColumnMapping[c.idx]).sort((a,b) => b.maxLen - a.maxLen)[0];
if(descCol) importColumnMapping[descCol.idx] = 'descripcion';
}
if(!Object.values(importColumnMapping).includes('clave')){
const claveCol = colsWithData.find(c => !importColumnMapping[c.idx]);
if(claveCol) importColumnMapping[claveCol.idx] = 'clave';
}
const numericCols = colsWithData.filter(c => c.isNumeric >= c.hasData/2 && !importColumnMapping[c.idx]).sort((a,b) => a.idx - b.idx);
if(!Object.values(importColumnMapping).includes('cantidad') && numericCols.length > 0) importColumnMapping[numericCols[0].idx] = 'cantidad';
if(!Object.values(importColumnMapping).includes('precio_unitario') && numericCols.length > 1) importColumnMapping[numericCols[1].idx] = 'precio_unitario';

// Preset OPUS / Neodata (US-242): sustituye el mapeo si reconoce los encabezados
importPreset = null;
try{
const det = ImportPresets.detectar(importCsvHeaders);
if(det.preset){ importPreset = det.preset; importColumnMapping = {}; Object.entries(det.mapping).forEach(([i,f]) => { if(f !== 'importe') importColumnMapping[i] = f; }); importColumnMapping.__importe = det.mapping; }
}catch(e){}
const badge = $('importPresetBadge'); if(badge) badge.innerHTML = importPreset ? `<span class="ml-2 px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-800">Formato ${importPreset === 'opus' ? 'OPUS' : 'Neodata'} reconocido</span>` : '';
console.log('Mapeo automatico:', importColumnMapping, 'preset:', importPreset);

renderMappingUI();
renderImportPreview();
}

/** Vista previa agrupada por partida con errores por fila (US-242). */
function importMappingLimpio(){ const mp = {}; Object.entries(importColumnMapping).forEach(([k,v]) => { if(!String(k).startsWith('__')) mp[k] = v; }); const extra = importColumnMapping.__importe || {}; Object.entries(extra).forEach(([k,v]) => { if(v === 'importe' && !mp[k]) mp[k] = 'importe'; }); return mp; }
function renderImportPreview(){
const box = $('importPreview'); if(!box) return;
try{
const r = ImportPresets.construir(importCsvData, importMappingLimpio(), {});
window._importResultado = r;
$('importCount').textContent = r.conceptos.length;
const total = r.conceptos.reduce((s,c) => s + c.cantidad * c.precio_unitario, 0);
box.classList.remove('hidden');
box.innerHTML = `<p class="text-xs text-gray-400 mb-2"><i class="ri-eye-line mr-1"></i>Se importarán <strong>${r.conceptos.length}</strong> conceptos${r.partidas.length ? ` en <strong>${r.partidas.length}</strong> partidas` : ''} · importe ${typeof fmt === 'function' ? fmt(total) : total.toFixed(2)}</p>
${r.partidas.length ? `<ul class="text-xs space-y-1 max-h-40 overflow-y-auto">${r.partidas.map(p => `<li class="flex justify-between gap-2"><span class="truncate">${'&nbsp;'.repeat(Math.max(0,(p.nivel-1)*3))}${S(p.clave ? p.clave + ' ' : '')}${S(p.nombre)}</span><span class="text-gray-500 shrink-0">${p.n} concepto${p.n === 1 ? '' : 's'}</span></li>`).join('')}</ul>` : ''}
${r.errores.length ? `<details class="mt-2"><summary class="text-xs text-amber-600 cursor-pointer">${r.errores.length} aviso${r.errores.length === 1 ? '' : 's'} por fila</summary><ul class="text-xs text-gray-400 mt-1 max-h-32 overflow-y-auto">${r.errores.slice(0,80).map(e => `<li>Fila ${e.fila}: ${S(e.motivo)}</li>`).join('')}</ul></details>` : '<p class="text-xs text-emerald-600 mt-1">Sin avisos.</p>'}`;
}catch(e){ box.classList.add('hidden'); }
}

function renderMappingUI(){
// Campos disponibles (no asignados)
const assignedFields = Object.values(importColumnMapping);
let fieldsHtml = '';
IMPORT_FIELDS.forEach(f => {
const isAssigned = assignedFields.includes(f.key);
fieldsHtml += `
<div draggable="${!isAssigned}"
     id="field_${f.key}"
     data-field="${f.key}"
     class="field-chip px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 ${isAssigned ? 'bg-gray-700 text-gray-500 cursor-not-allowed opacity-50' : f.color + ' text-white cursor-grab shadow-lg hover:scale-105'} transition-all"
     ${!isAssigned ? `ondragstart="onFieldDragStart(event)" ondragend="onFieldDragEnd(event)"` : ''}>
  <i class="${f.icon}"></i>${f.label}
</div>`;
});
$('availableFields').innerHTML = fieldsHtml;

// Filtrar solo columnas con datos
const colsWithData = [];
importCsvHeaders.forEach((_, i) => {
const hasData = importCsvData.slice(0,5).some(row => (row[i]||'').trim());
if(hasData || importColumnMapping[i]) colsWithData.push(i);
});

// Tabla preview con drop zones
let html = '<table class="w-full border-collapse"><thead><tr>';
colsWithData.forEach(i => {
const field = IMPORT_FIELDS.find(f => f.key === importColumnMapping[i]);
const headerText = field ? `<span class="flex items-center gap-1"><i class="${field.icon}"></i>${field.label}</span>` : `<span class="text-gray-500">Col ${i+1}</span>`;
html += `
<th class="p-1 min-w-[100px]">
  <div class="drop-zone rounded-lg p-2 border-2 border-dashed ${field ? field.color.replace('bg-','border-') + ' bg-opacity-20' : 'border-gray-600'} text-center cursor-pointer hover:border-cyan-400 transition-colors"
       data-col="${i}"
       ondragover="onColDragOver(event)"
       ondragleave="onColDragLeave(event)"
       ondrop="onColDrop(event)"
       onclick="onColClick(${i})">
    ${field ? `<div class="inline-flex items-center gap-1 px-2 py-1 rounded-full ${field.color} text-white text-xs"><i class="${field.icon}"></i>${field.label}<button onclick="event.stopPropagation();removeMapping(${i})" class="ml-1 hover:text-red-300"><i class="ri-close-line"></i></button></div>` : '<span class="text-gray-500 text-xs">Arrastra aqui</span>'}
  </div>
</th>`;
});
html += '</tr></thead><tbody>';

// Filas de datos
importCsvData.slice(0,5).forEach((row, rowIdx) => {
html += '<tr class="border-t border-gray-800">';
colsWithData.forEach(i => {
const val = row[i] || '';
const short = val.length > 20 ? val.substring(0,20) + '..' : val;
const field = IMPORT_FIELDS.find(f => f.key === importColumnMapping[i]);
html += `<td class="px-2 py-1.5 text-gray-300 ${field ? 'bg-opacity-10 ' + field.color.replace('bg-','bg-') + '/10' : ''}" title="${val.replace(/"/g,'&quot;')}">${short || '<span class="text-gray-600">-</span>'}</td>`;
});
html += '</tr>';
});

if(importCsvData.length > 5){
html += `<tr><td colspan="${colsWithData.length}" class="px-2 py-1 text-gray-500 text-center text-xs">... y ${importCsvData.length - 5} filas mas</td></tr>`;
}
html += '</tbody></table>';
$('previewTable').innerHTML = html;
}

// Drag & Drop handlers
let draggedField = null;

function onFieldDragStart(e){
draggedField = e.target.dataset.field;
e.target.classList.add('opacity-50', 'scale-95');
e.dataTransfer.effectAllowed = 'move';
}

function onFieldDragEnd(e){
e.target.classList.remove('opacity-50', 'scale-95');
document.querySelectorAll('.drop-zone').forEach(z => z.classList.remove('border-cyan-400', 'bg-cyan-500/20'));
}

function onColDragOver(e){
e.preventDefault();
e.currentTarget.classList.add('border-cyan-400', 'bg-cyan-500/20');
}

function onColDragLeave(e){
e.currentTarget.classList.remove('border-cyan-400', 'bg-cyan-500/20');
}

function onColDrop(e){
e.preventDefault();
const colIdx = parseInt(e.currentTarget.dataset.col);
if(draggedField && !isNaN(colIdx)){
  // Remover asignacion anterior de este campo
  Object.keys(importColumnMapping).forEach(k => {
    if(importColumnMapping[k] === draggedField) delete importColumnMapping[k];
  });
  importColumnMapping[colIdx] = draggedField;
  renderMappingUI();
}
draggedField = null;
}

function onColClick(colIdx){
// Mostrar menu de seleccion
const assignedFields = Object.values(importColumnMapping);
const available = IMPORT_FIELDS.filter(f => !assignedFields.includes(f.key) || importColumnMapping[colIdx] === f.key);

let menuHtml = '<div class="absolute z-50 mt-1 bg-gray-800 rounded-lg shadow-xl border border-gray-700 py-1 min-w-[150px]">';
menuHtml += `<div onclick="removeMapping(${colIdx});closeFieldMenu()" class="px-3 py-2 text-xs text-gray-400 hover:bg-gray-700 cursor-pointer flex items-center gap-2"><i class="ri-close-line"></i>Sin asignar</div>`;
IMPORT_FIELDS.forEach(f => {
const isAssigned = assignedFields.includes(f.key) && importColumnMapping[colIdx] !== f.key;
menuHtml += `<div onclick="${isAssigned ? '' : `assignField(${colIdx},'${f.key}');closeFieldMenu()`}" class="px-3 py-2 text-xs ${isAssigned ? 'text-gray-600 cursor-not-allowed' : 'text-white hover:bg-gray-700 cursor-pointer'} flex items-center gap-2"><i class="${f.icon}"></i>${f.label}</div>`;
});
menuHtml += '</div>';

// Cerrar menu existente
closeFieldMenu();

const menu = document.createElement('div');
menu.id = 'fieldMenu';
menu.innerHTML = menuHtml;
menu.style.position = 'fixed';

const rect = event.target.closest('.drop-zone').getBoundingClientRect();
menu.style.left = rect.left + 'px';
menu.style.top = (rect.bottom + 4) + 'px';

document.body.appendChild(menu);
setTimeout(() => document.addEventListener('click', closeFieldMenu, {once:true}), 10);
}

function closeFieldMenu(){
const menu = document.getElementById('fieldMenu');
if(menu) menu.remove();
}

function assignField(colIdx, fieldKey){
setTimeout(renderImportPreview, 0);
Object.keys(importColumnMapping).forEach(k => {
if(importColumnMapping[k] === fieldKey) delete importColumnMapping[k];
});
importColumnMapping[colIdx] = fieldKey;
renderMappingUI();
}

function removeMapping(colIdx){
setTimeout(renderImportPreview, 0);
delete importColumnMapping[colIdx];
renderMappingUI();
}

function resetImport(){
$('importStep1').classList.remove('hidden');
$('importStep2').classList.add('hidden');
$('csvFileInput').value = '';
$('importPasteData').value = '';
importCsvData = [];
importCsvHeaders = [];
importColumnMapping = {};
}

async function executeImport(){
if(importCsvData.length === 0){
Toast.error('No hay datos para importar');
return;
}

// Validar que hay al menos descripcion mapeada
if(!Object.values(importColumnMapping).includes('descripcion')){
Toast.error('Debes asignar al menos el campo Descripcion a una columna');
return;
}

// Validar que hay obra seleccionada
if(!selectedObra || selectedObra === 'all'){
Toast.error('Selecciona una obra especifica primero');
return;
}

// Construir conceptos con jerarquía de partidas y avisos por fila (US-242)
let conceptos = [];
let orden = (D.cc||[]).filter(c=>c.obra_id==selectedObra).length;
const resultado = ImportPresets.construir(importCsvData, importMappingLimpio(), { obra_id: parseInt(selectedObra), empresa_id: currentUser?.empresa_id || null, orden });
conceptos = resultado.conceptos.map(c => { const { partida, ...rest } = c; return Object.assign(rest, importColumnMapping.__usarPartida === false ? {} : { partida }); });
if(!conceptos.length){ Toast.error('No se encontró ningún concepto con descripción'); return; }
if(false) importCsvData.forEach((row, idx) => {
const concepto = {
obra_id: parseInt(selectedObra),
empresa_id: currentUser?.empresa_id || null,
orden: ++orden
};

Object.entries(importColumnMapping).forEach(([colIdx, field]) => {
let val = row[parseInt(colIdx)] || '';
if(field === 'cantidad' || field === 'precio_unitario'){
// Limpiar y convertir a numero - manejar formato $20,127.53
val = String(val).replace(/[$\s]/g,''); // Quitar $ y espacios
if(val.includes(',') && val.includes('.')){
// Formato 20,127.53 - coma es separador de miles
val = val.replace(/,/g, '');
} else if(val.includes(',')){
// Solo coma - determinar si es decimal o miles
const parts = val.split(',');
if(parts[1] && parts[1].length > 2){
// Mas de 2 digitos despues de coma = separador de miles
val = val.replace(/,/g, '');
} else {
// 2 o menos digitos = decimal
val = val.replace(',', '.');
}
}
val = parseFloat(val) || 0;
}
concepto[field] = val;
});

// Asegurar campos requeridos (NOT NULL)
concepto.clave = (concepto.clave && String(concepto.clave).trim()) || `C${String(idx+1).padStart(4,'0')}`;
concepto.descripcion = (concepto.descripcion && String(concepto.descripcion).trim()) || 'Sin descripcion';

// Defaults para opcionales
if(!concepto.unidad) concepto.unidad = 'PZA';
concepto.cantidad = Number(concepto.cantidad) || 0;
concepto.precio_unitario = Number(concepto.precio_unitario) || 0;
// NO incluir 'importe' - es columna generada en la BD

conceptos.push(concepto);
});

console.log('Conceptos a importar:', conceptos.slice(0,2), 'avisos:', resultado.errores.length);

try{
const{error} = await sb.from('catalogo_conceptos').insert(conceptos);
if(error) throw error;
Toast.success(`Se importaron ${conceptos.length} conceptos${resultado.partidas.length ? ` en ${resultado.partidas.length} partidas` : ''}${resultado.errores.length ? ` (${resultado.errores.length} avisos revisados)` : ''}`);
Cache.clear();
closeMdl('mdlImportCatalogo');
await L();
openMdlCatalogo();
}catch(err){
Toast.error('Error: ' + err.message);
}
}

console.log('Import Catalogo module loaded');
