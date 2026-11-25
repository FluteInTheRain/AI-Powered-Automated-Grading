import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createExam, getMe, listBank, listExams } from '../api.js'

const studentUrl = (path) => `${window.location.origin}${path}`
const excerpt = (text) => (text.length <= 120 ? text : `${text.slice(0, 120)}…`)

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* clipboard can be blocked; the link is visible and selectable */
  }
}

export default function TeacherHomePage() {
  const [me, setMe] = useState(null)
  const [exams, setExams] = useState(null)
  const [bank, setBank] = useState([])
  const [errorMessage, setErrorMessage] = useState(null)
  const [title, setTitle] = useState('')
  const [deadline, setDeadline] = useState('')
  const [minutes, setMinutes] = useState('10')
  const [chosen, setChosen] = useState({}) // problem_id -> weight string
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(null)

  const load = useCallback(() => {
    Promise.all([getMe(), listExams(), listBank()])
      .then(([m, e, b]) => { setMe(m); setExams(e); setBank(b) })
      .catch((e) => setErrorMessage(e.message))
  }, [])
  useEffect(() => { load() }, [load])

  const selected = bank.filter((q) => q.id in chosen)
  const weightsOk = selected.every((q) => Number(chosen[q.id]) > 0)
  const canCreate = title.trim() !== '' && selected.length > 0 && weightsOk && Number(minutes) > 0 && !creating

  const toggle = (id, on) =>
    setChosen((prev) => {
      const next = { ...prev }
      if (on) next[id] = '1'
      else delete next[id]
      return next
    })

  const handleCreate = async () => {
    setCreating(true)
    setErrorMessage(null)
    try {
      const body = {
        title: title.trim(), time_limit_seconds: Math.round(Number(minutes) * 60),
        questions: selected.map((q) => ({ problem_id: q.id, weight: Number(chosen[q.id]) })),
      }
      if (deadline) body.deadline = new Date(deadline).toISOString()
      setCreated(await createExam(body))
      setTitle('')
      setChosen({})
      load()
    } catch (e) {
      setErrorMessage(e.message)
    } finally {
      setCreating(false)
    }
  }

  if (errorMessage && !exams) return <p className="status-line status-error">Error: {errorMessage}</p>
  if (!exams) return <p className="status-line">Loading…</p>

  return (
    <div className="app">
      <header className="app-header">
        <h1>Bài kiểm tra của tôi</h1>
        <span className="field-hint">{me.email}</span>
      </header>

      <div className="teacher-section">
        <h2>Các bài kiểm tra</h2>
        {exams.length === 0 && <p className="status-line">Chưa có bài kiểm tra nào.</p>}
        {exams.map((e) => (
          <div key={e.id} className="exam-link-row">
            <Link to={`/teacher/exams/${e.id}`}>{e.title}</Link>
            <code>{studentUrl(e.student_path)}</code>
            <button className="btn btn-secondary" onClick={() => copy(studentUrl(e.student_path))}>Sao chép link</button>
          </div>
        ))}
      </div>

      <div className="teacher-section">
        <h2>Tạo bài kiểm tra</h2>
        <div className="field-row">
          <label htmlFor="exam-title">Tiêu đề</label>
          <input id="exam-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field-row">
          <label htmlFor="exam-minutes">Thời gian (phút)</label>
          <input id="exam-minutes" type="number" min="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        <div className="field-row">
          <label htmlFor="exam-deadline">Hạn chót</label>
          <input id="exam-deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <p className="field-hint">Chọn các câu từ kho (mỗi câu có trọng số, mặc định 1):</p>
        {bank.map((q) => (
          <div key={q.id} className="field-row">
            <label>
              <input type="checkbox" checked={q.id in chosen} onChange={(e) => toggle(q.id, e.target.checked)} />{' '}
              {excerpt(q.statement)}
            </label>
            {q.id in chosen && (
              <input
                type="number" min="0" step="any" aria-label={`Trọng số ${excerpt(q.statement)}`}
                value={chosen[q.id]} onChange={(e) => setChosen((prev) => ({ ...prev, [q.id]: e.target.value }))}
              />
            )}
          </div>
        ))}
        <div className="submit-row">
          {errorMessage && <span className="status-error">{errorMessage}</span>}
          <button className="btn btn-primary" onClick={handleCreate} disabled={!canCreate}>Tạo bài kiểm tra</button>
        </div>
        {created && (
          <p className="status-success">
            Đã tạo. Link cho học sinh: <code>{studentUrl(created.student_path)}</code>
          </p>
        )}
      </div>
    </div>
  )
}
