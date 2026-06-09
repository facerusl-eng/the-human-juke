/**
 * THE HUMAN JUKEBOX — Ultimo Vocal Compressor Bus
 *
 * Applies professional vocal compressor to a dedicated bus (Bus 3/4).
 * Routes all vocal channels (Ch 1, 2, 3) into the vocal bus with
 * transparent 3:1 compression for cohesive vocal blending.
 *
 * Usage:
 *   node scripts/apply-vocal-ultimo.mjs
 *
 * Environment variables:
 *   XR18_IP=192.168.10.70
 *   XR18_PORT=10024
 *   XR18_BIND_IP=192.168.10.194
 */

import dgram from 'dgram';

const MIXER_IP = process.env.XR18_IP || '192.168.10.70';
const MIXER_PORT = Number(process.env.XR18_PORT || 10024);
const BIND_IP = process.env.XR18_BIND_IP || '192.168.10.194';
const DELAY_MS = 50;

// ─── OSC Encoding ───────────────────────────────────────────────────────

function oscString(str) {
  const padded = str + '\0';
  const aligned = Math.ceil(padded.length / 4) * 4;
  const buf = Buffer.alloc(aligned, 0);
  buf.write(str, 0, 'ascii');
  return buf;
}

function oscFloat(val) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(val, 0);
  return buf;
}

function oscInt(val) {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(val, 0);
  return buf;
}

function buildOSC(address, args = []) {
  const typeTag = ',' + args.map(a => a.type).join('');
  const parts = [oscString(address), oscString(typeTag)];
  for (const a of args) {
    if (a.type === 'f') parts.push(oscFloat(a.value));
    else if (a.type === 's') parts.push(oscString(a.value));
    else parts.push(oscInt(a.value));
  }
  return Buffer.concat(parts);
}

// ─── Parameter Conversions ──────────────────────────────────────────────

function fader(db) {
  if (db <= -90) return 0.0;
  if (db <= -60) return (db + 90) / 30 * 0.25;
  if (db <= -30) return 0.25 + (db + 60) / 30 * 0.25;
  if (db <= 0) return 0.5 + (db + 30) / 30 * 0.25;
  return 0.75 + db / 10 * 0.25;
}

function threshold(db) {
  return Math.max(0, Math.min(1, (db + 80) / 80));
}

function attack(ms) {
  return Math.max(0, Math.min(1, ms / 200));
}

function release(ms) {
  const min = Math.log(5);
  const max = Math.log(3000);
  return Math.max(0, Math.min(1, (Math.log(ms) - min) / (max - min)));
}

function mgain(db) {
  return Math.max(0, Math.min(1, db / 24));
}

// ─── Preset Commands ────────────────────────────────────────────────────

const RATIO_3_1 = 5 / 14;

