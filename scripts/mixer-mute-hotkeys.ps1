$MIXER_IP   = '192.168.10.70'
$MIXER_PORT = 10024

$udp = New-Object System.Net.Sockets.UdpClient
$udp.Connect($MIXER_IP, $MIXER_PORT)

function Pad4([byte[]]$bytes) {
    $pad = (4 - ($bytes.Length % 4)) % 4
    $result = New-Object byte[] ($bytes.Length + $pad)
    [System.Buffer]::BlockCopy($bytes, 0, $result, 0, $bytes.Length)
    return $result
}
function OscStr([string]$s) { return Pad4([System.Text.Encoding]::ASCII.GetBytes($s + "`0")) }
function OscInt([int]$i) { $b = [System.BitConverter]::GetBytes([int]$i); [System.Array]::Reverse($b); return $b }
function SendOSC([string]$addr, [int]$val) {
    $msg = [byte[]]((OscStr $addr) + (OscStr ',i') + (OscInt $val))
    try {
        $sent = $udp.Send($msg, $msg.Length)
        Write-Host "  DEBUG: sent $sent bytes to ${MIXER_IP}:${MIXER_PORT}  addr=$addr val=$val" -ForegroundColor DarkGray
    } catch {
        Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    }
}

$state = @{ ch01=$true;ch02=$true;ch03=$true;ch04=$true;ch05=$true;ch06=$true;ch15=$true;ch16=$true;bus05=$true;bus06=$true;master=$true }

function Toggle([string[]]$keys,[string[]]$addrs,[string]$label) {
    $on = $state[$keys[0]]
    $newOn = -not $on
    foreach ($k in $keys) { $state[$k] = $newOn }
    foreach ($a in $addrs) { SendOSC $a ([int]$newOn) }
    if ($newOn) { Write-Host "  LIVE   $label" -ForegroundColor Green }
    else        { Write-Host "  MUTED  $label" -ForegroundColor Red }
}

Clear-Host
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  THE HUMAN JUKEBOX - Mute Hotkeys" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  1 -> Ch 1   Host Mic       (A alias)" -ForegroundColor Cyan
Write-Host "  2 -> Ch 2   Karaoke Mic    (S alias)" -ForegroundColor Cyan
Write-Host "  3 -> Ch 3   Guitar         (D alias)" -ForegroundColor Cyan
Write-Host "  4 -> Ch 4   Click Track    (F alias)" -ForegroundColor Cyan
Write-Host "  5 -> Ch 5                  (G alias)" -ForegroundColor Cyan
Write-Host "  6 -> Ch 6                  (H alias)" -ForegroundColor Cyan
Write-Host "  Q -> Ch 15+16  Jamzone L+R" -ForegroundColor Cyan
Write-Host "  W -> Bus 5+6   Jamzone Bus" -ForegroundColor Cyan
Write-Host "  + -> MASTER LR" -ForegroundColor Cyan
Write-Host "  P/0 -> PANIC force Spotify stereo ON" -ForegroundColor Cyan
Write-Host "  ESC -> Quit" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Connected to ${MIXER_IP}:${MIXER_PORT} - all channels LIVE" -ForegroundColor Green
Write-Host ""

function ForceSpotifyStereoOn {
    $state['ch15'] = $true
    $state['ch16'] = $true
    $state['bus05'] = $true
    $state['bus06'] = $true
    $state['master'] = $true

    SendOSC '/ch/15/mix/on' 1
    SendOSC '/ch/16/mix/on' 1
    SendOSC '/rtn/aux/mix/05/on' 1
    SendOSC '/rtn/aux/mix/06/on' 1
    SendOSC '/bus/05/mix/on' 1
    SendOSC '/bus/06/mix/on' 1
    SendOSC '/main/st/mix/on' 1
    Write-Host "  LIVE   PANIC - Spotify stereo forced ON" -ForegroundColor Green
}

while ($true) {
    $k = [System.Console]::ReadKey($true)
    switch ($k.KeyChar.ToString().ToLower()) {
        '1' { Toggle @('ch01')          @('/ch/01/mix/on')                   'Ch 1   - Host Mic'       }
        '2' { Toggle @('ch02')          @('/ch/02/mix/on')                   'Ch 2   - Karaoke Mic'    }
        '3' { Toggle @('ch03')          @('/ch/03/mix/on')                   'Ch 3   - Guitar'         }
        '4' { Toggle @('ch04')          @('/ch/04/mix/on')                   'Ch 4   - Click Track'    }
        '5' { Toggle @('ch05')          @('/ch/05/mix/on')                   'Ch 5'                    }
        '6' { Toggle @('ch06')          @('/ch/06/mix/on')                   'Ch 6'                    }
        'a' { Toggle @('ch01')          @('/ch/01/mix/on')                   'Ch 1   - Host Mic'       }
        's' { Toggle @('ch02')          @('/ch/02/mix/on')                   'Ch 2   - Karaoke Mic'    }
        'd' { Toggle @('ch03')          @('/ch/03/mix/on')                   'Ch 3   - Guitar'         }
        'f' { Toggle @('ch04')          @('/ch/04/mix/on')                   'Ch 4   - Click Track'    }
        'g' { Toggle @('ch05')          @('/ch/05/mix/on')                   'Ch 5'                    }
        'h' { Toggle @('ch06')          @('/ch/06/mix/on')                   'Ch 6'                    }
        'q' { Toggle @('ch15','ch16')   @('/ch/15/mix/on','/ch/16/mix/on')   'Ch 15+16 - Jamzone L+R'  }
        'w' { Toggle @('bus05','bus06') @('/bus/05/mix/on','/bus/06/mix/on') 'Bus 5+6  - Jamzone Bus'  }
        '+' { Toggle @('master')        @('/main/st/mix/on')                 'MASTER LR'               }
        '=' { Toggle @('master')        @('/main/st/mix/on')                 'MASTER LR'               }
        'p' { ForceSpotifyStereoOn }
        '0' { ForceSpotifyStereoOn }
    }
    if ($k.Key -eq [System.ConsoleKey]::Escape) {
        Write-Host "`n  Exiting. Bye!" -ForegroundColor Yellow
        $udp.Close()
        break
    }
}
