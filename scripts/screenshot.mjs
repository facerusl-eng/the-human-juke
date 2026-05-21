import { chromium, firefox } from 'playwright'
import { mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const outputDir = './public/snapshots'
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

const EVENT_ID = 'bdac77b2-e03c-44a8-b9d2-6cadc449d068'

// Try chromium first, fall back to firefox
let browser
try {
  browser = await chromium.launch()
} catch {
  browser = await firefox.launch()
}

// Audience app — mobile viewport
const audienceCtx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
})
const audiencePage = await audienceCtx.newPage()
try {
  await audiencePage.goto(
    `https://the-human-jukebox.org/audience?event=${EVENT_ID}`,
    { waitUntil: 'domcontentloaded', timeout: 30000 }
  )
  await audiencePage.waitForTimeout(4000)
  await audiencePage.screenshot({ path: join(outputDir, 'audience-app.png') })
  console.log('Saved audience-app.png')
} catch (err) {
  console.error('audience screenshot failed:', err.message)
}
await audienceCtx.close()

// Mirror screen — widescreen viewport
const mirrorCtx = await browser.newContext({
  viewport: { width: 1440, height: 810 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
})
const mirrorPage = await mirrorCtx.newPage()
try {
  await mirrorPage.goto('https://the-human-jukebox.org/mirror', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await mirrorPage.waitForTimeout(4000)
  await mirrorPage.screenshot({ path: join(outputDir, 'mirror-screen.png') })
  console.log('Saved mirror-screen.png')
} catch (err) {
  console.error('mirror screenshot failed:', err.message)
}
await mirrorCtx.close()

await browser.close()
console.log('Done. Files in', outputDir)
