/**
 * Scrapes the Bachelor of Engineering (Honours) in Software Engineering
 * degree structure from:
 *   https://www.waikato.ac.nz/study/subject-regulations/software-engineering
 *
 * Uses Playwright to render the accordion-based page (JavaScript required).
 *
 * Page text patterns observed (confirmed via Playwright inspection):
 *
 *   Compulsory block:
 *     "Students must take the following papers: CODE1, CODE2, ..."
 *
 *   Year 4 compulsory pair + elective pool in one sentence:
 *     "Students must take ENGEN570 and ENGEN582, and 30 points from 500 level COMPX papers..."
 *     -> ENGEN570 and ENGEN582 are compulsory; COMPX 500-level papers are listed in next sentence
 *
 *   Elective pool (choose one):
 *     "Students must also take one paper from the following X papers: CODE1, CODE2, ..."
 *
 *   Elective pool (choose two):
 *     "Students must also take two papers from the following X papers: CODE1, ..."
 *     "Students must also take at least two papers from the following X papers: CODE1, ..."
 *
 *   Graduate Diploma advisory note (parse ENGEN272/372 as OR-choice compulsory substitutes):
 *     "If you are studying the Graduate Diploma in Engineering Management ... ENGEN272
 *      (which will count in place of ENGEN271 for the BE(Hons))."
 *     "If you are studying the Graduate Diploma in Engineering Management ... ENGEN372
 *      (in place of ENGEN371)."
 *
 * Output:
 *   - Removes BSoftEng from degrees.json, adds BE-SE entry
 *   - Updates existing papers and appends new ones in papers.json
 *
 * Usage:
 *   node src/scrapers/scrapeBEsoftware.js
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

const DEGREE = {
  slug: 'software-engineering',
  code: 'BE-SE',
  name: 'Bachelor of Engineering (Honours) in Software Engineering',
  totalPoints: 480,
}

/** 500ms delay between requests. */
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const PAPER_CODE_RE = /[A-Z]{3,8}\d{3}[A-Z]?/g

function extractCodes(str) {
  const codes = []
  let m
  const re = new RegExp(PAPER_CODE_RE.source, 'g')
  while ((m = re.exec(str)) !== null) codes.push(m[0])
  return [...new Set(codes)]
}

/**
 * Parse a single paragraph of degree requirement text into paper entries.
 *
 * Handles the specific patterns used on the BE Software Engineering page.
 *
 * @param {string} text      - The paragraph text from the page.
 * @param {string} yearLabel - e.g. "Year-1", "Year-2" — used for elective group naming.
 * @returns {Array<{code: string, role: string, elective_group: string|null}>}
 */
function parseParagraph(text, yearLabel) {
  const codes = extractCodes(text)
  if (codes.length === 0) return []

  const t = text.trim()

  // ----------------------------------------------------------------
  // Compulsory block:
  //   "Students must take the following papers: CODE1, CODE2, ..."
  //   "Students must complete the following papers: CODE1, ..."
  // ----------------------------------------------------------------
  if (/students must (take|complete) the following papers/i.test(t)) {
    return codes.map((code) => ({ code, role: 'compulsory', elective_group: null }))
  }

  // ----------------------------------------------------------------
  // Year 4 explicit compulsory pair + elective pool hint:
  //   "Students must take ENGEN570 and ENGEN582, and 30 points from 500 level COMPX papers..."
  //
  // Extract only the explicitly named codes before "and N points".
  // The elective pool is described separately in the next sentence.
  // ----------------------------------------------------------------
  if (/students must take [A-Z]{3,8}\d{3}.*and \d+ points from/i.test(t)) {
    const beforePoints = t.replace(/,?\s*and \d+ points from.*/i, '')
    const compulsoryCodes = extractCodes(beforePoints)
    return compulsoryCodes.map((code) => ({ code, role: 'compulsory', elective_group: null }))
  }

  // ----------------------------------------------------------------
  // Elective pool with named group:
  //   "Students must also take one paper from the following X papers: ..."
  //   "Students must also take two papers from the following X papers: ..."
  //   "Students must also take at least two papers from the following X papers: ..."
  // ----------------------------------------------------------------
  if (/students must also take/i.test(t) && /from the following/i.test(t)) {
    // Derive the group name from the descriptor between "following" and "papers:"
    const groupMatch = t.match(/following\s+([\w\s-]+?)\s+papers?[:]/i)
    const groupName = groupMatch
      ? groupMatch[1].trim().replace(/\s+/g, '-')
      : 'elective'
    return codes.map((code) => ({
      code,
      role: 'elective',
      elective_group: `${yearLabel}-${groupName}`,
    }))
  }

  // ----------------------------------------------------------------
  // Graduate Diploma advisory note:
  //   "If you are studying the Graduate Diploma in Engineering Management ...
  //    you are strongly encouraged to complete ENGEN272 (which will count in
  //    place of ENGEN271 for the BE(Hons))."
  //   "If you are studying the Graduate Diploma in Engineering Management ...
  //    you must complete ENGEN372 (in place of ENGEN371)."
  //
  // ENGEN272 and ENGEN372 are alternate work-placement papers that substitute
  // for ENGEN271/ENGEN371.  We record them as OR-choice compulsory so the
  // graph can show the substitution relationship.
  // ----------------------------------------------------------------
  if (/graduate diploma/i.test(t) && /in place of ENGEN\d{3}/i.test(t)) {
    return codes.map((code) => ({
      code,
      role: 'compulsory',
      elective_group: `${yearLabel}-OR-choice`,
    }))
  }

  // ----------------------------------------------------------------
  // Generic elective pool fallback:
  //   "Plus N points of electives from: ..."
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
  // Default: treat any remaining paragraph with codes as compulsory.
  // ----------------------------------------------------------------
  return codes.map((code) => ({ code, role: 'compulsory', elective_group: null }))
}

