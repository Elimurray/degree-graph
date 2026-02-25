'use strict'

/**
 * parseDegree.js
 *
 * Shared utilities for scraping University of Waikato subject-regulations pages.
 *
 * Exports:
 *   extractYearSections(page)  — runs in-browser via Playwright, returns year sections
 *   parseParagraph(text, yearLabel) — classifies a paragraph into paper entries
 *   deduplicatePapers(papers)  — removes dupes, preferring compulsory over elective
 *
 * Paragraph patterns handled (consolidated from all previous scrapers):
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
 * @returns {Array<{yearLabel: string, paragraphs: string[]}>}
 */
function extractYearSectionsFn() {
  // This function runs inside the browser via page.evaluate()
  const sections = []

  // -- Primary: accordion items --
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

  if (sections.length > 0) return sections

  // -- Fallback: H2/H3 "Year N" headings --
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
 * Use Playwright to extract year sections from the loaded page.
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

module.exports = {
  extractCodes,
  parseParagraph,
  deduplicatePapers,
  extractYearSections,
  parseYearSections,
}
