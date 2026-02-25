/**
 * Scrapes the University of Waikato subject regulations pages for:
 *   - Bachelor of Software Engineering
 *   - Bachelor of Computer Science
 *
 * For BSoftEng, visits:
 *   https://www.waikato.ac.nz/study/subject-regulations/software-engineering
 *   The page has Year 1/2/3/4 accordion items listing papers in paragraph text.
 *
 * For BCompSc, visits:
 *   https://www.waikato.ac.nz/about/calendar/regulations/bachelor/bcompsc/
 *   The page has plain text listing compulsory papers.
 *   Also visits the CS subject-regulations page to get the full paper list.
 *
 * Extracts paper codes, roles (compulsory/elective), and elective group names.
 *
 * Usage (standalone):
 *   node src/scrapers/degrees.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../..', '.env') })

const path = require('path')
const fse = require('fs-extra')
const { newPage, closeBrowser } = require('../utils/browser')

const BASE_URL = process.env.SCRAPER_BASE_URL || 'https://www.waikato.ac.nz'
const OUTPUT_DIR = path.resolve(__dirname, '../../data')

const PAPER_CODE_RE = /\b([A-Z]{3,8}\d{3}[A-Z]?)\b/g

/**
 * Extract all paper codes from a text string.
 */
function extractCodes(text) {
  const codes = []
  const re = new RegExp(PAPER_CODE_RE.source, 'g')
  let m
  while ((m = re.exec(text)) !== null) {
    codes.push(m[1])
  }
  return [...new Set(codes)]
}

/**
 * Scrapes the BSoftEng subject regulations page.
 *
 * The page structure uses accordion items for Year 1, Year 2, Year 3, Year 4.
 * Each accordion contains paragraph text like:
 *   "Students must take the following papers: CODE1, CODE2, ..."
 *   "Students must also take one paper from the following [GroupName] papers: CODE3, CODE4, ..."
 *
 * Papers in the tabs section (100/200/300/500 Level) are used to get the full
 * list of papers that belong to the degree.
 */
