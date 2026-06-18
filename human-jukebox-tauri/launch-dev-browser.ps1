param(
    [int]$TimeoutSeconds = 90
)

Set-Location $PSScriptRoot

function Test-ServiceUp {
    param(
        [string]$Url
    )

    try {
        Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

$devReady = Test-ServiceUp 'http://localhost:5173'
$apiReady = Test-ServiceUp 'http://localhost:3001'

if (-not ($devReady -and $apiReady)) {
    $devProcess = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/s', '/c', 'npm run dev' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
}

try {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -UseBasicParsing http://localhost:5173 -TimeoutSec 2 | Out-Null
            Start-Process 'http://localhost:5173'
            exit 0
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }

    throw "Timed out waiting for Human Jukebox dev server."
} finally {
    if (Get-Variable devProcess -ErrorAction SilentlyContinue) {
        if ($devProcess -and -not $devProcess.HasExited) {
            $null = $devProcess
        }
    }
}