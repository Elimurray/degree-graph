import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useDegreeGraph } from '../hooks/useDegreeGraph.js'
import { PaperNode } from './PaperNode.jsx'
import { PaperDetail } from './PaperDetail.jsx'

// ---------------------------------------------------------------------------
// YearLabelNode — renders a right-aligned year label, no handles
// ---------------------------------------------------------------------------
function YearLabelNode({ data }) {
  return (
    <div className="text-right pointer-events-none select-none w-40">
      <p className="text-sm font-bold text-gray-500">{data.label}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const NODE_W = 180
const NODE_H = 90
const H_GAP = 20
const LABEL_X = -220

const YEAR_ROWS = [
  { key: '1', label: 'Year 1', y: 0 },
  { key: '2', label: 'Year 2', y: 160 },
  { key: '3', label: 'Year 3', y: 320 },
  { key: '4', label: 'Year 4+', y: 480 },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getPaperLevel(code) {
  const m = code.match(/(\d)\d{2}[A-Z]?$/)
  if (!m) return '4'
  const d = parseInt(m[1], 10)
  if (d === 1) return '1'
  if (d === 2) return '2'
  if (d === 3) return '3'
  return '4'
}

function layoutNodes(rawNodes) {
  const byYear = { '1': [], '2': [], '3': [], '4': [] }
  for (const node of rawNodes) {
    const y = getPaperLevel(node.id)
    byYear[y].push(node)
  }

  for (const key of Object.keys(byYear)) {
    byYear[key].sort((a, b) => {
      const ra = a.data.role === 'compulsory' ? 0 : 1
      const rb = b.data.role === 'compulsory' ? 0 : 1
      if (ra !== rb) return ra - rb
      return a.id.localeCompare(b.id)
    })
  }

  const positioned = []
  const labels = []

  for (const row of YEAR_ROWS) {
    const papers = byYear[row.key]
    if (papers.length === 0) continue

    labels.push({
      id: `year-label-${row.key}`,
      type: 'yearLabel',
      position: { x: LABEL_X, y: row.y + NODE_H / 2 - 12 },
      data: { label: row.label },
      draggable: false,
      selectable: false,
    })

    papers.forEach((node, i) => {
      positioned.push({
        ...node,
        position: { x: i * (NODE_W + H_GAP), y: row.y },
      })
    })
  }

  return [...labels, ...positioned]
}

function computePaperStates(nodes, edges, completedPapers) {
  const completed = new Set(completedPapers)
  const states = {}
  for (const node of nodes) {
    if (node.type !== 'paper') continue
    if (completed.has(node.id)) {
      states[node.id] = 'completed'
      continue
    }
    // CNF: group incoming edges by groupIndex.
    // Every group must have at least one completed source (AND between groups, OR within).
    const incomingEdges = edges.filter((e) => e.target === node.id)
    if (incomingEdges.length === 0) {
      states[node.id] = 'available'
      continue
    }
    const groups = new Map()
    for (const e of incomingEdges) {
      const gi = e.data?.groupIndex ?? 0
      if (!groups.has(gi)) groups.set(gi, [])
      groups.get(gi).push(e.source)
    }
    const allGroupsMet = [...groups.values()].every((sources) =>
      sources.some((src) => completed.has(src))
    )
    states[node.id] = allGroupsMet ? 'available' : 'locked'
  }
  return states
}

// ---------------------------------------------------------------------------
// nodeTypes — defined outside component to avoid recreation on every render
// ---------------------------------------------------------------------------
const nodeTypes = {
  paper: PaperNode,
  yearLabel: YearLabelNode,
}

// ---------------------------------------------------------------------------
// DegreeGraph
// ---------------------------------------------------------------------------
export function DegreeGraph({ degreeId, completedPapers, onTogglePaper }) {
  const { nodes: rawNodes, edges: rawEdges, degree, loading, error } = useDegreeGraph(degreeId)
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedPaper, setSelectedPaper] = useState(null)
  const [hoveredNodeId, setHoveredNodeId] = useState(null)

  // Compute layout whenever raw nodes change
  const layoutedNodes = useMemo(() => layoutNodes(rawNodes), [rawNodes])

  useEffect(() => {
    setNodes(layoutedNodes)
  }, [layoutedNodes, setNodes])

  useEffect(() => {
    setEdges(rawEdges)
  }, [rawEdges, setEdges])

  // ---------------------------------------------------------------------------
  // Paper states
  // ---------------------------------------------------------------------------
  const paperStates = useMemo(
    () => computePaperStates(nodes, edges, completedPapers),
    [nodes, edges, completedPapers]
  )

  // ---------------------------------------------------------------------------
  // Newly unlocked tracking
  // ---------------------------------------------------------------------------
  const prevStatesRef = useRef({})
  const [newlyUnlocked, setNewlyUnlocked] = useState(new Set())

  useEffect(() => {
    const prev = prevStatesRef.current
    const unlocked = new Set()
    for (const [code, status] of Object.entries(paperStates)) {
      if (status === 'available' && prev[code] === 'locked') {
        unlocked.add(code)
      }
    }
    prevStatesRef.current = paperStates
    if (unlocked.size > 0) {
      setNewlyUnlocked(unlocked)
      const t = setTimeout(() => setNewlyUnlocked(new Set()), 1200)
      return () => clearTimeout(t)
    }
  }, [paperStates])

  // ---------------------------------------------------------------------------
  // Enriched nodes — merge status + newlyUnlocked + prerequisites into data
  // ---------------------------------------------------------------------------
  const nodeById = Object.fromEntries(
    nodes.filter((n) => n.type === 'paper').map((n) => [n.id, n])
  )

  const enrichedNodes = nodes.map((n) => {
    if (n.type !== 'paper') return n
    return {
      ...n,
      data: {
        ...n.data,
        status: paperStates[n.id] ?? 'available',
        newlyUnlocked: newlyUnlocked.has(n.id),
        prerequisites: edges
          .filter((e) => e.target === n.id)
          .map((e) => ({
            code: e.source,
            title: nodeById[e.source]?.data?.title ?? e.source,
          })),
      },
    }
  })

  // ---------------------------------------------------------------------------
  // Edge styles based on paper states, visibility, and hover
  // ---------------------------------------------------------------------------
  const styledEdges = edges
    .map((edge) => {
      const srcState = paperStates[edge.source]
      const tgtState = paperStates[edge.target]

      let baseStyle
      if (srcState === 'locked' || tgtState === 'locked') {
        baseStyle = { stroke: '#4b5563', strokeWidth: 1, strokeDasharray: '4 3', opacity: 0.3 }
      } else if (srcState === 'completed' && tgtState === 'completed') {
        baseStyle = { ...edge.style, stroke: '#22c55e', strokeWidth: 1.5 }
      } else if (srcState === 'completed' && tgtState === 'available') {
        baseStyle = { ...edge.style, stroke: '#3b82f6', strokeWidth: 2 }
      } else {
        baseStyle = { ...edge.style, stroke: '#6366f1', strokeWidth: 1.5 }
      }

      // Hover: highlight connected edges, dim unconnected
      if (hoveredNodeId) {
        const isConnected = edge.source === hoveredNodeId || edge.target === hoveredNodeId
        baseStyle = {
          ...baseStyle,
          opacity: isConnected ? 1 : 0.08,
          strokeWidth: isConnected ? (baseStyle.strokeWidth ?? 2) + 1 : baseStyle.strokeWidth,
        }
      }

      return { ...edge, style: baseStyle }
    })

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------
  const paperNodes = nodes.filter((n) => n.type === 'paper')
  const totalCount = paperNodes.length
  const completedCount = completedPapers.length
  const completedPoints = paperNodes
    .filter((n) => completedPapers.includes(n.id))
    .reduce((sum, n) => sum + (n.data.points ?? 0), 0)
  const totalPoints = degree?.total_points ?? 360

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  function handleNodeClick(_event, node) {
    if (node.type !== 'paper') return
    if (node.data?.status === 'locked') return
    setSelectedPaper({ ...node.data })
    if (onTogglePaper) onTogglePaper(node.id)
  }

  function handleNodeMouseEnter(_event, node) {
    if (node.type !== 'paper') return
    setHoveredNodeId(node.id)
  }

  function handleNodeMouseLeave() {
    setHoveredNodeId(null)
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400">Loading degree graph...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-red-400">Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full flex flex-col">
      {degree && (
        <div className="shrink-0 px-4 py-2 bg-gray-900 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-white">{degree.name}</h2>
            <span className="text-xs text-gray-400">
              {completedCount} / {totalCount} papers
            </span>
            <span className="text-xs font-medium text-white">
              {completedPoints} / {totalPoints} points
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-600"></span>
              <span className="text-gray-400">Completed</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500"></span>
              <span className="text-gray-400">Available</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-700"></span>
              <span className="text-gray-400">Locked</span>
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 relative">
        <ReactFlow
          key={degreeId}
          nodes={enrichedNodes}
          edges={styledEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseLeave={handleNodeMouseLeave}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.2}
          colorMode="dark"
        >
          <Background />
          <Controls />
          <MiniMap nodeColor="#6366f1" maskColor="rgba(0,0,0,0.6)" />
        </ReactFlow>

        <PaperDetail
          paper={selectedPaper}
          onClose={() => setSelectedPaper(null)}
        />
      </div>
    </div>
  )
}
