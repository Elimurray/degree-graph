const express = require('express')
const db = require('../db/progress')

const router = express.Router()

// POST /api/progress
// body: { degreeId }
router.post('/', async (req, res) => {
  const { degreeId } = req.body
  if (!degreeId) {
    return res.status(400).json({ error: 'degreeId is required', code: 'MISSING_DEGREE_ID' })
  }
  try {
    const progress = await db.createProgress(degreeId)
    res.status(201).json(progress)
  } catch (err) {
    console.error('POST /api/progress error', err)
    res.status(500).json({ error: 'Failed to create progress', code: 'CREATE_FAILED' })
  }
})

// GET /api/progress/:id
router.get('/:id', async (req, res) => {
  try {
    const progress = await db.getProgress(req.params.id)
    if (!progress) {
      return res.status(404).json({ error: 'Progress not found', code: 'NOT_FOUND' })
    }
    res.json(progress)
  } catch (err) {
    console.error(`GET /api/progress/${req.params.id} error`, err)
    res.status(500).json({ error: 'Failed to fetch progress', code: 'FETCH_FAILED' })
  }
})

// PATCH /api/progress/:id
// body: { completedPapers: ['COMPX101', ...] }
router.patch('/:id', async (req, res) => {
  const { completedPapers } = req.body
  if (!Array.isArray(completedPapers)) {
    return res.status(400).json({ error: 'completedPapers must be an array', code: 'INVALID_BODY' })
  }
  try {
    const progress = await db.updateProgress(req.params.id, completedPapers)
    if (!progress) {
      return res.status(404).json({ error: 'Progress not found', code: 'NOT_FOUND' })
    }
    res.json(progress)
  } catch (err) {
    console.error(`PATCH /api/progress/${req.params.id} error`, err)
    res.status(500).json({ error: 'Failed to update progress', code: 'UPDATE_FAILED' })
  }
})

// DELETE /api/progress/:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await db.getProgress(req.params.id)
    if (!existing) {
      return res.status(404).json({ error: 'Progress not found', code: 'NOT_FOUND' })
    }
    await db.deleteProgress(req.params.id)
    res.status(204).end()
  } catch (err) {
    console.error(`DELETE /api/progress/${req.params.id} error`, err)
    res.status(500).json({ error: 'Failed to delete progress', code: 'DELETE_FAILED' })
  }
})

module.exports = router
