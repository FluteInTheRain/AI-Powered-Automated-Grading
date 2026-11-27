import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { decideAppeal, getAppeal, getExamDetail, listExamAppeals, startAppealReview } from '../api.js'
import { APPEAL_STATUS } from '../components/AppealForm.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'

const PENDING = ['open', 'under_review']
const DECISIONS = [
  ['upheld', 'Giữ nguyên điểm'],
  ['rejected', 'Từ chối'],
  ['adjusted', 'Chỉnh điểm'],
]

const CRITERIA = {
  correctness: 'Đúng chức năng',
  efficiency: 'Hiệu năng',
  code_style: 'Phong cách code',
  edge_case_handling: 'Trường hợp biên',
}
const STYLE_LEVEL = { clean: 'Tốt', medium: 'Trung bình', poor: 'Kém' }

/** One line of plain Vietnamese for what the AI found on each criterion; null when the check has no detail. */
function finding(key, detail) {
  if (!detail) return null
  if (key === 'efficiency') return `${detail.meets_expected_complexity ? 'Đạt' : 'Không đạt'} (${detail.observed_pattern})`
  if (key === 'code_style') return STYLE_LEVEL[detail.level] ?? detail.level
  if (key === 'edge_case_handling') return detail.handled ? 'Đã xử lý' : `Thiếu: ${(detail.missing_cases ?? []).join(', ') || 'không rõ'}`
  return null
}

function AiResult({ result }) {
  if (!result) return <p className="muted">Không có kết quả chấm chi tiết cho bài này.</p>
  const { execution_result: run, sub_scores_0_to_1: subs = {}, check_details: checks, feedback } = result
  return (
    <>
      {run && <p>{`Test ẩn đạt: ${run.pass_count}/${run.total}`}</p>}
      <ul>
        {Object.entries(CRITERIA).map(([key, label]) => {
          if (!(key in subs)) return null
          const note = finding(key, checks?.[key])
          return <li key={key}>{`${label} (${Math.round(subs[key] * 100)}/100)${note ? `: ${note}` : ''}`}</li>
        })}
      </ul>
      {feedback?.summary && <p>{feedback.summary}</p>}
      {feedback?.issues?.length > 0 && (
        <ul>
          {feedback.issues.map((it, i) => (
            <li key={i}>{`Dòng ${it.line}: ${it.issue}. ${it.explanation} Gợi ý: ${it.suggested_fix}`}</li>
          ))}
        </ul>
      )}
    </>
  )
}

function DecisionForm({ appealId, onDone }) {
  const [decision, setDecision] = useState('upheld')
  const [note, setNote] = useState('')
  const [score, setScore] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const adjusting = decision === 'adjusted'
  const valid = note.trim() !== '' && (!adjusting || (score !== '' && Number.isFinite(Number(score)) && Number(score) >= 0 && Number(score) <= 100))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await decideAppeal(appealId, { decision, note: note.trim(), ...(adjusting ? { score: Number(score) } : {}) })
      onDone()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="appeal-form">
      <fieldset>
        <legend>Quyết định</legend>
        {DECISIONS.map(([value, label]) => (
          <label key={value}>
            <input type="radio" name="decision" checked={decision === value} onChange={() => setDecision(value)} />
            {label}
          </label>
        ))}
      </fieldset>
      {adjusting && (
        <div className="field-row">
          <label htmlFor="appeal-score">Điểm mới</label>
          <input id="appeal-score" type="number" min="0" max="100" value={score} onChange={(e) => setScore(e.target.value)} />
          <span className="muted">thang 100</span>
        </div>
      )}
      <label htmlFor="appeal-note">Ghi chú cho sinh viên</label>
      <textarea id="appeal-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-primary" disabled={!valid || saving} onClick={save}>Lưu quyết định</button>
      {error && <p className="status-error" role="alert">{error}</p>}
    </div>
  )
}

