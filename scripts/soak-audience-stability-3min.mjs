import { chromium } from 'playwright';

const EVENT_ID = '35e30e67-5f21-4831-80d0-c1b40f73dc7c';
const URLS = {
  noEvent: 'http://localhost:5174/audience',
  requestedEvent: `http://localhost:5174/audience?event=${EVENT_ID}`,
  mirror: `http://localhost:5174/mirror?event=${EVENT_ID}`,
};

const SAMPLE_SECONDS = 180;
const INTERVAL_MS = 1000;

const rx = {
  checking: /Checking live gigs/i,
  hardLoader: /Audience loading|Checking live gigs\.\.\./i,
  noGigSurface: /Welcome to The Human Jukebox|No live show right now|Official Audience Lounge/i,
  audienceCountdown: /Event starting soon\s*[·\-]\s*(\d{2}):(\d{2}):(\d{2})/i,
  mirrorCountdown: /Starting In[\s\S]{0,120}?(\d{1,2})h\s*(\d{1,2})m\s*(\d{1,2})s/i,
};

function parseAudienceSeconds(text) {
  const m = text.match(rx.audienceCountdown);
  return m ? Number(m[3]) : null;
}

function parseMirrorSeconds(text) {
  const m = text.match(rx.mirrorCountdown);
  return m ? Number(m[3]) : null;
}

function summarizeWindow(items, key) {
  const values = items.map((r) => r[key]).filter((v) => typeof v === 'number');
  if (!values.length) return null;
  return { min: Math.min(...values), max: Math.max(...values), samples: values.length };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const pageNoEvent = await context.newPage();
const pageAudience = await context.newPage();
const pageMirror = await context.newPage();

try {
  await Promise.all([
    pageNoEvent.goto(URLS.noEvent, { waitUntil: 'domcontentloaded', timeout: 45000 }),
    pageAudience.goto(URLS.requestedEvent, { waitUntil: 'domcontentloaded', timeout: 45000 }),
    pageMirror.goto(URLS.mirror, { waitUntil: 'domcontentloaded', timeout: 45000 }),
  ]);

  const samples = [];
  for (let i = 0; i < SAMPLE_SECONDS; i += 1) {
    const [textNoEvent, textAudience, textMirror] = await Promise.all([
      pageNoEvent.evaluate(() => document.body?.innerText || ''),
      pageAudience.evaluate(() => document.body?.innerText || ''),
      pageMirror.evaluate(() => document.body?.innerText || ''),
    ]);

    const a = parseAudienceSeconds(textAudience);
    const m = parseMirrorSeconds(textMirror);
    const delta = a !== null && m !== null ? Math.abs(a - m) : null;

    samples.push({
      i,
      noEventHasChecking: rx.checking.test(textNoEvent),
      noEventHasNoGigSurface: rx.noGigSurface.test(textNoEvent),
      noEventHasHardLoader: rx.hardLoader.test(textNoEvent),
      audienceHasHardLoader: rx.hardLoader.test(textAudience),
      audienceHasNoGigSurface: rx.noGigSurface.test(textAudience),
      a,
      m,
      delta,
    });

    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }

  const tail = samples.slice(-30);
  const noEventStuckChecking = tail.every((r) => r.noEventHasChecking);
  const noEventStableSurface = tail.some((r) => r.noEventHasNoGigSurface) && !tail.every((r) => !r.noEventHasNoGigSurface);
  const noEventHardLoaderTail = tail.filter((r) => r.noEventHasHardLoader).length;

  const countdownComparable = samples.filter((r) => r.delta !== null);
  const maxDelta = countdownComparable.length ? Math.max(...countdownComparable.map((r) => r.delta)) : null;

  const verdictNoGig = !noEventStuckChecking && noEventStableSurface && noEventHardLoaderTail === 0 ? 'PASS' : 'FAIL';
  const verdictSync = countdownComparable.length >= 20 && maxDelta !== null && maxDelta <= 1 ? 'PASS' : 'FAIL';

  console.log(JSON.stringify({
    durationSec: SAMPLE_SECONDS,
    verdictNoGig,
    verdictSync,
    countdownComparable: countdownComparable.length,
    maxDelta,
    noEventStuckChecking,
    noEventHardLoaderTail,
    noEventTailNoGigSurfaceCount: tail.filter((r) => r.noEventHasNoGigSurface).length,
    audienceCountdownWindow: summarizeWindow(samples, 'a'),
    mirrorCountdownWindow: summarizeWindow(samples, 'm'),
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
