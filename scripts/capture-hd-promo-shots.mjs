import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outputDir = './public/images'
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true })
}

const EVENT_ID = 'bdac77b2-e03c-44a8-b9d2-6cadc449d068'
const baseUrl = 'https://www.the-human-jukebox.org'

const browser = await chromium.launch({ headless: true })

try {
  // Mirror in true 1080p landscape for the "live show" panel.
  const mirrorCtx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  })
  const mirrorPage = await mirrorCtx.newPage()
  await mirrorPage.goto(`${baseUrl}/mirror`, { waitUntil: 'networkidle', timeout: 45000 })
  await mirrorPage.screenshot({ path: join(outputDir, 'promo-mirror-live-hd.png'), fullPage: false })
  await mirrorCtx.close()

  // Audience app in portrait HD for mobile promo framing.
  const audienceCtx = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  const audiencePage = await audienceCtx.newPage()
  await audiencePage.goto(`${baseUrl}/audience?event=${encodeURIComponent(EVENT_ID)}`, { waitUntil: 'networkidle', timeout: 45000 })
  await audiencePage.screenshot({ path: join(outputDir, 'promo-audience-live-hd.png'), fullPage: false })

  const queuePage = await audienceCtx.newPage()
  await queuePage.goto(`${baseUrl}/audience/song-list?event=${encodeURIComponent(EVENT_ID)}`, { waitUntil: 'networkidle', timeout: 45000 })
  await queuePage.screenshot({ path: join(outputDir, 'promo-queue-live-hd.png'), fullPage: false })
  await audienceCtx.close()

  const feedCtx = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 2,
  })
  const feedPage = await feedCtx.newPage()
  await feedPage.goto(`${baseUrl}/feed?event=${encodeURIComponent(EVENT_ID)}`, { waitUntil: 'networkidle', timeout: 45000 })
  await feedPage.screenshot({ path: join(outputDir, 'promo-feed-live-hd.png'), fullPage: false })
  await feedCtx.close()

  console.log('Saved HD promo shots to', outputDir)
} finally {
  await browser.close()
}
