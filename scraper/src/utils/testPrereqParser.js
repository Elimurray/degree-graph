'use strict'

const { parsePrereqGroups } = require('./prereqParser')

function arraysEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function groupsEqual(actual, expected) {
  if (actual.length !== expected.length) return false
  for (let i = 0; i < actual.length; i++) {
    const aCodes = [...actual[i].codes].sort()
    const eCodes = [...expected[i].codes].sort()
    if (!arraysEqual(aCodes, eCodes)) return false
  }
  return true
}

const cases = [
  {
    input: 'COMPX102',
    expected: [{ codes: ['COMPX102'] }],
    label: 'Single code'
  },
  {
    input: 'MATHS135 or MATHS202 or COMPX201 or COMPX241',
    expected: [{ codes: ['MATHS135', 'MATHS202', 'COMPX201', 'COMPX241'] }],
    label: 'OR list'
  },
  {
    input: 'COMPX102 and (ENGEN102 or MATHS104)',
    expected: [{ codes: ['COMPX102'] }, { codes: ['ENGEN102', 'MATHS104'] }],
    label: 'AND of code and OR group'
  },
  {
    input: 'MATHS135 and one of COMPX201, COMPX202, COMPX241, or COMPX242',
    expected: [{ codes: ['MATHS135'] }, { codes: ['COMPX201', 'COMPX202', 'COMPX241', 'COMPX242'] }],
    label: 'AND with "one of" list'
  },
  {
    input: 'One of COMPX101, COMP103, ENGEN103, or ENGG182',
    expected: [{ codes: ['COMPX101', 'COMP103', 'ENGEN103', 'ENGG182'] }],
    label: '"One of" list only (no AND)'
  },
  {
    input: 'This paper requires previous knowledge of programming and cybersecurity, therefore (COMPX201 or COMPX241) and COMPX235.',
    expected: [{ codes: ['COMPX201', 'COMPX241'] }, { codes: ['COMPX235'] }],
    label: 'COMPX309: prose prefix with AND groups'
  }
]

let passed = 0
let failed = 0

for (const { input, expected, label } of cases) {
  const actual = parsePrereqGroups(input)
  const ok = groupsEqual(actual, expected)
  if (ok) {
    console.log(`PASS  ${label}`)
    passed++
  } else {
    console.log(`FAIL  ${label}`)
    console.log(`  input:    ${input}`)
    console.log(`  expected: ${JSON.stringify(expected)}`)
    console.log(`  actual:   ${JSON.stringify(actual)}`)
    failed++
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
