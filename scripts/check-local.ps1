param(
    [switch]$SkipPublic
)

. "$PSScriptRoot\local-common.ps1"

$settings = Get-LocalSettings
$envValues = Read-DotEnv
$failed = $false

Write-Host "Map Route Planner local check"
Write-Host "Repo: $($settings.RepoRoot)"
Write-Host ""

if (Test-Path -LiteralPath $settings.EnvPath) {
    Write-Check ".env" "PASS" "present"
} else {
    Write-Check ".env" "FAIL" "missing; copy .env.example to .env"
    $failed = $true
}

foreach ($name in @("VITE_AMAP_JS_KEY", "VITE_AMAP_SECURITY_JS_CODE", "AMAP_WEB_SERVICE_KEY")) {
    if ($envValues.ContainsKey($name) -and $envValues[$name]) {
        Write-Check $name "PASS" "set"
    } else {
        Write-Check $name "WARN" "not set"
    }
}

Write-Check "PUBLIC_HOST" "PASS" $settings.PublicHost

if (Test-PortListening -Port $settings.WebPort) {
    Write-Check "web port $($settings.WebPort)" "PASS" "listening"
} else {
    Write-Check "web port $($settings.WebPort)" "FAIL" "not listening"
    $failed = $true
}

if (Test-PortListening -Port $settings.ApiPort) {
    Write-Check "api port $($settings.ApiPort)" "PASS" "listening"
} else {
    Write-Check "api port $($settings.ApiPort)" "FAIL" "not listening"
    $failed = $true
}

try {
    $health = Invoke-LocalHealth -ApiPort $settings.ApiPort
    Write-Check "local API health" "PASS" $health.Content
} catch {
    Write-Check "local API health" "FAIL" $_.Exception.Message
    $failed = $true
}

$cloudflared = Get-CloudflaredProcess -Settings $settings
if ($cloudflared) {
    $ids = ($cloudflared | Select-Object -ExpandProperty ProcessId) -join ", "
    Write-Check "cloudflared tunnel" "PASS" "pid $ids"
} else {
    Write-Check "cloudflared tunnel" "FAIL" "not running for $($settings.PublicHost)"
    $failed = $true
}

if (Test-Path -LiteralPath $settings.CloudflaredExe) {
    Write-Check "cloudflared binary" "PASS" $settings.CloudflaredExe
} else {
    Write-Check "cloudflared binary" "WARN" "missing at $($settings.CloudflaredExe)"
}

if (Test-Path -LiteralPath $settings.CloudflaredCredential) {
    Write-Check "tunnel credential" "PASS" $settings.CloudflaredCredential
} else {
    Write-Check "tunnel credential" "FAIL" "missing at $($settings.CloudflaredCredential)"
    $failed = $true
}

if (-not $SkipPublic) {
    try {
        $publicHealth = Invoke-CurlText -Url "https://$($settings.PublicHost)/api/health"
        Write-Check "public API health" "PASS" $publicHealth
    } catch {
        Write-Check "public API health" "FAIL" $_.Exception.Message
        $failed = $true
    }
}

try {
    $status = & git -C $settings.RepoRoot status --short --branch 2>&1
    Write-Check "git status" "PASS" ($status -join " ")
} catch {
    Write-Check "git status" "WARN" $_.Exception.Message
}

if ($failed) {
    exit 1
}
