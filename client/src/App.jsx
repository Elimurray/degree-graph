import { useState } from 'react'
import { DegreeGraph } from './components/DegreeGraph.jsx'
import { DegreeSelector } from './components/DegreeSelector.jsx'
import { useProgress } from './hooks/useProgress.js'

export function App() {
  const [selectedDegreeId, setSelectedDegreeId] = useState(null)
  const { completedPapers, togglePaper } = useProgress(selectedDegreeId)

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      <header className="flex items-center justify-between px-3 py-2 md:px-6 md:py-4 border-b border-gray-800 shrink-0">
        <div>
          <h1 className="text-base md:text-xl font-bold tracking-tight">Degree Graph</h1>
          <p className="hidden md:block text-sm text-gray-400">University of Waikato — interactive prerequisite map</p>
        </div>
        <div className="flex items-center gap-4">
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
