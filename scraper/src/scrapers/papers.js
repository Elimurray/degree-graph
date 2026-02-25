/**
 * Scrapes individual paper pages from the University of Waikato website.
 *
 * For each paper code provided, visits:
 *   https://www.waikato.ac.nz/study/papers/<CODE>/2026/
 *
 * Page structure (confirmed via DOM inspection):
 *   - Code:        h1.paper-page__code
 *   - Title:       p.paper-page__title
 *   - Key info:    .key-info__item elements, each with:
 *                    - label in .key-info__item-title (inside .glossary-tooltip__term-name)
 *                    - value in p.key-info__item-value
 *                  Labels seen: "Points", "Level", "Teaching periods", "Locations",
 *                               "Prerequisite(s)", "Corequisite(s)", "Restriction(s)"
 *   - Description: The first <p> with class="" (empty) inside main.paper-page__container
 *                  that appears after the key-info block.
 *
 * Usage (standalone):
 *   node src/scrapers/papers.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../..', '.env') })

const path = require('path')
const fse = require('fs-extra')
const { newPage, closeBrowser } = require('../utils/browser')

const BASE_URL = process.env.SCRAPER_BASE_URL || 'https://www.waikato.ac.nz'
const YEAR = process.env.SCRAPER_YEAR || '2026'
const OUTPUT_DIR = path.resolve(__dirname, '../../data')

const PAPER_CODE_RE = /\b([A-Z]{3,8}\d{3}[A-Z]?)\b/g

/**
 * Extract all paper codes from a text string.
 */
function extractCodesFromText(text) {
  const codes = []
  const re = new RegExp(PAPER_CODE_RE.source, 'g')
  let m
  while ((m = re.exec(text)) !== null) {
    codes.push(m[1])
  }
  return [...new Set(codes)]
}

/**
 * Parse teaching periods text into semester codes.
 * "A Trimester" -> ["A"]
 * "A Trimester, B Trimester" -> ["A", "B"]
 * "A Trimester, and other teaching periods" -> ["A"]
 */
function parseSemesters(text) {
  const semesters = []
  if (/\bA Trimester\b/i.test(text)) semesters.push('A')
  if (/\bB Trimester\b/i.test(text)) semesters.push('B')
  if (/\bC Trimester\b|summer/i.test(text)) semesters.push('S')
  return semesters
}

/**
 * Scrapes a single paper page and returns structured data.
 * Returns null if the page does not exist or cannot be parsed.
 */
