import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import DifficultyMark from './DifficultyMark.jsx'
import Icon from './Icon.jsx'

/** The whole statement of one problem, rendered as markdown, with a button to choose or unchoose it. */
export default function ProblemDialog({ problem, chosen, onToggle, onClose }) {
  const closeRef = useRef(null)
  useEffect(() => {
    const before = document.activeElement
    closeRef.current?.focus()
    return () => before?.focus?.()
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="modal" role="dialog" aria-modal="true" aria-labelledby="problem-dialog-title"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
      >
        <div className="modal-head">
          <div>
            <h2 id="problem-dialog-title">{problem.title}</h2>
            <p className="modal-meta">
              <span className="muted">{problem.category}</span>
              <DifficultyMark difficulty={problem.difficulty} />
            </p>
          </div>
          <button type="button" className="ibtn" ref={closeRef} onClick={onClose} aria-label="Đóng"><Icon name="x" /></button>
        </div>
        <div className="modal-body statement">
          <ReactMarkdown>{problem.statement}</ReactMarkdown>
        </div>
        <div className="modal-foot">
          <button type="button" className={`btn${chosen ? '' : ' btn-primary'}`} onClick={() => onToggle(problem.id, !chosen)}>
            <Icon name={chosen ? 'x' : 'plus'} />
            {chosen ? 'Bỏ chọn' : 'Chọn câu này'}
          </button>
        </div>
      </div>
    </div>
  )
}
