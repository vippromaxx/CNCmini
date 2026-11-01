$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$savedTools = Join-Path $taskRoot '.tools/toolchain.json'
if (Test-Path -LiteralPath $savedTools) {
  $saved = Get-Content -LiteralPath $savedTools -Raw | ConvertFrom-Json
  if (!$env:JAVA_HOME) { $env:JAVA_HOME = $saved.javaHome }
  if (!$env:ANDROID_HOME) { $env:ANDROID_HOME = $saved.androidSdk }
}
$localJava = Join-Path $taskRoot '.tools/jdk-21.0.13+9'
$localSdk = Join-Path $taskRoot '.tools/android-sdk'
if (!$env:JAVA_HOME -and (Test-Path -LiteralPath $localJava)) { $env:JAVA_HOME = $localJava }
if (!$env:ANDROID_HOME -and (Test-Path -LiteralPath $localSdk)) { $env:ANDROID_HOME = $localSdk }
if (!$env:JAVA_HOME -or !$env:ANDROID_HOME) { throw 'Set JAVA_HOME / ANDROID_HOME, or run scripts/setup-tools.ps1 first.' }
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:DEBUG = ''
Push-Location $taskRoot
try {
  & npm.cmd run sync
  if ($LASTEXITCODE -ne 0) { throw 'Web build/sync failed.' }
  Push-Location (Join-Path $taskRoot 'android')
  try {
    & .\gradlew.bat --no-daemon assembleDebug lintDebug
    if ($LASTEXITCODE -ne 0) { throw 'Android build or lint failed.' }
  } finally { Pop-Location }
  $artifacts = Join-Path $taskRoot 'artifacts'
  New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
  Copy-Item -LiteralPath (Join-Path $taskRoot 'android/app/build/outputs/apk/debug/app-debug.apk') -Destination (Join-Path $artifacts 'MiniCNC-debug.apk') -Force
  $apkPath = Join-Path $artifacts 'MiniCNC-debug.apk'
  & (Join-Path $env:ANDROID_HOME 'build-tools/35.0.0/apksigner.bat') verify --verbose $apkPath
  if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
  $apkHash = Get-FileHash -LiteralPath $apkPath -Algorithm SHA256
  "$($apkHash.Hash.ToLower())  MiniCNC-debug.apk" | Set-Content -LiteralPath (Join-Path $artifacts 'MiniCNC-debug.apk.sha256') -Encoding ASCII
  $apkHash
} finally { Pop-Location }
