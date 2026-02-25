import { useDegrees } from '../hooks/useDegrees.js'

export function DegreeSelector({ selectedDegreeId, onSelect }) {
  const { degrees, loading } = useDegrees()

  if (loading) {
    return <p className="text-gray-500 text-sm">Loading degrees...</p>
  }

  return (
    <select
      value={selectedDegreeId ?? ''}
      onChange={(e) => onSelect(e.target.value || null)}
      className="bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
    >
      <option value="">Select a degree...</option>
      {degrees.map((degree) => (
        <option key={degree.id} value={degree.id}>
          {degree.name}
        </option>
      ))}
    </select>
  )
}
