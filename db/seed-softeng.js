'use strict';

// Seed script: re-seeds the Bachelor of Software Engineering degree (BSoftEng)
// using scraper/data/papers.json and scraper/data/degrees.json.
//
// Usage: node db/seed-softeng.js
//
// Strategy:
//   - All 259 papers are upserted (ON CONFLICT DO UPDATE)
//   - Prerequisites are DELETE + re-INSERT for BSoftEng paper codes only
//   - BSoftEng degree row is upserted
//   - degree_papers for BSoftEng are DELETE + re-INSERT

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const path = require('path');
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

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // -----------------------------------------------------------------
    // 1. Upsert all 259 papers
    // -----------------------------------------------------------------
    console.log(`Upserting ${papers.length} papers...`);

    let papersUpserted = 0;
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
      papersUpserted += result.rowCount;
    }
    console.log(`  -> ${papersUpserted} paper rows upserted`);

    // -----------------------------------------------------------------
    // 2. Prerequisites — BSoftEng papers only
    //    DELETE existing rows for these paper codes, then re-INSERT
    // -----------------------------------------------------------------
    const bsofteng = degrees.find(d => d.code === 'BSoftEng');
    if (!bsofteng) throw new Error('BSoftEng entry not found in degrees.json');

    const validCodes = new Set(papers.map(p => p.code));

    // Collect the set of paper codes that belong to BSoftEng
    const bsoftengCodes = bsofteng.papers
      .map(dp => dp.code)
      .filter(code => validCodes.has(code));

    console.log(`\nDeleting existing prerequisites for ${bsoftengCodes.length} BSoftEng paper codes...`);
    const deleteResult = await client.query(
      `DELETE FROM prerequisites WHERE paper_code = ANY($1::text[])`,
      [bsoftengCodes]
    );
    console.log(`  -> ${deleteResult.rowCount} prerequisite rows deleted`);

    // Build a lookup map: paper code -> paper object for fast access
    const paperMap = new Map(papers.map(p => [p.code, p]));

    let prereqsInserted = 0;
    let prereqsSkipped  = 0;

    for (const code of bsoftengCodes) {
      const paper = paperMap.get(code);
      if (!paper) continue;

      const prereqGroups = paper.prereq_groups || [];

      if (prereqGroups.length > 0) {
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
        // Fallback: flat prerequisites array with no group structure
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

      // Corequisites — always group_index 0
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

    console.log(`  -> ${prereqsInserted} prerequisite/corequisite edges inserted`);
    if (prereqsSkipped > 0) {
      console.log(`  -> ${prereqsSkipped} edges skipped (requires_code not in papers.json)`);
    }

    // -----------------------------------------------------------------
    // 3. Upsert the BSoftEng degree row, then fetch its id
    // -----------------------------------------------------------------
    console.log('\nUpserting BSoftEng degree row...');
    await client.query(
      `INSERT INTO degrees (name, code, total_points)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET
         name         = EXCLUDED.name,
         total_points = EXCLUDED.total_points`,
      ['Bachelor of Software Engineering', 'BSoftEng', 480]
    );

    const { rows: degreeRows } = await client.query(
      'SELECT id FROM degrees WHERE code = $1',
      ['BSoftEng']
    );
    if (degreeRows.length === 0) throw new Error('BSoftEng degree row missing after upsert');
    const degreeId = degreeRows[0].id;
    console.log(`  -> BSoftEng degree id = ${degreeId}`);

    // -----------------------------------------------------------------
    // 4. degree_papers — DELETE existing rows for BSoftEng, re-INSERT
    // -----------------------------------------------------------------
    console.log(`\nDeleting existing degree_papers for degree_id=${degreeId}...`);
    const dpDeleteResult = await client.query(
      'DELETE FROM degree_papers WHERE degree_id = $1',
      [degreeId]
    );
    console.log(`  -> ${dpDeleteResult.rowCount} degree_papers rows deleted`);

    let dpInserted = 0;
    let dpSkipped  = 0;

    for (const dp of bsofteng.papers) {
      if (!validCodes.has(dp.code)) {
        dpSkipped++;
        console.warn(`  WARNING: paper code "${dp.code}" not in papers.json — skipping`);
        continue;
      }
      await client.query(
        `INSERT INTO degree_papers (degree_id, paper_code, role, elective_group)
         VALUES ($1, $2, $3, $4)`,
        [degreeId, dp.code, dp.role, dp.elective_group || null]
      );
      dpInserted++;
    }

    console.log(`  -> ${dpInserted} degree_papers rows inserted`);
    if (dpSkipped > 0) {
      console.log(`  -> ${dpSkipped} degree_papers rows skipped`);
    }

    // -----------------------------------------------------------------
    // Commit
    // -----------------------------------------------------------------
    await client.query('COMMIT');
    console.log('\nSeed complete. Running verification counts...');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed — transaction rolled back.');
    throw err;
  } finally {
    client.release();
  }

  // -----------------------------------------------------------------
  // 5. Verification counts (outside transaction)
  // -----------------------------------------------------------------
  try {
    const { rows: paperCount } = await pool.query('SELECT COUNT(*) FROM papers');
    console.log(`\npapers total:         ${paperCount[0].count}`);

    const { rows: prereqCount } = await pool.query('SELECT COUNT(*) FROM prerequisites');
    console.log(`prerequisites total:  ${prereqCount[0].count}`);

    const { rows: dpCount } = await pool.query(
      `SELECT d.name, COUNT(dp.paper_code) AS paper_count
       FROM degrees d
       JOIN degree_papers dp ON dp.degree_id = d.id
       WHERE d.code = 'BSoftEng'
       GROUP BY d.name`
    );
    if (dpCount.length > 0) {
      console.log(`BSoftEng papers:      ${dpCount[0].paper_count} (${dpCount[0].name})`);
    }
  } finally {
    await pool.end();
  }
}

seed().catch(err => {
  console.error(err.message);
  process.exit(1);
});
