const { query } = require('./index')
const { buildGraph } = require('../utils/graph')

async function getGraphData(degreeId) {
  const papersResult = await query(
    `SELECT p.code, p.title, p.points, p.department, p.semesters,
            dp.role, dp.elective_group
     FROM degree_papers dp
     JOIN papers p ON p.code = dp.paper_code
     WHERE dp.degree_id = $1`,
    [degreeId],
  )

  const prereqsResult = await query(
    `SELECT pr.paper_code, pr.requires_code, pr.type
     FROM prerequisites pr
     WHERE pr.paper_code  IN (SELECT paper_code FROM degree_papers WHERE degree_id = $1)
       AND pr.requires_code IN (SELECT paper_code FROM degree_papers WHERE degree_id = $1)`,
    [degreeId],
  )

  const papers = papersResult.rows
  const prereqs = prereqsResult.rows

  return buildGraph(papers, prereqs)
}

module.exports = { getGraphData }
