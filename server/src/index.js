require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') })
const express = require('express')
const cors = require('cors')

const papersRouter = require('./routes/papers')
const degreesRouter = require('./routes/degrees')
const progressRouter = require('./routes/progress')

const app = express()
const PORT = process.env.PORT || 3002

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
}))
app.use(express.json())

app.use('/api/papers', papersRouter)
app.use('/api/degrees', degreesRouter)
app.use('/api/progress', progressRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})
