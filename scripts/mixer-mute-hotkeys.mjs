/**
 * THE HUMAN JUKEBOX — Mixer Mute Hotkeys
 *
 * Hold this running in a terminal during your gig.
 * Press keys to toggle mute on any channel instantly via OSC.
 *
 * Hotkeys:
 *   1  →  Ch 1  (Host Mic)
 *   2  →  Ch 2  (Karaoke Mic)
 *   3  →  Ch 3  (Guitar)
 *   4  →  Ch 4  (Click Track)
 *   5  →  Ch 5
 *   6  →  Ch 6
 *   Q  →  Ch 15 + 16  (Jamzone L+R)
 *   W  →  Bus 5 + 6   (Jamzone submix)
 *   +  →  Master LR
 *   P/0 →  PANIC: Force Spotify stereo ON (all relevant paths)
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

function forceOn(keys, addresses, label) {
  for (const k of keys) {
    if (k in state) state[k] = 1;
  }
  for (const addr of addresses) send(addr, 1);
  console.log(`  🔊 LIVE    ${label}`);
}

// ─── Keymap ──────────────────────────────────────────────────────────────────

function handleKey(key) {
  switch (key.toLowerCase()) {
    case '1':
    case 'a': toggle(['ch01'],          ['/ch/01/mix/on'],                         'Ch 1  — Host Mic');       break;
    case '2':
    case 's': toggle(['ch02'],          ['/ch/02/mix/on'],                         'Ch 2  — Karaoke Mic');    break;
    case '3':
    case 'd': toggle(['ch03'],          ['/ch/03/mix/on'],                         'Ch 3  — Guitar');         break;
    case '4':
    case 'f': toggle(['ch04'],          ['/ch/04/mix/on'],                         'Ch 4  — Click Track');    break;
    case '5':
    case 'g': toggle(['ch05'],          ['/ch/05/mix/on'],                         'Ch 5');                   break;
    case '6':
    case 'h': toggle(['ch06'],          ['/ch/06/mix/on'],                         'Ch 6');                   break;
    case 'q': toggle(['ch15','ch16'],   ['/ch/15/mix/on','/ch/16/mix/on'],         'Ch 15+16 — Jamzone L+R'); break;
    case 'w': toggle(['bus05','bus06'], ['/bus/05/mix/on','/bus/06/mix/on'],       'Bus 5+6  — Jamzone Bus'); break;
    case '+':
    case '=': toggle(['master'],        ['/main/st/mix/on'],                       'MASTER LR');              break;
    case 'p':
    case '0':
      forceOn(
        ['ch15', 'ch16', 'bus05', 'bus06', 'master'],
        [
          '/ch/15/mix/on', '/ch/16/mix/on',
          '/rtn/aux/mix/05/on', '/rtn/aux/mix/06/on',
          '/bus/05/mix/on', '/bus/06/mix/on',
          '/main/st/mix/on',
        ],
        'PANIC — Spotify stereo forced ON'
      );
      break;
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
  console.log('║  1  →  Ch 1   Host Mic   (A alias)                  ║');
  console.log('║  2  →  Ch 2   Karaoke Mic (S alias)                 ║');
  console.log('║  3  →  Ch 3   Guitar      (D alias)                 ║');
  console.log('║  4  →  Ch 4   Click Track (F alias)                 ║');
  console.log('║  5  →  Ch 5             (G alias)                   ║');
  console.log('║  6  →  Ch 6             (H alias)                   ║');
  console.log('║  Q  →  Ch 15+16   Jamzone L+R                       ║');
  console.log('║  W  →  Bus 5+6    Jamzone Bus                       ║');
  console.log('║  +  →  MASTER LR                                    ║');
  console.log('║  P/0→  PANIC: Force Spotify stereo ON               ║');
  console.log('║  ESC / Ctrl+C  →  Quit                              ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\n  Connected to ${MIXER_IP}:${MIXER_PORT}  — all channels LIVE\n`);
}

if (BIND_IP) {
  socket.bind(0, BIND_IP, start);
} else {
  start();
}
