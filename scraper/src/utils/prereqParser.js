'use strict'

const PAPER_CODE_RE = /\b([A-Z]{3,8}\d{3}[A-Z]?)\b/g

function extractCodes(text) {
  const codes = []
  const re = new RegExp(PAPER_CODE_RE.source, 'g')
  let m
  while ((m = re.exec(text)) !== null) codes.push(m[1])
  return [...new Set(codes)]
}

/**
 * Split text on top-level " and " — i.e. not inside parentheses.
 * Returns an array of string segments.
 */
function splitTopLevelAnd(text) {
  const segments = []
  let depth = 0
  let current = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '(') { depth++; current += text[i++]; continue }
    if (text[i] === ')') { depth--; current += text[i++]; continue }
    // Look for " and " at depth 0
    if (depth === 0 && text.slice(i, i + 5).toLowerCase() === ' and ') {
      segments.push(current.trim())
      current = ''
      i += 5
      continue
    }
    current += text[i++]
  }
  if (current.trim()) segments.push(current.trim())
  return segments
}

/**
 * Detect whether the text has any top-level " and " that connects paper codes.
 * Avoids splitting on Oxford commas like "A, B, and C" by checking
 * whether the segment before " and " ends with a comma (list continuation).
 */
function hasTopLevelAndBetweenCodes(text) {
  const segments = splitTopLevelAnd(text)
  if (segments.length < 2) return false
  // Only consider it a real AND-split if each segment contains at least one paper code
  return segments.filter(s => extractCodes(s).length > 0).length >= 2
}

/**
 * Parse prerequisite text into prereq_groups (CNF).
 * Returns an array of { codes: string[] } objects.
 */
function parsePrereqGroups(text) {
  if (!text || !text.trim()) return []

  const allCodes = extractCodes(text)
  if (allCodes.length === 0) return []

  // Check for top-level AND connecting distinct code groups
  if (hasTopLevelAndBetweenCodes(text)) {
    const segments = splitTopLevelAnd(text)
    const groups = []
    for (const seg of segments) {
      const codes = extractCodes(seg)
      if (codes.length > 0) groups.push({ codes })
    }
    // Deduplicate groups that are identical
    return groups
  }

  // No top-level AND between codes — all codes are OR alternatives in one group
  return [{ codes: allCodes }]
}

module.exports = { parsePrereqGroups }
