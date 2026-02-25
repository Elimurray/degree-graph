/**
 * Scraper entry point.
 *
 * Runs degree scraping first (to discover paper codes), then paper scraping
 * (to get full details for each paper), then writes both to /scraper/data/.
 *
 * Usage: npm run scrape (from project root)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../..', '.env') })

const path = require('path')
const fse = require('fs-extra')
const { scrapeDegrees } = require('./scrapers/degrees')
const { scrapePapers } = require('./scrapers/papers')
const { closeBrowser } = require('./utils/browser')

const OUTPUT_DIR = path.resolve(__dirname, '../data')

async function main() {
  await fse.ensureDir(OUTPUT_DIR)

  // Step 1: scrape degree structures to discover all paper codes
  console.log('\n=== Step 1: Scraping degree structures ===')
  const degrees = await scrapeDegrees()
  await fse.writeJson(path.join(OUTPUT_DIR, 'degrees.json'), degrees, { spaces: 2 })
  console.log(`Saved ${degrees.length} degrees`)

  // Step 2: collect unique paper codes across all degrees
  const allCodes = new Set()
  for (const degree of degrees) {
    for (const paper of degree.papers) {
      allCodes.add(paper.code)
    }
  }
  console.log(`\nDiscovered ${allCodes.size} unique paper codes`)

  // Step 3: scrape individual paper pages
  console.log('\n=== Step 2: Scraping individual papers ===')
  const papers = await scrapePapers(Array.from(allCodes), { concurrency: 3 })
  await fse.writeJson(path.join(OUTPUT_DIR, 'papers.json'), papers, { spaces: 2 })
  console.log(`Saved ${papers.length} papers`)

  // Step 4: cross-reference: for each paper's prereqs, make sure we have the paper data
  const missingCodes = new Set()
  for (const paper of papers) {
    for (const code of [...paper.prerequisites, ...paper.corequisites]) {
      if (!allCodes.has(code)) missingCodes.add(code)
    }
  }

  if (missingCodes.size > 0) {
    console.log(`\n=== Step 3: Scraping ${missingCodes.size} additional prerequisite papers ===`)
    const extraPapers = await scrapePapers(Array.from(missingCodes), { concurrency: 3 })
    papers.push(...extraPapers)
    await fse.writeJson(path.join(OUTPUT_DIR, 'papers.json'), papers, { spaces: 2 })
    console.log(`Total papers now: ${papers.length}`)
  }

  console.log('\nScraping complete. Files saved to:', OUTPUT_DIR)

  await closeBrowser()
}

main().catch((err) => {
  console.error('Fatal scraper error:', err)
  process.exit(1)
})
