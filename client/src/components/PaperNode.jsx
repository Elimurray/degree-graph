import { Handle, Position } from '@xyflow/react'

const roleColour = {
  compulsory: 'bg-indigo-700 border-indigo-500',
  elective: 'bg-teal-800 border-teal-600',
  specialisation: 'bg-amber-800 border-amber-600',
}

export function PaperNode({ data, selected }) {
  const completed = data.completed === true
  const colourClass = completed
    ? 'bg-green-700 border-green-500'
    : (roleColour[data.role] ?? 'bg-gray-700 border-gray-500')

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm w-44 shadow-md transition-shadow hover:brightness-110 cursor-pointer ${colourClass} ${selected ? 'ring-2 ring-white' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="w-2 h-2" />

      <div className="flex items-start justify-between gap-1 mb-1">
        <p className="font-mono font-bold text-xs text-white/70 leading-none">{data.code}</p>
        {completed && (
          <span className="text-green-300 text-xs leading-none font-bold">&#10003;</span>
        )}
      </div>

      <p className="font-semibold text-white leading-snug text-xs">{data.title}</p>

      <div className="flex items-center justify-between mt-1">
        <p className="text-white/60 text-xs">{data.points} pts</p>
        {data.semesters && data.semesters.length > 0 && (
          <div className="flex gap-0.5">
            {data.semesters.map((s) => (
              <span
                key={s}
                className="text-white/70 text-xs bg-white/10 rounded px-1 leading-tight"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      {data.electiveGroup && (
        <p className="text-white/40 text-xs mt-0.5 truncate">{data.electiveGroup}</p>
      )}

      <Handle type="source" position={Position.Right} className="w-2 h-2" />
    </div>
  )
}
