'use strict';

// Seed script: imports scraper/data/papers.json and scraper/data/degrees.json
// into the degree_graph PostgreSQL database.
//
// Usage: node db/seed.js
// Requires: pg available at root node_modules/pg
// Env vars: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
//   (defaults: pi5.local, 5432, eli, password, degree_graph)

const path = require('path');
const { Pool } = require(path.resolve(__dirname, '../node_modules/pg'));

const papers  = require(path.resolve(__dirname, '../scraper/data/papers.json'));
const degrees = require(path.resolve(__dirname, '../scraper/data/degrees.json'));

const pool = new Pool({
  host:     process.env.PGHOST     || 'pi5.local',
  port:     parseInt(process.env.PGPORT || '5432', 10),
  user:     process.env.PGUSER     || 'eli',
  password: process.env.PGPASSWORD || 'password',
  database: process.env.PGDATABASE || 'degree_graph',
});

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // -----------------------------------------------------------------
    // 1. Insert papers
    // -----------------------------------------------------------------
    console.log(`Inserting ${papers.length} papers...`);

    let papersInserted = 0;
    for (const paper of papers) {
      const result = await client.query(
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
          paper.points,
          paper.description || null,
          paper.department  || null,
          paper.semesters   || [],
        ]
      );
      papersInserted += result.rowCount;
    }
    console.log(`  -> ${papersInserted} paper rows upserted`);

    // -----------------------------------------------------------------
    // 2. Insert prerequisites / corequisites
    //    Only insert edges where both ends exist in papers.json
    // -----------------------------------------------------------------
    const validCodes = new Set(papers.map(p => p.code));

    let prereqsInserted = 0;
    let prereqsSkipped  = 0;

    for (const paper of papers) {
      // Prerequisites (type = 'pre')
      for (const reqCode of (paper.prerequisites || [])) {
        if (!validCodes.has(reqCode)) {
          prereqsSkipped++;
          continue;
        }
        const result = await client.query(
          `INSERT INTO prerequisites (paper_code, requires_code, type)
           VALUES ($1, $2, 'pre')
           ON CONFLICT DO NOTHING`,
          [paper.code, reqCode]
        );
        prereqsInserted += result.rowCount;
      }

      // Corequisites (type = 'co')
      for (const reqCode of (paper.corequisites || [])) {
        if (!validCodes.has(reqCode)) {
          prereqsSkipped++;
          continue;
        }
        const result = await client.query(
          `INSERT INTO prerequisites (paper_code, requires_code, type)
           VALUES ($1, $2, 'co')
           ON CONFLICT DO NOTHING`,
          [paper.code, reqCode]
        );
        prereqsInserted += result.rowCount;
      }
    }

    console.log(`  -> ${prereqsInserted} prerequisite/corequisite edges inserted`);
    if (prereqsSkipped > 0) {
      console.log(`  -> ${prereqsSkipped} edges skipped (referenced code not in papers.json)`);
    }

    // -----------------------------------------------------------------
    // 3. Insert degree_papers
    //    Look up each degree by code; only insert if paper code is valid
    // -----------------------------------------------------------------
    let degreePapersInserted = 0;
    let degreePapersSkipped  = 0;

    for (const degree of degrees) {
      const { rows } = await client.query(
        'SELECT id FROM degrees WHERE code = $1',
        [degree.code]
      );

      if (rows.length === 0) {
        console.warn(`  WARNING: degree code "${degree.code}" not found in degrees table — skipping`);
        continue;
      }

      const degreeId = rows[0].id;
      console.log(`Inserting degree_papers for ${degree.code} (id=${degreeId}), ${degree.papers.length} papers...`);

      for (const dp of degree.papers) {
        if (!validCodes.has(dp.code)) {
          degreePapersSkipped++;
          continue;
        }

        const result = await client.query(
          `INSERT INTO degree_papers (degree_id, paper_code, role, elective_group)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (degree_id, paper_code) DO UPDATE SET
             role          = EXCLUDED.role,
             elective_group = EXCLUDED.elective_group`,
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

    console.log(`  -> ${degreePapersInserted} degree_paper rows upserted`);
    if (degreePapersSkipped > 0) {
      console.log(`  -> ${degreePapersSkipped} degree_paper rows skipped (paper code not in papers.json)`);
    }

    // -----------------------------------------------------------------
    // Commit
    // -----------------------------------------------------------------
    await client.query('COMMIT');
    console.log('\nSeed complete.');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed — transaction rolled back.');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error(err.message);
  process.exit(1);
});
