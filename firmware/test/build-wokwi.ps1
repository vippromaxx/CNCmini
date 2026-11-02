param([string]$PlatformIO = "$env:USERPROFILE/.platformio/penv/Scripts/platformio.exe")

$ErrorActionPreference = 'Stop'
$simProject = Join-Path $PSScriptRoot 'wokwi'
if (-not (Test-Path -LiteralPath $PlatformIO -PathType Leaf)) {
    $PlatformIO = (Get-Command pio -ErrorAction Stop).Source
}

# Keep the normal build when a separate diagnostic environment has been used.
& $PlatformIO run --project-dir $simProject --environment wokwi --disable-auto-clean --jobs 4
if ($LASTEXITCODE -ne 0) { throw "Wokwi build failed ($LASTEXITCODE)." }

foreach ($name in @('firmware.factory.bin', 'firmware.elf')) {
    $artifact = Join-Path $simProject ".pio/build/wokwi/$name"
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
        throw "Missing Wokwi artifact: $artifact"
    }
}
Write-Host 'Wokwi build ready. Select CNC/test/wokwi.toml, then Wokwi: Start Simulator.'
