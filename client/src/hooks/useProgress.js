import { useState, useEffect } from 'react'

export function useProgress(degreeId) {
  const [progressId, setProgressId] = useState(null)
  const [completedPapers, setCompletedPapers] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!degreeId) return

    setProgressId(null)
    setCompletedPapers([])

    async function createSession() {
      setLoading(true)
      try {
        const response = await fetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ degreeId }),
        })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        const data = await response.json()
        setProgressId(data.id)
        setCompletedPapers(data.completed_papers ?? [])
      } catch (err) {
        console.error('Failed to create progress session:', err.message)
      } finally {
        setLoading(false)
      }
    }

    createSession()
  }, [degreeId])

  async function togglePaper(code) {
    if (!progressId) return

    const next = completedPapers.includes(code)
      ? completedPapers.filter((c) => c !== code)
      : [...completedPapers, code]

    setCompletedPapers(next)

    try {
      await fetch(`/api/progress/${progressId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completedPapers: next }),
      })
    } catch (err) {
      console.error('Failed to save progress:', err.message)
    }
  }

  return { progressId, completedPapers, togglePaper, loading }
}