async function scrapeBSoftEng() {
  const url = `${BASE_URL}/study/subject-regulations/software-engineering`
  const page = await newPage()
  const papers = []

  try {
    console.log(`[degrees] Loading ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

    // Wait for accordion content to be in the DOM
    await page.waitForSelector('.accordion-item__content', { timeout: 15000 }).catch(() => {
      console.warn('[degrees] No accordion items found on BSoftEng page')
    })

    const extracted = await page.evaluate(() => {
      const PAPER_CODE_RE_STR = '[A-Z]{3,8}\\d{3}[A-Z]?'
      const results = []

      function extractCodesFromText(text) {
        const re = new RegExp(PAPER_CODE_RE_STR, 'g')
        const found = []
        let m
        while ((m = re.exec(text)) !== null) found.push(m[0])
        return [...new Set(found)]
      }

      // Process accordion items (Year 1, Year 2, Year 3, Year 4)
      const accordionContents = Array.from(
        document.querySelectorAll('[id^=accordion-item-content]')
      )

      for (const content of accordionContents) {
        const paragraphs = Array.from(content.querySelectorAll('p'))

        for (const para of paragraphs) {
          const text = para.innerText.trim()
          if (!text) continue

          const codes = extractCodesFromText(text)
          if (codes.length === 0) continue

          // Determine role from paragraph text
          const lowerText = text.toLowerCase()

          if (
            /students must take the following papers/.test(lowerText) ||
            /students must take [a-z]{1,10}\d/.test(lowerText)
          ) {
            // Compulsory papers listed directly
            for (const code of codes) {
              results.push({ code, role: 'compulsory', electiveGroup: null })
            }
          } else if (/students must also take|one paper from|two papers from|at least/.test(lowerText)) {
            // Elective group - extract group name from text
            // Pattern: "from the following [GroupName] papers"
            const groupMatch = text.match(/from the following\s+(.+?)\s+papers/i)
            const electiveGroup = groupMatch ? groupMatch[1].trim() : 'General Elective'

            for (const code of codes) {
              results.push({ code, role: 'elective', electiveGroup })
            }
          } else if (/specialis/i.test(lowerText)) {
            const groupMatch = text.match(/from the following\s+(.+?)\s+papers/i)
            const electiveGroup = groupMatch ? groupMatch[1].trim() : 'Specialisation'
            for (const code of codes) {
              results.push({ code, role: 'specialisation', electiveGroup })
            }
          } else {
            // Default: treat as compulsory if it mentions specific codes
            for (const code of codes) {
              results.push({ code, role: 'compulsory', electiveGroup: null })
            }
          }
        }
      }

      return results
    })

    // De-duplicate: if a code appears as both compulsory and elective, keep compulsory
    const seen = new Map()
    for (const paper of extracted) {
      if (!seen.has(paper.code)) {
        seen.set(paper.code, paper)
      } else if (paper.role === 'compulsory' && seen.get(paper.code).role !== 'compulsory') {
        seen.set(paper.code, paper)
      }
    }
    papers.push(...seen.values())

    console.log(`[degrees] Found ${papers.length} papers for BSoftEng`)
  } catch (err) {
    console.error(`[degrees] Error scraping BSoftEng: ${err.message}`)
  } finally {
    await page.context().close()
  }

  return {
    code: 'BSoftEng',
    name: 'Bachelor of Software Engineering',
    papers,
  }
}

/**
 * Scrapes the BCompSc qualification regulations page.
 *
 * The page at /about/calendar/regulations/bachelor/bcompsc/ contains
 * plain text paragraphs listing compulsory papers.
 *
 * Also visits the CS subject-regulations page to pick up the full set of
 * papers (tab panels) and mark them as belonging to the degree.
 */
async function scrapeBCompSc() {
  const qualUrl = `${BASE_URL}/about/calendar/regulations/bachelor/bcompsc/`
  const subjectUrl = `${BASE_URL}/study/subject-regulations/computer-science`
  const papers = []

  // --- Step 1: Scrape the qualification regulations page for compulsory papers ---
  const qualPage = await newPage()
  try {
    console.log(`[degrees] Loading ${qualUrl}`)
    await qualPage.goto(qualUrl, { waitUntil: 'networkidle', timeout: 30000 })
    await qualPage.waitForSelector('h3, p', { timeout: 15000 }).catch(() => {})

    const qualExtracted = await qualPage.evaluate(() => {
      const PAPER_CODE_RE_STR = '[A-Z]{3,8}\\d{3}[A-Z]?'
      const results = []

      function extractCodesFromText(text) {
        const re = new RegExp(PAPER_CODE_RE_STR, 'g')
        const found = []
        let m
        while ((m = re.exec(text)) !== null) found.push(m[0])
        return [...new Set(found)]
      }

      // Find the "Requirements for the Degree" section
      const allParas = Array.from(document.querySelectorAll('p, li'))
      for (const el of allParas) {
        const text = el.innerText.trim()
        if (!text) continue

        const codes = extractCodesFromText(text)
        if (codes.length === 0) continue

        // Only include paragraphs that appear to list paper codes as requirements
        const lowerText = text.toLowerCase()
        if (
          /candidates must complete/.test(lowerText) ||
          /must complete/.test(lowerText) ||
          /compx|engen|maths|csmax|datax|softeng|waikt/.test(lowerText)
        ) {
          // These are compulsory papers
          for (const code of codes) {
            results.push({ code, role: 'compulsory', electiveGroup: null })
          }
        }
      }

      return results
    })

    papers.push(...qualExtracted)
    console.log(`[degrees] Found ${qualExtracted.length} compulsory papers for BCompSc from qual regs`)
  } catch (err) {
    console.error(`[degrees] Error scraping BCompSc qual regs: ${err.message}`)
  } finally {
    await qualPage.context().close()
  }

  // --- Step 2: Also scrape the subject regulations page for the broader paper list ---
  // The CS subject regulations page has tab panels with all CS papers listed
  const subjectPage = await newPage()
  try {
    console.log(`[degrees] Loading ${subjectUrl}`)
    await subjectPage.goto(subjectUrl, { waitUntil: 'networkidle', timeout: 30000 })
    await subjectPage.waitForSelector('table', { timeout: 15000 }).catch(() => {})

    const subjectExtracted = await subjectPage.evaluate(() => {
      const results = []
      // Get papers from the tab panels (100/200/300 Level tables)
      // Only include 100, 200, 300 level tabs (not 500, 800, 900 which are postgrad)
      const panels = Array.from(document.querySelectorAll('.tabs__panel'))
      // Get tab labels to identify level
      const tabLabels = Array.from(document.querySelectorAll('.tabs__tab')).map(t => t.innerText.trim())

      panels.forEach((panel, idx) => {
        const label = tabLabels[idx] || ''
        // Skip 500+ level for BCompSc undergrad focus
        if (/500|800|900/.test(label)) return

        const rows = Array.from(panel.querySelectorAll('tr'))
        for (const row of rows) {
          const codeEl = row.querySelector('.paper-code')
          if (!codeEl) continue
          const code = codeEl.innerText.trim()
          if (!/^[A-Z]{3,8}\d{3}[A-Z]?$/.test(code)) continue

          const nameEl = row.querySelector('.paper-name')
          const title = nameEl ? nameEl.innerText.trim() : ''
          const cells = Array.from(row.querySelectorAll('td'))
          const pointsCell = cells[1] ? cells[1].innerText.trim() : ''
          const pointsMatch = pointsCell.match(/(\d+)/)
          const points = pointsMatch ? parseInt(pointsMatch[1], 10) : 15

          results.push({ code, title, points, role: 'elective', electiveGroup: 'CS Papers' })
        }
      })

      return results
    })

    // Only add papers not already in the compulsory list
    const existingCodes = new Set(papers.map(p => p.code))
    for (const p of subjectExtracted) {
      if (!existingCodes.has(p.code)) {
        papers.push(p)
        existingCodes.add(p.code)
      }
    }
    console.log(`[degrees] Found ${subjectExtracted.length} papers from CS subject regs, total: ${papers.length}`)
  } catch (err) {
    console.error(`[degrees] Error scraping CS subject regs: ${err.message}`)
  } finally {
    await subjectPage.context().close()
  }

  return {
    code: 'BCompSc',
    name: 'Bachelor of Computer Science',
    papers,
  }
}

/**
 * Scrapes all configured degree pages.
 */
async function scrapeDegrees() {
  const results = []

  const bsofteng = await scrapeBSoftEng()
  results.push(bsofteng)

  // Add a small delay between requests
  await new Promise((r) => setTimeout(r, 500))

  const bcompsc = await scrapeBCompSc()
  results.push(bcompsc)

  return results
}

// Standalone runner
if (require.main === module) {
  async function main() {
    await fse.ensureDir(OUTPUT_DIR)
    const degrees = await scrapeDegrees()
    const outputPath = path.join(OUTPUT_DIR, 'degrees.json')
    await fse.writeJson(outputPath, degrees, { spaces: 2 })
    console.log(`[degrees] Saved degree data to ${outputPath}`)
    await closeBrowser()
  }

  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = { scrapeDegrees, scrapeBSoftEng, scrapeBCompSc }
