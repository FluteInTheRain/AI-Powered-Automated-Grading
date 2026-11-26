import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getExamDetail, getResults, updateDeadline } from '../api.js'
import Icon from '../components/Icon.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'

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
  const [search, setSearch] = useState('')
  const [reviewOnly, setReviewOnly] = useState(false)

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
  const tone = (q) => {
    if (q.status === 'failed') return 'score-low'
    if (q.status !== 'done' || q.score === null) return 'muted'
    return q.score >= 80 ? 'score-ok' : q.score >= 50 ? 'score-mid' : 'score-low'
  }
  const needsReview = (r) => r.questions.some((q) => q.status === 'failed') || (r.total !== null && r.total < 50)
  const shown = rows.filter((r) => r.student_name.toLowerCase().includes(search.trim().toLowerCase()) && (!reviewOnly || needsReview(r)))
  const totals = rows.map((r) => r.total).filter((t) => t !== null)
  const average = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null
  const grading = rows.filter((r) => r.questions.some((q) => q.status === 'queued' || q.status === 'grading')).length
  const failed = rows.filter((r) => r.questions.some((q) => q.status === 'failed')).length

  return (
    <>
      <header className="top">
        <span className="word">AI Grader</span>
        <span className="sp" />
        <ThemeToggle />
      </header>
      <div className="wrap">
        <div className="head">
          <div>
            <h1>{exam.title}</h1>
            <p>
              {rows.length} bài đã bắt đầu{average !== null ? `, điểm trung bình ${average}` : ''}.
              {grading > 0 ? ` ${grading} bài đang chấm.` : ''}{failed > 0 ? ` ${failed} bài có câu lỗi chấm.` : ''}
            </p>
          </div>
          <span className={`st ${isClosed ? 'st-closed' : 'st-open'}`}>{isClosed ? 'Đã đóng' : 'Đang mở'}</span>
        </div>

        <div className="link-row">
          <span>Link cho học sinh: <code>{link}</code></span>
          <button className="btn btn-small" onClick={() => navigator.clipboard?.writeText(link).catch(() => {})}><Icon name="copy" />Sao chép</button>
        </div>

        <div className="admin-controls">
          <label htmlFor="deadline">Hạn chót</label>
          <input id="deadline" type="datetime-local" value={deadlineInput} onChange={(e) => setDeadlineInput(e.target.value)} />
          <button className="btn" disabled={saving} onClick={() => save(deadlineInput ? new Date(deadlineInput).toISOString() : null)}>
            Lưu hạn chót
          </button>
          <button className="btn" disabled={saving} onClick={() => save(new Date(Date.now() - 1000).toISOString())}>
            Đóng ngay
          </button>
          {errorMessage && <span className="status-error" role="alert">{errorMessage}</span>}
        </div>

        <div className="filters">
          <input type="search" name="q" autoComplete="off" placeholder="Tìm học sinh…" aria-label="Tìm học sinh" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label>
            <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
            Chỉ hiện bài cần xem (lỗi chấm hoặc dưới 50 điểm)
          </label>
        </div>

        <table className="stack">
          <thead>
            <tr>
              <th>Học viên</th>
              {exam.questions.map((q, i) => <th key={q.problem_id} className="r" title={q.statement_excerpt}>Câu {i + 1}</th>)}
              <th className="r">Tổng</th>
              <th>Bắt đầu lúc</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={exam.questions.length + 3} className="status-line">Chưa có học sinh nào làm bài.</td></tr>
            )}
            {rows.length > 0 && shown.length === 0 && (
              <tr><td colSpan={exam.questions.length + 3} className="status-line">Không có học sinh nào khớp bộ lọc.</td></tr>
            )}
            {shown.map((r) => (
              <tr key={r.attempt_id}>
                <td className="name">{r.student_name}</td>
                {r.questions.map((q, i) => <td key={q.problem_id} className={`r num ${tone(q)}`} data-l={`Câu ${i + 1}`}>{cell(q)}</td>)}
                <td className="r num name" data-l="Tổng">{r.total === null ? '—' : r.total}</td>
                <td className="num muted" data-l="Bắt đầu lúc">{new Date(r.started_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