/**
 * Scrape the BE(Hons) Software Engineering degree structure using Playwright.
 *
 * Returns an array of { code, role, elective_group } objects.
 */
async function scrapeBESoftwareDegree() {
  const url = `${BASE_URL}/study/subject-regulations/${DEGREE.slug}`
  const page = await newPage()
  const papers = []

  try {
    console.log(`\n[be-se] Loading ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

    await page
      .waitForSelector('[id^=accordion-item-content], .tabs__panel, main p', { timeout: 15000 })
      .catch(() => {
        console.warn(`[be-se] Timeout waiting for content on ${DEGREE.slug}`)
      })

    // Extract paragraph text from accordion Year sections
    const yearSections = await page.evaluate(() => {
      const sections = []

      // Primary: accordion items keyed by id
      const accordionItems = Array.from(
        document.querySelectorAll('[id^=accordion-item-content]')
      )

      for (const item of accordionItems) {
        let yearLabel = 'Year'
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

      // Fallback: if no accordions, scan for H2/H3 "Year N" headings
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

    console.log(`[be-se] Found ${yearSections.length} year sections`)

    // Parse each year section's paragraphs into paper entries
    for (const section of yearSections) {
      const { yearLabel, paragraphs } = section
      console.log(`  [be-se] ${yearLabel}: ${paragraphs.length} paragraphs`)
      for (const para of paragraphs) {
        const entries = parseParagraph(para, yearLabel)
        if (entries.length > 0) {
          console.log(
            `    -> ${entries.length} entries from: "${para.slice(0, 80)}${para.length > 80 ? '...' : ''}"`
          )
        }
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
        if (paper.role === 'compulsory' && existing.role !== 'compulsory') {
          seen.set(paper.code, paper)
        }
      }
    }

    const deduped = [...seen.values()]
    console.log(
      `[be-se] ${deduped.length} unique papers ` +
        `(${deduped.filter((p) => p.role === 'compulsory').length} compulsory, ` +
        `${deduped.filter((p) => p.role === 'elective').length} elective)`
    )

    if (deduped.length === 0) {
      console.warn(`[be-se] WARNING: No papers found. Check page structure at ${url}`)
      await logError({
        degree: DEGREE.code,
        url,
        error: 'No papers extracted — page structure may have changed',
      })
    }

    return deduped
  } catch (err) {
    console.error(`[be-se] Error scraping degree: ${err.message}`)
    await logError({ degree: DEGREE.code, url, error: err.message })
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
 * 2. Scrape BE-SE degree structure
 * 3. Determine which paper codes need detail-fetching
 * 4. Fetch paper details (update existing + append new)
 * 5. Remove BSoftEng from degrees.json, add BE-SE entry
 * 6. Upsert papers in papers.json
 */
async function main() {
  await fse.ensureDir(DATA_DIR)

  const existingDegrees = await fse.readJson(DEGREES_PATH).catch(() => [])
  const existingPapers = await fse.readJson(PAPERS_PATH).catch(() => [])

  // Build lookup map for papers
  const existingPapersByCode = new Map(existingPapers.map((p) => [p.code, p]))

  // ---- Phase 1: Scrape the degree structure ----
  const degreePapers = await scrapeBESoftwareDegree()
  await delay(500)

  if (degreePapers.length === 0) {
    console.error('[be-se] No papers scraped — aborting to avoid corrupting data files.')
    await closeBrowser()
    process.exit(1)
  }

  // Build the degree entry
  const newDegreeEntry = {
    name: DEGREE.name,
    code: DEGREE.code,
    total_points: DEGREE.totalPoints,
    papers: degreePapers.map((p) => ({
      code: p.code,
      role: p.role,
      elective_group: p.elective_group || null,
    })),
  }

  // ---- Phase 2: Determine paper codes to fetch ----
  const allDegreeCodes = degreePapers.map((p) => p.code)
  const newCodes = allDegreeCodes.filter((c) => !existingPapersByCode.has(c))
  const existingCodes = allDegreeCodes.filter((c) => existingPapersByCode.has(c))

  console.log(`\n[be-se] Paper codes: ${allDegreeCodes.length} total`)
  console.log(`  New (not in papers.json)   : ${newCodes.length}`)
  if (newCodes.length > 0) console.log(`    ${newCodes.join(', ')}`)
  console.log(`  Existing (will UPDATE)     : ${existingCodes.length}`)

  // Fetch fresh details for all degree papers (both new and existing — overwrite with fresh data)
  console.log(`\n[be-se] Fetching fresh details for all ${allDegreeCodes.length} paper codes...`)
  const scrapedPapers = await scrapePapers(allDegreeCodes, { concurrency: 2 })

  // Attach prereq_groups to each scraped paper
  const freshPapers = scrapedPapers.map((paper) => ({
    ...paper,
    prereq_groups: parsePrereqGroups(paper.prerequisiteText),
  }))

  console.log(
    `\n[be-se] Successfully fetched ${freshPapers.length}/${allDegreeCodes.length} papers`
  )

  // Log any codes that failed to scrape
  const fetchedCodes = new Set(freshPapers.map((p) => p.code))
  const failedCodes = allDegreeCodes.filter((c) => !fetchedCodes.has(c))
  if (failedCodes.length > 0) {
    console.warn(`[be-se] Failed to fetch details for: ${failedCodes.join(', ')}`)
    await logError({
      degree: DEGREE.code,
      error: `Failed to fetch paper details for: ${failedCodes.join(', ')}`,
    })
  }

  // ---- Phase 3: Merge and write output ----

  // degrees.json: remove BSoftEng (wrong degree), remove any existing BE-SE, add new BE-SE entry
  const removedCodes = new Set(['BSoftEng', DEGREE.code])
  const filteredDegrees = existingDegrees.filter((d) => !removedCodes.has(d.code))
  const mergedDegrees = [...filteredDegrees, newDegreeEntry]

  await fse.writeJson(DEGREES_PATH, mergedDegrees, { spaces: 2 })
  console.log(
    `\n[be-se] degrees.json written: ${mergedDegrees.length} total degrees`
  )
  if (existingDegrees.some((d) => d.code === 'BSoftEng')) {
    console.log(`  Removed BSoftEng (wrong degree — was Bachelor of Software Engineering)`)
  }
  console.log(`  Added ${DEGREE.code} — ${DEGREE.name}`)

  // papers.json: upsert — overwrite existing codes, append genuinely new ones
  const mergedPapers = [...existingPapers]
  let updatedCount = 0
  let addedCount = 0

  for (const paper of freshPapers) {
    const idx = mergedPapers.findIndex((p) => p.code === paper.code)
    if (idx !== -1) {
      mergedPapers[idx] = paper
      updatedCount++
    } else {
      mergedPapers.push(paper)
      addedCount++
    }
  }

  await fse.writeJson(PAPERS_PATH, mergedPapers, { spaces: 2 })
  console.log(
    `[be-se] papers.json written: ${mergedPapers.length} total papers ` +
      `(${updatedCount} updated, ${addedCount} new)`
  )

  // ---- Summary ----
  console.log('\n[be-se] Done.')
  console.log(`  Degree : ${newDegreeEntry.code} — ${newDegreeEntry.name}`)
  console.log(`  Points : ${newDegreeEntry.total_points}`)
  console.log(`  Papers : ${newDegreeEntry.papers.length} total`)
  console.log(
    `    Compulsory : ${newDegreeEntry.papers.filter((p) => p.role === 'compulsory' && !p.elective_group).length}`
  )
  console.log(
    `    OR-choice  : ${newDegreeEntry.papers.filter((p) => p.elective_group && p.elective_group.includes('OR-choice')).length}`
  )
  console.log(
    `    Elective   : ${newDegreeEntry.papers.filter((p) => p.role === 'elective').length}`
  )

  const groups = [
    ...new Set(
      newDegreeEntry.papers.filter((p) => p.elective_group).map((p) => p.elective_group)
    ),
  ]
  if (groups.length > 0) {
    console.log(`  Elective groups:`)
    for (const g of groups) {
      const count = newDegreeEntry.papers.filter((p) => p.elective_group === g).length
      console.log(`    ${g}: ${count} papers`)
    }
  }

  // Check ENGEN272 and ENGEN372 are present (expected for all BE degrees)
  const hasPlacements = ['ENGEN272', 'ENGEN372'].filter((c) =>
    newDegreeEntry.papers.some((p) => p.code === c)
  )
  const missingPlacements = ['ENGEN272', 'ENGEN372'].filter(
    (c) => !newDegreeEntry.papers.some((p) => p.code === c)
  )
  if (hasPlacements.length > 0) {
    console.log(`  Work placements found: ${hasPlacements.join(', ')}`)
  }
  if (missingPlacements.length > 0) {
    console.warn(`  Note: Work placement papers not found: ${missingPlacements.join(', ')}`)
    console.warn(
      `  (These appear as optional Graduate Diploma substitutes, not core BE(Hons) papers)`
    )
  }

  await closeBrowser()
}

main().catch((err) => {
  console.error('[be-se] Fatal error:', err)
  process.exit(1)
})
