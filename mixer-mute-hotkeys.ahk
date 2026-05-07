#Requires AutoHotkey v2.0
#SingleInstance Force

; ── THE HUMAN JUKEBOX — Global Mute Hotkeys ──────────────────────────────────
; Runs in system tray. Works even when window is in background.
; Right-click tray icon → Suspend to disable while typing normally.
;
; A  = Ch 1  Host Mic
; S  = Ch 2  Karaoke Mic
; D  = Ch 3  Guitar
; F  = Ch 4  Click Track
; G  = Ch 5
; H  = Ch 6
; Q  = Ch 15+16  Jamzone L+R
; W  = Bus 5+6   Jamzone Bus
; +  = Master LR
; ─────────────────────────────────────────────────────────────────────────────

MIXER_IP   := "192.168.10.70"
MIXER_PORT := 10024

; Mute state: true = live, false = muted
state := Map(
    "ch01",  true, "ch02",  true, "ch03",  true, "ch04", true,
    "ch05",  true, "ch06",  true,
    "ch15",  true, "ch16",  true,
    "bus05", true, "bus06", true,
    "master",true
)

; ── OSC UDP sender ────────────────────────────────────────────────────────────

SendOSC(ip, port, address, value) {
    ; Pad string to multiple of 4 bytes (null terminated)
    PadStr(s) {
        bytes := Buffer(0)
        loop StrLen(s) + 1 {
            ch := (A_Index <= StrLen(s)) ? Ord(SubStr(s, A_Index, 1)) : 0
            bytes.Size += 1
            NumPut("UChar", ch, bytes, bytes.Size - 1)
        }
        pad := (4 - Mod(bytes.Size, 4))
        if (pad < 4) {
            loop pad {
                bytes.Size += 1
                NumPut("UChar", 0, bytes, bytes.Size - 1)
            }
        }
        return bytes
    }

    addrBuf := PadStr(address)
    typeBuf := PadStr(",i")
    
    ; Big-endian int32
    valBuf := Buffer(4)
    NumPut("UChar", (value >> 24) & 0xFF, valBuf, 0)
    NumPut("UChar", (value >> 16) & 0xFF, valBuf, 1)
    NumPut("UChar", (value >>  8) & 0xFF, valBuf, 2)
    NumPut("UChar",  value        & 0xFF, valBuf, 3)

    totalSize := addrBuf.Size + typeBuf.Size + valBuf.Size
    msg := Buffer(totalSize)
    DllCall("RtlMoveMemory", "Ptr", msg.Ptr,                              "Ptr", addrBuf.Ptr, "UPtr", addrBuf.Size)
    DllCall("RtlMoveMemory", "Ptr", msg.Ptr + addrBuf.Size,               "Ptr", typeBuf.Ptr, "UPtr", typeBuf.Size)
    DllCall("RtlMoveMemory", "Ptr", msg.Ptr + addrBuf.Size + typeBuf.Size,"Ptr", valBuf.Ptr,  "UPtr", valBuf.Size)

    ; Send UDP
    sock := DllCall("ws2_32\socket", "Int", 2, "Int", 2, "Int", 17, "Ptr")
    addrStruct := Buffer(16, 0)
    NumPut("UShort", 2,                                     addrStruct, 0)
    NumPut("UShort", DllCall("ws2_32\htons", "UShort", port, "UShort"), addrStruct, 2)
    NumPut("UInt",   DllCall("ws2_32\inet_addr", "AStr", ip, "UInt"),   addrStruct, 4)
    DllCall("ws2_32\sendto", "Ptr", sock, "Ptr", msg.Ptr, "Int", msg.Size, "Int", 0, "Ptr", addrStruct.Ptr, "Int", 16)
    DllCall("ws2_32\closesocket", "Ptr", sock)
}

DllCall("ws2_32\WSAStartup", "UShort", 0x0202, "Ptr", Buffer(400))

; ── Toggle function ───────────────────────────────────────────────────────────

Toggle(keys, addresses, label) {
    global state, MIXER_IP, MIXER_PORT
    newOn := !state[keys[1]]
    for k in keys
        state[k] := newOn
    for addr in addresses
        SendOSC(MIXER_IP, MIXER_PORT, addr, newOn ? 1 : 0)
    status := newOn ? "LIVE" : "MUTED"
    color  := newOn ? "00AA00" : "CC0000"
    ToolTip(status "  " label)
    SetTimer(() => ToolTip(), -1200)
}

; ── Hotkeys ───────────────────────────────────────────────────────────────────

a:: Toggle(["ch01"],          ["/ch/01/mix/on"],                        "Ch 1  - Host Mic")
s:: Toggle(["ch02"],          ["/ch/02/mix/on"],                        "Ch 2  - Karaoke Mic")
d:: Toggle(["ch03"],          ["/ch/03/mix/on"],                        "Ch 3  - Guitar")
f:: Toggle(["ch04"],          ["/ch/04/mix/on"],                        "Ch 4  - Click Track")
g:: Toggle(["ch05"],          ["/ch/05/mix/on"],                        "Ch 5")
h:: Toggle(["ch06"],          ["/ch/06/mix/on"],                        "Ch 6")
q:: Toggle(["ch15","ch16"],   ["/ch/15/mix/on","/ch/16/mix/on"],        "Ch 15+16 - Jamzone L+R")
w:: Toggle(["bus05","bus06"], ["/bus/05/mix/on","/bus/06/mix/on"],      "Bus 5+6  - Jamzone Bus")
+:: Toggle(["master"],        ["/main/st/mix/on"],                      "MASTER LR")
