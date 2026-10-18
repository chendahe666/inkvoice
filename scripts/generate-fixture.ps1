$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path $PSScriptRoot '..\fixtures'
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
Add-Type -AssemblyName System.Speech
$fixtureVoice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fixtureVoice.Rate = -1
$fixtureFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$fixturePath = Join-Path $fixtureRoot 'dictation-en.wav'
$fixtureVoice.SetOutputToWaveFile($fixturePath, $fixtureFormat)
$fixtureText = 'Hello, this is Ink Voice. Tomorrow at nine, we will discuss the project plan. Please bring your notes.'
$fixtureVoice.Speak($fixtureText)
$fixtureVoice.Dispose()
[pscustomobject]@{source='Windows Microsoft Zira local speech synthesis';text=$fixtureText;file='fixtures/dictation-en.wav';sampleRate=16000;channels=1;bits=16;purpose='Real synthetic speech integration test; not a human dictation accuracy benchmark'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $fixtureRoot 'dictation-en.json') -Encoding utf8
Get-Item -LiteralPath $fixturePath | Select-Object Name,Length
