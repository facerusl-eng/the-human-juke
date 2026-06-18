$shell = New-Object -ComObject WScript.Shell
$shortcutNames = @(
    "Human Jukebox.lnk",
    "Human Jukebox Dev.lnk",
    "Human Jukebox Tauri.lnk",
    "HumanJukeboxWinUI - THIS ONE.lnk",
    "HumanJukeboxWinUI.lnk"
)

Write-Host "=== All Desktop Shortcuts Verification ===" -ForegroundColor Cyan
Write-Host ""

foreach ($name in $shortcutNames) {
    $path = Join-Path $env:USERPROFILE "Desktop\$name"
    if (Test-Path $path) {
        $shortcut = $shell.CreateShortcut($path)
        Write-Host "=== $name ===" -ForegroundColor Yellow
        Write-Host "Target: $($shortcut.TargetPath)" -ForegroundColor Green
        Write-Host "WorkingDirectory: $($shortcut.WorkingDirectory)" -ForegroundColor Yellow
        Write-Host "IconLocation: $($shortcut.IconLocation)" -ForegroundColor Yellow
        if (Test-Path $shortcut.TargetPath) {
            $exeInfo = Get-Item $shortcut.TargetPath
            Write-Host "Executable Exists: Yes" -ForegroundColor Green
            Write-Host "Last Modified: $($exeInfo.LastWriteTime)" -ForegroundColor Green
            Write-Host "Size: $($exeInfo.Length) bytes" -ForegroundColor Green
        } else {
            Write-Host "ERROR: Executable not found!" -ForegroundColor Red
        }
        Write-Host ""
    } else {
        Write-Host "=== $name ===" -ForegroundColor Yellow
        Write-Host "Shortcut file not found!" -ForegroundColor Red
        Write-Host ""
    }
}
