. "$PSScriptRoot\local-common.ps1"

$settings = Get-LocalSettings
Ensure-RuntimeDir

function Stop-PidFile {
    param(
        [string]$Name
    )

    $pidFile = Join-Path $RuntimeDir "$Name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) {
        return
    }

    $pidText = Get-Content -LiteralPath $pidFile | Select-Object -First 1
    if ($pidText -and (Get-Process -Id $pidText -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $pidText -Force
        Write-Host "$Name stopped (pid $pidText)"
    }

    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Stop-PidFile -Name "web"
Stop-PidFile -Name "server"
Stop-PidFile -Name "cloudflared"

$ports = @($settings.WebPort, $settings.ApiPort)
$ids = Get-ListeningProcessIds -Ports $ports
foreach ($id in $ids) {
    try {
        $proc = Get-Process -Id $id -ErrorAction Stop
        if ($proc.ProcessName -match "node|npm|cloudflared") {
            Stop-Process -Id $id -Force
            Write-Host "stopped process $id ($($proc.ProcessName))"
        }
    } catch {
    }
}
