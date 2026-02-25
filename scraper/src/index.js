'use strict'

/**
 * index.js — Generic University of Waikato degree scraper entry point.
 *
 * Accepts a subject-regulations URL or slug as a CLI argument and:
 *   1. Scrapes the degree structure (Year 1–4 accordion sections).
 *   2. Fetches paper details for any codes not already in papers.json.
 *   3. Upserts the degree into degrees.json (replaces existing entry with same code).
 *   4. Appends only new papers to papers.json (never overwrites existing records).
 *
 * Usage:
 *   npm run scrape -- "https://www.waikato.ac.nz/study/subject-regulations/software-engineering"
 *   npm run scrape -- software-engineering
 *   npm run scrape -- "software-engineering" --name "My Degree" --points 360
 *
 * Optional flags:
 *   --name "Degree Name"   Override the degree name (useful for unknown slugs).
 *   --points 360           Override the total_points value.
 *   --code "MY-CODE"       Override the derived degree code.
 *   --force                Re-fetch paper details even for papers already in papers.json.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../..', '.env') })

const path = require('path')
const fse = require('fs-extra')

const { newPage, closeBrowser } = require('./utils/browser')
const { extractYearSections, parseYearSections } = require('./utils/parseDegree')
const { scrapePapers } = require('./scrapers/papers')
const { parsePrereqGroups } = require('./utils/prereqParser')
const { resolveDegreeFromSlug, extractSlug, buildRegulationsUrl } = require('./utils/slugToCode')

const BASE_URL = process.env.SCRAPER_BASE_URL || 'https://www.waikato.ac.nz'
const DATA_DIR = path.resolve(__dirname, '../data')
const DEGREES_PATH = path.join(DATA_DIR, 'degrees.json')
const PAPERS_PATH = path.join(DATA_DIR, 'papers.json')
const ERRORS_PATH = path.join(DATA_DIR, 'errors.json')

/** 500ms polite delay between requests. */
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse process.argv into { target, name, points, code, force }.
 * Target is the first positional argument (URL or slug).
 *
 * @returns {{ target: string|null, name: string|null, points: number|null,
 *             code: string|null, force: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const result = { target: null, name: null, points: null, code: null, force: false }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) {
      result.name = args[++i]
    } else if (args[i] === '--points' && args[i + 1]) {
      result.points = parseInt(args[++i], 10) || null
    } else if (args[i] === '--code' && args[i + 1]) {
      result.code = args[++i]
    } else if (args[i] === '--force') {
      result.force = true
    } else if (!result.target && !args[i].startsWith('--')) {
      result.target = args[i]
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Error logging
// ---------------------------------------------------------------------------

/** Append an error entry to errors.json. */
async function logError(entry) {
  await fse.ensureDir(DATA_DIR)
  const existing = await fse.readJson(ERRORS_PATH).catch(() => [])
  existing.push({ ...entry, timestamp: new Date().toISOString() })
  await fse.writeJson(ERRORS_PATH, existing, { spaces: 2 })
}

// ---------------------------------------------------------------------------
// Degree structure scraper
// ---------------------------------------------------------------------------

/**
 * Load the subject-regulations page and extract paper entries for all year sections.
 *
 * @param {string} url        - Full URL to the subject-regulations page.
 * @param {string} degreeCode - Short code used in log messages and error records.
 * @returns {Promise<Array<{code: string, role: string, elective_group: string|null}>>}
 */
async function scrapeDegreeStructure(url, degreeCode) {
  const page = await newPage()

  try {
    console.log(`\n[scraper] Loading ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

    await page
      .waitForSelector('[id^=accordion-item-content], .tabs__panel, main p', { timeout: 15000 })
      .catch(() => {
        console.warn(`[scraper] Timeout waiting for page content — continuing anyway`)
      })

    const yearSections = await extractYearSections(page)
    console.log(`[scraper] ${degreeCode}: found ${yearSections.length} year section(s)`)

    if (yearSections.length === 0) {
      console.warn(
        `[scraper] WARNING: No year sections found for ${degreeCode}. ` +
          `The page may have changed structure or the URL is incorrect.`
      )
      await logError({
        degree: degreeCode,
        url,
        error: 'No year sections found — page structure may have changed or URL is incorrect',
      })
      return []
    }

    const papers = parseYearSections(yearSections, { verbose: true })

    console.log(
      `[scraper] ${degreeCode}: ${papers.length} unique paper(s) — ` +
        `${papers.filter((p) => p.role === 'compulsory').length} compulsory, ` +
        `${papers.filter((p) => p.role === 'elective').length} elective`
    )

    if (papers.length === 0) {
      console.warn(
        `[scraper] WARNING: Year sections found but no paper codes parsed for ${degreeCode}. ` +
          `Check parseDegree.js paragraph patterns.`
      )
      await logError({
        degree: degreeCode,
        url,
        error: 'Year sections found but no paper codes extracted',
      })
    }

    return papers
  } catch (err) {
    console.error(`[scraper] Error loading degree page: ${err.message}`)
    await logError({ degree: degreeCode, url, error: err.message })
    return []
  } finally {
    await page.context().close()
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await fse.ensureDir(DATA_DIR)

  // ---- Parse CLI arguments ----
  const args = parseArgs()

  if (!args.target) {
    console.error(
      'Usage: npm run scrape -- <url-or-slug> [--name "Degree Name"] [--points 360] [--code "MY-CODE"] [--force]\n' +
        '\n' +
        'Examples:\n' +
        '  npm run scrape -- software-engineering\n' +
        '  npm run scrape -- "https://www.waikato.ac.nz/study/subject-regulations/civil-engineering"\n' +
        '  npm run scrape -- data-science --name "Bachelor of Data Science" --points 360'
    )
    process.exit(1)
  }

  // ---- Resolve slug and URL ----
  const slug = extractSlug(args.target)
  const url = buildRegulationsUrl(slug, BASE_URL)
  const resolved = resolveDegreeFromSlug(slug)

  // CLI flags override resolved values
  const degreeCode = args.code || resolved.code
  const degreeName = args.name || resolved.name
  const totalPoints = args.points || resolved.totalPoints

  if (!resolved.known) {
    console.warn(
      `[scraper] Unknown slug "${slug}" — using derived code "${degreeCode}" and name "${degreeName}".`
    )
    console.warn(
      `[scraper] Use --name and --points flags to set the correct values, or add the slug to slugToCode.js.`
    )
  }

  console.log('\n=== Degree Graph Scraper ===')
  console.log(`  Slug        : ${slug}`)
  console.log(`  URL         : ${url}`)
  console.log(`  Code        : ${degreeCode}`)
  console.log(`  Name        : ${degreeName}`)
  console.log(`  Points      : ${totalPoints ?? '(unknown)'}`)
  console.log(`  Force fetch : ${args.force}`)

  // ---- Load existing data ----
  const existingDegrees = await fse.readJson(DEGREES_PATH).catch(() => [])
  const existingPapers = await fse.readJson(PAPERS_PATH).catch(() => [])
  const existingPapersByCode = new Map(existingPapers.map((p) => [p.code, p]))

  const previousDegreeEntry = existingDegrees.find((d) => d.code === degreeCode)
  if (previousDegreeEntry) {
    console.log(
      `\n[scraper] Existing entry for "${degreeCode}" found in degrees.json — will replace it.`
    )
  }

  // ---- Phase 1: Scrape degree structure ----
  console.log('\n=== Phase 1: Scraping degree structure ===')
  const degreePapers = await scrapeDegreeStructure(url, degreeCode)
  await delay(500)

  if (degreePapers.length === 0) {
    console.error(
      '\n[scraper] No papers scraped — aborting to avoid corrupting data files.\n' +
        `  Verify the URL is correct: ${url}`
    )
    await closeBrowser()
    process.exit(1)
  }

  // Build the degree entry
  const newDegreeEntry = {
    name: degreeName,
    code: degreeCode,
    total_points: totalPoints,
    papers: degreePapers.map((p) => ({
      code: p.code,
      role: p.role,
      elective_group: p.elective_group || null,
    })),
  }

  // ---- Phase 2: Fetch paper details ----
  console.log('\n=== Phase 2: Fetching paper details ===')

  const allDegreeCodes = degreePapers.map((p) => p.code)
  const newCodes = allDegreeCodes.filter((c) => !existingPapersByCode.has(c))
  const existingCodes = allDegreeCodes.filter((c) => existingPapersByCode.has(c))

  console.log(`[scraper] Total paper codes in degree: ${allDegreeCodes.length}`)
  console.log(`  Already in papers.json : ${existingCodes.length}`)
  console.log(`  New (need fetching)    : ${newCodes.length}`)

  if (newCodes.length > 0) {
    console.log(`  New codes: ${newCodes.join(', ')}`)
  }

  // When --force is set, re-fetch all codes; otherwise only fetch new ones.
  const codesToFetch = args.force ? allDegreeCodes : newCodes

  let freshPapers = []
  if (codesToFetch.length > 0) {
    if (args.force) {
      console.log(
        `[scraper] --force: fetching fresh details for all ${codesToFetch.length} paper(s)...`
      )
    } else {
      console.log(`[scraper] Fetching details for ${codesToFetch.length} new paper(s)...`)
    }

    const scrapedPapers = await scrapePapers(codesToFetch, { concurrency: 2 })

    // Attach prereq_groups to each paper
    freshPapers = scrapedPapers.map((paper) => ({
      ...paper,
      prereq_groups: parsePrereqGroups(paper.prerequisiteText),
    }))

    console.log(`[scraper] Successfully fetched ${freshPapers.length}/${codesToFetch.length} paper(s)`)

    // Log any codes that failed
    const fetchedCodes = new Set(freshPapers.map((p) => p.code))
    const failedCodes = codesToFetch.filter((c) => !fetchedCodes.has(c))
    if (failedCodes.length > 0) {
      console.warn(`[scraper] Failed to fetch details for: ${failedCodes.join(', ')}`)
      await logError({
        degree: degreeCode,
        error: `Failed to fetch paper details for: ${failedCodes.join(', ')}`,
      })
    }
  } else {
    console.log('[scraper] No new paper codes to fetch — all already in papers.json.')
  }

  // ---- Phase 3: Also fetch prereq papers not in any degree ----
  // Collect all prereq/coreq codes referenced by the newly scraped papers and
  // ensure we have detail records for them too (they may not be part of the degree).
  await delay(500)
  const allKnownCodes = new Set([
    ...existingPapers.map((p) => p.code),
    ...freshPapers.map((p) => p.code),
  ])

  const referencedCodes = new Set()
  for (const paper of freshPapers) {
    for (const c of [...paper.prerequisites, ...paper.corequisites]) {
      if (!allKnownCodes.has(c)) referencedCodes.add(c)
    }
  }

  let extraPapers = []
  if (referencedCodes.size > 0) {
    console.log(
      `\n=== Phase 3: Fetching ${referencedCodes.size} prerequisite paper(s) not in papers.json ===`
    )
    console.log(`  Codes: ${[...referencedCodes].join(', ')}`)

    const scrapedExtras = await scrapePapers([...referencedCodes], { concurrency: 2 })
    extraPapers = scrapedExtras.map((paper) => ({
      ...paper,
      prereq_groups: parsePrereqGroups(paper.prerequisiteText),
    }))
    console.log(`[scraper] Fetched ${extraPapers.length} prerequisite paper(s)`)
  }

  // ---- Phase 4: Write output files ----
  console.log('\n=== Phase 4: Writing output files ===')

  // degrees.json: upsert — remove existing entry with same code, append new entry
  const filteredDegrees = existingDegrees.filter((d) => d.code !== degreeCode)
  const mergedDegrees = [...filteredDegrees, newDegreeEntry]
  await fse.writeJson(DEGREES_PATH, mergedDegrees, { spaces: 2 })
  const degreeAction = previousDegreeEntry ? 'replaced' : 'added'
  console.log(
    `[scraper] degrees.json: ${degreeAction} "${degreeCode}" — ${mergedDegrees.length} total degree(s)`
  )

  // papers.json: append new papers only (do not overwrite existing records unless --force)
  const mergedPapers = [...existingPapers]
  let addedCount = 0
  let updatedCount = 0

  for (const paper of [...freshPapers, ...extraPapers]) {
    const idx = mergedPapers.findIndex((p) => p.code === paper.code)
    if (idx !== -1) {
      if (args.force) {
        mergedPapers[idx] = paper
        updatedCount++
      }
      // Without --force: skip — do not overwrite existing records
    } else {
      mergedPapers.push(paper)
      addedCount++
    }
  }

  await fse.writeJson(PAPERS_PATH, mergedPapers, { spaces: 2 })
  console.log(
    `[scraper] papers.json: ${addedCount} added` +
      (args.force ? `, ${updatedCount} updated` : '') +
      ` — ${mergedPapers.length} total paper(s)`
  )

  // ---- Summary ----
  console.log('\n=== Summary ===')
  console.log(`  Degree  : ${newDegreeEntry.code} — ${newDegreeEntry.name}`)
  console.log(`  Points  : ${newDegreeEntry.total_points ?? '(not set)'}`)
  console.log(`  Papers  : ${newDegreeEntry.papers.length} in degree structure`)
  console.log(
    `    Compulsory (strict)  : ${newDegreeEntry.papers.filter((p) => p.role === 'compulsory' && !p.elective_group).length}`
  )
  console.log(
    `    Compulsory (OR)      : ${newDegreeEntry.papers.filter((p) => p.role === 'compulsory' && p.elective_group).length}`
  )
  console.log(
    `    Elective             : ${newDegreeEntry.papers.filter((p) => p.role === 'elective').length}`
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
      console.log(`    ${g}: ${count} paper(s)`)
    }
  }

  console.log(`\n  Output files:`)
  console.log(`    ${DEGREES_PATH}`)
  console.log(`    ${PAPERS_PATH}`)

  console.log('\n[scraper] Done.')

  await closeBrowser()
}

main().catch(async (err) => {
  console.error('\n[scraper] Fatal error:', err.message)
  await logError({ error: err.message, stack: err.stack }).catch(() => {})
  await closeBrowser().catch(() => {})
  process.exit(1)
})
