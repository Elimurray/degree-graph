'use strict'

/**
 * parseDegree.js
 *
 * Shared utilities for scraping University of Waikato subject-regulations pages.
 *
 * Exports:
 *   extractYearSections(page)          — runs in-browser via Playwright, returns year sections
 *   parseParagraph(text, yearLabel)    — classifies a paragraph into paper entries
 *   deduplicatePapers(papers)          — removes dupes, preferring compulsory over elective
 *   parseYearSections(yearSections)    — parse Format A year sections into paper entries
 *   extractFormatA(page)               — Format A: year-accordion extraction
 *   extractFormatB(page)               — Format B: flat prose overview extraction
 *   extractFormatC(page)               — Format C: calendar/regulations list extraction
 *   extractFormatD(page, subjectFilter) — Format D: /study/qualifications/ degree planner
 *   detectFormat(page, url)            — returns 'A', 'B', 'C', 'D', or 'unknown'
 *
 * Paragraph patterns handled (Format A — consolidated from all previous scrapers):
 *
 *   Compulsory:
 *     "Students must take the following papers: CODE1, CODE2, ..."
 *     "Students must complete the following papers: CODE1, ..."
 *     "Students must take the following: CODE1, ..."
 *
 *   Year 4 explicit pair + elective pool hint (BE Software Engineering):
 *     "Students must take ENGEN570 and ENGEN582, and 30 points from 500 level COMPX papers"
 *     -> named codes before "and N points" are compulsory; the rest is described separately
 *
 *   Elective pool with named group:
 *     "Students must also take one paper from the following X papers: CODE1, CODE2, ..."
 *     "Students must also take two papers from the following X papers: CODE1, ..."
 *     "Students must also take at least two papers from the following X papers: CODE1, ..."
 *
 *   Graduate Diploma substitutes (BE(Hons) only):
 *     "If you are studying the Graduate Diploma in Engineering Management ...
 *      ENGEN272 (which will count in place of ENGEN271 for the BE(Hons))."
 *     -> recorded as compulsory with OR-choice elective_group
 *
 *   Named elective set (EEE degree):
 *     "Plus 30 points from Set A: CODE1, CODE2, ..."
 *     "Plus 15 points from Set B: CODE1, ..."
 *
 *   Mixed set (EEE Year 4):
 *     "Plus another 15 points from either Set A or Set B, or CODE1 or CODE2"
 *
 *   Generic elective pool:
 *     "Plus N points of electives from: CODE1, CODE2, ..."
 *     "Plus N points of electives (...) from: CODE1, ..."
 *
 *   OR-choice compulsory:
 *     "Plus, either CODE1 or CODE2"
 *     "Plus CODE1 or CODE2 or CODE3."
 *
 *   Default fallback:
 *     Any remaining paragraph containing codes is treated as compulsory.
 *
 * Format B patterns (flat prose overview — e.g. Psychology, Screen and Media Studies):
 *   "students must gain N points in papers listed for <Subject>, including CODE1, CODE2..."
 *     -> extract explicitly named codes as compulsory (single-major paragraph only)
 *   "Students must complete CODE1, CODE2, CODE3" -> compulsory
 *   "N points from CODE1, CODE2 or CODE3"        -> elective group
 *   "one of CODE1 or CODE2"                       -> OR-choice compulsory
 *
 * Format C patterns (calendar/regulations — partial core only):
 *   "Candidates must include CODE1, CODE2 and CODE3 in their programme" -> compulsory
 *   "at least N points from the following papers: CODE1, CODE2"         -> elective group
 *
 * Format D patterns (/study/qualifications/ degree planner — BBus, BA, etc.):
 *
 *   The planner page renders TWO .degree-planner containers (a condensed and a full
 *   view). Only the first container is scanned to avoid duplicates.
 *
 *   Each .degree-planner__row contains .degree-planner__cell elements. Each cell has
 *   a <span title="..."> whose text is the primary data source. Cell modifier classes:
 *
 *   --major (not --disabled):
 *     Title starts with a paper code  ->  compulsory, elective_group: null
 *     Title contains "or" between codes (e.g. "WSAFE396 or WSAFE399")
 *                                      ->  compulsory, elective_group: "<year>-OR-choice"
 *     Title is generic ("Any Economics paper...") -> skip, no extractable code
 *
 *   --major + --disabled:
 *     Same rules as --major above. Disabled just means it is greyed-out in the UI
 *     but the paper is still part of the degree.
 *
 *   --compulsory (not a "Choose one of:" cell):
 *     Title starts with a paper code  ->  compulsory, elective_group: null
 *
 *   --compulsory + title "Choose one of: CODE1, CODE2, CODE3":
 *     All codes in the title          ->  compulsory, elective_group: "<year>-OR-choice"
 *
 *   --compulsory + --disabled:
 *     Title starts with a paper code  ->  compulsory, elective_group: null
 *
 *   --elective (always --disabled, free-choice slot):
 *     Title like "100 Level Elective" -> skip (no fixed paper code)
 *
 *   Accordion fallback (BA and similar degrees only):
 *     #accordion-item-content-200-level / -300-level  -> elective pool
 *     #accordion-item-content-list-a / -list-b / -list-c -> elective pool
 */