function Detail({ appeal, onDecided }) {
  return (
    <div className="result-panel">
      <h2>{appeal.student_name} — {APPEAL_STATUS[appeal.status] ?? appeal.status}</h2>
      <p>{appeal.message}</p>
      <h3>Bài làm</h3>
      <pre>{appeal.code}</pre>
      <h3>Lịch sử điểm</h3>
      <ul>
        {appeal.revisions.map((r) => (
          <li key={r.revision}>#{r.revision} · {r.source} · {r.score} · {r.author}{r.reason ? ` · ${r.reason}` : ''}</li>
        ))}
      </ul>
      <h3>AI đã chấm thế nào</h3>
      <AiResult result={appeal.ai_result} />
      <details>
        <summary>Chi tiết kỹ thuật (prompt và phản hồi thô của AI)</summary>
        {appeal.audit === null && <p className="muted">Không còn dữ liệu chấm của AI cho bài này.</p>}
        {appeal.audit?.call_log.map((c, i) => (
          <details key={i}>
            <summary>{c.kind} · {c.schema} · {c.model}</summary>
            <pre>{c.system_prompt}</pre>
            <pre>{c.user_prompt}</pre>
            <pre>{c.raw_response}</pre>
          </details>
        ))}
      </details>
      {PENDING.includes(appeal.status) ? (
        <DecisionForm appealId={appeal.id} onDone={onDecided} />
      ) : (
        <p>Quyết định: {appeal.decision_note}{appeal.decided_by ? ` (${appeal.decided_by})` : ''}</p>
      )}
    </div>
  )
}

export default function ExamAppealsPage() {
  const { id } = useParams()
  const [exam, setExam] = useState(null)
  const [appeals, setAppeals] = useState(null)
  const [selected, setSelected] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)

  const load = useCallback(async () => {
    try {
      const [e, list] = await Promise.all([getExamDetail(id), listExamAppeals(id)])
      setExam(e)
      setAppeals(list)
    } catch (e) {
      setErrorMessage(e.message)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  const openAppeal = async (row) => {
    setErrorMessage(null)
    if (row.status === 'open') {
      // A 409 means another tab or the cron got there first: the detail below shows the real state, and the list is refreshed.
      try { await startAppealReview(row.id) } catch { /* handled by the refresh */ }
    }
    try {
      setSelected(await getAppeal(row.id))
    } catch (e) {
      setErrorMessage(e.message)
    }
    if (row.status === 'open') load()
  }
  const decided = () => {
    setSelected(null)
    load()
  }

  if (errorMessage && !appeals) return <p className="status-line status-error">Error: {errorMessage}</p>
  if (!appeals || !exam) return <p className="status-line">Loading…</p>
  const number = (problemId) => exam.questions.findIndex((q) => q.problem_id === problemId) + 1

  return (
    <>
      <header className="top">
        <span className="word">AI Grader</span>
        <span className="sp" />
        <Link className="link" to={`/teacher/exams/${id}`}>Kết quả</Link>
        <ThemeToggle />
      </header>
      <div className="wrap">
        <div className="head">
          <div>
            <h1>Khiếu nại — {exam.title}</h1>
          </div>
        </div>
        {errorMessage && <p className="status-error" role="alert">{errorMessage}</p>}
        <table className="stack">
          <thead>
            <tr><th>Học viên</th><th>Câu</th><th>Trạng thái</th><th>Gửi lúc</th><th /></tr>
          </thead>
          <tbody>
            {appeals.length === 0 && <tr><td colSpan={5} className="status-line">Chưa có khiếu nại nào.</td></tr>}
            {appeals.map((a) => (
              <tr key={a.id}>
                <td className="name">{a.student_name}</td>
                <td data-l="Câu">Câu {number(a.problem_id)}</td>
                <td data-l="Trạng thái">{APPEAL_STATUS[a.status] ?? a.status}</td>
                <td className="num muted" data-l="Gửi lúc">{new Date(a.created_at).toLocaleString()}</td>
                <td><button className="btn btn-small" onClick={() => openAppeal(a)}>Xem</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {selected && <Detail key={selected.id} appeal={selected} onDecided={decided} />}
      </div>
    </>
  )
}
