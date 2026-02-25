/**
 * Scrapes 6 Bachelor of Engineering degree structures from:
 *   https://www.waikato.ac.nz/study/subject-regulations/<slug>
 *
 * For each degree it:
 *   1. Loads the subject-regulations page with Playwright (JS required for accordion)
 *   2. Extracts paper codes from the Year 1–4 accordion panels, classifying
 *      them as compulsory or elective (with elective_group name)
 *   3. Fetches full paper details for any new codes not already in papers.json
 *   4. Appends results to scraper/data/degrees.json and scraper/data/papers.json
 *      without overwriting existing entries
 *
 * Page text patterns observed (confirmed via Playwright inspection):
 *
 *   Compulsory:
 *     "Students must take the following papers: CODE1, CODE2, ..."
 *     "Students must complete the following papers: CODE1, ..."
 *
 *   Compulsory OR-choice (must take one of):
 *     "Plus, either COMPX101 or ENGEN103."
 *     "Plus ENGCB321 or ENGMP311 or ENGME554."
 *
 *   Elective pools:
 *     "Plus 15 points of electives from: CODE1, CODE2, ..."
 *     "Plus 30 points of electives (...) from: CODE1, ..."
 *     "Plus 45 points of electives from: CODE1, ..."
 *
 *   Named elective sets (EEE only):
 *     "Plus 30 points from Set A: CODE1, CODE2, ..."
 *     "Plus 15 points from Set B: CODE1, ..."
 *     "Plus another 15 points from either Set A or Set B, or CODE1 or CODE2."
 *
 * Usage:
 *   node src/scrapers/scrapeEngineering.js
 */

'use strict'

require('dotenv').config({ path: require('path').resolve(__dirname, '../../..', '.env') })

const path = require('path')
const fse = require('fs-extra')
const { newPage, closeBrowser } = require('../utils/browser')
const { scrapePapers } = require('./papers')
const { parsePrereqGroups } = require('../utils/prereqParser')

const BASE_URL = process.env.SCRAPER_BASE_URL || 'https://www.waikato.ac.nz'
const DATA_DIR = path.resolve(__dirname, '../../data')
const DEGREES_PATH = path.join(DATA_DIR, 'degrees.json')
const PAPERS_PATH = path.join(DATA_DIR, 'papers.json')
const ERRORS_PATH = path.join(DATA_DIR, 'errors.json')

/**
 * The 6 BE degrees to scrape.
 * slug        — the path segment in /study/subject-regulations/<slug>
 * code        — short identifier used in degrees.json
 * name        — full degree name
 * totalPoints — 480 for all 4-year BE(Hons) degrees
 */
const BE_DEGREES = [
  {
    slug: 'chemical-and-process-engineering',
    code: 'BE-CBE',
    name: 'Bachelor of Engineering in Chemical and Biological Engineering',
    totalPoints: 480,
  },
  {
    slug: 'civil-engineering',
    code: 'BE-CVL',
    name: 'Bachelor of Engineering in Civil Engineering',
    totalPoints: 480,
  },
  {
    slug: 'electrical-and-electronic-engineering',
    code: 'BE-EEE',
    name: 'Bachelor of Engineering in Electrical and Electronic Engineering',
    totalPoints: 480,
  },
  {
    slug: 'environmental-engineering',
    code: 'BE-ENV',
    name: 'Bachelor of Engineering in Environmental Engineering',
    totalPoints: 480,
  },
  {
    slug: 'materials-and-process-engineering',
    code: 'BE-MPE',
    name: 'Bachelor of Engineering in Materials and Process Engineering',
    totalPoints: 480,
  },
  {
    slug: 'mechanical-engineering',
    code: 'BE-MCH',
    name: 'Bachelor of Engineering in Mechanical Engineering',
    totalPoints: 480,
  },
]

/** 500ms delay between requests. */
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Parse a single paragraph of degree requirement text into paper entries.
 *
 * @param {string} text - The paragraph text from the page.
 * @param {string} yearLabel - e.g. "Year-1", "Year-2" etc., used for elective group naming.
 * @returns {Array<{code: string, role: string, elective_group: string|null}>}
 */
