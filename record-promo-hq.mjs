import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const videoDir = join(__dirname, 'public/videos');
const targetUrl = 'http://localhost:5174/story-promo.html';
const durationMs = 18000;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    recordVideo: {
      dir: videoDir,
      size: { width: 1080, height: 1920 },
    },
  });

  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'networkidle' });

  console.log('Recording concept promo in HQ for 18 seconds...');
  await page.waitForTimeout(durationMs);

  const rawVideoPath = await page.video().path();
  await context.close();
  await browser.close();

  const outputPath = join(videoDir, 'human-jukebox-story-promo-concept-hq.webm');
  fs.copyFileSync(rawVideoPath, outputPath);

  const stats = fs.statSync(outputPath);
  console.log('Saved:', outputPath);
  console.log('Size MB:', (stats.size / 1024 / 1024).toFixed(2));
})();