const commands = [
  // Create Vocal Bus (Bus 3/4)
  ['/bus/03/config/name', [{ type: 's', value: 'Vocal Bus L' }]],
  ['/bus/03/config/color', [{ type: 'i', value: 3 }]], // YELLOW
  ['/bus/04/config/name', [{ type: 's', value: 'Vocal Bus R' }]],
  ['/bus/04/config/color', [{ type: 'i', value: 3 }]], // YELLOW

  // Link buses as stereo pair
  ['/config/buslink/3-4', [{ type: 'i', value: 1 }]],

  // Enable buses and set faders
  ['/bus/03/mix/on', [{ type: 'i', value: 1 }]],
  ['/bus/04/mix/on', [{ type: 'i', value: 1 }]],
  ['/bus/03/mix/fader', [{ type: 'f', value: fader(-3) }]],
  ['/bus/04/mix/fader', [{ type: 'f', value: fader(-3) }]],

  // Route vocals into vocal bus
  ['/ch/01/mix/03/on', [{ type: 'i', value: 1 }]],  // Ch 1 → Bus 3
  ['/ch/01/mix/03/level', [{ type: 'f', value: fader(0) }]],
  ['/ch/02/mix/03/on', [{ type: 'i', value: 1 }]],  // Ch 2 → Bus 3
  ['/ch/02/mix/03/level', [{ type: 'f', value: fader(0) }]],
  ['/ch/03/mix/03/on', [{ type: 'i', value: 1 }]],  // Ch 3 → Bus 3
  ['/ch/03/mix/03/level', [{ type: 'f', value: fader(0) }]],

  // ═══ BUS 3 COMPRESSOR: ULTIMO VOCAL SETTINGS ═══════════════════════════
  // Threshold: -14dB | Ratio: 3:1 | Attack: 6ms | Release: 95ms | Makeup: +2.5dB
  ['/bus/03/dyn/on', [{ type: 'i', value: 1 }]],
  ['/bus/03/dyn/mode', [{ type: 'i', value: 0 }]],           // COMP
  ['/bus/03/dyn/det', [{ type: 'i', value: 1 }]],            // RMS
  ['/bus/03/dyn/thr', [{ type: 'f', value: threshold(-14) }]],
  ['/bus/03/dyn/ratio', [{ type: 'f', value: RATIO_3_1 }]],
  ['/bus/03/dyn/knee', [{ type: 'f', value: 0.36 }]],        // soft knee
  ['/bus/03/dyn/mgain', [{ type: 'f', value: mgain(2.5) }]],
  ['/bus/03/dyn/attack', [{ type: 'f', value: attack(6) }]],
  ['/bus/03/dyn/release', [{ type: 'f', value: release(95) }]],

  // ═══ BUS 4 COMPRESSOR (STEREO LINKED) ════════════════════════════════
  ['/bus/04/dyn/on', [{ type: 'i', value: 1 }]],
  ['/bus/04/dyn/mode', [{ type: 'i', value: 0 }]],
  ['/bus/04/dyn/det', [{ type: 'i', value: 1 }]],
  ['/bus/04/dyn/thr', [{ type: 'f', value: threshold(-14) }]],
  ['/bus/04/dyn/ratio', [{ type: 'f', value: RATIO_3_1 }]],
  ['/bus/04/dyn/knee', [{ type: 'f', value: 0.36 }]],
  ['/bus/04/dyn/mgain', [{ type: 'f', value: mgain(2.5) }]],
  ['/bus/04/dyn/attack', [{ type: 'f', value: attack(6) }]],
  ['/bus/04/dyn/release', [{ type: 'f', value: release(95) }]],
];

// ─── Send All Commands ───────────────────────────────────────────────────

const socket = dgram.createSocket('udp4');
let index = 0;

function subscribeAndStart() {
  const xremote = buildOSC('/xremote', []);
  socket.send(xremote, MIXER_PORT, MIXER_IP, (err) => {
    if (err) {
      console.error(`✗ Failed to subscribe: ${err.message}`);
      socket.close();
      process.exit(1);
      return;
    }
    setTimeout(sendNext, 200);
  });
}

function sendNext() {
  if (index >= commands.length) {
    console.log('\n✓ Ultimo Vocal Compressor applied!\n');
    console.log('  Bus 3/4 (Vocal Bus) now active:');
    console.log('    • Ch 1 (Harald Vocals) → Bus 3');
    console.log('    • Ch 2 (Guest Vocals 1) → Bus 3');
    console.log('    • Ch 3 (Guest Vocals 2) → Bus 3');
    console.log('\n  Compressor Settings (Professional Vocal Chain):');
    console.log('    • Threshold: -14 dB');
    console.log('    • Ratio: 3:1 (transparent, musical)');
    console.log('    • Attack: 6 ms (fast presence, not aggressive)');
    console.log('    • Release: 95 ms (natural recovery)');
    console.log('    • Makeup Gain: +2.5 dB (lifts vocal presence)');
    console.log('\n  Live Control:');
    console.log('    • Bus 3/4 fader: adjust vocal group level');
    console.log('    • Individual channels: fine-tune per vocalist\n');
    socket.close();
    return;
  }

  const [address, args] = commands[index];
  const msg = buildOSC(address, args);

  socket.send(msg, MIXER_PORT, MIXER_IP, (err) => {
    if (err) {
      console.error(`✗ Failed to send ${address}: ${err.message}`);
    }
    index++;
    setTimeout(sendNext, DELAY_MS);
  });
}

console.log('═════════════════════════════════════════════════════════');
console.log('  THE HUMAN JUKEBOX — Ultimo Vocal Compressor           ');
console.log('  Professional 3-vocal blend with transparent compression');
console.log('═════════════════════════════════════════════════════════');
console.log(`  Sending ${commands.length} OSC commands to ${MIXER_IP}:${MIXER_PORT} ...\n`);

socket.on('error', (err) => {
  console.error(`\nSocket error: ${err.message}`);
  console.error('Check that the mixer is on and reachable at', MIXER_IP);
  socket.close();
  process.exit(1);
});

if (BIND_IP) {
  socket.bind(0, BIND_IP, () => subscribeAndStart());
} else {
  subscribeAndStart();
}
