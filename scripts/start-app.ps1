[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packagedExe = Join-Path $projectRoot 'release\InkVoice\InkVoice.exe'
$devExe = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
if (Test-Path -LiteralPath $packagedExe) {
    Start-Process -FilePath $packagedExe -WorkingDirectory (Split-Path -Parent $packagedExe) -WindowStyle Normal
} elseif (Test-Path -LiteralPath $devExe) {
    Start-Process -FilePath $devExe -ArgumentList ('"' + $projectRoot + '"') -WorkingDirectory $projectRoot -WindowStyle Normal
} else {
    throw 'InkVoice runtime was not found. Run npm ci, or use a complete portable release folder.'
}
