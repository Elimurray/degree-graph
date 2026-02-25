import { useEffect, useState } from 'react'
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

const nodeTypes = {
  paper: PaperNode,
}

export function DegreeGraph({ degreeId, completedPapers, onTogglePaper }) {
  const { nodes: initialNodes, edges: initialEdges, degree, loading, error } = useDegreeGraph(degreeId)
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedPaper, setSelectedPaper] = useState(null)

  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, setNodes])

  useEffect(() => {
    setEdges(initialEdges)
  }, [initialEdges, setEdges])

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

  const enrichedNodes = nodes.map((n) => ({
    ...n,
    data: { ...n.data, completed: completedPapers.includes(n.id) },
  }))

  const totalCount = nodes.length
  const compulsoryCount = nodes.filter((n) => n.data?.role === 'compulsory').length
  const electiveCount = totalCount - compulsoryCount

  function handleNodeClick(_event, node) {
    setSelectedPaper(node.data)
    if (onTogglePaper) {
      onTogglePaper(node.id)
    }
  }

  return (
    <div className="relative h-full w-full flex flex-col">
      {degree && (
        <div className="shrink-0 px-4 py-2 bg-gray-900 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-white">{degree.name}</h2>
            <span className="text-xs text-gray-400">
              {totalCount} papers &middot; {compulsoryCount} compulsory &middot; {electiveCount} elective
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
              <span className="text-gray-400">Compulsory</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-teal-600"></span>
              <span className="text-gray-400">Elective</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-600"></span>
              <span className="text-gray-400">Specialisation</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-600"></span>
              <span className="text-gray-400">Completed</span>
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 relative">
        <ReactFlow
          key={degreeId}
          nodes={enrichedNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
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
