const COLUMN_WIDTH = 280
const ROW_HEIGHT = 140

const ROLE_ORDER = { compulsory: 0, elective: 1, specialisation: 2 }

/**
 * Assign topological levels to papers using Kahn's algorithm (BFS).
 * Returns a Map<code, level> where level 0 = no prerequisites within the set.
 * Papers involved in cycles are assigned level = max_assigned_level + 1.
 *
 * @param {string[]} codes - all paper codes in this degree
 * @param {{ paper_code: string, requires_code: string }[]} prereqs - filtered edges
 * @returns {Map<string, number>}
 */
function assignLevels(codes, prereqs) {
  const codeSet = new Set(codes)

  // Build adjacency: requires_code -> [paper_code] (i.e. "this paper unlocks these")
  const dependents = new Map()
  const inDegree = new Map()

  for (const code of codes) {
    dependents.set(code, [])
    inDegree.set(code, 0)
  }

  for (const { paper_code, requires_code } of prereqs) {
    // Only consider edges where both ends are in the set
    if (!codeSet.has(paper_code) || !codeSet.has(requires_code)) continue
    dependents.get(requires_code).push(paper_code)
    inDegree.set(paper_code, (inDegree.get(paper_code) ?? 0) + 1)
  }

  const levels = new Map()
  const queue = []

  // Seed with zero in-degree nodes
  for (const code of codes) {
    if (inDegree.get(code) === 0) {
      queue.push(code)
      levels.set(code, 0)
    }
  }

  let head = 0
  while (head < queue.length) {
    const current = queue[head++]
    const currentLevel = levels.get(current)

    for (const dep of dependents.get(current)) {
      const proposed = currentLevel + 1
      if (!levels.has(dep) || levels.get(dep) < proposed) {
        levels.set(dep, proposed)
      }
      inDegree.set(dep, inDegree.get(dep) - 1)
      if (inDegree.get(dep) === 0) {
        queue.push(dep)
      }
    }
  }

  // Handle any remaining nodes (cycles) by placing them after the deepest level
  const maxLevel = levels.size > 0 ? Math.max(...levels.values()) : 0
  let cycleLevel = maxLevel + 1
  for (const code of codes) {
    if (!levels.has(code)) {
      levels.set(code, cycleLevel)
    }
  }

  return levels
}

/**
 * Build React Flow nodes and edges from raw degree data.
 *
 * @param {{ code: string, title: string, points: number, department: string, semesters: string[], role: string, elective_group: string|null }[]} papers
 * @param {{ paper_code: string, requires_code: string, type: string }[]} prereqs
 * @returns {{ nodes: object[], edges: object[] }}
 */
function buildGraph(papers, prereqs) {
  const codes = papers.map((p) => p.code)
  const levels = assignLevels(codes, prereqs)

  // Group papers by level for y-position assignment
  const byLevel = new Map()
  for (const paper of papers) {
    const level = levels.get(paper.code) ?? 0
    if (!byLevel.has(level)) byLevel.set(level, [])
    byLevel.get(level).push(paper)
  }

  // Sort within each level: compulsory first, then elective by group, then by code
  for (const group of byLevel.values()) {
    group.sort((a, b) => {
      const roleA = ROLE_ORDER[a.role] ?? 99
      const roleB = ROLE_ORDER[b.role] ?? 99
      if (roleA !== roleB) return roleA - roleB
      if (a.elective_group !== b.elective_group) {
        if (a.elective_group == null) return 1
        if (b.elective_group == null) return -1
        return a.elective_group.localeCompare(b.elective_group)
      }
      return a.code.localeCompare(b.code)
    })
  }

  // Build nodes
  const nodes = []
  for (const paper of papers) {
    const level = levels.get(paper.code) ?? 0
    const group = byLevel.get(level)
    const indexInLevel = group.findIndex((p) => p.code === paper.code)

    nodes.push({
      id: paper.code,
      type: 'paper',
      position: {
        x: level * COLUMN_WIDTH,
        y: indexInLevel * ROW_HEIGHT,
      },
      data: {
        code: paper.code,
        title: paper.title,
        points: paper.points,
        role: paper.role,
        electiveGroup: paper.elective_group ?? null,
        semesters: paper.semesters ?? [],
        department: paper.department,
      },
    })
  }

  // Build edges — only for prereqs where both ends exist in this degree
  const codeSet = new Set(codes)
  const edges = []
  for (const { paper_code, requires_code, type, group_index } of prereqs) {
    if (!codeSet.has(paper_code) || !codeSet.has(requires_code)) continue
    edges.push({
      id: `e-${requires_code}-${paper_code}-g${group_index ?? 0}`,
      source: requires_code,
      target: paper_code,
      type: 'smoothstep',
      animated: type === 'co',
      data: { prereqType: type, groupIndex: group_index ?? 0 },
    })
  }

  return { nodes, edges }
}

module.exports = { buildGraph }
