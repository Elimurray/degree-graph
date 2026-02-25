const roleBadgeColour = {
  compulsory: 'bg-indigo-700 text-indigo-200',
  elective: 'bg-teal-700 text-teal-200',
  specialisation: 'bg-amber-700 text-amber-200',
}

export function PaperDetail({ paper, onClose }) {
  const visible = paper !== null && paper !== undefined

  return (
    <div
      className={`fixed top-0 right-0 h-full w-80 bg-gray-900 border-l border-gray-700 flex flex-col z-50 transition-transform duration-300 ${visible ? 'translate-x-0' : 'translate-x-full'}`}
    >
      {visible && (
        <>
          <div className="flex items-start justify-between px-5 py-4 border-b border-gray-700 shrink-0">
            <div>
              <p className="font-mono text-xs text-gray-400 leading-none mb-1">{paper.code}</p>
              <h2 className="text-base font-bold text-white leading-snug">{paper.title}</h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-xl leading-none ml-3 mt-0.5 shrink-0"
              aria-label="Close panel"
            >
              &times;
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              {paper.role && (
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${roleBadgeColour[paper.role] ?? 'bg-gray-700 text-gray-300'}`}
                >
                  {paper.role}
                </span>
              )}
              <span className="text-xs text-gray-400">{paper.points} points</span>
              {paper.department && (
                <span className="text-xs text-gray-400">{paper.department}</span>
              )}
            </div>

            {paper.semesters && paper.semesters.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Semesters</p>
                <div className="flex gap-1">
                  {paper.semesters.map((s) => (
                    <span
                      key={s}
                      className="text-xs text-white bg-gray-700 rounded px-2 py-0.5"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {paper.electiveGroup && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Elective Group</p>
                <p className="text-sm text-gray-300">{paper.electiveGroup}</p>
              </div>
            )}

            {paper.description && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Description</p>
                <p className="text-sm text-gray-300 leading-relaxed">{paper.description}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
