const express = require('express')
const db = require('../db/papers')

const router = express.Router()

// GET /api/papers
router.get('/', async (req, res) => {
  try {
    const papers = await db.getAllPapers()
    res.json(papers)
  } catch (err) {
    console.error('GET /api/papers error', err)
    res.status(500).json({ error: 'Failed to fetch papers' })
  }
})

// GET /api/papers/:code
router.get('/:code', async (req, res) => {
  try {
    const paper = await db.getPaperByCode(req.params.code.toUpperCase())
    if (!paper) {
      return res.status(404).json({ error: 'Paper not found' })
    }
    res.json(paper)
  } catch (err) {
    console.error(`GET /api/papers/${req.params.code} error`, err)
    res.status(500).json({ error: 'Failed to fetch paper' })
  }
})

// GET /api/papers/:code/prerequisites
router.get('/:code/prerequisites', async (req, res) => {
  try {
    const prereqs = await db.getPrerequisitesForPaper(req.params.code.toUpperCase())
    res.json(prereqs)
  } catch (err) {
    console.error(`GET /api/papers/${req.params.code}/prerequisites error`, err)
    res.status(500).json({ error: 'Failed to fetch prerequisites' })
  }
})

module.exports = router
