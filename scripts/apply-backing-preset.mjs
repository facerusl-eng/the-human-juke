/**
 * THE HUMAN JUKEBOX — Backing Tracks Professional Preset
 *
 * Sends OSC commands over UDP to the Behringer XR18 mixer to apply:
 *   - Ch 15+16 (Jamzone Backing): stereo linked pair → Bus 5+6
 *   - Bus 1+2 (IEM monitor):      stereo linked, AUX output for in-ear monitors
 *   - Bus 5+6 (Jamzone submix):   stereo linked → Limiter (-3dB, ∞:1) → Main L/R
 *   - Click track (Ch 4):         sends ONLY to Bus 1+2 (IEM), never to Main L/R
 *
 * Usage:
 *   node scripts/apply-backing-preset.mjs
 *
 * Requirements:
 *   - XR18 mixer powered on and connected to network
 *   - Mixer reachable at 192.168.10.20 (static IP)
 *   - Run from any terminal in the project folder
 */

import dgram from 'dgram';

const MIXER_IP = process.env.XR18_IP || '192.168.10.70';
const MIXER_PORT = Number(process.env.XR18_PORT || 10024);
const BIND_IP = process.env.XR18_BIND_IP || '';
const DELAY_MS = 70; // ms between OSC messages (mixer needs time to process)

// ─── OSC Encoding (no external packages needed) ─────────────────────────────

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

/**
 * Build a raw OSC message buffer.
 * args: array of { type: 'f'|'i'|'s', value: number|string }
 */
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

// ─── XR18 Parameter Conversions ─────────────────────────────────────────────

/**
 * XR18 fader: 0.0 = -∞, 0.5 = -30dB, 0.75 = 0dB, 1.0 = +10dB
 * Piecewise approximation based on Behringer OSC protocol spec.
 */
function fader(db) {
  if (db <= -90) return 0.0;
  if (db <= -60) return lerp(0.00, 0.25, (db + 90) / 30);
  if (db <= -30) return lerp(0.25, 0.50, (db + 60) / 30);
  if (db <=   0) return lerp(0.50, 0.75, (db + 30) / 30);
  return lerp(0.75, 1.00, db / 10);
}
function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

/**
 * XR18 dynamics threshold: -80dB to 0dB → 0.0 to 1.0 (linear)
 */
function threshold(db) { return Math.max(0, Math.min(1, (db + 80) / 80)); }

/**
 * XR18 dynamics attack: 0ms to 200ms → 0.0 to 1.0 (linear)
 */
function attack(ms) { return Math.max(0, Math.min(1, ms / 200)); }

/**
 * XR18 dynamics release: 5ms to 3000ms → 0.0 to 1.0 (logarithmic approx)
 */
function release(ms) {
  const min = Math.log(5), max = Math.log(3000);
  return Math.max(0, Math.min(1, (Math.log(ms) - min) / (max - min)));
}

/**
 * XR18 ratio index → normalized float (14 steps: 1.1:1 … ∞:1)
 * Indices: 0=1.1, 1=1.3, 2=1.5, 3=2, 4=2.5, 5=3, 6=4, 7=5,
 *          8=6, 9=7, 10=8, 11=10, 12=16, 13=32, 14=∞
 */
const RATIO = { '3:1': 5 / 14, '4:1': 6 / 14, '10:1': 11 / 14, 'INF': 14 / 14 };

/**
 * XR18 dynamics makeup gain: 0dB to +24dB → 0.0 to 1.0
 */
function mgain(db) { return Math.max(0, Math.min(1, db / 24)); }

/**
 * XR18 EQ frequency: 20Hz – 20kHz log scale → 0.0 to 1.0
 */
function eqFreq(hz) {
  return (Math.log10(hz) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20));
}

/**
 * XR18 EQ gain: -15dB to +15dB → 0.0 to 1.0 (0.5 = 0dB)
 */
