const express = require('express')
const db = require('../db/degrees')
const graphDb = require('../db/graph')

const router = express.Router()

// GET /api/degrees
router.get('/', async (req, res) => {
  try {
    const degrees = await db.getAllDegrees()
    res.json(degrees)
  } catch (err) {
    console.error('GET /api/degrees error', err)
    res.status(500).json({ error: 'Failed to fetch degrees' })
  }
})

// GET /api/degrees/:id
router.get('/:id', async (req, res) => {
  try {
    const degree = await db.getDegreeById(req.params.id)
    if (!degree) {
      return res.status(404).json({ error: 'Degree not found' })
    }
    res.json(degree)
  } catch (err) {
    console.error(`GET /api/degrees/${req.params.id} error`, err)
    res.status(500).json({ error: 'Failed to fetch degree' })
  }
})

// GET /api/degrees/:id/papers
router.get('/:id/papers', async (req, res) => {
  try {
    const papers = await db.getPapersForDegree(req.params.id)
    res.json(papers)
  } catch (err) {
    console.error(`GET /api/degrees/${req.params.id}/papers error`, err)
    res.status(500).json({ error: 'Failed to fetch degree papers' })
  }
})

// GET /api/degrees/:id/prerequisites
router.get('/:id/prerequisites', async (req, res) => {
  try {
    const prereqs = await db.getPrerequisitesForDegree(req.params.id)
    res.json(prereqs)
  } catch (err) {
    console.error(`GET /api/degrees/${req.params.id}/prerequisites error`, err)
    res.status(500).json({ error: 'Failed to fetch degree prerequisites' })
  }
})

// GET /api/degrees/:id/graph
router.get('/:id/graph', async (req, res) => {
  try {
    const degree = await db.getDegreeById(req.params.id)
    if (!degree) {
      return res.status(404).json({ error: 'Degree not found', code: 'NOT_FOUND' })
    }
    const graph = await graphDb.getGraphData(req.params.id)
    res.json({ degree, ...graph })
  } catch (err) {
    console.error(`GET /api/degrees/${req.params.id}/graph error`, err)
    res.status(500).json({ error: 'Failed to build graph', code: 'GRAPH_FAILED' })
  }
})

module.exports = router
