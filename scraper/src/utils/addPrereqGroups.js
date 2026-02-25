'use strict'

const path = require('path')
const fse = require('fs-extra')
const { parsePrereqGroups } = require('./prereqParser')

const DATA_PATH = path.resolve(__dirname, '../../data/papers.json')

async function main() {
  const papers = await fse.readJson(DATA_PATH)

  let withGroups = 0
  let withMultipleGroups = 0

  const updated = papers.map(paper => {
    const groups = parsePrereqGroups(paper.prerequisiteText)
    if (groups.length > 0) withGroups++
    if (groups.length > 1) withMultipleGroups++
    return { ...paper, prereq_groups: groups }
  })

  await fse.writeJson(DATA_PATH, updated, { spaces: 2 })

  console.log(`Updated ${updated.length} papers`)
  console.log(`  With prereq_groups: ${withGroups}`)
  console.log(`  With multiple AND groups: ${withMultipleGroups}`)

  // Print a sample of interesting cases
  const interesting = updated.filter(p => p.prereq_groups.length > 1)
  console.log('\nSample AND-group papers:')
  interesting.slice(0, 8).forEach(p => {
    console.log(`  ${p.code}: ${JSON.stringify(p.prereq_groups)}`)
    console.log(`    text: ${p.prerequisiteText}`)
  })
}

main().catch(console.error)
