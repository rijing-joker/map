param(
    [switch]$NoTunnel,
    [switch]$Check
)

$ErrorActionPreference = "Stop"

$script = Join-Path $PSScriptRoot "scripts\start-local.ps1"
$args = @()
if ($NoTunnel) {
    $args += "-NoTunnel"
}

& $script @args

if ($Check) {
    & (Join-Path $PSScriptRoot "scripts\check-local.ps1")
}
