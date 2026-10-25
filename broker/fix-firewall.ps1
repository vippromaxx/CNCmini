$ErrorActionPreference = 'Stop'

$nodePath = 'C:\Program Files\nodejs\node.exe'
$rules = @(
    @{ Name = 'MiniCNC MQTT TCP 1883'; Port = 1883 },
    @{ Name = 'MiniCNC Web TCP 3000'; Port = 3000 }
)

# Windows' default Node.js inbound block overrides a narrower allow rule.
# Disable only that inbound block; the allow rules below expose only MiniCNC's ports.
Get-NetFirewallRule -DisplayName 'Node.js JavaScript Runtime' -ErrorAction SilentlyContinue |
    Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' } |
    Disable-NetFirewallRule

foreach ($item in $rules) {
    Get-NetFirewallRule -DisplayName $item.Name -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule

    New-NetFirewallRule `
        -DisplayName $item.Name `
        -Description 'MiniCNC broker access' `
        -Direction Inbound `
        -Action Allow `
        -Enabled True `
        -Profile Domain,Private,Public `
        -Program $nodePath `
        -Protocol TCP `
        -LocalPort $item.Port | Out-Null
}

Write-Output 'MiniCNC firewall rules applied:'
Get-NetFirewallRule -DisplayName 'MiniCNC MQTT TCP 1883','MiniCNC Web TCP 3000' |
    Select-Object DisplayName, Enabled, Direction, Action, Profile |
    Format-Table -AutoSize
