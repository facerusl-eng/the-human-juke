import { chromium } from 'playwright';

const EVENT_ID = '35e30e67-5f21-4831-80d0-c1b40f73dc7c';
const URLS = {
  noEvent: 'http://localhost:5174/audience',
  requestedEvent: `http://localhost:5174/audience?event=${EVENT_ID}`,
  mirror: `http://localhost:5174/mirror?event=${EVENT_ID}`,
};

const SAMPLE_SECONDS = 90;

const rx = {
  checking: /Checking live gigs/i,
  hardLoader: /Audience loading|Checking live gigs\.\.\./i,
  noGigSurface: /Welcome to The Human Jukebox|No live show right now|Official Audience Lounge/i,
  audienceCountdown: /Event starting soon\s*[.-]\s*(\d{2}):(\d{2}):(\d{2})/i,
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
      noEventHasChecking: rx.checking.test(textNoEvent),
      noEventHasNoGigSurface: rx.noGigSurface.test(textNoEvent),
      noEventHasHardLoader: rx.hardLoader.test(textNoEvent),
      audienceHasHardLoader: rx.hardLoader.test(textAudience),
      a,
      m,
      delta,
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const tail = samples.slice(-20);
  const noEventStuckChecking = tail.every((row) => row.noEventHasChecking);
  const noEventHardLoaderTail = tail.filter((row) => row.noEventHasHardLoader).length;
  const noEventTailNoGigSurfaceCount = tail.filter((row) => row.noEventHasNoGigSurface).length;

  const countdownComparable = samples.filter((row) => row.delta !== null);
  const maxDelta = countdownComparable.length > 0
    ? Math.max(...countdownComparable.map((row) => row.delta))
    : null;

  const verdictNoGig = !noEventStuckChecking && noEventHardLoaderTail === 0 && noEventTailNoGigSurfaceCount > 0 ? 'PASS' : 'FAIL';
  const verdictSync = countdownComparable.length >= 10 && maxDelta !== null && maxDelta <= 1 ? 'PASS' : 'FAIL';

  console.log(JSON.stringify({
    durationSec: SAMPLE_SECONDS,
    verdictNoGig,
    verdictSync,
    countdownComparable: countdownComparable.length,
    maxDelta,
    noEventStuckChecking,
    noEventHardLoaderTail,
    noEventTailNoGigSurfaceCount,
    audienceHardLoaderCount: samples.filter((row) => row.audienceHasHardLoader).length,
  }));
} finally {
  await context.close();
  await browser.close();
}
