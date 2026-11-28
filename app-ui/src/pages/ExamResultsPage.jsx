import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getExamDetail, getResults, updateDeadline } from '../api.js'
import Icon from '../components/Icon.jsx'
import { RUBRIC_FIELDS } from '../components/RubricFields.jsx'
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
    if (q.status === 'failed') return 'tone-low'
    if (q.status !== 'done' || q.score === null) return 'tone-none'
    return q.score >= 80 ? 'tone-ok' : q.score >= 50 ? 'tone-mid' : 'tone-low'
  }
  const needsReview = (r) => r.questions.some((q) => q.status === 'failed') || (r.total !== null && r.total < 50)
  const shown = rows.filter((r) => r.student_name.toLowerCase().includes(search.trim().toLowerCase()) && (!reviewOnly || needsReview(r)))
  const reviewCount = rows.filter(needsReview).length

  const totals = rows.map((r) => r.total).filter((t) => t !== null)
  const average = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null
  const grading = rows.filter((r) => r.questions.some((q) => q.status === 'queued' || q.status === 'grading')).length
  const failed = rows.filter((r) => r.questions.some((q) => q.status === 'failed')).length
  const bands = [
    { key: 'ok', label: 'từ 80 điểm', count: totals.filter((t) => t >= 80).length },
    { key: 'mid', label: 'từ 50 đến 79', count: totals.filter((t) => t >= 50 && t < 80).length },
    { key: 'low', label: 'dưới 50', count: totals.filter((t) => t < 50).length },
    { key: 'none', label: 'chưa có tổng', count: rows.length - totals.length },
  ]
  const distributionLabel = `Phân bố điểm: ${bands.map((b) => `${b.count} bài ${b.label}`).join(', ')}`
  const rubricTotal = exam.rubric ? Object.values(exam.rubric).reduce((a, b) => a + b, 0) : 0
  const pad = (n) => String(n).padStart(2, '0')
  const when = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}` }

  return (
    <>
      <header className="top">
        <Link className="word" to="/teacher">AI Grader</Link>
        <span className="sp" />
        <Link className="link" to={`/teacher/exams/${id}/stats`}>Thống kê</Link>
        <Link className="link" to={`/teacher/exams/${id}/appeals`}>Khiếu nại</Link>
        <Link className="link" to="/teacher/settings"><Icon name="gear" />Cài đặt</Link>
        <ThemeToggle />
      </header>
      <div className="wrap wrap-wide">
        <Link className="back-link" to="/teacher"><Icon name="back" />Bài kiểm tra</Link>
        <div className="head">
          <div>
            <h1>{exam.title}</h1>
            <p className="muted">{exam.deadline ? `Hạn chót ${when(exam.deadline)}` : 'Chưa đặt hạn chót'} · Điểm theo thang 100</p>
          </div>
          <span className={`st ${isClosed ? 'st-closed' : 'st-open'}`}>{isClosed ? 'Đã đóng' : 'Đang mở'}</span>
        </div>

        <section className="summary" aria-label="Tóm tắt kết quả">
          <dl className="summary-grid">
            <div><dt><Icon name="users" />Đã bắt đầu</dt><dd className="num">{rows.length}</dd></div>
            <div><dt><Icon name="chart" />Điểm trung bình</dt><dd className="num">{average ?? '—'}</dd></div>
            <div><dt><Icon name="clock" />Đang chấm</dt><dd className="num">{grading}</dd></div>
            <div><dt><Icon name="alert" />Lỗi chấm</dt><dd className={`num${failed > 0 ? ' score-low' : ''}`}>{failed}</dd></div>
          </dl>
          <div className="dist">
            <div className="dist-bar" role="img" aria-label={distributionLabel}>
              {rows.length === 0
                ? <span className="seg seg-none" style={{ flex: 1 }} />
                : bands.filter((b) => b.count > 0).map((b) => <span key={b.key} className={`seg seg-${b.key}`} style={{ flex: b.count }} />)}
            </div>
            <ul className="dist-legend" aria-hidden="true">
              {bands.map((b) => <li key={b.key}><span className={`dot dot-${b.key}`} />{b.count} {b.label}</li>)}
            </ul>
          </div>
        </section>

        <div className="config">
          <section className="config-col" aria-label="Chia sẻ và hạn chót">
            <h3>Liên kết cho học sinh</h3>
            <div className="link-box">
              <input readOnly value={link} aria-label="Liên kết cho học sinh" onFocus={(e) => e.target.select()} />
              <button className="btn" onClick={() => navigator.clipboard?.writeText(link).catch(() => {})}><Icon name="copy" />Sao chép</button>
            </div>
            <div className="admin-controls">
              <label htmlFor="deadline">Hạn chót</label>
              <input id="deadline" type="datetime-local" value={deadlineInput} onChange={(e) => setDeadlineInput(e.target.value)} />
              <button className="btn" disabled={saving} onClick={() => save(deadlineInput ? new Date(deadlineInput).toISOString() : null)}>
                <Icon name="check" />Lưu hạn chót
              </button>
              <button className="btn" disabled={saving} onClick={() => save(new Date(Date.now() - 1000).toISOString())}>
                <Icon name="lock" />Đóng ngay
              </button>
              {errorMessage && <span className="status-error" role="alert">{errorMessage}</span>}
            </div>
          </section>

          <section className="config-col" role="group" aria-label="Trọng số tiêu chí">
            <h3>Trọng số tiêu chí</h3>
            {exam.rubric ? (
              <ul className="weights">
                {RUBRIC_FIELDS.map((f) => {
                  const pct = rubricTotal > 0 ? Math.round((exam.rubric[f.key] / rubricTotal) * 100) : 0
                  return (
                    <li key={f.key}>
                      <span className="weight-name"><Icon name={f.icon} />{f.label}</span>
                      <span className="weight-track" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                      <span className="num weight-pct">{pct}%</span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="muted">Trọng số theo từng bài (đề này tạo trước khi có tuỳ chỉnh trọng số).</p>
            )}
          </section>
        </div>

        <div className="filters">
          <span className="search-box">
            <Icon name="search" />
            <input type="search" name="q" autoComplete="off" placeholder="Tìm học sinh…" aria-label="Tìm học sinh" value={search} onChange={(e) => setSearch(e.target.value)} />
          </span>
          <label title="Có câu lỗi chấm hoặc tổng dưới 50 điểm">
            <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
            <Icon name="alert" />
            Chỉ hiện bài cần xem <span className="num muted">({reviewCount})</span>
          </label>
          <span className="sp" />
          <a className="btn" href={`/api/teacher/exams/${id}/export.csv`} download>
            <Icon name="download" />Xuất CSV
          </a>
          <span className="muted num">{`Hiện ${shown.length} trên ${rows.length} bài làm`}</span>
        </div>

        <table className="stack results-table">
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
                <td className="name">{r.student_name}{needsReview(r) && <span className="review-flag" title="Cần xem lại"><Icon name="alert" /></span>}</td>
                {r.questions.map((q, i) => <td key={q.problem_id} className={`r num cell ${tone(q)}`} data-l={`Câu ${i + 1}`}>{cell(q)}</td>)}
                <td className="r num total" data-l="Tổng">
                  <span>{r.total === null ? '—' : r.total}</span>
                  {r.total !== null && <i className={`total-bar ${r.total >= 80 ? 'tone-ok' : r.total >= 50 ? 'tone-mid' : 'tone-low'}`} style={{ width: `${Math.min(100, Math.max(0, r.total))}%` }} />}
                </td>
                <td className="num muted" data-l="Bắt đầu lúc">{when(r.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
