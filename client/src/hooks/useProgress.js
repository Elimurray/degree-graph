import { useState, useEffect, useCallback } from 'react'

export function useProgress(degreeId) {
  const [completedPapers, setCompletedPapers] = useState([])

  useEffect(() => {
    if (!degreeId) {
      setCompletedPapers([])
      return
    }
    const stored = localStorage.getItem(`degree-graph-progress-${degreeId}`)
    setCompletedPapers(stored ? JSON.parse(stored) : [])
  }, [degreeId])

  const togglePaper = useCallback(
    (code) => {
      setCompletedPapers((prev) => {
        const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
        localStorage.setItem(`degree-graph-progress-${degreeId}`, JSON.stringify(next))
        return next
      })
    },
    [degreeId]
  )

  return { completedPapers, togglePaper }
}
