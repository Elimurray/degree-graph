'use strict';

// db/seed.js — modular, per-degree seed script
//
// Usage:
//   node db/seed.js <degree-code-or-slug>
//
// Examples:
//   node db/seed.js BCompSc
//   node db/seed.js BE-SE
//   node db/seed.js BE-CVL
//
// The argument is matched against the "code" field in degrees.json.
// Matching is case-insensitive and hyphens/spaces are normalised so that
// e.g. "be-se", "BE-SE", and "BE SE" all resolve correctly.
//
// What this script does for the target degree:
//   1. Upserts all papers referenced by the degree
//   1b. Upserts any additional papers that appear only as prereq/coreq targets
//       (required to satisfy the papers FK on the prerequisites table)
//   2. Refreshes prerequisite/corequisite edges for those papers
//      (DELETE existing rows for those paper codes, then re-INSERT)
//   3. Upserts the degree row itself
//   4. Replaces degree_papers for this degree
//      (DELETE existing rows for this degree_id, then re-INSERT)
//
// No other degree's data is touched.
//
// Env vars (loaded from .env at project root):
//   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const path = require('path');
const { Pool } = require(path.resolve(__dirname, '../node_modules/pg'));

const ALL_PAPERS  = require(path.resolve(__dirname, '../scraper/data/papers.json'));
const ALL_DEGREES = require(path.resolve(__dirname, '../scraper/data/degrees.json'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseSlug(str) {
  return str.toLowerCase().replace(/[\s-]+/g, '-');
}

function findDegree(arg) {
  const needle = normaliseSlug(arg);
  return ALL_DEGREES.find(d => normaliseSlug(d.code) === needle);
}

// ---------------------------------------------------------------------------
// DB pool — mirrors server/src/db/index.js
// ---------------------------------------------------------------------------

const pool = new Pool({
  host:                    process.env.PGHOST     || 'pi5.local',
  port:                    parseInt(process.env.PGPORT || '5432', 10),
  user:                    process.env.PGUSER     || 'eli',
  password:                process.env.PGPASSWORD,
  database:                process.env.PGDATABASE || 'degree_graph',
  connectionTimeoutMillis: 10000,
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seed() {
  const arg = process.argv[2];

  if (!arg) {
    const codes = ALL_DEGREES.map(d => d.code).join(', ');
    console.error('Usage: node db/seed.js <degree-code>');
    console.error(`Available codes: ${codes}`);
    process.exit(1);
  }

  const degree = findDegree(arg);

  if (!degree) {
    const codes = ALL_DEGREES.map(d => d.code).join(', ');
    console.error(`No degree found matching "${arg}".`);
    console.error(`Available codes: ${codes}`);
    process.exit(1);
  }

  console.log(`Seeding degree: ${degree.name} (${degree.code})`);
  console.log(`  ${degree.papers.length} papers listed in degrees.json\n`);

  // Build a fast lookup of all papers in papers.json
  const paperMap   = new Map(ALL_PAPERS.map(p => [p.code, p]));
  const validCodes = new Set(ALL_PAPERS.map(p => p.code));

  // Collect the paper codes actually used by this degree (and present in papers.json)
  const degreePaperCodes = degree.papers
    .map(dp => dp.code)
    .filter(code => {
      if (!validCodes.has(code)) {
        console.warn(`  WARNING: paper "${code}" listed in degree but not found in papers.json — will skip`);
        return false;
      }
      return true;
    });

  // Collect all requires_code values referenced in prereq/coreq edges for
  // degree papers that are NOT already in degreePaperCodes.  These must also
  // be upserted into papers before the FK-constrained INSERT in step 2.
  const degreePaperCodeSet = new Set(degreePaperCodes);
  const extraPaperCodes = new Set();

  for (const code of degreePaperCodes) {
    const paper = paperMap.get(code);
    const allReqCodes = [];

    for (const group of (paper.prereq_groups || [])) {
      for (const reqCode of (group.codes || [])) allReqCodes.push(reqCode);
    }
    for (const reqCode of (paper.prerequisites || [])) allReqCodes.push(reqCode);
    for (const reqCode of (paper.corequisites  || [])) allReqCodes.push(reqCode);

    for (const reqCode of allReqCodes) {
      if (!degreePaperCodeSet.has(reqCode) && validCodes.has(reqCode)) {
        extraPaperCodes.add(reqCode);
      }
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // -----------------------------------------------------------------------
    // 1. Upsert papers referenced by this degree
    // -----------------------------------------------------------------------
    console.log(`Upserting ${degreePaperCodes.length} papers...`);
    let papersUpserted = 0;

    for (const code of degreePaperCodes) {
      const paper = paperMap.get(code);

      await client.query(
        `INSERT INTO papers (code, title, points, description, department, semesters)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET
           title       = EXCLUDED.title,
           points      = EXCLUDED.points,
           description = EXCLUDED.description,
           department  = EXCLUDED.department,
           semesters   = EXCLUDED.semesters,
           updated_at  = NOW()`,
        [
          paper.code,
          paper.title,
          paper.points       ?? 15,
          paper.description  || null,
          paper.department   || null,
          paper.semesters    || [],
        ]
      );
      papersUpserted++;
    }
    console.log(`  -> ${papersUpserted} paper rows upserted`);

    // -----------------------------------------------------------------------
    // 1b. Upsert any additional papers that appear only as prereq/coreq targets
    //     These are not part of the degree's paper list but must exist in the
    //     papers table before the FK-constrained INSERT in step 2.
    // -----------------------------------------------------------------------
    if (extraPaperCodes.size > 0) {
      console.log(`\nUpserting ${extraPaperCodes.size} extra paper(s) referenced only as prereq/coreq targets...`);
      let extraUpserted = 0;

      for (const code of extraPaperCodes) {
        const paper = paperMap.get(code);

        await client.query(
          `INSERT INTO papers (code, title, points, description, department, semesters)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (code) DO NOTHING`,
          [
            paper.code,
            paper.title,
            paper.points       ?? 15,
            paper.description  || null,
            paper.department   || null,
            paper.semesters    || [],
          ]
        );
        extraUpserted++;
      }
      console.log(`  -> ${extraUpserted} extra paper row(s) upserted`);
    }

    // -----------------------------------------------------------------------
    // 2. Refresh prerequisite / corequisite edges for this degree's papers
    //    Delete all existing rows for these paper codes, then re-insert.
    //    Only reference codes present in papers.json to preserve FK integrity.
    // -----------------------------------------------------------------------
    const deleteResult = await client.query(
      'DELETE FROM prerequisites WHERE paper_code = ANY($1::text[])',
      [degreePaperCodes]
    );
    console.log(`\nPrerequisites: deleted ${deleteResult.rowCount} existing edge(s) for these papers`);

    let prereqsInserted = 0;
    let prereqsSkipped  = 0;

    for (const code of degreePaperCodes) {
      const paper        = paperMap.get(code);
      const prereqGroups = paper.prereq_groups || [];

      if (prereqGroups.length > 0) {
        // Structured prereq_groups — CNF encoding:
        //   same group_index = OR alternatives, different group_index = AND requirements
        for (let gi = 0; gi < prereqGroups.length; gi++) {
          for (const reqCode of (prereqGroups[gi].codes || [])) {
            if (!validCodes.has(reqCode)) { prereqsSkipped++; continue; }
            await client.query(
              `INSERT INTO prerequisites (paper_code, requires_code, type, group_index)
               VALUES ($1, $2, 'pre', $3)
               ON CONFLICT (paper_code, requires_code, type) DO NOTHING`,
              [code, reqCode, gi]
            );
            prereqsInserted++;
          }
        }
      } else if ((paper.prerequisites || []).length > 0) {
        // Fallback: flat prerequisites array — all in group_index 0
        for (const reqCode of paper.prerequisites) {
          if (!validCodes.has(reqCode)) { prereqsSkipped++; continue; }
          await client.query(
            `INSERT INTO prerequisites (paper_code, requires_code, type, group_index)
             VALUES ($1, $2, 'pre', 0)
             ON CONFLICT (paper_code, requires_code, type) DO NOTHING`,
            [code, reqCode]
          );
          prereqsInserted++;
        }
      }

      // Corequisites always use group_index 0
      for (const reqCode of (paper.corequisites || [])) {
        if (!validCodes.has(reqCode)) { prereqsSkipped++; continue; }
        await client.query(
          `INSERT INTO prerequisites (paper_code, requires_code, type, group_index)
           VALUES ($1, $2, 'co', 0)
           ON CONFLICT (paper_code, requires_code, type) DO NOTHING`,
          [code, reqCode]
        );
        prereqsInserted++;
      }
    }

    console.log(`  -> ${prereqsInserted} edge(s) inserted`);
    if (prereqsSkipped > 0) {
      console.log(`  -> ${prereqsSkipped} edge(s) skipped (requires_code not in papers.json)`);
    }

    // -----------------------------------------------------------------------
    // 3. Upsert the degree row
    // -----------------------------------------------------------------------
    console.log(`\nUpserting degree row for ${degree.code}...`);
    await client.query(
      `INSERT INTO degrees (name, code, total_points)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET
         name         = EXCLUDED.name,
         total_points = EXCLUDED.total_points`,
      [
        degree.name,
        degree.code,
        degree.total_points || 360,
      ]
    );

    const { rows: degreeRows } = await client.query(
      'SELECT id FROM degrees WHERE code = $1',
      [degree.code]
    );
    if (degreeRows.length === 0) {
      throw new Error(`Degree row for "${degree.code}" missing after upsert — aborting`);
    }
    const degreeId = degreeRows[0].id;
    console.log(`  -> degree id = ${degreeId}`);

    // -----------------------------------------------------------------------
    // 4. Replace degree_papers for this degree
    //    Delete all existing rows for this degree_id, then re-insert fresh.
    // -----------------------------------------------------------------------
    const dpDeleteResult = await client.query(
      'DELETE FROM degree_papers WHERE degree_id = $1',
      [degreeId]
    );
    console.log(`\nDegree papers: deleted ${dpDeleteResult.rowCount} existing row(s) for degree_id=${degreeId}`);

    let dpInserted = 0;
    let dpSkipped  = 0;

    for (const dp of degree.papers) {
      if (!validCodes.has(dp.code)) {
        dpSkipped++;
        continue;
      }
      await client.query(
        `INSERT INTO degree_papers (degree_id, paper_code, role, elective_group)
         VALUES ($1, $2, $3, $4)`,
        [
          degreeId,
          dp.code,
          dp.role,
          dp.elective_group || dp.electiveGroup || null,
        ]
      );
      dpInserted++;
    }

    console.log(`  -> ${dpInserted} degree_paper row(s) inserted`);
    if (dpSkipped > 0) {
      console.log(`  -> ${dpSkipped} row(s) skipped (paper code not in papers.json)`);
    }

    // -----------------------------------------------------------------------
    // Commit
    // -----------------------------------------------------------------------
    await client.query('COMMIT');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nSeed failed — transaction rolled back.');
    throw err;
  } finally {
    client.release();
  }

  // -----------------------------------------------------------------------
  // Verification counts (outside transaction, best-effort)
  // -----------------------------------------------------------------------
  try {
    const { rows: pc } = await pool.query('SELECT COUNT(*) FROM papers');
    const { rows: rc } = await pool.query('SELECT COUNT(*) FROM prerequisites');
    const { rows: dc } = await pool.query(
      `SELECT COUNT(dp.paper_code) AS cnt
       FROM degree_papers dp
       WHERE dp.degree_id = (SELECT id FROM degrees WHERE code = $1)`,
      [degree.code]
    );

    console.log('\nVerification:');
    console.log(`  papers total:           ${pc[0].count}`);
    console.log(`  prerequisites total:    ${rc[0].count}`);
    console.log(`  ${degree.code} papers:  ${dc[0].cnt}`);
    console.log('\nSeed complete.');
  } finally {
    await pool.end();
  }
}

seed().catch(err => {
  console.error(err.message);
  process.exit(1);
});
