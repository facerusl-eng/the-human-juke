import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const videoDir = join(__dirname, 'public/videos');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    recordVideo: { dir: videoDir }
  });
  
  const page = await context.newPage();
  
  // Set viewport to 9:16 story format (1080x1920)
  await page.setViewportSize({ width: 1080, height: 1920 });
  
  // Navigate to the promo
  await page.goto('http://localhost:5174/story-promo.html', { waitUntil: 'networkidle' });
  
  // Wait for the entire promo to play (26 seconds)
  console.log('Recording promo for 26 seconds...');
  await new Promise(resolve => setTimeout(resolve, 26000));
  
  // Get video path before closing context
  const videoPath = await page.video().path();
  
  // Close the context to finalize the video
  await context.close();
  await browser.close();
  
  // Verify the file was created
  if (fs.existsSync(videoPath)) {
    const stats = fs.statSync(videoPath);
    console.log(`✓ Video recorded successfully!`);
    console.log(`  Location: ${videoPath}`);
    console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  } else {
    console.error(`✗ Video file not found at ${videoPath}`);
  }
  
  process.exit(0);
})();
