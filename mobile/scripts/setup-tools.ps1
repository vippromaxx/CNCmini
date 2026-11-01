param([string]$JavaHome = $env:JAVA_HOME)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$taskRoot = Split-Path $PSScriptRoot -Parent
$toolRoot = Join-Path $taskRoot '.tools'
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
function Get-VerifiedArchive($url, $target, $hash, $algorithm) {
  if (!(Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target -Algorithm $algorithm).Hash -ne $hash) {
    & curl.exe --fail --location --silent --show-error --retry 2 --connect-timeout 30 --max-time 600 --output $target $url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
  }
  if ((Get-FileHash -LiteralPath $target -Algorithm $algorithm).Hash -ne $hash) { throw "Checksum mismatch: $target" }
}
if (!$JavaHome) {
  Get-VerifiedArchive 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jdk_x64_windows_hotspot_21.0.13_9.zip' (Join-Path $toolRoot 'jdk.zip') 'a4dbaa05fca4bd89d84584e58c459bd732efebb1722af80ab13c6516832004f9' 'SHA256'
  if (!(Test-Path (Join-Path $toolRoot 'jdk-21.0.13+9'))) { Expand-Archive -LiteralPath (Join-Path $toolRoot 'jdk.zip') -DestinationPath $toolRoot }
  $JavaHome = Join-Path $toolRoot 'jdk-21.0.13+9'
}
if (!(Test-Path (Join-Path $JavaHome 'bin/javac.exe'))) { throw 'A full JDK 21 is required.' }
Get-VerifiedArchive 'https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip' (Join-Path $toolRoot 'sdk-tools.zip') '57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d' 'SHA1'
$sdkRoot = Join-Path $toolRoot 'android-sdk'
if (!(Test-Path (Join-Path $sdkRoot 'cmdline-tools/latest/bin/sdkmanager.bat'))) {
  $extractRoot = Join-Path $toolRoot 'sdk-extract'
  Expand-Archive -LiteralPath (Join-Path $toolRoot 'sdk-tools.zip') -DestinationPath $extractRoot -Force
  New-Item -ItemType Directory -Force -Path (Join-Path $sdkRoot 'cmdline-tools/latest') | Out-Null
  Copy-Item -Path (Join-Path $extractRoot 'cmdline-tools/*') -Destination (Join-Path $sdkRoot 'cmdline-tools/latest') -Recurse -Force
}
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $sdkRoot
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
# Use the bundled Java SDK manager, avoiding the wrapper's extra CLI bootstrap.
$javaExe = Join-Path $JavaHome 'bin/java.exe'
$sdkClasspath = (Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'cmdline-tools/latest/lib') -Recurse -Filter '*.jar' | ForEach-Object FullName) -join ';'
$sdkMain = 'com.android.sdklib.tool.sdkmanager.SdkManagerCli'
1..100 | ForEach-Object { 'y' } | & $javaExe -cp $sdkClasspath $sdkMain "--sdk_root=$sdkRoot" --licenses | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'SDK license setup failed.' }
& $javaExe -cp $sdkClasspath $sdkMain "--sdk_root=$sdkRoot" 'platform-tools' 'platforms;android-36' 'build-tools;35.0.0'
if ($LASTEXITCODE -ne 0) { throw 'Android SDK installation failed.' }
@{ javaHome = $JavaHome; androidSdk = $sdkRoot } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $toolRoot 'toolchain.json') -Encoding UTF8
Write-Output 'Local JDK and Android SDK ready. No machine-wide environment variables changed.'
