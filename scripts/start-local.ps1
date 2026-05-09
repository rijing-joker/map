param(
    [switch]$NoTunnel
)

. "$PSScriptRoot\local-common.ps1"

$settings = Get-LocalSettings
Ensure-RuntimeDir

Write-Output "Starting Map Route Planner local stack"
Write-Output "Repo: $($settings.RepoRoot)"
Write-Output ""

function Start-LoggedProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$Arguments
    )

    $stdout = Join-Path $RuntimeDir "$Name.out.log"
    $stderr = Join-Path $RuntimeDir "$Name.err.log"
    $pidFile = Join-Path $RuntimeDir "$Name.pid"

    if (Test-Path -LiteralPath $pidFile) {
        $existingPid = Get-Content -LiteralPath $pidFile | Select-Object -First 1
        if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
            Write-Output "$Name already running (pid $existingPid)"
            return
        }
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }

    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WorkingDirectory $settings.RepoRoot
    $process.Id | Set-Content -LiteralPath $pidFile
    Write-Output "$Name started (pid $($process.Id))"
}

if (Test-PortListening -Port $settings.ApiPort) {
    if (Test-ApiHealthy -ApiPort $settings.ApiPort) {
        Write-Output "server already healthy on $($settings.ApiPort)"
    } else {
        throw "api port $($settings.ApiPort) is already in use, but /api/health did not return this app. Run 'npm run local:stop' or free the port."
    }
} else {
    Start-LoggedProcess -Name "server" -FilePath "npm.cmd" -Arguments @("run", "dev:server")
}

if (Test-PortListening -Port $settings.WebPort) {
    if (Test-WebHealthy -WebPort $settings.WebPort) {
        Write-Output "web already healthy on $($settings.WebPort)"
    } else {
        throw "web port $($settings.WebPort) is already in use, but the Vite page did not return this app. Run 'npm run local:stop' or free the port."
    }
} else {
    Start-LoggedProcess -Name "web" -FilePath "npm.cmd" -Arguments @("run", "dev:web")
}

if (-not $NoTunnel) {
    if (-not $settings.TunnelId) {
        throw "CLOUDFLARE_TUNNEL_ID is not set. Add it to .env or run with -NoTunnel."
    }

    if (-not $settings.CloudflaredCredential) {
        throw "CLOUDFLARE_CREDENTIAL_FILE is not set and no default credential path could be inferred."
    }

    if (-not (Test-Path -LiteralPath $settings.CloudflaredExe)) {
        throw "cloudflared.exe not found at $($settings.CloudflaredExe)"
    }

    $tunnelProc = Get-CloudflaredProcess -Settings $settings
    if ($tunnelProc) {
        Write-Output "cloudflared tunnel already running (pid $($tunnelProc.ProcessId -join ', '))"
    } else {
        $staleTunnelProc = Get-CloudflaredProcess -Settings $settings -AnyOrigin
        foreach ($proc in $staleTunnelProc) {
            Stop-Process -Id $proc.ProcessId -Force
            Write-Output "stopped stale cloudflared tunnel (pid $($proc.ProcessId))"
        }

        $stdout = Join-Path $RuntimeDir "cloudflared.out.log"
        $stderr = Join-Path $RuntimeDir "cloudflared.err.log"
        $pidFile = Join-Path $RuntimeDir "cloudflared.pid"
        $args = @(
            "tunnel",
            "--no-autoupdate",
            "--url",
            $settings.OriginUrl,
            "run",
            "--credentials-file",
            $settings.CloudflaredCredential,
            $settings.TunnelId
        )
        $process = Start-Process -FilePath $settings.CloudflaredExe -ArgumentList $args -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WorkingDirectory $settings.RepoRoot
        $process.Id | Set-Content -LiteralPath $pidFile
        Write-Output "cloudflared started (pid $($process.Id))"
    }
}

Write-Output ""
Write-Output "Local app:"
Write-Output "  http://127.0.0.1:$($settings.WebPort)"
if ($settings.PublicHost) {
    Write-Output "Public app:"
    Write-Output "  https://$($settings.PublicHost)"
}
Write-Output ""
Write-Output "Run 'npm run local:check' to verify the stack."
