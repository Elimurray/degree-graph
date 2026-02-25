const { Pool } = require('pg')

const pool = new Pool({
  host: process.env.PGHOST || 'pi5.local',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'eli',
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'degree_graph',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  console.error('Unexpected pg pool error', err)
})

async function query(text, params) {
  const client = await pool.connect()
  try {
    const result = await client.query(text, params)
    return result
  } finally {
    client.release()
  }
}

module.exports = { pool, query }