function parseParagraph(text, yearLabel) {
  const PAPER_CODE_RE = /[A-Z]{3,8}\d{3}[A-Z]?/g

  function extractCodes(str) {
    const codes = []
    let m
    const re = new RegExp(PAPER_CODE_RE.source, 'g')
    while ((m = re.exec(str)) !== null) codes.push(m[0])
    return [...new Set(codes)]
  }

  const codes = extractCodes(text)
  if (codes.length === 0) return []

  const t = text.trim()
  const lower = t.toLowerCase()

  // ----------------------------------------------------------------
  // Compulsory block: "Students must take/complete the following papers"
  // ----------------------------------------------------------------
  if (
    /students must (take|complete) the following papers/.test(lower) ||
    /students must (take|complete) the following/.test(lower)
  ) {
    return codes.map((code) => ({ code, role: 'compulsory', elective_group: null }))
  }

  // ----------------------------------------------------------------
  // Named elective set: "Plus N points from Set X: CODE1, CODE2, ..."
  // (used by EEE degree)
  // ----------------------------------------------------------------
  const namedSetMatch = t.match(/Plus\s+\d+\s+points\s+from\s+(Set\s+[A-Z])\s*:/i)
  if (namedSetMatch) {
    const setName = namedSetMatch[1].replace(/\s+/, '-')
    return codes.map((code) => ({
      code,
      role: 'elective',
      elective_group: `${yearLabel}-${setName}`,
    }))
  }

  // ----------------------------------------------------------------
  // Mixed set: "Plus another N points from either Set A or Set B, or CODE1 or CODE2"
  // (EEE Year 4 final elective block)
  // ----------------------------------------------------------------
  if (/plus another \d+ points from either set/i.test(lower)) {
    return codes.map((code) => ({
      code,
      role: 'elective',
      elective_group: `${yearLabel}-Set-A-or-B`,
    }))
  }

  // ----------------------------------------------------------------
  // Elective pool: "Plus N points of electives from: CODE1, CODE2, ..."
  // Capture the point count for the group name.
  // ----------------------------------------------------------------
  const electivePoolMatch = t.match(/plus\s+(\d+)\s+points\s+of\s+electives.*?from[:\s]/i)
  if (electivePoolMatch) {
    const pts = electivePoolMatch[1]
    return codes.map((code) => ({
      code,
      role: 'elective',
      elective_group: `${yearLabel}-${pts}pts-elective`,
    }))
  }

  // ----------------------------------------------------------------
  // OR-choice compulsory: "Plus, either CODE1 or CODE2"
  //                        "Plus CODE1 or CODE2 or CODE3."
  // These are compulsory but the student must choose one.
  // ----------------------------------------------------------------
  if (/^plus,?\s+either\s+/i.test(t) || /^plus\s+[A-Z]{3,8}\d{3}.*\bor\b/i.test(t)) {
    return codes.map((code) => ({
      code,
      role: 'compulsory',
      elective_group: `${yearLabel}-OR-choice`,
    }))
  }

  // ----------------------------------------------------------------
  // Default: treat any remaining paragraph with codes as compulsory.
  // This handles edge cases like "Plus 30 points from Set A: ..."
  // that were not captured above.
  // ----------------------------------------------------------------
  return codes.map((code) => ({ code, role: 'compulsory', elective_group: null }))
}

/**
 * Scrape a single BE degree subject-regulations page using Playwright.
 *
 * The pages use accordion items (id starting "accordion-item-content") for
 * Year 1, Year 2, Year 3, Year 4 sections. Each section contains <p> and <li>
 * elements describing the paper requirements.
 *
 * Returns an array of { code, role, elective_group } objects.
 */
