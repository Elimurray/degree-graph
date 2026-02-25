'use strict';

// db/migrate.js — modular, safe-to-rerun migration runner
//
// Usage: node db/migrate.js
//
// Reads all .sql files from db/migrations/ sorted by filename, checks which
// have already been recorded in schema_migrations, and runs only the new ones.
//
// Env vars (loaded from .env at project root):
//   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const { Pool } = require(path.resolve(__dirname, '../node_modules/pg'));

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

const pool = new Pool({
  host:                   process.env.PGHOST     || 'pi5.local',
  port:                   parseInt(process.env.PGPORT || '5432', 10),
  user:                   process.env.PGUSER     || 'eli',
  password:               process.env.PGPASSWORD,
  database:               process.env.PGDATABASE || 'degree_graph',
  connectionTimeoutMillis: 10000,
});

async function migrate() {
  const client = await pool.connect();

  try {
    // ------------------------------------------------------------------
    // 1. Ensure the schema_migrations tracking table exists
    // ------------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT        PRIMARY KEY,
        run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ------------------------------------------------------------------
    // 2. Read migration filenames sorted alphabetically
    // ------------------------------------------------------------------
    const allFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (allFiles.length === 0) {
      console.log('No migration files found in db/migrations/');
      return;
    }

    // ------------------------------------------------------------------
    // 3. Fetch already-applied migrations
    // ------------------------------------------------------------------
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map(r => r.filename));

    const pending = allFiles.filter(f => !applied.has(f));
    const skipped = allFiles.filter(f => applied.has(f));

    if (skipped.length > 0) {
      console.log(`Skipping ${skipped.length} already-applied migration(s):`);
      for (const f of skipped) {
        console.log(`  [skipped] ${f}`);
      }
    }

    if (pending.length === 0) {
      console.log('\nAll migrations are already up to date.');
      return;
    }

    console.log(`\nRunning ${pending.length} pending migration(s):`);

    // ------------------------------------------------------------------
    // 4. Run each pending migration inside its own transaction, then
    //    record it in schema_migrations
    // ------------------------------------------------------------------
    for (const filename of pending) {
      const filePath = path.join(MIGRATIONS_DIR, filename);
      const sql      = fs.readFileSync(filePath, 'utf8');

      // Each migration file wraps its own BEGIN/COMMIT; run it as-is.
      // We wrap the tracking insert separately so a failure is obvious.
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        );
        console.log(`  [applied]  ${filename}`);
      } catch (err) {
        console.error(`  [FAILED]   ${filename}`);
        console.error(`             ${err.message}`);
        throw err;
      }
    }

    console.log('\nMigrations complete.');

  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('\nMigration runner failed:', err.message);
  process.exit(1);
});
