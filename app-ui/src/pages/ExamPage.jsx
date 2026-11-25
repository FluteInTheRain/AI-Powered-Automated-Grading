import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useParams } from 'react-router-dom'
import { getAttemptByReceipt, getExam, runTests, startAttempt, submitQuestion } from '../api.js'
import CodeEditor from '../components/CodeEditor.jsx'
import ResultPanel from '../components/ResultPanel.jsx'
import TestRunPanel from '../components/TestRunPanel.jsx'
import Timer from '../components/Timer.jsx'

// phase: 'loading' | 'closed' | 'name_gate' | 'in_progress' | 'error' (exam could not be loaded)

function secondsUntil(isoDeadline) {
  if (!isoDeadline) return Infinity
  return Math.max(0, (new Date(isoDeadline).getTime() - Date.now()) / 1000)
}

const blankQuestion = (q) => ({ code: q.starter_code, result: null, runResult: null, submitted: false, submitting: false, running: false, error: null })

export default function ExamPage() {
  const { token } = useParams()
  const [exam, setExam] = useState(null)
  const [phase, setPhase] = useState('loading')
  const [errorMessage, setErrorMessage] = useState(null)
  const [studentName, setStudentName] = useState('')
  const [attempt, setAttempt] = useState(null) // { attempt_id, receipt_code }
  const [qs, setQs] = useState({}) // problem_id -> per-question state
  const [active, setActive] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [total, setTotal] = useState(null)
  const [lookupCode, setLookupCode] = useState('')
  const [lookup, setLookup] = useState(null)
  const [lookupError, setLookupError] = useState(null)

  // Refs let the timer callback (which outlives renders) read the latest code and attempt.
  const qsRef = useRef(qs)
  const attemptRef = useRef(attempt)
  const sentRef = useRef(new Set()) // problem ids with a submit already started
  qsRef.current = qs
  attemptRef.current = attempt

  useEffect(() => {
    getExam(token)
      .then((e) => {
        setExam(e)
        setPhase(e.is_closed ? 'closed' : 'name_gate')
      })
      .catch((e) => {
        setErrorMessage(e.message)
        setPhase('error')
      })
  }, [token])

  const patch = useCallback((id, changes) => setQs((prev) => ({ ...prev, [id]: { ...prev[id], ...changes } })), [])

  const submitOne = useCallback(async (problemId) => {
    if (sentRef.current.has(problemId) || !attemptRef.current) return
    sentRef.current.add(problemId)
    patch(problemId, { submitting: true, error: null })
    try {
      const result = await submitQuestion(token, attemptRef.current.attempt_id, problemId, qsRef.current[problemId].code)
      patch(problemId, { submitting: false, submitted: true, result })
    } catch (e) {
      if (/already submitted/i.test(e.message)) {
        patch(problemId, { submitting: false, submitted: true }) // done on the server already
      } else {
        sentRef.current.delete(problemId) // let the student retry
        patch(problemId, { submitting: false, error: e.message })
      }
    }
  }, [token, patch])

  const submitAll = useCallback(() => {
    if (!exam) return
    exam.questions.forEach((q) => submitOne(q.problem_id))
  }, [exam, submitOne])

  const handleRun = async (problemId) => {
    patch(problemId, { running: true })
    try {
      const runResult = await runTests(token, attempt.attempt_id, problemId, qs[problemId].code)
      patch(problemId, { running: false, runResult })
    } catch (e) {
      patch(problemId, { running: false, runResult: { status: 'error', message: e.message, cases: [] } })
    }
  }

  const handleStart = async () => {
    if (!studentName.trim()) return
    try {
      const a = await startAttempt(token, studentName.trim())
      setAttempt(a)
      setQs(Object.fromEntries(exam.questions.map((q) => [q.problem_id, blankQuestion(q)])))
      // Whichever runs out first: the exam's time limit, or its absolute deadline.
      setDurationSeconds(Math.min(exam.time_limit_seconds, secondsUntil(exam.deadline)))
      setPhase('in_progress')
    } catch (e) {
      setErrorMessage(e.message)
    }
  }

  const allSubmitted = !!exam && !!attempt && exam.questions.every((q) => qs[q.problem_id]?.submitted)
  useEffect(() => {
    if (!allSubmitted) return
    getAttemptByReceipt(token, attempt.receipt_code).then((r) => setTotal(r.total)).catch(() => {})
  }, [allSubmitted, token, attempt])

  const handleLookup = async () => {
    setLookup(null)
    setLookupError(null)
    try {
      setLookup(await getAttemptByReceipt(token, lookupCode.trim()))
    } catch (e) {
      setLookupError(e.message)
    }
  }

  if (phase === 'loading') return <p className="status-line">Loading…</p>
  if (phase === 'error') return <p className="status-line status-error">Error: {errorMessage}</p>
  if (phase === 'closed') return <p className="status-line">Đề kiểm tra này đã đóng.</p>

  const question = exam.questions[active]
  const state = qs[question.problem_id]

  const problemPanel = (
    <div className="problem-header">
      <div className="statement">
        <ReactMarkdown>{question.statement}</ReactMarkdown>
      </div>
      <div className="rubric">
        {Object.entries(question.rubric).map(([key, weight]) => (
          <span key={key} className="rubric-chip">
            {key.replace(/_/g, ' ')}: {weight}
          </span>
        ))}
      </div>
      <p className="hidden-note">
        {question.public_case_count} public test case(s) — use "Run Tests" to check pass/fail. Your score is based
        only on the {question.hidden_case_count} hidden test case(s).
      </p>
    </div>
  )

  return (
    <div className="app app-wide">
      <header className="app-header">
        <h1>{exam.title}</h1>
        {phase === 'in_progress' && (
          <Timer durationSeconds={durationSeconds} isRunning={!allSubmitted} onExpire={submitAll} />
        )}
      </header>

      {phase === 'name_gate' && (
        <>
          {problemPanel}
          <div className="name-gate">
            <label htmlFor="student-name">Họ tên</label>
            <input id="student-name" type="text" value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="Nhập họ tên của bạn" />
            <button className="btn btn-primary btn-start" onClick={handleStart} disabled={!studentName.trim()}>
              Bắt đầu ({Math.round(exam.time_limit_seconds / 60)} phút)
            </button>
            {errorMessage && <span className="status-error">{errorMessage}</span>}
          </div>
          <div className="name-gate">
            <label htmlFor="receipt-code">Mã biên nhận</label>
            <input id="receipt-code" type="text" value={lookupCode} onChange={(e) => setLookupCode(e.target.value)} placeholder="Đã làm bài? Nhập mã để xem điểm" />
            <button className="btn btn-secondary" onClick={handleLookup} disabled={!lookupCode.trim()}>
              Xem điểm
            </button>
            {lookupError && <span className="status-error">{lookupError}</span>}
          </div>
          {lookup && (
            <div className="result-panel">
              <p>{lookup.student_name}</p>
              <div className="score-grid">
                {lookup.questions.map((q, i) => (
                  <div key={q.problem_id} className="score-card">
                    <div className="score-card-label">Câu {i + 1}</div>
                    <div className="score-card-value">{q.score === null ? '—' : q.score.toFixed(1)}</div>
                  </div>
                ))}
              </div>
              <p className="final-score-value">{lookup.total === null ? 'Chưa nộp đủ các câu' : `Tổng điểm: ${lookup.total}`}</p>
            </div>
          )}
        </>
      )}

      {phase === 'in_progress' && (
        <>
          <p className="hidden-note">
            Mã biên nhận của bạn: <code>{attempt.receipt_code}</code> — hãy lưu lại để xem điểm sau, kể cả khi tải lại trang.
          </p>
          <div className="submit-row">
            {exam.questions.map((q, i) => (
              <button key={q.problem_id} className={`btn ${i === active ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActive(i)}>
                Câu {i + 1}
              </button>
            ))}
            {allSubmitted && total !== null && <span className="final-score-value">Tổng điểm: {total}</span>}
          </div>
          <div className="solve-grid">
            <div className="solve-left">
              {problemPanel}
              {state.submitted && state.result && <ResultPanel result={state.result} />}
              {state.submitted && !state.result && <p className="status-line">Câu này đã được nộp.</p>}
            </div>
            <div className="solve-right">
              <div className="submit-row">
                {state.error && <span className="status-error">Grading failed: {state.error}</span>}
                <button className="btn btn-secondary" onClick={() => handleRun(question.problem_id)} disabled={state.submitted || state.running}>
                  {state.running ? 'Running…' : 'Run Tests'}
                </button>
                <button className="btn btn-primary" onClick={() => submitOne(question.problem_id)} disabled={state.submitted || state.submitting}>
                  {state.submitting ? 'Grading…' : 'Submit'}
                </button>
              </div>
              <CodeEditor value={state.code} onChange={(code) => patch(question.problem_id, { code })} readOnly={state.submitted || state.submitting} />
              <TestRunPanel runResult={state.runResult} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
