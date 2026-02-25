import { useState, useEffect } from 'react'

export function useDegreeGraph(degreeId) {
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [degree, setDegree] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!degreeId) return

    setNodes([])
    setEdges([])
    setDegree(null)
    setError(null)

    async function fetchGraph() {
      setLoading(true)
      try {
        const response = await fetch(`/api/degrees/${degreeId}/graph`)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        const data = await response.json()

        const styledEdges = data.edges.map((edge) => {
          const prereqType = edge.data?.prereqType
          if (prereqType === 'co') {
            return {
              ...edge,
              animated: true,
              style: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '5 3' },
            }
          }
          return {
            ...edge,
            animated: false,
            style: { stroke: '#6366f1', strokeWidth: 2 },
          }
        })

        setDegree(data.degree)
        setNodes(data.nodes)
        setEdges(styledEdges)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchGraph()
  }, [degreeId])

  return { nodes, edges, degree, loading, error }
}
