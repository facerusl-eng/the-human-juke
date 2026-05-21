import { chromium, devices } from 'playwright';

const routes = [
  'https://the-human-jukebox.org/',
  'https://the-human-jukebox.org/audience',
  'https://the-human-jukebox.org/admin/gig-settings',
  'https://the-human-jukebox.org/mirror'
];

const profiles = ['iPad (gen 7)', 'iPad Pro 11'];
const browser = await chromium.launch({ headless: true });
const out = [];

for (const profile of profiles) {
  const context = await browser.newContext({ ...devices[profile] });
  const pg = await context.newPage();

  for (const url of routes) {
    const errors = [];
    const failed = [];
    pg.on('pageerror', (e) => errors.push(String(e?.message || e)));
    pg.on('requestfailed', (r) => failed.push(`${r.url()} :: ${r.failure()?.errorText || 'unknown'}`));

    const response = await pg.goto(`${url}?ipad_smoke=1`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => null);

    const probe = await pg.evaluate(() => ({
      width: window.innerWidth,
      mqWidth: window.matchMedia('(min-width: 768px) and (max-width: 1366px)').matches,
      mqTouchHybrid: window.matchMedia('(min-width: 768px) and (max-width: 1366px) and (hover: none) and (pointer: coarse)').matches,
      mqHoverNone: window.matchMedia('(hover: none)').matches,
      mqPointerCoarse: window.matchMedia('(pointer: coarse)').matches,
      scrollXOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      title: document.title,
      text: (document.body?.innerText || '').trim().slice(0, 110)
    }));

    out.push({
      profile,
      url,
      status: response ? response.status() : 'no-response',
      ...probe,
      errorCount: errors.length,
      failCount: failed.length,
      firstError: errors[0] || null,
      firstFail: failed[0] || null
    });

    pg.removeAllListeners('pageerror');
    pg.removeAllListeners('requestfailed');
  }
  await context.close();
}

await browser.close();

// Print human-readable report
console.log('\n=== iPad Global Smoke Test ===\n');
for (const r of out) {
  const issues = [];
  if (r.status !== 200) issues.push(`HTTP ${r.status}`);
  if (r.errorCount > 0) issues.push(`${r.errorCount} JS error(s): ${r.firstError}`);
  if (r.failCount > 0) issues.push(`${r.failCount} request fail(s): ${r.firstFail}`);
  if (r.scrollXOverflow) issues.push('HORIZONTAL SCROLL OVERFLOW');
  const badge = issues.length === 0 ? '✅ PASS' : '❌ FAIL';
  console.log(`${badge}  [${r.profile}] ${r.url}`);
  console.log(`       width=${r.width}  mqWidth=${r.mqWidth}  touch=${r.mqTouchHybrid}  hoverNone=${r.mqHoverNone}  coarse=${r.mqPointerCoarse}`);
  if (issues.length > 0) console.log(`       ISSUES: ${issues.join(' | ')}`);
  console.log(`       text: "${r.text.slice(0, 80)}..."`);
}
