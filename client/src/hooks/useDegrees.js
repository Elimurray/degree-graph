import { useState, useEffect } from 'react'

export function useDegrees() {
  const [degrees, setDegrees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchDegrees() {
      try {
        const response = await fetch('/api/degrees')
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        const data = await response.json()
        setDegrees(data)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchDegrees()
  }, [])

  return { degrees, loading, error }
}
