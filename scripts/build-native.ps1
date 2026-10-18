$ErrorActionPreference = 'Stop'
$inkRoot = Split-Path -Parent $PSScriptRoot
$inkCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$inkSource = Join-Path $inkRoot 'native\InkVoice.Input.cs'
$inkBin = Join-Path $inkRoot 'native\bin'
$inkOutput = Join-Path $inkBin 'InkVoice.Input.exe'
if (-not (Test-Path -LiteralPath $inkCompiler)) { throw 'Windows .NET Framework x64 C# compiler is unavailable.' }
New-Item -ItemType Directory -Path $inkBin -Force | Out-Null
& $inkCompiler /nologo /target:exe /platform:x64 /optimize+ /utf8output "/out:$inkOutput" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll $inkSource
if ($LASTEXITCODE -ne 0) { throw "Native helper compilation failed: $LASTEXITCODE" }
& $inkOutput --check
if ($LASTEXITCODE -ne 0) { throw "Native helper layout check failed: $LASTEXITCODE" }
