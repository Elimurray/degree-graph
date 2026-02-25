const { query } = require('./index')

async function createProgress(degreeId) {
  const result = await query(
    `INSERT INTO user_progress (degree_id, completed_papers)
     VALUES ($1, $2)
     RETURNING id, degree_id, completed_papers, created_at`,
    [degreeId, []],
  )
  return result.rows[0]
}

async function getProgress(id) {
  const result = await query(
    `SELECT id, degree_id, completed_papers, created_at
     FROM user_progress
     WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

async function updateProgress(id, completedPapers) {
  const result = await query(
    `UPDATE user_progress
     SET completed_papers = $2
     WHERE id = $1
     RETURNING id, degree_id, completed_papers, created_at`,
    [id, completedPapers],
  )
  return result.rows[0] ?? null
}

async function deleteProgress(id) {
  await query(
    `DELETE FROM user_progress WHERE id = $1`,
    [id],
  )
}

module.exports = { createProgress, getProgress, updateProgress, deleteProgress }
