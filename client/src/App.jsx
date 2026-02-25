import { useState } from 'react'
import { DegreeGraph } from './components/DegreeGraph.jsx'
import { DegreeSelector } from './components/DegreeSelector.jsx'
import { useProgress } from './hooks/useProgress.js'
import { useDegreeGraph } from './hooks/useDegreeGraph.js'

function ProgressBar({ completedPapers, degreeId }) {
  const { nodes } = useDegreeGraph(degreeId)
  const total = nodes.length
  const completed = completedPapers.length
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0

  if (total === 0) return null

  return (
    <div className="flex items-center gap-3 min-w-48">
      <span className="text-xs text-gray-400 whitespace-nowrap">
        {completed} / {total} papers
      </span>
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden min-w-24">
        <div
          className="h-full bg-green-500 rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-gray-400">{percent}%</span>
    </div>
  )
}

export function App() {
  const [selectedDegreeId, setSelectedDegreeId] = useState(null)
  const { completedPapers, togglePaper } = useProgress(selectedDegreeId)

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Degree Graph</h1>
          <p className="text-sm text-gray-400">University of Waikato — interactive prerequisite map</p>
        </div>
        <div className="flex items-center gap-4">
          {selectedDegreeId && (
            <ProgressBar
              completedPapers={completedPapers}
              degreeId={selectedDegreeId}
            />
          )}
          <DegreeSelector
            selectedDegreeId={selectedDegreeId}
            onSelect={setSelectedDegreeId}
          />
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {selectedDegreeId ? (
          <DegreeGraph
            degreeId={selectedDegreeId}
            completedPapers={completedPapers}
            onTogglePaper={togglePaper}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-gray-400 text-lg">Select a degree above to visualise its papers</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
