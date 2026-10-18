[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$downloads = Join-Path $projectRoot 'tools\downloads'
$runtime = Join-Path $projectRoot 'runtime\whisper'
$models = Join-Path $projectRoot 'models'
$evidenceDir = Join-Path $projectRoot 'evidence'
foreach ($directory in @($downloads, $runtime, $models, $evidenceDir)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

# Pinned upstream artifacts. The v1.9.5 release explicitly links nightly b5454.
$archiveUrl = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip'
$archiveHash = '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb'
$archiveBytes = 8928640
$modelRevision = '5359861c739e955e79d9a303bcbc70fb988958b1'
$modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/$modelRevision/ggml-base-q5_1.bin?download=true"
$modelHash = '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898'
$modelBytes = 59707625

function Get-VerifiedArtifact {
    param([string]$Url, [string]$Destination, [string]$Sha256, [long]$Bytes)
    if ((Test-Path -LiteralPath $Destination) -and
        ((Get-Item -LiteralPath $Destination).Length -eq $Bytes) -and
        ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Sha256)) {
        Write-Host "Verified cached artifact: $Destination"
        return
    }
    $partial = "$Destination.partial"
    Write-Host "Downloading official artifact: $Url"
    Invoke-WebRequest -Uri $Url -OutFile $partial -UseBasicParsing
    $actualHash = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
    $actualBytes = (Get-Item -LiteralPath $partial).Length
    if ($actualHash -ne $Sha256 -or $actualBytes -ne $Bytes) {
        throw "Artifact integrity mismatch for $Destination. Received $actualBytes bytes, SHA256 $actualHash. Partial file retained for inspection."
    }
    Move-Item -LiteralPath $partial -Destination $Destination -Force
}

$archivePath = Join-Path $downloads 'whisper-b5454-bin-x64.zip'
$modelPath = Join-Path $models 'ggml-base-q5_1.bin'
Get-VerifiedArtifact -Url $archiveUrl -Destination $archivePath -Sha256 $archiveHash -Bytes $archiveBytes
Get-VerifiedArtifact -Url $modelUrl -Destination $modelPath -Sha256 $modelHash -Bytes $modelBytes

$extractDir = Join-Path $downloads 'whisper-b5454-extracted'
Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDir -Force
$candidates = @(Get-ChildItem -LiteralPath $extractDir -Filter 'whisper-cli.exe' -File -Recurse)
if ($candidates.Count -ne 1) { throw "Expected one whisper-cli.exe, found $($candidates.Count)." }
# Keep executable and its same-directory DLL dependencies together.
Get-ChildItem -LiteralPath $candidates[0].DirectoryName -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $runtime $_.Name) -Force
}
$cliPath = Join-Path $runtime 'whisper-cli.exe'
$helpPath = Join-Path $runtime 'cli-help.txt'
$helpProcess = New-Object System.Diagnostics.Process
$helpProcess.StartInfo.FileName = $cliPath
$helpProcess.StartInfo.Arguments = '--help'
$helpProcess.StartInfo.WorkingDirectory = $runtime
$helpProcess.StartInfo.UseShellExecute = $false
$helpProcess.StartInfo.CreateNoWindow = $true
$helpProcess.StartInfo.RedirectStandardOutput = $true
$helpProcess.StartInfo.RedirectStandardError = $true
[void]$helpProcess.Start()
$helpOutputTask = $helpProcess.StandardOutput.ReadToEndAsync()
$helpErrorTask = $helpProcess.StandardError.ReadToEndAsync()
$helpProcess.WaitForExit()
$helpExitCode = $helpProcess.ExitCode
($helpOutputTask.GetAwaiter().GetResult() + $helpErrorTask.GetAwaiter().GetResult()) |
    Set-Content -LiteralPath $helpPath -Encoding utf8
$helpProcess.Dispose()
if ($helpExitCode -ne 0) { throw "whisper-cli --help failed with exit code $helpExitCode; inspect $helpPath" }

$record = [ordered]@{
    checkedAtUtc = [DateTime]::UtcNow.ToString('o')
    runtime = [ordered]@{
        project = 'ggml-org/whisper.cpp'
        version = '1.9.5'
        build = 'b5454'
        commit = 'd1be6fde11ac6e0407606b4e42fe72d34add8037'
        license = 'MIT'
        release = 'https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.5'
        metadata = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/b5454'
        url = $archiveUrl
        archiveSha256 = $archiveHash
        archiveBytes = $archiveBytes
        executable = 'runtime/whisper/whisper-cli.exe'
        executableSha256 = (Get-FileHash -LiteralPath $cliPath -Algorithm SHA256).Hash.ToLowerInvariant()
        helpExitCode = $helpExitCode
        helpArtifact = 'runtime/whisper/cli-help.txt'
    }
    model = [ordered]@{
        name = 'Whisper base multilingual Q5_1'
        source = 'ggerganov/whisper.cpp'
        revision = $modelRevision
        license = 'MIT'
        metadata = 'https://huggingface.co/api/models/ggerganov/whisper.cpp'
        url = $modelUrl
        sha256 = $modelHash
        bytes = $modelBytes
        path = 'models/ggml-base-q5_1.bin'
    }
    validation = 'Dependency checksums and CLI help only; this setup step does not access a microphone or transcribe user audio.'
}
$record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $evidenceDir 'engine-setup.json') -Encoding utf8
Write-Host "Local speech engine ready: $cliPath"
Write-Host "Model ready: $modelPath"
