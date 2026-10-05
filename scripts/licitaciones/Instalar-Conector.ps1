<#
.SYNOPSIS
  Instala el conector local de ComprasMX (Control de Obra, US-851) para el usuario actual.

.DESCRIPTION
  - Copia conector-local.py y comprasmx-recolector.py a %LOCALAPPDATA%\control-obra\conector\
  - Crea un acceso en la carpeta Inicio del usuario que lo lanza oculto con pythonw.exe (sin consola,
    sin navegador: Chrome sólo se abre cuando la app pide una búsqueda).
  - Lo inicia en este momento y comprueba que http://127.0.0.1:8879/estado responde.
  No pide permisos de administrador ni crea tareas programadas.

.PARAMETER Python
  Ruta a python.exe (por omisión, el primero del PATH). Debe tener Playwright instalado.

.PARAMETER TlsInseguro
  Escribe CONVOCATORIAS_TLS_INSEGURO=1 en conector.env (sólo en redes que inspeccionan TLS, como la oficina).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Instalar-Conector.ps1 -TlsInseguro
#>
[CmdletBinding()]
param(
  [string]$Python = '',
  [switch]$TlsInseguro
)
$ErrorActionPreference = 'Stop'

$origen   = Split-Path -Parent $MyInvocation.MyCommand.Path
$destino  = Join-Path $env:LOCALAPPDATA 'control-obra\conector'
$inicio   = [Environment]::GetFolderPath('Startup')
$acceso   = Join-Path $inicio 'Conector Control de Obra.lnk'
$secreto  = Join-Path $env:USERPROFILE '.config\control-obra\convocatorias.env'
$url      = 'http://127.0.0.1:8879/estado'

function Detener-Conector {
  $procs = Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*conector-local.py*' -and $_.CommandLine -notlike '*--consola*' }
  foreach ($p in $procs) {
    Write-Host "Deteniendo el conector anterior (PID $($p.ProcessId))..."
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($procs) { Start-Sleep -Seconds 1 }
}

# 1. Python con Playwright
if (-not $Python) {
  $cmd = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'No se encontró python.exe en el PATH. Instala Python 3.10+ o pasa -Python <ruta>.' }
  $Python = $cmd.Source
}
$pythonw = Join-Path (Split-Path -Parent $Python) 'pythonw.exe'
if (-not (Test-Path $pythonw)) { throw "No existe $pythonw (hace falta pythonw.exe junto a python.exe)." }
& $Python -c "import playwright" 2>$null
if ($LASTEXITCODE -ne 0) { throw "Playwright no está instalado para $Python. Ejecuta: `"$Python`" -m pip install playwright" }

# 2. Chrome y secreto (sólo avisos: el conector arranca igual y lo reporta en /estado)
$chrome = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) { Write-Warning 'Google Chrome no está instalado: el conector arrancará, pero las búsquedas fallarán hasta instalarlo.' }
if (-not (Test-Path $secreto)) { Write-Warning "No existe $secreto (secreto de ingesta): las búsquedas no podrán guardar resultados." }

# 3. Copiar archivos
Detener-Conector
New-Item -ItemType Directory -Force -Path $destino | Out-Null
foreach ($f in 'conector-local.py', 'comprasmx-recolector.py') {
  Copy-Item -Path (Join-Path $origen $f) -Destination (Join-Path $destino $f) -Force
}
$envLocal = Join-Path $destino 'conector.env'
if ($TlsInseguro) {
  Set-Content -Path $envLocal -Value '# Red con inspección TLS: no verificar certificados al hablar con Supabase' , 'CONVOCATORIAS_TLS_INSEGURO=1' -Encoding ASCII
} elseif (Test-Path $envLocal) {
  Remove-Item $envLocal -Force
}
$script = Join-Path $destino 'conector-local.py'

# 4. Acceso en Inicio (oculto: pythonw no abre consola)
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($acceso)
$lnk.TargetPath = $pythonw
$lnk.Arguments = "`"$script`""
$lnk.WorkingDirectory = $destino
$lnk.WindowStyle = 7
$lnk.Description = 'Conector local de ComprasMX para Control de Obra (escucha en 127.0.0.1:8879)'
$lnk.Save()
Write-Host "Acceso creado: $acceso"

# 5. Iniciar ahora y comprobar
Start-Process -FilePath $pythonw -ArgumentList "`"$script`"" -WorkingDirectory $destino -WindowStyle Hidden
$estado = $null
for ($i = 0; $i -lt 30 -and -not $estado; $i++) {
  Start-Sleep -Milliseconds 500
  try { $estado = Invoke-RestMethod -Uri $url -TimeoutSec 2 } catch { $estado = $null }
}
if (-not $estado) {
  $log = Join-Path $env:LOCALAPPDATA 'control-obra\conector.log'
  throw "El conector no respondió en $url. Revisa la bitácora: $log (¿puerto 8879 ocupado?)."
}
Write-Host ("Conector activo: version {0}, chrome={1}, ocupado={2}" -f $estado.version, $estado.chrome, $estado.ocupado)
Write-Host "Archivos en $destino; bitácora en $(Join-Path $env:LOCALAPPDATA 'control-obra\conector.log')"
