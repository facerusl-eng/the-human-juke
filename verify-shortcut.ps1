$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut("$env:USERPROFILE\Desktop\Human Jukebox.lnk")
Write-Host "=== Desktop Shortcut Verification ===" -ForegroundColor Cyan
Write-Host "Target: $($shortcut.TargetPath)" -ForegroundColor Green
Write-Host "Arguments: $($shortcut.Arguments)" -ForegroundColor Yellow
Write-Host "WorkingDirectory: $($shortcut.WorkingDirectory)" -ForegroundColor Yellow
Write-Host "IconLocation: $($shortcut.IconLocation)" -ForegroundColor Yellow

$exePath = $shortcut.TargetPath
if (Test-Path $exePath) {
    $fileInfo = Get-Item $exePath
    Write-Host "=== Executable Info ===" -ForegroundColor Cyan
    Write-Host "Exists: Yes" -ForegroundColor Green
    Write-Host "LastWriteTime: $($fileInfo.LastWriteTime)" -ForegroundColor Yellow
    Write-Host "Size: $($fileInfo.Length) bytes" -ForegroundColor Yellow
} else {
    Write-Host "ERROR: Executable not found!" -ForegroundColor Red
}
