const { query } = require('./index')

async function getAllPapers() {
  const result = await query(
    `SELECT code, title, points, description, department, semesters
     FROM papers
     ORDER BY code`,
  )
  return result.rows
}

async function getPaperByCode(code) {
  const result = await query(
    `SELECT code, title, points, description, department, semesters
     FROM papers
     WHERE code = $1`,
    [code],
  )
  return result.rows[0] ?? null
}

async function getPrerequisitesForPaper(code) {
  const result = await query(
    `SELECT p.paper_code, p.requires_code, p.type,
            r.title AS requires_title, r.points AS requires_points
     FROM prerequisites p
     JOIN papers r ON r.code = p.requires_code
     WHERE p.paper_code = $1`,
    [code],
  )
  return result.rows
}

async function upsertPaper({ code, title, points, description, department, semesters }) {
  const result = await query(
    `INSERT INTO papers (code, title, points, description, department, semesters)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (code) DO UPDATE SET
       title = EXCLUDED.title,
       points = EXCLUDED.points,
       description = EXCLUDED.description,
       department = EXCLUDED.department,
       semesters = EXCLUDED.semesters,
       updated_at = NOW()
     RETURNING *`,
    [code, title, points, description, department, semesters],
  )
  return result.rows[0]
}

async function upsertPrerequisite({ paperCode, requiresCode, type }) {
  const result = await query(
    `INSERT INTO prerequisites (paper_code, requires_code, type)
     VALUES ($1, $2, $3)
     ON CONFLICT (paper_code, requires_code, type) DO NOTHING
     RETURNING *`,
    [paperCode, requiresCode, type],
  )
  return result.rows[0]
}

async function deletePrerequisitesForPaper(paperCode) {
  await query(`DELETE FROM prerequisites WHERE paper_code = $1`, [paperCode])
}

module.exports = {
  getAllPapers,
  getPaperByCode,
  getPrerequisitesForPaper,
  upsertPaper,
  upsertPrerequisite,
  deletePrerequisitesForPaper,
}
