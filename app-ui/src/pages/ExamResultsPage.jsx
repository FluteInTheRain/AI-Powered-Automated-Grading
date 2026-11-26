import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getExamDetail, getResults, updateDeadline } from '../api.js'

function toDatetimeLocalValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ExamResultsPage() {
  const { id } = useParams()
  const [exam, setExam] = useState(null)
  const [rows, setRows] = useState([])
  const [errorMessage, setErrorMessage] = useState(null)
  const [deadlineInput, setDeadlineInput] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    Promise.all([getExamDetail(id), getResults(id)])
      .then(([e, r]) => {
        setExam(e)
        setRows(r)
        setDeadlineInput(toDatetimeLocalValue(e.deadline))
      })
      .catch((e) => setErrorMessage(e.message))
  }, [id])
  useEffect(() => { load() }, [load])

  const save = async (iso) => {
    setSaving(true)
    try {
      await updateDeadline(id, iso)
      load()
    } catch (e) {
      setErrorMessage(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (errorMessage && !exam) return <p className="status-line status-error">Error: {errorMessage}</p>
  if (!exam) return <p className="status-line">Loading…</p>

  const isClosed = exam.deadline !== null && new Date(exam.deadline).getTime() <= Date.now()
  const link = `${window.location.origin}${exam.student_path}`
  const cell = (q) => {
    if (q.status === 'failed') return 'lỗi chấm'
    if (q.status === 'queued' || q.status === 'grading') return '…'
    return q.score === null ? '—' : q.score.toFixed(1)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>{exam.title}</h1>
      </header>

      <div className="problem-header">
        <p className="hidden-note">Link cho học sinh: <code>{link}</code></p>
      </div>

      <div className="admin-controls">
        <label htmlFor="deadline">Hạn chót</label>
        <input id="deadline" type="datetime-local" value={deadlineInput} onChange={(e) => setDeadlineInput(e.target.value)} />
        <button className="btn btn-secondary" disabled={saving} onClick={() => save(deadlineInput ? new Date(deadlineInput).toISOString() : null)}>
          Lưu hạn chót
        </button>
        <button className="btn btn-secondary" disabled={saving} onClick={() => save(new Date(Date.now() - 1000).toISOString())}>
          Đóng ngay
        </button>
        <span className={`status-chip${isClosed ? ' status-chip-closed' : ' status-chip-open'}`}>{isClosed ? 'Đã đóng' : 'Đang mở'}</span>
        {errorMessage && <span className="status-error">{errorMessage}</span>}
      </div>

      <table className="results-table">
        <thead>
          <tr>
            <th>Học viên</th>
            {exam.questions.map((q, i) => <th key={q.problem_id} title={q.statement_excerpt}>Câu {i + 1}</th>)}
            <th>Tổng</th>
            <th>Bắt đầu lúc</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={exam.questions.length + 3} className="status-line">Chưa có học sinh nào làm bài.</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.attempt_id}>
              <td>{r.student_name}</td>
              {r.questions.map((q) => <td key={q.problem_id}>{cell(q)}</td>)}
              <td>{r.total === null ? '—' : r.total}</td>
              <td>{new Date(r.started_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
