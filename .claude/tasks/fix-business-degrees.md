# Task: Add all BBus degrees

## Steps

### 1 — Scrape all BBus degrees

Use the scraper agent to fix the BBus degree scraping. The current
Format D scraper is only capturing major-specific compulsory papers
and missing the full degree structure.

For BBus-ACC the scraper returned 7 papers but the actual degree has
approximately 24 including:

- Core BBus papers shared across all majors (ACCTN101, ACCTN102,
  ECONS101, STMGT101, MNGMT101 etc)
- Major-specific compulsory papers
- Choice groups (e.g. "Choose one of: FINAN101, MGSYS101, MRKTG101")
- Elective slots (100 Level Elective, 200 Level Elective etc)

Fetch the full planner page for BBus Accounting at:
https://www.waikato.ac.nz/study/qualifications/bachelor-of-business/?subject=ACC&plannerSubject=ACC#degree

Analyse the complete HTML structure including all rows and columns
of the planner table, then update the Format D extractor in
parseDegree.js to capture:

1. All named paper codes across all year rows not just major papers
2. Choice groups stored as OR alternatives
3. Elective slots stored as placeholder nodes with their level and points
4. The shared core papers that appear in every BBus major

Re-scrape all 11 BBus majors after the fix and confirm paper counts
are closer to 20-25 per degree.

### 2 — Seed all

Once scraper confirms all 11 BBus degrees are in scraper/data/degrees.json,
delegate to database agent:
"Remove existing BBus degrees and re-seed all 11 BBus degrees using
npm run seed for each one. Verify row counts in degree_papers on the
Pi after each seed before moving to the next."
