$udp = New-Object System.Net.Sockets.UdpClient
$udp.Client.Bind([System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse('192.168.10.194'), 0))
$ep  = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse('192.168.10.70'), 10023)

function OSCStr($s) {
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($s + [char]0)
    $pad   = [Math]::Ceiling($bytes.Length / 4) * 4
    $buf   = New-Object byte[] $pad
    [System.Buffer]::BlockCopy($bytes, 0, $buf, 0, $bytes.Length)
    return ,$buf   # comma forces array return
}

function OSCFloat($v) {
    $b = [BitConverter]::GetBytes([float]$v)
    [Array]::Reverse($b)
    return ,$b
}

function OSCInt($v) {
    $b = [BitConverter]::GetBytes([int]$v)
    [Array]::Reverse($b)
    return ,$b
}

function SendF($addr, $val) {
    $msg = [byte[]](OSCStr $addr) + [byte[]](OSCStr ',f') + [byte[]](OSCFloat $val)
    $udp.Send($msg, $msg.Length, $ep) | Out-Null
    Start-Sleep -Milliseconds 60
}

function SendI($addr, $val) {
    $msg = [byte[]](OSCStr $addr) + [byte[]](OSCStr ',i') + [byte[]](OSCInt $val)
    $udp.Send($msg, $msg.Length, $ep) | Out-Null
    Start-Sleep -Milliseconds 60
}

function SendS($addr, $val) {
    $msg = [byte[]](OSCStr $addr) + [byte[]](OSCStr ',s') + [byte[]](OSCStr $val)
    $udp.Send($msg, $msg.Length, $ep) | Out-Null
    Start-Sleep -Milliseconds 60
}

# Subscribe
$xr = [byte[]](OSCStr '/xremote') + [byte[]](OSCStr ',')
$udp.Send($xr, $xr.Length, $ep) | Out-Null
Start-Sleep -Milliseconds 200
Write-Host "Subscribed to mixer"

# --- TEST: move Ch1 fader down then up ---
Write-Host "Moving Ch1 fader DOWN to -20dB..."
SendF '/ch/01/mix/fader' 0.583
Start-Sleep -Seconds 2
Write-Host "Moving Ch1 fader back UP to 0dB..."
SendF '/ch/01/mix/fader' 0.75

Write-Host "Done. Did the Ch1 fader move in X-AIR Edit?"
$udp.Close()