const PAPER_CODE_RE = /[A-Z]{3,8}\d{3}[A-Z]?/g

/**
 * Extract all unique paper codes from a string.
 *
 * @param {string} str
 * @returns {string[]}
 */
function extractCodes(str) {
  const codes = []
  let m
  const re = new RegExp(PAPER_CODE_RE.source, 'g')
  while ((m = re.exec(str)) !== null) codes.push(m[0])
  return [...new Set(codes)]
}

/**
 * Parse a single paragraph of degree requirement text into an array of paper entries.
 *
 * @param {string} text      - The raw paragraph text from the page.
 * @param {string} yearLabel - Section heading (e.g. "Year-1"), used in elective group names.
 * @returns {Array<{code: string, role: string, elective_group: string|null}>}
 */
function parseParagraph(text, yearLabel) {
  const codes = extractCodes(text)
  if (codes.length === 0) return []

  const t = text.trim()
  const lower = t.toLowerCase()

  // ----------------------------------------------------------------
  // Graduate Diploma advisory note (BE(Hons) pages only):
  //   "If you are studying the Graduate Diploma in Engineering Management ...
  //    ENGEN272 (which will count in place of ENGEN271 for the BE(Hons))."
  //
  // These are optional substitutes, not core requirements.  Record them as
  // compulsory with an OR-choice group so the graph can show the relationship.
  // ----------------------------------------------------------------
  if (/graduate diploma/i.test(t) && /in place of [A-Z]{3,8}\d{3}/i.test(t)) {
    return codes.map((code) => ({
      code,
      role: 'compulsory',
      elective_group: `${yearLabel}-OR-choice`,
    }))
  }

  // ----------------------------------------------------------------
  // Skip other Graduate Diploma advisory notes that don't follow the
  // "in place of" pattern — they are informational only.
  // ----------------------------------------------------------------
  if (/graduate diploma/i.test(t)) {
    return []
  }

  // ----------------------------------------------------------------
  // Compulsory block:
  //   "Students must take the following papers: CODE1, CODE2, ..."
  //   "Students must complete the following papers: CODE1, ..."
  //   "Students must take the following: CODE1, ..."
  // ----------------------------------------------------------------
  if (/students must (take|complete) the following/i.test(t)) {
    return codes.map((code) => ({ code, role: 'compulsory', elective_group: null }))
  }

  // ----------------------------------------------------------------
  // Year 4 explicit pair + elective pool hint (BE Software Engineering):
  //   "Students must take ENGEN570 and ENGEN582, and 30 points from 500 level COMPX papers"
  //
  // Only the explicitly named codes before "and N points" are compulsory.
  // The elective pool appears in the following sentence.
  // ----------------------------------------------------------------
  if (/students must take [A-Z]{3,8}\d{3}.*and \d+ points from/i.test(t)) {
    const beforePoints = t.replace(/,?\s*and \d+ points from.*/i, '')
    const compulsoryCodes = extractCodes(beforePoints)
    return compulsoryCodes.map((code) => ({ code, role: 'compulsory', elective_group: null }))
  }

  // ----------------------------------------------------------------
  // Named elective set (EEE degree):
  //   "Plus N points from Set A: CODE1, CODE2, ..."
  //   "Plus N points from Set B: CODE1, ..."
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
  // Mixed set (EEE Year 4):
  //   "Plus another N points from either Set A or Set B, or CODE1 or CODE2"
  // ----------------------------------------------------------------
  if (/plus another \d+ points from either set/i.test(lower)) {
    return codes.map((code) => ({
      code,
      role: 'elective',
      elective_group: `${yearLabel}-Set-A-or-B`,
    }))
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
  // Generic elective pool:
  //   "Plus N points of electives from: CODE1, CODE2, ..."
  //   "Plus N points of electives (...) from: CODE1, ..."
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
  // OR-choice compulsory:
  //   "Plus, either CODE1 or CODE2"
  //   "Plus CODE1 or CODE2 or CODE3."
  // ----------------------------------------------------------------
  if (/^plus,?\s+either\s+/i.test(t) || /^plus\s+[A-Z]{3,8}\d{3}.*\bor\b/i.test(t)) {
    return codes.map((code) => ({
      code,
      role: 'compulsory',
      elective_group: `${yearLabel}-OR-choice`,
    }))
  }

  // ----------------------------------------------------------------
  // Default: any remaining paragraph containing codes is compulsory.
  // ----------------------------------------------------------------
  return codes.map((code) => ({ code, role: 'compulsory', elective_group: null }))
}

/**
 * De-duplicate paper entries.
 * If the same code appears more than once, keep the compulsory occurrence.
 * If both are elective, keep the first one seen.
 *
 * @param {Array<{code: string, role: string, elective_group: string|null}>} papers
 * @returns {Array<{code: string, role: string, elective_group: string|null}>}
 */
function deduplicatePapers(papers) {
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
  return [...seen.values()]
}

/**
 * Extract year sections from the current page using Playwright's page.evaluate().
 *
 * This function is designed to be passed to page.evaluate() — it runs in the
 * browser context and returns plain serialisable data.
 *
 * Strategy:
 *   1. Primary: look for accordion items ([id^=accordion-item-content]).
 *      Each accordion item's nearest parent with class "accordion-item" contains
 *      a heading (h2/h3/button/.accordion-item__title) that gives the year label.
 *   2. Fallback: scan main for H2/H3 headings matching "Year N", collect
 *      subsequent <p>/<li> elements until the next heading.
 *
 * Only accordion items whose heading matches /year\s*\d/i are included,
 * so that non-year accordions (postgrad, diplomas) are skipped.
 *
 * @returns {Array<{yearLabel: string, paragraphs: string[]}>}
 */
function extractYearSectionsFn() {
  // This function runs inside the browser via page.evaluate()
  const sections = []

  // -- Primary: accordion items in #qualifications with year headings only --
  const qualsSection = document.getElementById('qualifications')
  const accordionScope = qualsSection || document

  const accordionItems = Array.from(
    accordionScope.querySelectorAll('[id^=accordion-item-content]')
  )

  for (const item of accordionItems) {
    let yearLabel = null
    const wrapper = item.closest('.accordion-item') || item.parentElement
    if (wrapper) {
      const heading = wrapper.querySelector('h2, h3, button, .accordion-item__title')
      if (heading) {
        const headingText = heading.innerText.trim()
        if (/year\s*\d/i.test(headingText)) {
          yearLabel = headingText.replace(/\s+/g, '-')
        }
      }
    }

    // Skip non-year accordion items
    if (!yearLabel) continue

    const paras = Array.from(item.querySelectorAll('p, li'))
      .map((el) => el.innerText.trim())
      .filter((t) => t.length > 0)

    if (paras.length > 0) {
      sections.push({ yearLabel, paragraphs: paras })
    }
  }

  if (sections.length > 0) return sections

  // -- Fallback: H2/H3 "Year N" headings in main --
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

  return sections
}

/**
 * Use Playwright to extract year sections from the loaded page (Format A).
 *
 * @param {import('playwright').Page} page - A Playwright page with the degree URL loaded.
 * @returns {Promise<Array<{yearLabel: string, paragraphs: string[]}>>}
 */
async function extractYearSections(page) {
  return page.evaluate(extractYearSectionsFn)
}

/**
 * Parse all year sections into a flat, de-duplicated list of paper entries.
 *
 * @param {Array<{yearLabel: string, paragraphs: string[]}>} yearSections
 * @param {object} [options]
 * @param {boolean} [options.verbose=false] - Log each paragraph match.
 * @returns {Array<{code: string, role: string, elective_group: string|null}>}
 */
function parseYearSections(yearSections, { verbose = false } = {}) {
  const papers = []

  for (const section of yearSections) {
    const { yearLabel, paragraphs } = section
    if (verbose) {
      console.log(`  [parseDegree] ${yearLabel}: ${paragraphs.length} paragraph(s)`)
    }
    for (const para of paragraphs) {
      const entries = parseParagraph(para, yearLabel)
      if (verbose && entries.length > 0) {
        console.log(
          `    -> ${entries.length} entries from: "${para.slice(0, 90)}${para.length > 90 ? '...' : ''}"`
        )
      }
      papers.push(...entries)
    }
  }

  return deduplicatePapers(papers)
}

// ---------------------------------------------------------------------------
// Format A — Year-accordion extraction
// ---------------------------------------------------------------------------

/**
 * Extract paper entries using Format A (year-accordion structure).
 * Delegates to extractYearSections + parseYearSections.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{code: string, role: string, elective_group: string|null}>>}
 */
async function extractFormatA(page) {
  const yearSections = await extractYearSections(page)
  return parseYearSections(yearSections, { verbose: true })
}

// ---------------------------------------------------------------------------
// Format B — Flat prose overview extraction
// ---------------------------------------------------------------------------

/**
 * Parse a single Format B paragraph into paper entries.
 *
 * Patterns handled:
 *   "students must gain N points ... including CODE1, CODE2, CODE3, plus ..."
 *     -> extract codes after "including" up to end-of-sentence as compulsory
 *   "students must complete CODE1, CODE2" -> compulsory
 *   "N points from CODE1, CODE2 or CODE3" -> elective group
 *   "one of CODE1 or CODE2" -> OR-choice compulsory
 *   Default: any codes found treated as compulsory
 *
 * @param {string} text
 * @returns {Array<{code: string, role: string, elective_group: string|null}>}
 */
function parseFormatBParagraph(text) {
  const codes = extractCodes(text)
  if (codes.length === 0) return []

  const t = text.trim()

  // ----------------------------------------------------------------
  // "students must gain N points ... including CODE1, CODE2, CODE3"
  // Extract only the explicitly named codes after "including".
  // ----------------------------------------------------------------
  const includingMatch = t.match(/\bincluding\s+([A-Z]{3,8}\d{3}[A-Z]?(?:[,\s/]+(?:and\s+)?[A-Z]{3,8}\d{3}[A-Z]?)*)/i)
  if (includingMatch) {
    const afterIncluding = includingMatch[1]
    const includedCodes = extractCodes(afterIncluding)
    return includedCodes.map((code) => ({ code, role: 'compulsory', elective_group: null }))
  }

  // ----------------------------------------------------------------
  // "one of CODE1 or CODE2" -> OR-choice compulsory
  // ----------------------------------------------------------------
  if (/\bone\s+of\s+[A-Z]{3,8}\d{3}/i.test(t)) {
    return codes.map((code) => ({
      code,
      role: 'compulsory',
      elective_group: 'OR-choice',
    }))
  }

  // ----------------------------------------------------------------
  // "N points from CODE1, CODE2 or CODE3" -> elective group
  // ----------------------------------------------------------------
  const pointsFromMatch = t.match(/(\d+)\s+points\s+from\s+[A-Z]{3,8}\d{3}/i)
  if (pointsFromMatch) {
    const pts = pointsFromMatch[1]
    return codes.map((code) => ({
      code,
      role: 'elective',
      elective_group: `${pts}pts-elective`,
    }))
  }

  // ----------------------------------------------------------------
  // "Students must complete CODE1, CODE2, CODE3" -> compulsory
  // ----------------------------------------------------------------
  if (/students must complete/i.test(t)) {
    return codes.map((code) => ({ code, role: 'compulsory', elective_group: null }))
  }

  // ----------------------------------------------------------------
  // Default: codes treated as compulsory
  // ----------------------------------------------------------------
  return codes.map((code) => ({ code, role: 'compulsory', elective_group: null }))
}

/**
 * Extract paper entries from a Format B page (flat prose overview).
 *
 * Strategy:
 *   - Read paragraphs from .subject-regulation-page__summary.wysiwyg-content
 *   - Find the FIRST paragraph that contains paper codes (the single-major paragraph)
 *   - Parse only that paragraph — ignore double-major and minor variants
 *   - If no paragraphs contain codes, emit 0 papers and warn (postgrad-only page)
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{code: string, role: string, elective_group: string|null}>>}
 */
async function extractFormatB(page) {
  const paragraphs = await page.evaluate(() => {
    const container = document.querySelector(
      '.subject-regulation-page__summary.wysiwyg-content, ' +
      '.subject-regulation-page__summary, ' +
      '.wysiwyg-content'
    )
    if (!container) return []
    return Array.from(container.querySelectorAll('p'))
      .map((el) => el.innerText.trim())
      .filter((t) => t.length > 0)
  })

  const PAPER_CODE_RE_LOCAL = /[A-Z]{3,8}\d{3}[A-Z]?/

  // Find the first paragraph that contains paper codes (single-major paragraph)
  const firstWithCodes = paragraphs.find((p) => PAPER_CODE_RE_LOCAL.test(p))

  if (!firstWithCodes) {
    console.warn('[parseDegree] Format B: no paragraphs with paper codes found — postgrad-only page?')
    return []
  }

  console.log(
    `  [parseDegree] Format B single-major paragraph: "${firstWithCodes.slice(0, 120)}..."`
  )

  const entries = parseFormatBParagraph(firstWithCodes)

  console.log(
    `  [parseDegree] Format B: parsed ${entries.length} paper(s) from overview paragraph`
  )

  return deduplicatePapers(entries)
}

// ---------------------------------------------------------------------------
// Format C — Calendar/regulations list extraction
// ---------------------------------------------------------------------------

/**
 * Parse a single Format C list item into paper entries.
 *
 * Patterns handled:
 *   "Candidates must include CODE1, CODE2 and CODE3 in their programme" -> compulsory
 *   "at least N points from the following papers: CODE1, CODE2"         -> elective group
 *   Default: codes treated as compulsory
 *
 * @param {string} text
 * @returns {Array<{code: string, role: string, elective_group: string|null}>}
 */
function parseFormatCItem(text) {
  const codes = extractCodes(text)
  if (codes.length === 0) return []

  const t = text.trim()

  // ----------------------------------------------------------------
  // "Candidates must include CODE1, CODE2 and CODE3 in their programme"
  // ----------------------------------------------------------------
  if (/candidates must include/i.test(t)) {
    return codes.map((code) => ({ code, role: 'compulsory', elective_group: null }))
  }

  // ----------------------------------------------------------------
  // "at least N points from the following papers: CODE1, CODE2"
  // ----------------------------------------------------------------
  const atLeastMatch = t.match(/at\s+least\s+(\d+)\s+points\s+from/i)
  if (atLeastMatch) {
    const pts = atLeastMatch[1]
    return codes.map((code) => ({
      code,
      role: 'elective',
      elective_group: `${pts}pts-elective`,
    }))
  }

  // ----------------------------------------------------------------
  // Default: compulsory
  // ----------------------------------------------------------------
  return codes.map((code) => ({ code, role: 'compulsory', elective_group: null }))
}

/**
 * Extract paper entries from a Format C page (calendar/regulations).
 *
 * Strategy:
 *   - Find .wysiwyg-academic-calendar
 *   - Locate H3 "Requirements for the Degree"
 *   - Parse <ol><li> items that follow
 *   - Also check for <table> elements for named list definitions
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{code: string, role: string, elective_group: string|null}>>}
 */
async function extractFormatC(page) {
  const items = await page.evaluate(() => {
    const calendar = document.querySelector('.wysiwyg-academic-calendar')
    if (!calendar) return []

    // Find the "Requirements for the Degree" H3
    const headings = Array.from(calendar.querySelectorAll('h3'))
    let reqHeading = null
    for (const h of headings) {
      if (/requirements for the degree/i.test(h.innerText)) {
        reqHeading = h
        break
      }
    }

    if (!reqHeading) return []

    // Collect <li> items from the next <ol> or <ul> after the heading
    const collected = []
    let node = reqHeading.nextElementSibling
    while (node) {
      if (node.tagName === 'OL' || node.tagName === 'UL') {
        const liItems = Array.from(node.querySelectorAll('li'))
          .map((li) => li.innerText.trim())
          .filter((t) => t.length > 0)
        collected.push(...liItems)
        break
      }
      // Also check for table-based list definitions
      if (node.tagName === 'TABLE') break
      // Stop at the next heading
      if (node.tagName === 'H2' || node.tagName === 'H3' || node.tagName === 'H4') break
      node = node.nextElementSibling
    }

    return collected
  })

  if (items.length === 0) {
    console.warn('[parseDegree] Format C: no list items found under "Requirements for the Degree"')
    return []
  }

  console.log(`  [parseDegree] Format C: found ${items.length} requirement item(s)`)

  const papers = []
  for (const item of items) {
    const entries = parseFormatCItem(item)
    if (entries.length > 0) {
      console.log(
        `    -> ${entries.length} entries from: "${item.slice(0, 90)}${item.length > 90 ? '...' : ''}"`
      )
    }
    papers.push(...entries)
  }

  return deduplicatePapers(papers)
}

// ---------------------------------------------------------------------------
// Format D — /study/qualifications/ degree planner extraction
// ---------------------------------------------------------------------------

/**
 * Extract paper entries from a Format D page (/study/qualifications/ degree planner).
 *
 * The page renders a Vue-powered degree planner grid with subject-filtered content.
 * The ?subject=SUBJ and ?plannerSubject=SUBJ query params pre-select the major subject.
 *
 * The planner always renders TWO .degree-planner containers (a condensed mobile view
 * and a full desktop view) with identical row content. Only the FIRST container is
 * processed to avoid duplicating every paper.
 *
 * Cell classification rules (based on DOM analysis of BBus pages):
 *
 *   .degree-planner__cell--major (with or without --disabled):
 *     - Title matches a single paper code at start  ->  compulsory, elective_group: null
 *     - Title contains multiple codes joined by "or"
 *       (e.g. "WSAFE396 or WSAFE399", "Choose one: ECONS200 or ECONS209")
 *                                                    ->  compulsory, elective_group: "<year>-OR-choice"
 *     - Title is generic ("Any Economics paper at 300 Level", "One from 300 Level...")
 *                                                    ->  skip
 *
 *   .degree-planner__cell--compulsory (with or without --disabled):
 *     - Title starts with "Choose one of: CODE1, CODE2, ..."
 *                                                    ->  compulsory, elective_group: "<year>-OR-choice"
 *     - Title starts with a single paper code        ->  compulsory, elective_group: null
 *     - Title has no extractable code               ->  skip
 *
 *   .degree-planner__cell--elective:
 *     Always a free-choice placeholder with no fixed paper -> skip entirely.
 *
 *   Accordion fallback (BA and similar non-BBus degrees only):
 *     #accordion-item-content-200-level / -300-level  -> elective pool
 *     #accordion-item-content-list-a / -list-b / -list-c -> elective pool
 *
 * @param {import('playwright').Page} page
 * @param {string|null} [subjectFilter] - e.g. "ACCTN". Used for logging only.
 * @returns {Promise<Array<{code: string, role: string, elective_group: string|null}>>}
 */
async function extractFormatD(page, subjectFilter = null) {
  const raw = await page.evaluate(() => {
    const PAPER_CODE_RE = /[A-Z]{3,8}\d{3}[A-Z]?/g

    /**
     * Extract all paper codes from a string.
     * @param {string} str
     * @returns {string[]}
     */
    function codesFromText(str) {
      if (!str) return []
      const codes = []
      let m
      const re = /[A-Z]{3,8}\d{3}[A-Z]?/g
      while ((m = re.exec(str)) !== null) codes.push(m[0])
      return [...new Set(codes)]
    }

    /**
     * Extract all unique paper code strings from a container element.
     * Looks for <a> tags whose innerText matches a paper code.
     *
     * @param {Element} container
     * @returns {string[]}
     */
    function codesFromLinks(container) {
      const SINGLE_CODE_RE = /^[A-Z]{3,8}\d{3}[A-Z]?$/
      const codes = []
      const links = Array.from(container.querySelectorAll('a'))
      for (const a of links) {
        const text = a.innerText.trim().toUpperCase()
        if (SINGLE_CODE_RE.test(text)) codes.push(text)
      }
      return [...new Set(codes)]
    }

    // ------------------------------------------------------------------
    // Use only the FIRST .degree-planner container to avoid duplicates.
    // The page always renders two identical planners (condensed + full).
    // ------------------------------------------------------------------
    const planners = document.querySelectorAll('.degree-planner')
    if (planners.length === 0) return { plannerCells: [], majorElectives: {}, degreeElectives: {} }
    const firstPlanner = planners[0]

    // ------------------------------------------------------------------
    // Walk every row in the first planner and classify each cell.
    // ------------------------------------------------------------------
    const plannerCells = []

    const rows = firstPlanner.querySelectorAll('.degree-planner__row')
    Array.from(rows).forEach((row) => {
      const yearEl = row.querySelector('.degree-planner__year span')
      const yearLabel = yearEl ? yearEl.innerText.trim().replace(/\s+/g, '-') : 'Year-unknown'

      const cells = row.querySelectorAll('.degree-planner__cell')
      Array.from(cells).forEach((cell) => {
        const classes = cell.className.split(' ')
        const isMajor = classes.some((c) => c === 'degree-planner__cell--major')
        const isCompulsory = classes.some((c) => c === 'degree-planner__cell--compulsory')
        const isElective = classes.some((c) => c === 'degree-planner__cell--elective')

        // Free-choice elective slots have no fixed paper code — skip entirely.
        if (isElective) return

        // Get the title from the span[title] attribute.
        const spanEl = cell.querySelector('span[title]')
        const title = spanEl ? spanEl.getAttribute('title') : null
        if (!title) return

        const codes = codesFromText(title)
        if (codes.length === 0) return  // No extractable code — skip (generic text)

        if (isMajor || isCompulsory) {
          // Determine if this is an OR-choice group:
          //   - "Choose one of: CODE1, CODE2, ..."  (--compulsory)
          //   - "Choose one: CODE1 or CODE2"         (--major)
          //   - "WSAFE396 or WSAFE399"               (--major --disabled)
          //   - Any title with multiple codes and "or" between them
          const isChoiceGroup =
            /choose one/i.test(title) ||
            (codes.length > 1 && /\bor\b/i.test(title))

          plannerCells.push({
            yearLabel,
            codes,
            isChoice: isChoiceGroup,
          })
        }
        // Cells that are neither --major nor --compulsory are ignored.
      })
    })

    // ------------------------------------------------------------------
    // Accordion fallback: major elective pools (BA/other non-BBus degrees)
    // These accordions are typically not present on BBus pages.
    // ------------------------------------------------------------------
    const majorElectives = {}

    const level200 = document.getElementById('accordion-item-content-200-level')
    if (level200) {
      const codes = codesFromLinks(level200)
      if (codes.length > 0) majorElectives['200-level'] = codes
    }

    const level300 = document.getElementById('accordion-item-content-300-level')
    if (level300) {
      const codes = codesFromLinks(level300)
      if (codes.length > 0) majorElectives['300-level'] = codes
    }

    // ------------------------------------------------------------------
    // Degree-wide elective lists (List A, List B, List C — BA only)
    // ------------------------------------------------------------------
    const degreeElectives = {}

    for (const listName of ['list-a', 'list-b', 'list-c']) {
      const el = document.getElementById(`accordion-item-content-${listName}`)
      if (el) {
        const codes = codesFromLinks(el)
        if (codes.length > 0) degreeElectives[listName] = codes
      }
    }

    return { plannerCells, majorElectives, degreeElectives }
  })

  const subjectTag = subjectFilter ? ` (subject=${subjectFilter})` : ''
  console.log(`  [parseDegree] Format D${subjectTag}:`)
  console.log(`    Planner cells parsed: ${raw.plannerCells.length}`)

  // Build the paper entries list
  const papers = []
  const seenCodes = new Set()

  // 1. Named cells from the degree planner grid
  for (const cell of raw.plannerCells) {
    const { yearLabel, codes, isChoice } = cell

    if (isChoice) {
      // OR-choice group: all codes are alternatives for the same slot
      const group = `${yearLabel}-OR-choice`
      for (const code of codes) {
        if (!seenCodes.has(code)) {
          seenCodes.add(code)
          papers.push({ code, role: 'compulsory', elective_group: group })
          console.log(`    ${yearLabel} OR-choice [${group}]: ${code}`)
        }
      }
    } else {
      // Single named paper — strictly compulsory
      const code = codes[0]
      if (!seenCodes.has(code)) {
        seenCodes.add(code)
        papers.push({ code, role: 'compulsory', elective_group: null })
        console.log(`    ${yearLabel} compulsory: ${code}`)
      }
    }
  }

  // 2. Major elective pools from accordions (BA/other degrees) — skip already-seen codes
  for (const [level, codes] of Object.entries(raw.majorElectives)) {
    for (const code of codes) {
      if (!seenCodes.has(code)) {
        seenCodes.add(code)
        papers.push({ code, role: 'elective', elective_group: `major-${level}` })
      }
    }
  }

  // 3. Degree-wide elective lists (BA only)
  for (const [list, codes] of Object.entries(raw.degreeElectives)) {
    for (const code of codes) {
      if (!seenCodes.has(code)) {
        seenCodes.add(code)
        papers.push({ code, role: 'elective', elective_group: list })
      }
    }
  }

  const compulsoryStrict = papers.filter((p) => p.role === 'compulsory' && !p.elective_group)
  const compulsoryOR = papers.filter((p) => p.role === 'compulsory' && p.elective_group)
  const elective = papers.filter((p) => p.role === 'elective')

  console.log(`    -> ${papers.length} total: ${compulsoryStrict.length} strict compulsory, ${compulsoryOR.length} OR-choice, ${elective.length} elective`)

  return deduplicatePapers(papers)
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/**
 * Detect which page format the loaded page uses.
 *
 * Detection logic:
 *   1. URL contains /about/calendar/regulations/  ->  Format C
 *   2. URL contains /study/qualifications/         ->  Format D
 *   3. Page has .subject-regulation-page__hero AND
 *      #qualifications has accordion items with year headings  ->  Format A
 *   4. Page has .subject-regulation-page__hero AND
 *      no year-accordion items in #qualifications             ->  Format B
 *   5. Otherwise -> 'unknown'
 *
 * @param {import('playwright').Page} page - A Playwright page with the degree URL loaded.
 * @param {string} url - The URL of the loaded page.
 * @returns {Promise<'A'|'B'|'C'|'D'|'unknown'>}
 */
async function detectFormat(page, url) {
  // Format C: calendar URL
  if (/\/about\/calendar\/regulations\//i.test(url)) {
    return 'C'
  }

  // Format D: qualifications planner URL
  if (/\/study\/qualifications\//i.test(url)) {
    return 'D'
  }

  const detected = await page.evaluate(() => {
    const hasSubjHero = !!document.querySelector('.subject-regulation-page__hero')
    if (!hasSubjHero) return 'unknown'

    // Check for year-accordion items in #qualifications
    const qualsSection = document.getElementById('qualifications')
    if (qualsSection) {
      const accordionItems = Array.from(
        qualsSection.querySelectorAll('[id^=accordion-item-content]')
      )
      for (const item of accordionItems) {
        const wrapper = item.closest('.accordion-item') || item.parentElement
        if (wrapper) {
          const heading = wrapper.querySelector('h2, h3, button, .accordion-item__title')
          if (heading && /year\s*\d/i.test(heading.innerText)) {
            return 'A'
          }
        }
      }
    }

    // Has subject-regulation hero but no year accordions
    return 'B'
  })

  return detected
}

module.exports = {
  extractCodes,
  parseParagraph,
  deduplicatePapers,
  extractYearSections,
  parseYearSections,
  extractFormatA,
  extractFormatB,
  extractFormatC,
  extractFormatD,
  detectFormat,
}
