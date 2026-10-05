<#
.SYNOPSIS
  Detiene y retira el conector local de ComprasMX (Control de Obra, US-851).

.DESCRIPTION
  Detiene el proceso, borra el acceso de la carpeta Inicio y la carpeta %LOCALAPPDATA%\control-obra\conector\.
  No toca el secreto de ingesta (~\.config\control-obra\convocatorias.env) ni los datos de la app.
  Con -ConservarBitacora deja %LOCALAPPDATA%\control-obra\conector.log.
#>
[CmdletBinding()]
param([switch]$ConservarBitacora)
$ErrorActionPreference = 'Stop'

$base    = Join-Path $env:LOCALAPPDATA 'control-obra'
$destino = Join-Path $base 'conector'
$acceso  = Join-Path ([Environment]::GetFolderPath('Startup')) 'Conector Control de Obra.lnk'

$procs = Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like '*conector-local.py*' }
foreach ($p in $procs) {
  Write-Host "Deteniendo el conector (PID $($p.ProcessId))..."
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
# Chrome sin cabeza que hubiera quedado de una búsqueda interrumpida (sólo los lanzados por Playwright)
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*--headless*' -and $_.CommandLine -like '*playwright*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

if (Test-Path $acceso) { Remove-Item $acceso -Force; Write-Host "Acceso retirado: $acceso" }
if (Test-Path $destino) { Remove-Item $destino -Recurse -Force; Write-Host "Carpeta retirada: $destino" }
$log = Join-Path $base 'conector.log'
if (-not $ConservarBitacora -and (Test-Path $log)) { Remove-Item $log -Force }

try {
  Invoke-RestMethod -Uri 'http://127.0.0.1:8879/estado' -TimeoutSec 2 | Out-Null
  Write-Warning 'Algo sigue respondiendo en 127.0.0.1:8879 (¿un conector abierto a mano con --consola?).'
} catch {
  Write-Host 'Conector retirado: 127.0.0.1:8879 ya no responde.'
}
