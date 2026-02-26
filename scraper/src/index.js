'use strict'

/**
 * index.js — Generic University of Waikato degree scraper entry point.
 *
 * Accepts a subject-regulations URL or slug as a CLI argument and:
 *   1. Detects the page format (A, B, C, or D).
 *   2. Scrapes the degree structure using the appropriate extractor.
 *   3. Fetches paper details for any codes not already in papers.json.
 *   4. Upserts the degree into degrees.json (replaces existing entry with same code).
 *   5. Appends only new papers to papers.json (never overwrites existing records).
 *
 * Page formats:
 *   A — Year-accordion (Engineering degrees): year sections in #qualifications accordion
 *   B — Major-text flat prose: paper codes listed in .subject-regulation-page__summary
 *   C — Calendar/regulations: .wysiwyg-academic-calendar with H3 "Requirements for the Degree"
 *   D — Qualifications planner: /study/qualifications/ Vue-rendered degree planner grid
 *       Uses .degree-planner__cell--major tiles + accordion lists (200/300 Level, List A/B/C)
 *
 * Usage:
 *   npm run scrape -- "https://www.waikato.ac.nz/study/subject-regulations/software-engineering"
 *   npm run scrape -- software-engineering
 *   npm run scrape -- "software-engineering" --name "My Degree" --points 360
 *   npm run scrape -- "https://www.waikato.ac.nz/study/qualifications/bachelor-of-arts/?subject=PSYCH&plannerSubject=PSYCH#degree" --name "Bachelor of Arts - Psychology" --code "BA-PSYCH" --points 360
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
const {
  extractFormatA,
  extractFormatB,
  extractFormatC,
  extractFormatD,
  detectFormat,
} = require('./utils/parseDegree')
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
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether the target is a full URL (starts with http/https).
 *
 * @param {string} target
 * @returns {boolean}
 */
function isFullUrl(target) {
  return /^https?:\/\//i.test(target.trim())
}

/**
 * Extract the `subject` query parameter value from a URL string.
 * Returns null if the param is absent.
 *
 * @param {string} url - e.g. "https://...?subject=PSYCH&plannerSubject=PSYCH#degree"
 * @returns {string|null} - e.g. "PSYCH"
 */
function extractSubjectParam(url) {
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get('subject') || null
  } catch {
    return null
  }
}

/**
 * Determine whether a URL points to a /study/qualifications/ page (Format D).
 *
 * @param {string} url
 * @returns {boolean}
 */
function isQualificationsUrl(url) {
  return /\/study\/qualifications\//i.test(url)
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
// Degree structure scraper — dispatches by detected format
// ---------------------------------------------------------------------------

/**
 * Load the degree page, detect its format, and extract paper entries.
 *
 * @param {string} url           - Full URL to the degree regulations page.
 * @param {string} degreeCode    - Short code used in log messages and error records.
 * @param {string|null} subjectFilter - e.g. "PSYCH" for Format D pages.
 * @returns {Promise<Array<{code: string, role: string, elective_group: string|null}>>}
 */
async function scrapeDegreeStructure(url, degreeCode, subjectFilter = null) {
  const page = await newPage()

  try {
    console.log(`\n[scraper] Loading ${url}`)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

    await page
      .waitForSelector(
        '[id^=accordion-item-content], .subject-regulation-page__summary, .wysiwyg-academic-calendar, .degree-planner, main p',
        { timeout: 15000 }
      )
      .catch(() => {
        console.warn(`[scraper] Timeout waiting for page content — continuing anyway`)
      })

    // Give JS-rendered planners time to initialise
    await page.waitForTimeout(2000)

    // Detect format
    const format = await detectFormat(page, url)

    if (format === 'A') {
      console.log('[scraper] Format A detected — year-accordion')
    } else if (format === 'B') {
      console.log('[scraper] Format B detected — major-text flat prose')
    } else if (format === 'C') {
      console.log('[scraper] Format C detected — calendar/regulations')
    } else if (format === 'D') {
      const subjectTag = subjectFilter ? ` (subject=${subjectFilter})` : ''
      console.log(`[scraper] Format D detected — qualifications planner${subjectTag}`)
    } else {
      const msg = `Unsupported page format at ${url}`
      console.error(`[scraper] ERROR: ${msg}`)
      await logError({ degree: degreeCode, url, error: msg })
      return []
    }

    // Dispatch to the appropriate extractor
    let papers
    if (format === 'A') {
      papers = await extractFormatA(page)
    } else if (format === 'B') {
      papers = await extractFormatB(page)
    } else if (format === 'C') {
      papers = await extractFormatC(page)
    } else if (format === 'D') {
      papers = await extractFormatD(page, subjectFilter)
    }

    console.log(`[scraper] ${degreeCode}: ${papers.length} unique paper(s) extracted`)

    if (papers.length === 0) {
      console.warn(
        `[scraper] WARNING: No paper codes parsed for ${degreeCode}. ` +
          `Check parseDegree.js patterns for Format ${format}.`
      )
      await logError({
        degree: degreeCode,
        url,
        format,
        error: `Format ${format}: no paper codes extracted`,
      })
    } else {
      console.log(
        `[scraper] ${degreeCode}: ` +
          `${papers.filter((p) => p.role === 'compulsory').length} compulsory, ` +
          `${papers.filter((p) => p.role === 'elective').length} elective`
      )
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
        '  npm run scrape -- "https://www.waikato.ac.nz/study/qualifications/bachelor-of-arts/?subject=PSYCH&plannerSubject=PSYCH#degree" --name "Bachelor of Arts - Psychology" --code "BA-PSYCH" --points 360\n' +
        '  npm run scrape -- data-science --name "Bachelor of Data Science" --points 360'
    )
    process.exit(1)
  }

  // ---- Resolve URL, slug, and subject filter ----
  let url
  let slug
  let subjectFilter = null

  if (isFullUrl(args.target)) {
    // Full URL supplied — use it verbatim (strip the #fragment for the actual request
    // but keep it in logs; Playwright handles the full URL fine).
    url = args.target

    if (isQualificationsUrl(url)) {
      // Format D: extract ?subject= param for filtering/logging
      subjectFilter = extractSubjectParam(url)

      // Use the subject filter (or a derived slug) as the slug for metadata lookup
      // e.g. "PSYCH" -> look up "psychology" -> fall back to CLI flags
      slug = subjectFilter ? subjectFilter.toLowerCase() : extractSlug(url)
    } else {
      // Format A/B/C: extract the path slug from the URL
      slug = extractSlug(url)
    }
  } else {
    // Slug or partial path supplied — build the full regulations URL
    slug = extractSlug(args.target)
    url = buildRegulationsUrl(slug, BASE_URL)
  }

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
  console.log(`  Subject     : ${subjectFilter ?? '(n/a)'}`)
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
  const degreePapers = await scrapeDegreeStructure(url, degreeCode, subjectFilter)
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

  console.log(`\n  Sample paper codes:`)
  const samplePapers = newDegreeEntry.papers.slice(0, 5)
  for (const p of samplePapers) {
    console.log(`    ${p.code} [${p.role}${p.elective_group ? ' / ' + p.elective_group : ''}]`)
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
