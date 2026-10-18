[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixtureDir = Join-Path $projectRoot 'fixtures'
New-Item -ItemType Directory -Path $fixtureDir -Force | Out-Null
$wavePath = Join-Path $fixtureDir 'dictation-zh.wav'
$metadataPath = Join-Path $fixtureDir 'dictation-zh.json'
# UTF-8 base64 preserves the exact Mandarin fixture across Windows PowerShell encodings.
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('5piO5aSp5LiK5Y2I5Lmd54K577yM5oiR5Lus6K6o6K666aG555uu6K6h5YiS44CC6K+35bim5LiK5L2g55qE56yU6K6w44CC'))
$categoryId = 'HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices'
$voiceRegistryPath = 'HKLM:\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens'
$category = $null
$voice = $null
$stream = $null
$token = $null
try {
    $category = New-Object -ComObject SAPI.SpObjectTokenCategory
    $category.SetId($categoryId, $false)
    $enumerated = $category.EnumerateTokens()
    # Some SAPI versions cannot enumerate OneCore even though explicit read-only tokens work.
    $voiceKey = Get-ChildItem -LiteralPath $voiceRegistryPath |
        Where-Object { (Get-Item -LiteralPath ($_.PSPath + '\Attributes')).GetValue('Language') -eq '804' } |
        Sort-Object @{Expression = { if ($_.PSChildName -like '*Huihui*') { 0 } else { 1 } } }, PSChildName |
        Select-Object -First 1
    if (-not $voiceKey) { throw 'No installed zh-CN OneCore voice is available; registry was not changed.' }
    $token = New-Object -ComObject SAPI.SpObjectToken
    $token.SetId($voiceKey.Name, $categoryId, $false)
    $voice = New-Object -ComObject SAPI.SpVoice
    $voice.Voice = $token
    $voice.Rate = 0
    $voice.Volume = 100
    $stream = New-Object -ComObject SAPI.SpFileStream
    $stream.Format.Type = 18 # SAFT16kHz16BitMono
    $stream.Open($wavePath, 3, $false) # SSFMCreateForWrite
    $voice.AllowAudioOutputFormatChangesOnNextSet = $false
    $voice.AudioOutputStream = $stream
    [void]$voice.Speak($text, 0)
    $stream.Close()
    $record = [ordered]@{
        generatedAtUtc = [DateTime]::UtcNow.ToString('o')
        text = $text
        language = 'zh-CN'
        source = 'Locally synthesized installed Windows OneCore voice through SAPI COM'
        voice = $token.GetDescription()
        voiceToken = $voiceKey.Name
        categoryEnumerationCount = $enumerated.Count
        explicitTokenFallback = ($enumerated.Count -eq 0)
        registryModified = $false
        cloudUsed = $false
        format = 'PCM 16 kHz 16-bit mono; inspected separately before ASR'
        path = 'fixtures/dictation-zh.wav'
        bytes = (Get-Item -LiteralPath $wavePath).Length
        sha256 = (Get-FileHash -LiteralPath $wavePath -Algorithm SHA256).Hash.ToLowerInvariant()
        scope = 'Synthetic Mandarin fixture; not a human dictation accuracy benchmark.'
    }
    $record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $metadataPath -Encoding utf8
    $record | ConvertTo-Json -Depth 4
} finally {
    if ($stream) { try { $stream.Close() } catch {} }
    foreach ($comObject in @($stream, $voice, $token, $category)) {
        if ($comObject) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject) }
    }
}