async function scrapeBEDegree(degree) {
  const url = `${BASE_URL}/study/subject-regulations/${degree.slug}`
  const page = await newPage()
  const papers = []

  try {
    console.log(`\n[engineering] Loading ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

    // Wait for the accordion content or at least some page content
    await page
      .waitForSelector('[id^=accordion-item-content], .tabs__panel, main p', { timeout: 15000 })
      .catch(() => {
        console.warn(`[engineering] Timeout waiting for content on ${degree.slug}`)
      })

    // Extract paragraph text from accordion Year sections
    // Returns [{ yearLabel, paragraphs: string[] }]
    const yearSections = await page.evaluate(() => {
      const sections = []

      // Primary: accordion items keyed by id
      const accordionItems = Array.from(
        document.querySelectorAll('[id^=accordion-item-content]')
      )

      for (const item of accordionItems) {
        // Find the adjacent heading (usually an H3 directly before or the toggle button)
        // Look in the parent for any H2/H3 before this element
        let yearLabel = 'Year'
        // Try to find preceding heading inside the accordion wrapper
        const wrapper = item.closest('.accordion-item') || item.parentElement
        if (wrapper) {
          const heading = wrapper.querySelector('h2, h3, button, .accordion-item__title')
          if (heading) yearLabel = heading.innerText.trim().replace(/\s+/g, '-')
        }

        const paras = Array.from(item.querySelectorAll('p, li'))
          .map((el) => el.innerText.trim())
          .filter((t) => t.length > 0)

        if (paras.length > 0) {
          sections.push({ yearLabel, paragraphs: paras })
        }
      }

      // Fallback: if no accordions, try looking for H3 "Year N" headings followed by paragraphs
      if (sections.length === 0) {
        const main = document.querySelector('main')
        if (!main) return sections

        const allElements = Array.from(main.querySelectorAll('h2, h3, p, li'))
        let current = null

        for (const el of allElements) {
          const tag = el.tagName
          const text = el.innerText.trim()

          if ((tag === 'H2' || tag === 'H3') && /year\s+\d/i.test(text)) {
            current = { yearLabel: text.replace(/\s+/g, '-'), paragraphs: [] }
            sections.push(current)
          } else if (current && (tag === 'P' || tag === 'LI') && text.length > 0) {
            current.paragraphs.push(text)
          }
        }
      }

      return sections
    })

    console.log(
      `[engineering] ${degree.code}: found ${yearSections.length} year sections`
    )

    // Parse each year section's paragraphs into paper entries
    for (const section of yearSections) {
      const { yearLabel, paragraphs } = section
      for (const para of paragraphs) {
        const entries = parseParagraph(para, yearLabel)
        papers.push(...entries)
      }
    }

    // De-duplicate: prefer compulsory over elective for the same code
    const seen = new Map()
    for (const paper of papers) {
      if (!seen.has(paper.code)) {
        seen.set(paper.code, paper)
      } else {
        const existing = seen.get(paper.code)
        // Upgrade to compulsory if we see a compulsory occurrence
        if (paper.role === 'compulsory' && existing.role !== 'compulsory') {
          seen.set(paper.code, paper)
        }
      }
    }

    const deduped = [...seen.values()]
    console.log(
      `[engineering] ${degree.code}: ${deduped.length} unique papers ` +
        `(${deduped.filter((p) => p.role === 'compulsory').length} compulsory, ` +
        `${deduped.filter((p) => p.role === 'elective').length} elective)`
    )

    // Log if we got no papers at all
    if (deduped.length === 0) {
      console.warn(
        `[engineering] WARNING: No papers found for ${degree.code}. ` +
          `Check the page structure at ${url}`
      )
      await logError({
        degree: degree.code,
        url,
        error: 'No papers extracted — page structure may have changed',
      })
    }

    return deduped
  } catch (err) {
    console.error(`[engineering] Error scraping ${degree.slug}: ${err.message}`)
    await logError({ degree: degree.code, url, error: err.message })
    return []
  } finally {
    await page.context().close()
  }
}

/** Append an error entry to errors.json. */
async function logError(entry) {
  await fse.ensureDir(DATA_DIR)
  const existing = await fse.readJson(ERRORS_PATH).catch(() => [])
  existing.push({ ...entry, timestamp: new Date().toISOString() })
  await fse.writeJson(ERRORS_PATH, existing, { spaces: 2 })
}

/**
 * Main entry point.
 *
 * 1. Load existing degrees.json and papers.json
 * 2. Scrape each BE degree structure
 * 3. Collect new paper codes
 * 4. Fetch paper details for new codes only
 * 5. Append new degrees and papers to the data files
 */
async function main() {
  await fse.ensureDir(DATA_DIR)

  const existingDegrees = await fse.readJson(DEGREES_PATH).catch(() => [])
  const existingPapers = await fse.readJson(PAPERS_PATH).catch(() => [])

  const existingDegreeCodes = new Set(existingDegrees.map((d) => d.code))
  const existingPaperCodes = new Set(existingPapers.map((p) => p.code))

  const newDegrees = []
  const allNewPaperCodes = new Set()

  // ---- Phase 1: Scrape degree structures ----
  for (const degree of BE_DEGREES) {
    if (existingDegreeCodes.has(degree.code)) {
      console.log(`[engineering] Skipping ${degree.code} — already in degrees.json`)
      continue
    }

    const degreeePapers = await scrapeBEDegree(degree)

    // Collect codes that need to be fetched
    for (const p of degreeePapers) {
      if (!existingPaperCodes.has(p.code)) {
        allNewPaperCodes.add(p.code)
      }
    }

    newDegrees.push({
      name: degree.name,
      code: degree.code,
      total_points: degree.totalPoints,
      papers: degreeePapers.map((p) => ({
        code: p.code,
        role: p.role,
        elective_group: p.elective_group || null,
      })),
    })

    await delay(500)
  }

  // ---- Phase 2: Fetch paper details for new codes ----
  const newCodesArray = [...allNewPaperCodes]
  console.log(
    `\n[engineering] Fetching details for ${newCodesArray.length} new paper codes...`
  )
  if (newCodesArray.length > 0) {
    console.log(`  Codes: ${newCodesArray.join(', ')}`)
  }

  let newPapers = []
  if (newCodesArray.length > 0) {
    const scraped = await scrapePapers(newCodesArray, { concurrency: 2 })
    // Attach prereq_groups to each paper
    newPapers = scraped.map((paper) => ({
      ...paper,
      prereq_groups: parsePrereqGroups(paper.prerequisiteText),
    }))
  }

  // ---- Phase 3: Merge and write output ----
  const mergedDegrees = [...existingDegrees, ...newDegrees]
  await fse.writeJson(DEGREES_PATH, mergedDegrees, { spaces: 2 })
  console.log(
    `\n[engineering] degrees.json: ` +
      `${existingDegrees.length} existing + ${newDegrees.length} new = ${mergedDegrees.length} total`
  )

  const mergedPapers = [...existingPapers]
  let addedCount = 0
  for (const paper of newPapers) {
    if (!existingPaperCodes.has(paper.code)) {
      mergedPapers.push(paper)
      existingPaperCodes.add(paper.code)
      addedCount++
    }
  }
  await fse.writeJson(PAPERS_PATH, mergedPapers, { spaces: 2 })
  console.log(
    `[engineering] papers.json: ` +
      `${existingPapers.length} existing + ${addedCount} new = ${mergedPapers.length} total`
  )

  // ---- Summary ----
  console.log('\n[engineering] Done.')
  console.log(`  New degrees added : ${newDegrees.length}`)
  console.log(`  New papers added  : ${addedCount}`)

  if (newDegrees.length > 0) {
    console.log('\n[engineering] New degree codes per degree:')
    for (const d of newDegrees) {
      const compulsory = d.papers.filter((p) => p.role === 'compulsory').length
      const elective = d.papers.filter((p) => p.role === 'elective').length
      console.log(
        `  ${d.code}: ${d.papers.length} total (${compulsory} compulsory, ${elective} elective)`
      )
    }
  }

  await closeBrowser()
}

main().catch((err) => {
  console.error('[engineering] Fatal error:', err)
  process.exit(1)
})
