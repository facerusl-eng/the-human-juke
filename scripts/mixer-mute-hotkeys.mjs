/**
 * THE HUMAN JUKEBOX — Mixer Mute Hotkeys
 *
 * Hold this running in a terminal during your gig.
 * Press keys to toggle mute on any channel instantly via OSC.
 *
 * Hotkeys:
 *   A  →  Ch 1  (Host Mic)
 *   S  →  Ch 2  (Karaoke Mic)
 *   D  →  Ch 3  (Guitar)
 *   F  →  Ch 4  (Click Track)
 *   G  →  Ch 5
 *   H  →  Ch 6
 *   Q  →  Ch 15 + 16  (Jamzone L+R)
 *   W  →  Bus 5 + 6   (Jamzone submix)
 *   +  →  Master LR
 *   ESC / Ctrl+C  →  Quit
 */

import dgram from 'dgram';

const MIXER_IP   = process.env.XR18_IP   || '192.168.10.70';
const MIXER_PORT = Number(process.env.XR18_PORT || 10024);
const BIND_IP    = process.env.XR18_BIND_IP || '';

// ─── OSC helpers ────────────────────────────────────────────────────────────

function oscString(str) {
  const padded = str + '\0';
  const buf = Buffer.alloc(Math.ceil(padded.length / 4) * 4, 0);
  buf.write(str, 0, 'ascii');
  return buf;
}
function oscInt(val) {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(val, 0);
  return buf;
}
function buildOSC(address, intVal) {
  return Buffer.concat([
    oscString(address),
    oscString(',i'),
    oscInt(intVal),
  ]);
}

// ─── State: 1 = ON (audible), 0 = OFF (muted) ───────────────────────────────

const state = {
  ch01: 1, ch02: 1, ch03: 1, ch04: 1,
  ch05: 1, ch06: 1,
  ch15: 1, ch16: 1,
  bus05: 1, bus06: 1,
  master: 1,
};

// ─── Send ────────────────────────────────────────────────────────────────────

const socket = dgram.createSocket('udp4');

function send(address, val) {
  const msg = buildOSC(address, val);
  socket.send(msg, MIXER_PORT, MIXER_IP);
}

function toggle(keys, addresses, label) {
  const currentlyOn = state[keys[0]] === 1;
  const newVal = currentlyOn ? 0 : 1;
  for (const k of keys) state[k] = newVal;
  for (const addr of addresses) send(addr, newVal);
  const icon = newVal === 0 ? '🔇 MUTED  ' : '🔊 LIVE   ';
  console.log(`  ${icon}  ${label}`);
}

// ─── Keymap ──────────────────────────────────────────────────────────────────

function handleKey(key) {
  switch (key.toLowerCase()) {
    case 'a': toggle(['ch01'],          ['/ch/01/mix/on'],                         'Ch 1  — Host Mic');       break;
    case 's': toggle(['ch02'],          ['/ch/02/mix/on'],                         'Ch 2  — Karaoke Mic');    break;
    case 'd': toggle(['ch03'],          ['/ch/03/mix/on'],                         'Ch 3  — Guitar');         break;
    case 'f': toggle(['ch04'],          ['/ch/04/mix/on'],                         'Ch 4  — Click Track');    break;
    case 'g': toggle(['ch05'],          ['/ch/05/mix/on'],                         'Ch 5');                   break;
    case 'h': toggle(['ch06'],          ['/ch/06/mix/on'],                         'Ch 6');                   break;
    case 'q': toggle(['ch15','ch16'],   ['/ch/15/mix/on','/ch/16/mix/on'],         'Ch 15+16 — Jamzone L+R'); break;
    case 'w': toggle(['bus05','bus06'], ['/bus/05/mix/on','/bus/06/mix/on'],       'Bus 5+6  — Jamzone Bus'); break;
    case '+':
    case '=': toggle(['master'],        ['/main/st/mix/on'],                       'MASTER LR');              break;
    case '\u001b':  // ESC
    case '\u0003':  // Ctrl+C
      console.log('\n  Exiting hotkey controller. Bye!\n');
      socket.close();
      process.exit(0);
  }
}

// ─── Start ───────────────────────────────────────────────────────────────────

socket.on('error', (err) => {
  console.error(`Socket error: ${err.message}`);
});

function start() {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (data) => {
    handleKey(data);
  });

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║    THE HUMAN JUKEBOX — Mute Hotkeys (OSC)           ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  A  →  Ch 1   Host Mic                              ║');
  console.log('║  S  →  Ch 2   Karaoke Mic                           ║');
  console.log('║  D  →  Ch 3   Guitar                                ║');
  console.log('║  F  →  Ch 4   Click Track                           ║');
  console.log('║  G  →  Ch 5                                         ║');
  console.log('║  H  →  Ch 6                                         ║');
  console.log('║  Q  →  Ch 15+16   Jamzone L+R                       ║');
  console.log('║  W  →  Bus 5+6    Jamzone Bus                       ║');
  console.log('║  +  →  MASTER LR                                    ║');
  console.log('║  ESC / Ctrl+C  →  Quit                              ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\n  Connected to ${MIXER_IP}:${MIXER_PORT}  — all channels LIVE\n`);
}

if (BIND_IP) {
  socket.bind(0, BIND_IP, start);
} else {
  start();
}
