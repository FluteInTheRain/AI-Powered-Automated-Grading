import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { createExam, getMe, getSettings, listBank, listExams, listOwnProblems } from '../api.js'
import Icon from '../components/Icon.jsx'
import ProblemPicker from '../components/ProblemPicker.jsx'
import RubricFields, { DEFAULT_RUBRIC, isValidRubric, rubricToNumbers, rubricToStrings } from '../components/RubricFields.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'

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
  const [rubric, setRubric] = useState(DEFAULT_RUBRIC)
  const prefilled = useRef(false) // the form takes the teacher's defaults once, so reloading the list never wipes typed values

  const load = useCallback(() => {
    Promise.all([getMe(), listExams(), listBank(), listOwnProblems(), getSettings()])
      .then(([m, e, b, own, s]) => {
        setMe(m); setExams(e); setBank([...b, ...(own ?? [])])
        if (prefilled.current) return
        prefilled.current = true
        if (s?.default_rubric) setRubric(rubricToStrings(s.default_rubric))
        if (s?.default_time_limit_seconds) setMinutes(String(Math.round(s.default_time_limit_seconds / 60)))
      })
      .catch((e) => setErrorMessage(e.message))
  }, [])
  useEffect(() => { load() }, [load])

  const selected = bank.filter((q) => q.id in chosen)
  const weightsOk = selected.every((q) => Number(chosen[q.id]) > 0)
  const canCreate = title.trim() !== '' && selected.length > 0 && weightsOk && Number(minutes) > 0 && isValidRubric(rubric) && !creating

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
        title: title.trim(), time_limit_seconds: Math.round(Number(minutes) * 60), rubric: rubricToNumbers(rubric),
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
    <>
      <header className="top">
        <span className="word">AI Grader</span>
        <span className="sp" />
        <span className="muted hide-s">{me.email}</span>
        <Link className="link" to="/teacher/settings">Cài đặt</Link>
        <ThemeToggle />
      </header>
      <div className="wrap">
        <div className="head">
          <div>
            <h1>Bài kiểm tra của tôi</h1>
            <p>Tạo đề từ kho bài có sẵn, rồi gửi liên kết cho học sinh. AI chấm, bạn xem lại khi cần.</p>
          </div>
          <a className="btn btn-primary" href="#tao-bai"><Icon name="plus" />Tạo bài kiểm tra mới</a>
        </div>

        {exams.length === 0 ? (
          <p className="status-line">Chưa có bài kiểm tra nào.</p>
        ) : (
          <table className="stack">
            <thead>
              <tr><th>Tên</th><th>Liên kết cho học sinh</th><th /></tr>
            </thead>
            <tbody>
              {exams.map((e) => (
                <tr key={e.id}>
                  <td className="name"><Link className="link" to={`/teacher/exams/${e.id}`}>{e.title}</Link></td>
                  <td><code>{studentUrl(e.student_path)}</code></td>
                  <td className="r">
                    <button className="btn btn-small" onClick={() => copy(studentUrl(e.student_path))}><Icon name="copy" />Sao chép link</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <section className="form-sec" id="tao-bai">
          <h2>Tạo bài kiểm tra</h2>
          <div className="field-row">
            <label htmlFor="exam-title">Tiêu đề</label>
            <input id="exam-title" name="title" type="text" autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field-row">
            <label htmlFor="exam-minutes">Thời gian (phút)</label>
            <input id="exam-minutes" name="minutes" type="number" min="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
          <div className="field-row">
            <label htmlFor="exam-deadline">Hạn chót</label>
            <input id="exam-deadline" name="deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <h3 style={{ margin: '24px 0 8px' }}>Trọng số tiêu chí chấm</h3>
          <RubricFields value={rubric} onChange={setRubric} />
          <p className="field-hint" style={{ marginTop: 24 }}>Chọn các câu từ kho (mỗi câu có trọng số, mặc định 1):</p>
          <ProblemPicker
            problems={bank} chosen={chosen} onToggle={toggle}
            onWeight={(id, value) => setChosen((prev) => ({ ...prev, [id]: value }))}
          />
          <div className="submit-row">
            <button className="btn btn-primary" onClick={handleCreate} disabled={!canCreate}>Tạo bài kiểm tra</button>
            {errorMessage && <span className="status-error" role="alert">{errorMessage}</span>}
          </div>
          {created && (
            <p className="status-success" aria-live="polite">
              Đã tạo. Link cho học sinh: <code>{studentUrl(created.student_path)}</code>
            </p>
          )}
        </section>
      </div>
    </>
  )
}
