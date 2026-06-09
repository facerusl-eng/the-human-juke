import { chromium, devices } from 'playwright';
import { mkdirSync } from 'fs';

mkdirSync('screenshots', { recursive: true });

const profiles = [
  {
    label: 'ipad-gen7-landscape',
    cfg: { ...devices['iPad (gen 7)'], viewport: { width: 1080, height: 810 }, deviceScaleFactor: 2 }
  },
  {
    label: 'ipad-pro11-landscape',
    cfg: { ...devices['iPad Pro 11'], viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2 }
  }
];

const routes = [
  { url: 'https://the-human-jukebox.org/', name: 'home' },
  { url: 'https://the-human-jukebox.org/audience', name: 'audience' },
  { url: 'https://the-human-jukebox.org/admin/gig-settings', name: 'gig-settings' },
  { url: 'https://the-human-jukebox.org/mirror', name: 'mirror' }
];

const browser = await chromium.launch({ headless: true });

for (const { label, cfg } of profiles) {
  const ctx = await browser.newContext(cfg);
  const pg = await ctx.newPage();
  for (const route of routes) {
    await pg.goto(route.url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => null);
    await pg.screenshot({ path: `screenshots/${label}-${route.name}.png`, fullPage: false });
    console.log(`Saved screenshots/${label}-${route.name}.png`);
  }
  await ctx.close();
}

await browser.close();
console.log('Done.');
