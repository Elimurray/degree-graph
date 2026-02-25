'use strict';

// seed-new.js — additive-only seed script
// Inserts new papers, prerequisites, degrees, and degree_papers without
// touching or wiping any existing rows.  All inserts use ON CONFLICT DO NOTHING.
//
// Usage: node db/seed-new.js   (run from project root)
// Env: .env at project root must contain PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
//
// Prerequisites PK is (paper_code, requires_code, type) — group_index is NOT part of the PK.
// degrees.total_points is NOT NULL with a column default of 360; fall back to 360 when absent.

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const path   = require('path');
const { Pool } = require(path.resolve(__dirname, '../node_modules/pg'));

const papers  = require(path.resolve(__dirname, '../scraper/data/papers.json'));
const degrees = require(path.resolve(__dirname, '../scraper/data/degrees.json'));

const pool = new Pool({
  host:     process.env.PGHOST     || '192.168.1.11',
  port:     parseInt(process.env.PGPORT || '5432', 10),
  user:     process.env.PGUSER     || 'eli',
  password: process.env.PGPASSWORD || 'password',
  database: process.env.PGDATABASE || 'degree_graph',
});

async function seedNew() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // -----------------------------------------------------------------
    // 1. Insert papers — skip any that already exist (DO NOTHING)
    // -----------------------------------------------------------------
    console.log(`Inserting up to ${papers.length} papers (skipping existing)...`);

    let papersInserted = 0;

    for (const paper of papers) {
      const result = await client.query(
        `INSERT INTO papers (code, title, points, description, department, semesters)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO NOTHING`,
        [
          paper.code,
          paper.title,
          paper.points,
          paper.description || null,
          paper.department  || null,
          paper.semesters   || [],
        ]
      );
      papersInserted += result.rowCount;
    }

    console.log(`  -> ${papersInserted} new paper rows inserted (${papers.length - papersInserted} already existed)`);

    // -----------------------------------------------------------------
    // 2. Insert prerequisites / corequisites — skip existing rows
    //    PK is (paper_code, requires_code, type) — group_index is NOT part of PK.
    //    Only reference codes present in the papers.json set.
    // -----------------------------------------------------------------
    const validCodes = new Set(papers.map(p => p.code));

    let prereqsInserted = 0;
    let prereqsSkipped  = 0;

    for (const paper of papers) {
      const prereqGroups = paper.prereq_groups || [];

      if (prereqGroups.length > 0) {
        for (let gi = 0; gi < prereqGroups.length; gi++) {
          for (const reqCode of (prereqGroups[gi].codes || [])) {
            if (!validCodes.has(reqCode)) {
              prereqsSkipped++;
              continue;
            }
            const result = await client.query(
              `INSERT INTO prerequisites (paper_code, requires_code, type, group_index)
               VALUES ($1, $2, 'pre', $3)
               ON CONFLICT (paper_code, requires_code, type) DO NOTHING`,
              [paper.code, reqCode, gi]
            );
            prereqsInserted += result.rowCount;
          }
        }
      } else if ((paper.prerequisites || []).length > 0) {
        // Fallback: flat prerequisites array — insert at group_index 0
        for (const reqCode of paper.prerequisites) {
          if (!validCodes.has(reqCode)) {
            prereqsSkipped++;
            continue;
          }
          const result = await client.query(
            `INSERT INTO prerequisites (paper_code, requires_code, type, group_index)
             VALUES ($1, $2, 'pre', 0)
             ON CONFLICT (paper_code, requires_code, type) DO NOTHING`,
            [paper.code, reqCode]
          );
          prereqsInserted += result.rowCount;
        }
      }

      // Corequisites always use group_index 0
      for (const reqCode of (paper.corequisites || [])) {
        if (!validCodes.has(reqCode)) {
          prereqsSkipped++;
          continue;
        }
        const result = await client.query(
          `INSERT INTO prerequisites (paper_code, requires_code, type, group_index)
           VALUES ($1, $2, 'co', 0)
           ON CONFLICT (paper_code, requires_code, type) DO NOTHING`,
          [paper.code, reqCode]
        );
        prereqsInserted += result.rowCount;
      }
    }

    console.log(`  -> ${prereqsInserted} new prerequisite/corequisite edges inserted`);
    if (prereqsSkipped > 0) {
      console.log(`  -> ${prereqsSkipped} edges skipped (requires_code not found in papers.json)`);
    }

    // -----------------------------------------------------------------
    // 3. Insert degrees — skip existing; then resolve the id (existing or new)
    //    total_points is NOT NULL with DB default 360; use 360 as JS fallback too.
    // -----------------------------------------------------------------
    console.log(`\nInserting up to ${degrees.length} degrees (skipping existing)...`);

    let degreesInserted = 0;

    // Build a map of degree.code -> id for use in degree_papers
    const degreeIdMap = new Map();

    for (const degree of degrees) {
      // Try insert; if it already exists this does nothing
      await client.query(
        `INSERT INTO degrees (name, code, total_points)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING`,
        [
          degree.name,
          degree.code,
          degree.total_points || 360,
        ]
      );

      // Always SELECT the id (whether just inserted or pre-existing)
      const { rows } = await client.query(
        'SELECT id FROM degrees WHERE code = $1',
        [degree.code]
      );

      if (rows.length === 0) {
        console.warn(`  WARNING: Could not resolve id for degree "${degree.code}" — skipping its papers`);
        continue;
      }

      degreeIdMap.set(degree.code, rows[0].id);
      degreesInserted++;
    }

    console.log(`  -> ${degreesInserted} degrees resolved (inserted or already existed)`);

    // -----------------------------------------------------------------
    // 4. Insert degree_papers — skip existing rows
    // -----------------------------------------------------------------
    let degreePapersInserted = 0;
    let degreePapersSkipped  = 0;

    for (const degree of degrees) {
      const degreeId = degreeIdMap.get(degree.code);
      if (degreeId === undefined) continue;

      console.log(`Inserting degree_papers for ${degree.code} (id=${degreeId}), ${degree.papers.length} papers...`);

      for (const dp of degree.papers) {
        if (!validCodes.has(dp.code)) {
          degreePapersSkipped++;
          continue;
        }

        const result = await client.query(
          `INSERT INTO degree_papers (degree_id, paper_code, role, elective_group)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (degree_id, paper_code) DO NOTHING`,
          [
            degreeId,
            dp.code,
            dp.role,
            dp.electiveGroup || null,
          ]
        );
        degreePapersInserted += result.rowCount;
      }
    }

    console.log(`  -> ${degreePapersInserted} new degree_paper rows inserted`);
    if (degreePapersSkipped > 0) {
      console.log(`  -> ${degreePapersSkipped} degree_paper rows skipped (paper code not in papers.json)`);
    }

    // -----------------------------------------------------------------
    // Commit
    // -----------------------------------------------------------------
    await client.query('COMMIT');
    console.log('\nSeed-new complete — all new rows inserted, existing rows untouched.');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed-new failed — transaction rolled back.');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seedNew().catch(err => {
  console.error(err.message);
  process.exit(1);
});
