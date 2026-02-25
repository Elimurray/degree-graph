const { query } = require('./index')

async function getAllDegrees() {
  const result = await query(
    `SELECT id, name, code, total_points
     FROM degrees
     ORDER BY name`,
  )
  return result.rows
}

async function getDegreeById(id) {
  const result = await query(
    `SELECT id, name, code, total_points
     FROM degrees
     WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

async function getPapersForDegree(degreeId) {
  const result = await query(
    `SELECT p.code, p.title, p.points, p.description, p.department, p.semesters,
            dp.role, dp.elective_group
     FROM degree_papers dp
     JOIN papers p ON p.code = dp.paper_code
     WHERE dp.degree_id = $1
     ORDER BY p.code`,
    [degreeId],
  )
  return result.rows
}

async function getPrerequisitesForDegree(degreeId) {
  const result = await query(
    `SELECT DISTINCT pr.paper_code, pr.requires_code, pr.type
     FROM prerequisites pr
     WHERE pr.paper_code IN (
       SELECT paper_code FROM degree_papers WHERE degree_id = $1
     )
     AND pr.requires_code IN (
       SELECT paper_code FROM degree_papers WHERE degree_id = $1
     )`,
    [degreeId],
  )
  return result.rows
}

async function upsertDegree({ name, code, totalPoints }) {
  const result = await query(
    `INSERT INTO degrees (name, code, total_points)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       total_points = EXCLUDED.total_points
     RETURNING *`,
    [name, code, totalPoints],
  )
  return result.rows[0]
}

async function upsertDegreePaper({ degreeId, paperCode, role, electiveGroup }) {
  const result = await query(
    `INSERT INTO degree_papers (degree_id, paper_code, role, elective_group)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (degree_id, paper_code) DO UPDATE SET
       role = EXCLUDED.role,
       elective_group = EXCLUDED.elective_group
     RETURNING *`,
    [degreeId, paperCode, role, electiveGroup ?? null],
  )
  return result.rows[0]
}

module.exports = {
  getAllDegrees,
  getDegreeById,
  getPapersForDegree,
  getPrerequisitesForDegree,
  upsertDegree,
  upsertDegreePaper,
}
