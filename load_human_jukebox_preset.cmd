@echo off
setlocal

cd /d "%~dp0"

rem Mixer and local Ethernet interface settings
set XR18_IP=192.168.10.70
set XR18_PORT=10024
set XR18_BIND_IP=192.168.10.194

echo Loading Human Jukebox preset to XR18 at %XR18_IP%...
node scripts\apply-backing-preset.mjs

echo.
echo If successful, open X-Air Edit and Save Scene As:
echo   The Human Jukebox - Full Setup
pause
