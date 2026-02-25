import { Handle, Position } from '@xyflow/react'

export function PaperNode({ data, selected }) {
  const { status, newlyUnlocked } = data
  const isLocked = status === 'locked'

  let containerClass = 'group relative rounded-lg border px-3 py-2 text-sm w-44 shadow-md transition-shadow '

  if (status === 'completed') {
    containerClass += 'bg-green-700 border-green-500 cursor-pointer '
  } else if (status === 'available') {
    containerClass += 'bg-blue-700 border-blue-400 cursor-pointer hover:ring-2 hover:ring-blue-300 '
    if (newlyUnlocked) {
      containerClass += 'animate-pulse '
    }
  } else {
    // locked
    containerClass += 'bg-gray-900/60 border-gray-700/50 cursor-not-allowed '
  }

  if (selected) {
    containerClass += 'ring-2 ring-white '
  }

  return (
    <div className={containerClass}>
      <Handle type="target" position={Position.Left} className="w-2 h-2" />

      <div className="flex items-start justify-between gap-1 mb-1">
        <p className={`font-mono font-bold text-xs leading-none ${isLocked ? 'text-gray-600' : 'text-white/70'}`}>
          {data.code}
        </p>
        {status === 'completed' && (
          <span className="text-green-300 text-xs leading-none font-bold">&#10003;</span>
        )}
        {status === 'locked' && (
          <span className="text-xs leading-none">&#128274;</span>
        )}
      </div>

      <p className={`font-semibold leading-snug text-xs ${isLocked ? 'text-gray-600' : 'text-white'}`}>
        {data.title}
      </p>

      <div className="flex items-center justify-between mt-1">
        <p className={`text-xs ${isLocked ? 'text-gray-700' : 'text-white/60'}`}>{data.points} pts</p>
        {data.semesters && data.semesters.length > 0 && (
          <div className="flex gap-0.5">
            {data.semesters.map((s) => (
              <span
                key={s}
                className={`text-xs rounded px-1 leading-tight ${isLocked ? 'bg-gray-800 text-gray-600' : 'bg-white/10 text-white/70'}`}
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

      {isLocked && data.prerequisites && data.prerequisites.length > 0 && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-[9999] pointer-events-none">
          <div className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 shadow-2xl w-52">
            <p className="text-xs text-gray-400 font-medium mb-1.5">Requires:</p>
            <ul className="space-y-1">
              {data.prerequisites.map((p) => (
                <li key={p.code} className="flex items-baseline gap-1.5">
                  <span className="font-mono text-xs text-indigo-400 shrink-0">{p.code}</span>
                  <span className="text-xs text-gray-300 leading-tight">{p.title}</span>
                </li>
              ))}
            </ul>
          </div>
          {/* arrow */}
          <div className="w-2 h-2 bg-gray-800 border-r border-b border-gray-600 rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </div>
  )
}
