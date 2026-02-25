const { chromium } = require('playwright')

let browser = null

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: true })
  }
  return browser
}

async function newPage() {
  const b = await getBrowser()
  const context = await b.newContext({
    userAgent:
      'Mozilla/5.0 (compatible; DegreeGraphBot/1.0; +https://github.com/degree-graph)',
  })
  const page = await context.newPage()
  return page
}

async function closeBrowser() {
  if (browser) {
    await browser.close()
    browser = null
  }
}

module.exports = { getBrowser, newPage, closeBrowser }