function eqGain(db) { return Math.max(0, Math.min(1, 0.5 + db / 30)); }

/**
 * XR18 EQ Q: 0.3 – 10 log scale → 0.0 to 1.0
 */
function eqQ(q) {
  return (Math.log10(q) - Math.log10(0.3)) / (Math.log10(10) - Math.log10(0.3));
}

// ─── XR18 Color Index ────────────────────────────────────────────────────────
// 0=OFF 1=RED 2=GREEN 3=YELLOW 4=BLUE 5=MAGENTA 6=CYAN 7=WHITE
const COLOR = { OFF: 0, RED: 1, GREEN: 2, YELLOW: 3, BLUE: 4, MAGENTA: 5, CYAN: 6, WHITE: 7 };

// ─── Preset Commands ─────────────────────────────────────────────────────────

const commands = [

  // ══ CHANNEL NAMES & COLORS ═══════════════════════════════════════════════
  ['/ch/01/config/name',   [{ type: 's', value: 'Host Mic'     }]],
  ['/ch/01/config/color',  [{ type: 'i', value: COLOR.RED      }]],
  ['/ch/02/config/name',   [{ type: 's', value: 'Karaoke Mic'  }]],
  ['/ch/02/config/color',  [{ type: 'i', value: COLOR.MAGENTA  }]],
  ['/ch/03/config/name',   [{ type: 's', value: 'Guitar'       }]],
  ['/ch/03/config/color',  [{ type: 'i', value: COLOR.YELLOW   }]],
  ['/ch/04/config/name',   [{ type: 's', value: 'Click Track'  }]],
  ['/ch/04/config/color',  [{ type: 'i', value: COLOR.BLUE     }]],
  ['/ch/15/config/name',   [{ type: 's', value: 'Jamzone L'    }]],
  ['/ch/15/config/color',  [{ type: 'i', value: COLOR.BLUE     }]],  // navy blue = BLUE
  ['/ch/16/config/name',   [{ type: 's', value: 'Jamzone R'    }]],
  ['/ch/16/config/color',  [{ type: 'i', value: COLOR.BLUE     }]],  // navy blue = BLUE

  // AUX stereo return (Spotify) uses /rtn/aux — NOT /ch/17 or /ch/18
  ['/rtn/aux/config/name',  [{ type: 's', value: 'Spotify'     }]],
  ['/rtn/aux/config/color', [{ type: 'i', value: COLOR.GREEN   }]],

  // ══ BUS NAMES & COLORS ═══════════════════════════════════════════════════
  ['/bus/01/config/name',  [{ type: 's', value: 'IEM L'        }]],
  ['/bus/01/config/color', [{ type: 'i', value: COLOR.YELLOW   }]],
  ['/bus/02/config/name',  [{ type: 's', value: 'IEM R'        }]],
  ['/bus/02/config/color', [{ type: 'i', value: COLOR.YELLOW   }]],
  ['/bus/05/config/name',  [{ type: 's', value: 'Jamzone L'    }]],
  ['/bus/05/config/color', [{ type: 'i', value: COLOR.BLUE     }]],
  ['/bus/06/config/name',  [{ type: 's', value: 'Jamzone R'    }]],
  ['/bus/06/config/color', [{ type: 'i', value: COLOR.BLUE     }]],

  // ══ CH 15+16: JAMZONE STEREO PAIR → BUS 5+6 ══════════════════════════════
  ['/ch/15/mix/on',        [{ type: 'i', value: 1 }]],
  ['/ch/15/mix/pan',       [{ type: 'f', value: 0.0 }]],           // hard left
  ['/ch/15/mix/fader',     [{ type: 'f', value: fader(0) }]],      // 0dB into bus
  ['/ch/15/mix/05/on',     [{ type: 'i', value: 1 }]],             // ch15→bus5 send ON
  ['/ch/15/mix/05/level',  [{ type: 'f', value: fader(0) }]],      // 0dB
  ['/ch/16/mix/on',        [{ type: 'i', value: 1 }]],
  ['/ch/16/mix/pan',       [{ type: 'f', value: 1.0 }]],           // hard right
  ['/ch/16/mix/fader',     [{ type: 'f', value: fader(0) }]],      // 0dB into bus
  ['/ch/16/mix/06/on',     [{ type: 'i', value: 1 }]],             // ch16→bus6 send ON
  ['/ch/16/mix/06/level',  [{ type: 'f', value: fader(0) }]],      // 0dB

  // ══ BUS 1+2: IEM MONITOR (stereo linked, no limiter) ═════════════════════
  ['/bus/01/mix/on',       [{ type: 'i', value: 1 }]],
  ['/bus/01/mix/fader',    [{ type: 'f', value: fader(-6) }]],     // start -6dB
  ['/bus/02/mix/on',       [{ type: 'i', value: 1 }]],
  ['/bus/02/mix/fader',    [{ type: 'f', value: fader(-6) }]],     // start -6dB

  // ══ BUS 5+6: JAMZONE SUBMIX → LIMITER → MAIN ═════════════════════════════
  ['/bus/05/mix/on',       [{ type: 'i', value: 1 }]],
  ['/bus/05/mix/fader',    [{ type: 'f', value: fader(-6) }]],     // -6dB starting level
  ['/bus/06/mix/on',       [{ type: 'i', value: 1 }]],
  ['/bus/06/mix/fader',    [{ type: 'f', value: fader(-6) }]],

  // Bus 5 Limiter (COMP mode + ∞:1 ratio = brick wall limiter)
  ['/bus/05/dyn/on',       [{ type: 'i', value: 1 }]],
  ['/bus/05/dyn/mode',     [{ type: 'i', value: 0 }]],             // COMP (XR18 has no separate LIMIT mode)
  ['/bus/05/dyn/thr',      [{ type: 'f', value: threshold(-3) }]], // -3dB ceiling
  ['/bus/05/dyn/ratio',    [{ type: 'f', value: RATIO['INF'] }]],  // ∞:1 = limiter
  ['/bus/05/dyn/attack',   [{ type: 'f', value: attack(1) }]],     // 1ms (instant)
  ['/bus/05/dyn/release',  [{ type: 'f', value: release(50) }]],   // 50ms

  // Bus 6 Limiter (same)
  ['/bus/06/dyn/on',       [{ type: 'i', value: 1 }]],
  ['/bus/06/dyn/mode',     [{ type: 'i', value: 0 }]],             // COMP
  ['/bus/06/dyn/thr',      [{ type: 'f', value: threshold(-3) }]],
  ['/bus/06/dyn/ratio',    [{ type: 'f', value: RATIO['INF'] }]],
  ['/bus/06/dyn/attack',   [{ type: 'f', value: attack(1) }]],
  ['/bus/06/dyn/release',  [{ type: 'f', value: release(50) }]],

  // ══ FX 4: PRECISION LIMITER — Jamzone bus protection ═════════════════════
  // Parameters: 0.0–1.0 normalized. For steady backing track level holding.
  ['/fx/4/par/01',  [{ type: 'f', value: 0.0  }]],  // AUTOGAIN: OFF (manual control)
  ['/fx/4/par/02',  [{ type: 'f', value: 1.0  }]],  // STEREO LINK: ON (Bus 5+6 pair)
  ['/fx/4/par/03',  [{ type: 'f', value: 0.5  }]],  // INPUT GAIN: 0dB
  ['/fx/4/par/04',  [{ type: 'f', value: 0.5  }]],  // OUTPUT GAIN: 0dB
  ['/fx/4/par/05',  [{ type: 'f', value: 0.75 }]],  // GR ceiling: catches peaks ~6dB above nominal
  ['/fx/4/par/06',  [{ type: 'f', value: 0.40 }]],  // SQUEEZE: 40% — gentle leveling below ceiling
  ['/fx/4/par/07',  [{ type: 'f', value: 0.35 }]],  // KNEE: soft — transparent, no pumping
  ['/fx/4/par/08',  [{ type: 'f', value: 0.10 }]],  // ATTACK: ~1ms — catches transients fast
  ['/fx/4/par/09',  [{ type: 'f', value: 0.50 }]],  // RELEASE: ~100ms — natural, no breathing

  // ══ STEREO LINKS ══════════════════════════════════════════════════════════
  ['/config/chlink/15-16', [{ type: 'i', value: 1 }]],  // Jamzone L+R stereo pair
  ['/config/buslink/1-2',  [{ type: 'i', value: 1 }]],  // IEM stereo pair
  ['/config/buslink/5-6',  [{ type: 'i', value: 1 }]],  // Jamzone bus stereo pair

  // ══ MAIN LR / MASTER ══════════════════════════════════════════════════════
  ['/main/st/mix/on',      [{ type: 'i', value: 1 }]],
  ['/main/st/mix/fader',   [{ type: 'f', value: fader(0) }]],      // 0dB master open

  // ══ CH 1: HOST MIC — EQ + COMPRESSOR ══════════════════════════════════════
  // EQ: HPF @ 100Hz | -2dB mud @ 250Hz | +2.5dB presence @ 3kHz
  ['/ch/01/eq/on',         [{ type: 'i', value: 1 }]],
  ['/ch/01/eq/1/type',     [{ type: 'i', value: 0 }]],             // LC = High Pass
  ['/ch/01/eq/1/f',        [{ type: 'f', value: eqFreq(100) }]],
  ['/ch/01/eq/2/type',     [{ type: 'i', value: 2 }]],             // PEQ
  ['/ch/01/eq/2/f',        [{ type: 'f', value: eqFreq(250) }]],
  ['/ch/01/eq/2/g',        [{ type: 'f', value: eqGain(-2) }]],    // -2dB mud
  ['/ch/01/eq/2/q',        [{ type: 'f', value: eqQ(1.0) }]],
  ['/ch/01/eq/3/type',     [{ type: 'i', value: 2 }]],             // PEQ
  ['/ch/01/eq/3/f',        [{ type: 'f', value: eqFreq(3000) }]],
  ['/ch/01/eq/3/g',        [{ type: 'f', value: eqGain(2.5) }]],   // +2.5dB presence
  ['/ch/01/eq/3/q',        [{ type: 'f', value: eqQ(1.0) }]],
  // Compressor: 3:1 | -18dB | 10ms attack | 80ms release | +3dB makeup
  ['/ch/01/dyn/on',        [{ type: 'i', value: 1 }]],
  ['/ch/01/dyn/mode',      [{ type: 'i', value: 0 }]],             // COMP
  ['/ch/01/dyn/det',       [{ type: 'i', value: 1 }]],             // RMS
  ['/ch/01/dyn/thr',       [{ type: 'f', value: threshold(-18) }]],
  ['/ch/01/dyn/ratio',     [{ type: 'f', value: RATIO['3:1'] }]],
  ['/ch/01/dyn/knee',      [{ type: 'f', value: 0.3 }]],           // soft knee
  ['/ch/01/dyn/mgain',     [{ type: 'f', value: mgain(3) }]],      // +3dB makeup
  ['/ch/01/dyn/attack',    [{ type: 'f', value: attack(10) }]],    // 10ms
  ['/ch/01/dyn/release',   [{ type: 'f', value: release(80) }]],   // 80ms

  // ══ CH 2: KARAOKE MIC — EQ + COMPRESSOR (same as host mic) ════════════════
  ['/ch/02/eq/on',         [{ type: 'i', value: 1 }]],
  ['/ch/02/eq/1/type',     [{ type: 'i', value: 0 }]],             // LC = High Pass
  ['/ch/02/eq/1/f',        [{ type: 'f', value: eqFreq(100) }]],
  ['/ch/02/eq/2/type',     [{ type: 'i', value: 2 }]],
  ['/ch/02/eq/2/f',        [{ type: 'f', value: eqFreq(250) }]],
  ['/ch/02/eq/2/g',        [{ type: 'f', value: eqGain(-2) }]],
  ['/ch/02/eq/2/q',        [{ type: 'f', value: eqQ(1.0) }]],
  ['/ch/02/eq/3/type',     [{ type: 'i', value: 2 }]],
  ['/ch/02/eq/3/f',        [{ type: 'f', value: eqFreq(3000) }]],
  ['/ch/02/eq/3/g',        [{ type: 'f', value: eqGain(2.5) }]],
  ['/ch/02/eq/3/q',        [{ type: 'f', value: eqQ(1.0) }]],
  ['/ch/02/dyn/on',        [{ type: 'i', value: 1 }]],
  ['/ch/02/dyn/mode',      [{ type: 'i', value: 0 }]],
  ['/ch/02/dyn/det',       [{ type: 'i', value: 1 }]],
  ['/ch/02/dyn/thr',       [{ type: 'f', value: threshold(-18) }]],
  ['/ch/02/dyn/ratio',     [{ type: 'f', value: RATIO['3:1'] }]],
  ['/ch/02/dyn/knee',      [{ type: 'f', value: 0.3 }]],
  ['/ch/02/dyn/mgain',     [{ type: 'f', value: mgain(3) }]],
  ['/ch/02/dyn/attack',    [{ type: 'f', value: attack(10) }]],
  ['/ch/02/dyn/release',   [{ type: 'f', value: release(80) }]],

  // ══ CH 3: GUITAR — EQ + COMPRESSOR ════════════════════════════════════════
  // EQ: HPF @ 80Hz | -2dB mud @ 250Hz | +2dB bite @ 2.5kHz
  ['/ch/03/eq/on',         [{ type: 'i', value: 1 }]],
  ['/ch/03/eq/1/type',     [{ type: 'i', value: 0 }]],             // LC = High Pass
  ['/ch/03/eq/1/f',        [{ type: 'f', value: eqFreq(80) }]],
  ['/ch/03/eq/2/type',     [{ type: 'i', value: 2 }]],
  ['/ch/03/eq/2/f',        [{ type: 'f', value: eqFreq(250) }]],
  ['/ch/03/eq/2/g',        [{ type: 'f', value: eqGain(-2) }]],
  ['/ch/03/eq/2/q',        [{ type: 'f', value: eqQ(1.2) }]],
  ['/ch/03/eq/3/type',     [{ type: 'i', value: 2 }]],
  ['/ch/03/eq/3/f',        [{ type: 'f', value: eqFreq(2500) }]],
  ['/ch/03/eq/3/g',        [{ type: 'f', value: eqGain(2) }]],     // +2dB bite
  ['/ch/03/eq/3/q',        [{ type: 'f', value: eqQ(1.0) }]],
  // Compressor: 4:1 | -18dB | 20ms | 100ms | +2dB makeup
  ['/ch/03/dyn/on',        [{ type: 'i', value: 1 }]],
  ['/ch/03/dyn/mode',      [{ type: 'i', value: 0 }]],
  ['/ch/03/dyn/det',       [{ type: 'i', value: 1 }]],
  ['/ch/03/dyn/thr',       [{ type: 'f', value: threshold(-18) }]],
  ['/ch/03/dyn/ratio',     [{ type: 'f', value: RATIO['4:1'] }]],
  ['/ch/03/dyn/knee',      [{ type: 'f', value: 0.3 }]],
  ['/ch/03/dyn/mgain',     [{ type: 'f', value: mgain(2) }]],
  ['/ch/03/dyn/attack',    [{ type: 'f', value: attack(20) }]],
  ['/ch/03/dyn/release',   [{ type: 'f', value: release(100) }]],

  // ══ CH 15+16: JAMZONE — COMPRESSOR + EQ ═══════════════════════════════════
  // Compressor pushes body/low end up: 4:1 | -15dB | 25ms | 120ms | +3dB makeup
  ['/ch/15/dyn/on',        [{ type: 'i', value: 1 }]],
  ['/ch/15/dyn/mode',      [{ type: 'i', value: 0 }]],             // COMP
  ['/ch/15/dyn/det',       [{ type: 'i', value: 1 }]],             // RMS
  ['/ch/15/dyn/thr',       [{ type: 'f', value: threshold(-15) }]],
  ['/ch/15/dyn/ratio',     [{ type: 'f', value: RATIO['4:1'] }]],
  ['/ch/15/dyn/knee',      [{ type: 'f', value: 0.3 }]],           // soft knee
  ['/ch/15/dyn/mgain',     [{ type: 'f', value: mgain(3) }]],      // +3dB pushes low end body up
  ['/ch/15/dyn/attack',    [{ type: 'f', value: attack(25) }]],    // 25ms (let transient punch through)
  ['/ch/15/dyn/release',   [{ type: 'f', value: release(120) }]],  // 120ms natural decay
  ['/ch/16/dyn/on',        [{ type: 'i', value: 1 }]],
  ['/ch/16/dyn/mode',      [{ type: 'i', value: 0 }]],
  ['/ch/16/dyn/det',       [{ type: 'i', value: 1 }]],
  ['/ch/16/dyn/thr',       [{ type: 'f', value: threshold(-15) }]],
  ['/ch/16/dyn/ratio',     [{ type: 'f', value: RATIO['4:1'] }]],
  ['/ch/16/dyn/knee',      [{ type: 'f', value: 0.3 }]],
  ['/ch/16/dyn/mgain',     [{ type: 'f', value: mgain(3) }]],
  ['/ch/16/dyn/attack',    [{ type: 'f', value: attack(25) }]],
  ['/ch/16/dyn/release',   [{ type: 'f', value: release(120) }]],
  // EQ: +2dB low shelf @ 80Hz | -2dB mud @ 300Hz | +2dB air @ 12kHz
  ['/ch/15/eq/on',         [{ type: 'i', value: 1 }]],
  ['/ch/15/eq/1/type',     [{ type: 'i', value: 1 }]],             // LO SHELF
  ['/ch/15/eq/1/f',        [{ type: 'f', value: eqFreq(80) }]],
  ['/ch/15/eq/1/g',        [{ type: 'f', value: eqGain(2) }]],     // +2dB warmth
  ['/ch/15/eq/2/type',     [{ type: 'i', value: 2 }]],             // PEQ
  ['/ch/15/eq/2/f',        [{ type: 'f', value: eqFreq(300) }]],
  ['/ch/15/eq/2/g',        [{ type: 'f', value: eqGain(-2) }]],    // -2dB mud cut
  ['/ch/15/eq/2/q',        [{ type: 'f', value: eqQ(1.4) }]],
  ['/ch/15/eq/4/type',     [{ type: 'i', value: 3 }]],             // HI SHELF
  ['/ch/15/eq/4/f',        [{ type: 'f', value: eqFreq(12000) }]],
  ['/ch/15/eq/4/g',        [{ type: 'f', value: eqGain(2) }]],     // +2dB air
  ['/ch/16/eq/on',         [{ type: 'i', value: 1 }]],
  ['/ch/16/eq/1/type',     [{ type: 'i', value: 1 }]],
  ['/ch/16/eq/1/f',        [{ type: 'f', value: eqFreq(80) }]],
  ['/ch/16/eq/1/g',        [{ type: 'f', value: eqGain(2) }]],
  ['/ch/16/eq/2/type',     [{ type: 'i', value: 2 }]],
  ['/ch/16/eq/2/f',        [{ type: 'f', value: eqFreq(300) }]],
  ['/ch/16/eq/2/g',        [{ type: 'f', value: eqGain(-2) }]],
  ['/ch/16/eq/2/q',        [{ type: 'f', value: eqQ(1.4) }]],
  ['/ch/16/eq/4/type',     [{ type: 'i', value: 3 }]],
  ['/ch/16/eq/4/f',        [{ type: 'f', value: eqFreq(12000) }]],
  ['/ch/16/eq/4/g',        [{ type: 'f', value: eqGain(2) }]],

];

