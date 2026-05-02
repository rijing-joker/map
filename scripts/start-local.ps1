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

if (-not (Test-PortListening -Port $settings.ApiPort)) {
    Start-LoggedProcess -Name "server" -FilePath "npm.cmd" -Arguments @("run", "dev:server")
} else {
    Write-Output "server already listening on $($settings.ApiPort)"
}

if (-not (Test-PortListening -Port $settings.WebPort)) {
    Start-LoggedProcess -Name "web" -FilePath "npm.cmd" -Arguments @("run", "dev:web")
} else {
    Write-Output "web already listening on $($settings.WebPort)"
}

if (-not $NoTunnel) {
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
Write-Output "Public app:"
Write-Output "  https://$($settings.PublicHost)"
Write-Output ""
Write-Output "Run 'npm run local:check' to verify the stack."
