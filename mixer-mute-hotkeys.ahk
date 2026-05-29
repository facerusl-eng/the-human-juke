#Requires AutoHotkey v2.0
#SingleInstance Force

; ── THE HUMAN JUKEBOX — Global Mute Hotkeys ──────────────────────────────────
; Runs in system tray. Works even when window is in background.
; Right-click tray icon → Suspend to disable while typing normally.
;
; 1  = Ch 1  Host Mic   (A alias)
; 2  = Ch 2  Karaoke Mic (S alias)
; 3  = Ch 3  Guitar      (D alias)
; 4  = Ch 4  Click Track (F alias)
; 5  = Ch 5              (G alias)
; 6  = Ch 6              (H alias)
; Numpad 7 = Ch 15+16  Jamzone L+R
; Numpad 8 = AUX source to Bus 5+6
; Numpad 9 = Master channel (Bus 5+6)
; Numpad 0 = PANIC force Spotify stereo ON
; Numpad controls are mapped globally to keep non-numpad keys normal
; ─────────────────────────────────────────────────────────────────────────────

envMixerIp := EnvGet("XR18_IP")
MIXER_IP   := (envMixerIp != "") ? envMixerIp : "10.1.1.70"
MIXER_PORT := 10024

; Mute state: true = live, false = muted
state := Map(
    "ch01",  true, "ch02",  true, "ch03",  true, "ch04", true,
    "ch05",  true, "ch06",  true,
    "ch15",  true, "ch16",  true,
    "aux",   true,
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

ForceSpotifyStereoOn() {
    global state, MIXER_IP, MIXER_PORT
    state["ch15"] := true
    state["ch16"] := true
    state["aux"] := true
    state["master"] := true
    SendOSC(MIXER_IP, MIXER_PORT, "/ch/15/mix/on", 1)
    SendOSC(MIXER_IP, MIXER_PORT, "/ch/16/mix/on", 1)
    SendOSC(MIXER_IP, MIXER_PORT, "/rtn/aux/mix/05/on", 1)
    SendOSC(MIXER_IP, MIXER_PORT, "/rtn/aux/mix/06/on", 1)
    SendOSC(MIXER_IP, MIXER_PORT, "/bus/05/mix/on", 1)
    SendOSC(MIXER_IP, MIXER_PORT, "/bus/06/mix/on", 1)
    ToolTip("LIVE  PANIC - Spotify stereo ON")
    SetTimer(() => ToolTip(), -1200)
}

; ── Hotkeys ───────────────────────────────────────────────────────────────────

Numpad1::
NumpadEnd:: Toggle(["ch01"],      ["/ch/01/mix/on"],                    "Ch 1  - Host Mic")
Numpad2::
NumpadDown:: Toggle(["ch02"],     ["/ch/02/mix/on"],                    "Ch 2  - Karaoke Mic")
Numpad3::
NumpadPgDn:: Toggle(["ch03"],     ["/ch/03/mix/on"],                    "Ch 3  - Guitar")
Numpad4::
NumpadLeft:: Toggle(["ch04"],     ["/ch/04/mix/on"],                    "Ch 4  - Click Track")
Numpad5::
NumpadClear:: Toggle(["ch05"],    ["/ch/05/mix/on"],                    "Ch 5")
Numpad6::
NumpadRight:: Toggle(["ch06"],    ["/ch/06/mix/on"],                    "Ch 6")
Numpad7::
NumpadHome:: Toggle(["ch15","ch16"], ["/ch/15/mix/on","/ch/16/mix/on"], "Ch 15+16 - Jamzone L+R")
Numpad8::
NumpadUp:: Toggle(["aux"], ["/rtn/aux/mix/05/on","/rtn/aux/mix/06/on"], "AUX Source")
Numpad9::
NumpadPgUp::
NumpadAdd:: Toggle(["master"], ["/bus/05/mix/on","/bus/06/mix/on"], "MASTER Channel (Bus 5+6)")
Numpad0::
NumpadIns:: ForceSpotifyStereoOn()