// ─── Send All Commands ───────────────────────────────────────────────────────

const socket = dgram.createSocket('udp4');
let index = 0;

function subscribeAndStart() {
  const xremote = buildOSC('/xremote', []);
  socket.send(xremote, MIXER_PORT, MIXER_IP, (err) => {
    if (err) {
      console.error(`\n✗ Failed to subscribe with /xremote: ${err.message}`);
      socket.close();
      process.exit(1);
      return;
    }
    setTimeout(sendNext, 200);
  });
}

function sendNext() {
  if (index >= commands.length) {
    console.log('\n✓ All preset commands sent successfully!');
    console.log('\nVerify in X-AIR Edit:');
    console.log('  CHANNELS');
    console.log('  • Ch 1  "Host Mic"     → RED     | HPF 100Hz | -2dB@250Hz | +2.5dB@3kHz | Comp 3:1');
    console.log('  • Ch 2  "Karaoke Mic"  → MAGENTA | HPF 100Hz | -2dB@250Hz | +2.5dB@3kHz | Comp 3:1');
    console.log('  • Ch 3  "Guitar"       → YELLOW  | HPF 80Hz  | -2dB@250Hz | +2dB@2.5kHz | Comp 4:1');
    console.log('  • Ch 4  "Click Track"  → BLUE    | No processing (clean click)');
    console.log('  • Ch 15 "Jamzone L"    → BLUE    | +2dB@80Hz | -2dB@300Hz | +2dB@12kHz | Comp 4:1 +3dB makeup');
    console.log('  • Ch 16 "Jamzone R"    → BLUE    | (stereo linked to Ch15)');
    console.log('  • AUX  "Spotify"       → GREEN');
    console.log('\n  BUSES');
    console.log('  • Bus 1 "IEM L"        → YELLOW  (stereo linked, in-ear monitor)');
    console.log('  • Bus 2 "IEM R"        → YELLOW');
    console.log('  • Bus 5 "Jamzone L"    → BLUE    (stereo linked, limiter -3dBFS ∞:1 → Main L/R)');
    console.log('  • Bus 6 "Jamzone R"    → BLUE');
    console.log('\nSave your scene in X-AIR Edit: File → Save Scene As');
    console.log('  Name it: "The Human Jukebox - Full Setup"\n');
    socket.close();
    return;
  }

  const [address, args] = commands[index];
  const msg = buildOSC(address, args);

  socket.send(msg, MIXER_PORT, MIXER_IP, (err) => {
    if (err) {
      console.error(`✗ Failed to send ${address}: ${err.message}`);
    } else {
      const val = args[0]?.value?.toFixed?.(4) ?? args[0]?.value ?? '';
      console.log(`  [${String(index + 1).padStart(2)}/${commands.length}] ${address.padEnd(28)} → ${val}`);
    }
    index++;
    setTimeout(sendNext, DELAY_MS);
  });
}

console.log('═══════════════════════════════════════════════════════════');
console.log('  THE HUMAN JUKEBOX — Professional Mixer Preset           ');
console.log('  Names | Colors | Routing | EQ | Compressors | Limiters  ');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Sending ${commands.length} OSC commands to ${MIXER_IP}:${MIXER_PORT} ...\n`);
if (BIND_IP) {
  console.log(`  Binding local UDP socket to ${BIND_IP}`);
}

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
