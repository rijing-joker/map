$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RuntimeDir = Join-Path $RepoRoot ".runtime"
$EnvPath = Join-Path $RepoRoot ".env"
$WebPort = 25173
$DefaultApiPort = 25174

function Ensure-RuntimeDir {
    if (-not (Test-Path -LiteralPath $RuntimeDir)) {
        New-Item -ItemType Directory -Path $RuntimeDir | Out-Null
    }
}

function Read-DotEnv {
    $values = @{}
    if (-not (Test-Path -LiteralPath $EnvPath)) {
        return $values
    }

    foreach ($line in Get-Content -LiteralPath $EnvPath) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }

        $index = $trimmed.IndexOf("=")
        if ($index -le 0) {
            continue
        }

        $name = $trimmed.Substring(0, $index).Trim()
        $value = $trimmed.Substring($index + 1).Trim().Trim('"').Trim("'")
        $values[$name] = $value
    }

    return $values
}

function Get-LocalSettings {
    $envValues = Read-DotEnv
    $apiPort = $DefaultApiPort
    if ($envValues.ContainsKey("PORT") -and $envValues["PORT"]) {
        $apiPort = [int]$envValues["PORT"]
    }

    $publicHost = ""
    if ($envValues.ContainsKey("PUBLIC_HOST") -and $envValues["PUBLIC_HOST"]) {
        $publicHost = $envValues["PUBLIC_HOST"]
    }

    $tunnelId = ""
    if ($envValues.ContainsKey("CLOUDFLARE_TUNNEL_ID") -and $envValues["CLOUDFLARE_TUNNEL_ID"]) {
        $tunnelId = $envValues["CLOUDFLARE_TUNNEL_ID"]
    }

    $cloudflaredCredential = ""
    if ($envValues.ContainsKey("CLOUDFLARE_CREDENTIAL_FILE") -and $envValues["CLOUDFLARE_CREDENTIAL_FILE"]) {
        $cloudflaredCredential = $envValues["CLOUDFLARE_CREDENTIAL_FILE"]
    } elseif ($tunnelId) {
        $cloudflaredCredential = Join-Path $env:USERPROFILE ".cloudflared\$tunnelId.json"
    }

    [pscustomobject]@{
        RepoRoot = $RepoRoot
        RuntimeDir = $RuntimeDir
        EnvPath = $EnvPath
        WebPort = $WebPort
        ApiPort = $apiPort
        PublicHost = $publicHost
        OriginUrl = "http://127.0.0.1:$WebPort"
        TunnelId = $tunnelId
        CloudflaredCredential = $cloudflaredCredential
        CloudflaredExe = Join-Path $RepoRoot ".tools\cloudflared.exe"
    }
}

function Test-PortListening {
    param([int]$Port)

    try {
        return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1)
    } catch {
        return $false
    }
}

function Test-ApiHealthy {
    param([int]$ApiPort)

    try {
        $response = Invoke-LocalHealth -ApiPort $ApiPort
        return [bool]($response.StatusCode -eq 200 -and $response.Content -like "*`"ok`":true*")
    } catch {
        return $false
    }
}

function Test-WebHealthy {
    param([int]$WebPort)

    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$WebPort/" -UseBasicParsing -TimeoutSec 8
        return [bool]($response.StatusCode -eq 200 -and $response.Content -like "*<div id=`"root`"></div>*")
    } catch {
        return $false
    }
}

function Get-ListeningProcessIds {
    param([int[]]$Ports)

    $ids = @()
    foreach ($port in $Ports) {
        try {
            $ids += Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
                Select-Object -ExpandProperty OwningProcess
        } catch {
        }
    }

    return $ids | Where-Object { $_ } | Sort-Object -Unique
}

function Get-CloudflaredProcess {
    param(
        $Settings,
        [switch]$AnyOrigin
    )

    Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $commandLine = [string]$_.CommandLine
            $matchesRepoBinary = $_.ExecutablePath -eq $Settings.CloudflaredExe
            $matchesTunnel = $Settings.TunnelId -and $commandLine -like "*$($Settings.TunnelId)*"

            if ($AnyOrigin) {
                $matchesRepoBinary -or $matchesTunnel
            } else {
                $matchesTunnel -and $commandLine -like "*$($Settings.OriginUrl)*"
            }
        }
}

function Write-Check {
    param(
        [string]$Name,
        [ValidateSet("PASS", "WARN", "FAIL")]
        [string]$Status,
        [string]$Detail = ""
    )

    $line = "[{0}] {1}" -f $Status, $Name
    if ($Detail) {
        $line = "$line - $Detail"
    }
    Write-Host $line
}

function Invoke-LocalHealth {
    param([int]$ApiPort)

    Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/api/health" -UseBasicParsing -TimeoutSec 8
}

function Invoke-CurlText {
    param(
        [string]$Url,
        [int]$MaxTimeSec = 15
    )

    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) {
        throw "curl.exe was not found"
    }

    $output = & $curl.Source -ksS --fail-with-body --max-time $MaxTimeSec $Url 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ($output -join "`n")
    }
    return ($output -join "`n")
}