async function scrapePaper(code) {
  const url = `${BASE_URL}/study/papers/${encodeURIComponent(code)}/${YEAR}/`
  const page = await newPage()

  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

    if (!response || response.status() === 404) {
      console.warn(`  [papers] 404 for ${code} at ${url}`)
      return null
    }

    // Wait for the paper title to render
    await page
      .waitForSelector('.paper-page__title, .paper-page__code', { timeout: 10000 })
      .catch(() => {})

    const data = await page.evaluate(() => {
      // --- Title ---
      const titleEl = document.querySelector('p.paper-page__title')
      const title = titleEl ? titleEl.innerText.trim() : ''

      // --- Key info items ---
      // Each .key-info__item has a label in .key-info__item-title and value in p.key-info__item-value
      const keyInfo = {}
      const items = Array.from(document.querySelectorAll('.key-info__item'))
      for (const item of items) {
        // The label text lives inside .glossary-tooltip__term-name or .key-info__item-title
        const labelEl = item.querySelector('.glossary-tooltip__term-name, .key-info__item-title')
        if (!labelEl) continue
        // The label text may include an SVG icon — get just the first text node
        const labelText = labelEl.childNodes[0]
          ? labelEl.childNodes[0].textContent.trim()
          : labelEl.innerText.trim()

        const valueEl = item.querySelector('p.key-info__item-value')
        const value = valueEl ? valueEl.innerText.trim() : ''

        if (labelText) keyInfo[labelText.toLowerCase().replace(/[^a-z]/g, '')] = value
      }

      // --- Points ---
      const pointsRaw = keyInfo['points'] || ''
      const points = parseInt(pointsRaw, 10) || 15

      // --- Teaching periods / semesters ---
      const semesterRaw = keyInfo['teachingperiods'] || ''

      // --- Prerequisites ---
      // key-info label is "Prerequisite(s)" -> normalised key: "prerequisites"
      const prereqRaw = keyInfo['prerequisites'] || ''

      // --- Corequisites ---
      const coreqRaw = keyInfo['corequisites'] || ''

      // --- Description ---
      // The description is the first <p> with an empty class (class="") inside main
      // that is not a tooltip popup and has substantial length.
      // It appears after the key-info block.
      const main = document.querySelector('main.paper-page__container')
      let description = ''
      if (main) {
        const allParas = Array.from(main.querySelectorAll('p'))
        for (const p of allParas) {
          // Empty class = not a glossary tooltip, not a nav element
          if (p.className === '' || p.className === 'paper-page__description') {
            const text = p.innerText.trim()
            if (text.length > 20) {
              description = text
              break
            }
          }
        }
      }

      return { title, keyInfo, points, semesterRaw, prereqRaw, coreqRaw, description }
    })

    // Parse semesters
    const semesters = parseSemesters(data.semesterRaw)

    // Parse prerequisites — extract paper codes from the raw text
    const prerequisites = extractCodesFromText(data.prereqRaw)

    // Parse corequisites — extract paper codes from the raw text
    const corequisites = extractCodesFromText(data.coreqRaw)

    // Department from paper code prefix
    const deptMatch = code.match(/^([A-Z]+)/)
    const department = deptMatch ? deptMatch[1] : null

    return {
      code,
      title: data.title,
      points: data.points,
      description: data.description,
      semesters,
      department,
      prerequisites,
      corequisites,
      prerequisiteText: data.prereqRaw || null,
      corequisiteText: data.coreqRaw || null,
    }
  } catch (err) {
    console.error(`  [papers] Error scraping ${code}: ${err.message}`)
    return null
  } finally {
    await page.context().close()
  }
}

/**
 * Scrapes all paper codes in the provided array, with concurrency throttle.
 * Adds a 500ms delay between each request to be polite to the server.
 */
async function scrapePapers(codes, { concurrency = 3 } = {}) {
  const results = []
  const errors = []
  const queue = [...codes]

  async function worker() {
    while (queue.length > 0) {
      const code = queue.shift()
      console.log(`[papers] Scraping ${code}...`)
      const result = await scrapePaper(code)
      if (result) {
        results.push(result)
      } else {
        errors.push({ code, reason: 'null result (404 or parse error)' })
      }
      // Polite delay
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)

  if (errors.length > 0) {
    const errPath = path.join(OUTPUT_DIR, 'errors.json')
    await fse.ensureDir(OUTPUT_DIR)
    const existing = await fse.readJson(errPath).catch(() => [])
    await fse.writeJson(errPath, [...existing, ...errors], { spaces: 2 })
    console.log(`[papers] Logged ${errors.length} errors to ${errPath}`)
  }

  return results
}

// Standalone runner
if (require.main === module) {
  const sampleCodes = [
    'COMPX101', 'COMPX102', 'COMPX201', 'COMPX202', 'COMPX203',
    'COMPX241', 'COMPX301', 'COMPX321', 'COMPX341', 'COMPX361',
    'COMPX371', 'COMPX401', 'COMPX471',
    'ENGEN101', 'ENGEN102', 'ENGEN180', 'ENGEN183', 'ENGEN184',
    'MATHS101', 'MATHS135', 'MATHS201',
  ]

  async function main() {
    await fse.ensureDir(OUTPUT_DIR)
    console.log(`[papers] Scraping ${sampleCodes.length} papers...`)
    const papers = await scrapePapers(sampleCodes)
    const outputPath = path.join(OUTPUT_DIR, 'papers.json')
    await fse.writeJson(outputPath, papers, { spaces: 2 })
    console.log(`[papers] Saved ${papers.length} papers to ${outputPath}`)
    await closeBrowser()
  }

  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = { scrapePaper, scrapePapers }
