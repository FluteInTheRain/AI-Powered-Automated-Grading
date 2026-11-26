import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useParams } from 'react-router-dom'
import {
  getAttemptByReceipt, getExam, getQuestionStatus, resumeAttempt, retryQuestion, runTests, startAttempt, submitQuestion,
} from '../api.js'
import CodeEditor from '../components/CodeEditor.jsx'
import ResultPanel from '../components/ResultPanel.jsx'
import TestRunPanel from '../components/TestRunPanel.jsx'
import Timer from '../components/Timer.jsx'
import TurnstileWidget from '../components/TurnstileWidget.jsx'

// phase: 'loading' | 'closed' | 'name_gate' | 'in_progress' | 'error' (the exam could not be loaded)
// per-question status: 'none' | 'queued' | 'grading' | 'done' | 'failed'

const POLL_MS = 2000
const GIVE_UP_MS = 5 * 60 * 1000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const storageKey = (token) => `exam:${token}`

function readStored(token) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(token)))
  } catch {
    return null
  }
}
function writeStored(token, value) {
  try {
    if (value) localStorage.setItem(storageKey(token), JSON.stringify(value))
    else localStorage.removeItem(storageKey(token))
  } catch {
    /* storage can be blocked; the attempt then simply cannot be resumed */
  }
}

const blankQuestion = (q) => ({
  code: q.starter_code, status: q.status ?? 'none', result: null, runResult: null,
  running: false, submitting: false, error: null, gaveUp: false,
})

export default function ExamPage() {
  const { token } = useParams()
  const [exam, setExam] = useState(null)
  const [phase, setPhase] = useState('loading')
  const [errorMessage, setErrorMessage] = useState(null)
  const [studentName, setStudentName] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [challenge, setChallenge] = useState(0) // bumped to mount a fresh widget: a Turnstile token works only once
  const [starting, setStarting] = useState(false)
  const [attempt, setAttempt] = useState(null) // { attempt_id, receipt_code }
  const [questions, setQuestions] = useState([])
  const [qs, setQs] = useState({}) // problem_id -> per-question state
  const [active, setActive] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [total, setTotal] = useState(null)
  const [lookupCode, setLookupCode] = useState('')
  const [lookup, setLookup] = useState(null)
  const [lookupError, setLookupError] = useState(null)

  // Refs let long-lived callbacks (timer expiry, polling loops) read the latest values.
  const qsRef = useRef(qs)
  const attemptRef = useRef(attempt)
  const sentRef = useRef(new Set()) // problem ids with a submit already started
  const pollingRef = useRef(new Set()) // problem ids with a poll loop running
  const aliveRef = useRef(true)
  qsRef.current = qs
  attemptRef.current = attempt
  useEffect(() => () => { aliveRef.current = false }, [])

  const patch = useCallback((id, changes) => {
    if (aliveRef.current) setQs((prev) => ({ ...prev, [id]: { ...prev[id], ...changes } }))
  }, [])

  /** Polls a question until it is graded or failed, giving up after five minutes. */
  const watch = useCallback(async (problemId) => {
    if (pollingRef.current.has(problemId)) return
    pollingRef.current.add(problemId)
    const startedAt = Date.now()
    try {
      while (aliveRef.current && Date.now() - startedAt < GIVE_UP_MS) {
        await sleep(POLL_MS)
        let s
        try {
          s = await getQuestionStatus(token, attemptRef.current.attempt_id, problemId)
        } catch {
          continue // a network blip must not end the poll
        }
        if (s.status === 'done') return patch(problemId, { status: 'done', result: s, error: null, stuck: false })
        if (s.status === 'failed') return patch(problemId, { status: 'failed', error: s.error, retryable: s.retryable, stuck: false })
        if (s.status === 'none') {
          // Nothing was stored (e.g. the other submit that held the claim failed): let the student submit again.
          sentRef.current.delete(problemId)
          return patch(problemId, { status: 'none', error: null, stuck: false })
        }
        patch(problemId, { status: s.status, stuck: !!s.stuck })
      }
      if (aliveRef.current) patch(problemId, { gaveUp: true })
    } finally {
      pollingRef.current.delete(problemId)
    }
  }, [token, patch])

  /** One look at an already-settled question (after a resume) to get its result or error. */
  const settle = useCallback(async (problemId, attemptId) => {
    try {
      const s = await getQuestionStatus(token, attemptId, problemId)
      if (s.status === 'done') patch(problemId, { status: 'done', result: s })
      else if (s.status === 'failed') patch(problemId, { status: 'failed', error: s.error, retryable: s.retryable })
    } catch {
      /* the receipt lookup still shows the score */
    }
  }, [token, patch])

  const enterExam = useCallback((att, qList, remainingSeconds) => {
    attemptRef.current = att
    setAttempt(att)
    setQuestions(qList)
    const initial = Object.fromEntries(qList.map((q) => [q.problem_id, blankQuestion(q)]))
    qsRef.current = initial
    setQs(initial)
    setDurationSeconds(remainingSeconds)
    setPhase('in_progress')
    qList.forEach((q) => {
      if (q.status === 'queued' || q.status === 'grading') {
        sentRef.current.add(q.problem_id)
        watch(q.problem_id)
      } else if (q.status === 'done' || q.status === 'failed') {
        sentRef.current.add(q.problem_id)
        settle(q.problem_id, att.attempt_id)
      }
    })
  }, [watch, settle])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let e
      try {
        e = await getExam(token)
      } catch (err) {
        if (!cancelled) { setErrorMessage(err.message); setPhase('error') }
        return
      }
      if (cancelled) return
      setExam(e)
      if (e.is_closed) return setPhase('closed')
      const stored = readStored(token)
      if (stored?.attempt_id) {
        try {
          const r = await resumeAttempt(token, stored.attempt_id)
          if (!cancelled) enterExam({ attempt_id: stored.attempt_id, receipt_code: r.receipt_code }, r.questions, r.remaining_seconds)
          return
        } catch (err) {
          if (err.status !== 404) {
            // An outage or a blip: keep the stored attempt so the student can reload and continue.
            if (!cancelled) { setErrorMessage(`Không thể tải lại bài làm: ${err.message}`); setPhase('error') }
            return
          }
          writeStored(token, null) // the server does not know this attempt: forget it and start fresh
        }
      }
      if (!cancelled) setPhase('name_gate')
    })()
    return () => { cancelled = true }
  }, [token, enterExam])

  const submitOne = useCallback(async (problemId) => {
    if (sentRef.current.has(problemId) || !attemptRef.current) return
    sentRef.current.add(problemId)
    patch(problemId, { submitting: true, error: null })
    try {
      await submitQuestion(token, attemptRef.current.attempt_id, problemId, qsRef.current[problemId].code)
      patch(problemId, { submitting: false, status: 'queued' })
      watch(problemId)
    } catch (e) {
      if (/already submitted|in progress/i.test(e.message)) {
        patch(problemId, { submitting: false, status: 'queued' }) // it is on the server already: just watch it
        watch(problemId)
      } else {
        sentRef.current.delete(problemId) // let the student retry
        patch(problemId, { submitting: false, error: e.message })
      }
    }
  }, [token, patch, watch])

  const submitAll = useCallback(() => {
    questions.forEach((q) => {
      if (qsRef.current[q.problem_id]?.status === 'none') submitOne(q.problem_id)
    })
  }, [questions, submitOne])

  const handleRetry = async (problemId) => {
    patch(problemId, { error: null, status: 'queued', stuck: false, retryable: undefined, gaveUp: false })
    try {
      await retryQuestion(token, attempt.attempt_id, problemId)
      watch(problemId)
    } catch (e) {
      patch(problemId, { status: 'failed', error: e.message })
    }
  }

  const handleRun = async (problemId) => {
    patch(problemId, { running: true })
    try {
      const runResult = await runTests(token, attempt.attempt_id, problemId, qs[problemId].code)
      patch(problemId, { running: false, runResult })
    } catch (e) {
      patch(problemId, { running: false, runResult: { status: 'error', message: e.message, cases: [] } })
    }
  }

  const needsTurnstile = !!exam?.turnstile_site_key
  const canStart = studentName.trim() !== '' && (!needsTurnstile || turnstileToken !== '') && !starting

  const handleStart = async () => {
    if (!canStart) return
    setStarting(true)
    setErrorMessage(null)
    try {
      const r = await startAttempt(token, studentName.trim(), turnstileToken || undefined)
      const att = { attempt_id: r.attempt_id, receipt_code: r.receipt_code }
      writeStored(token, att)
      enterExam(att, r.questions, r.remaining_seconds)
    } catch (e) {
      setErrorMessage(e.message)
      setTurnstileToken('')
      setChallenge((n) => n + 1)
    } finally {
      setStarting(false)
    }
  }

  const allSubmitted = questions.length > 0 && questions.every((q) => qs[q.problem_id]?.status && qs[q.problem_id].status !== 'none')
  const allDone = questions.length > 0 && questions.every((q) => qs[q.problem_id]?.status === 'done')
  useEffect(() => {
    if (!allDone || !attempt) return
    getAttemptByReceipt(token, attempt.receipt_code).then((r) => setTotal(r.total)).catch(() => {})
  }, [allDone, token, attempt])

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

  const question = questions[active]
  const state = question ? qs[question.problem_id] : null
  const waiting = state && (state.submitting || state.status === 'queued' || state.status === 'grading')
  const canRetry = state && ((state.status === 'failed' && state.retryable !== false) || (state.stuck && state.status !== 'done'))

  return (
    <div className="app app-wide">
      <header className="app-header">
        <h1>{exam.title}</h1>
        {phase === 'in_progress' && <Timer durationSeconds={durationSeconds} isRunning={!allSubmitted} onExpire={submitAll} />}
      </header>

      {phase === 'name_gate' && (
        <>
          <p className="hidden-note">Bài gồm {exam.question_count} câu. Đề sẽ hiện sau khi bạn bấm Bắt đầu.</p>
          <div className="name-gate">
            <label htmlFor="student-name">Họ tên</label>
            <input id="student-name" type="text" value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="Nhập họ tên của bạn" />
            {needsTurnstile && <TurnstileWidget key={challenge} siteKey={exam.turnstile_site_key} onToken={setTurnstileToken} />}
            <button className="btn btn-primary btn-start" onClick={handleStart} disabled={!canStart}>
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

      {phase === 'in_progress' && question && (
        <>
          <p className="hidden-note">
            Mã biên nhận của bạn: <code>{attempt.receipt_code}</code> — hãy lưu lại để xem điểm sau, kể cả khi tải lại trang.
          </p>
          <div className="submit-row">
            {questions.map((q, i) => (
              <button key={q.problem_id} className={`btn ${i === active ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActive(i)}>
                Câu {i + 1}
              </button>
            ))}
            {allDone && total !== null && <span className="final-score-value">Tổng điểm: {total}</span>}
          </div>
          <div className="solve-grid">
            <div className="solve-left">
              <div className="problem-header">
                <div className="statement">
                  <ReactMarkdown>{question.statement}</ReactMarkdown>
                </div>
                <div className="rubric">
                  {Object.entries(question.rubric).map(([key, weight]) => (
                    <span key={key} className="rubric-chip">{key.replace(/_/g, ' ')}: {weight}</span>
                  ))}
                </div>
                <p className="hidden-note">
                  {question.public_case_count} public test case(s) — use "Run Tests" to check pass/fail. Your score is based
                  only on the {question.hidden_case_count} hidden test case(s).
                </p>
              </div>
              {state.status === 'done' && state.result && <ResultPanel result={state.result} />}
              {state.gaveUp && state.status !== 'done' && (
                <p className="status-line">Chấm bài đang mất nhiều thời gian. Điểm sẽ hiện trong phần xem điểm bằng mã biên nhận ở trang đầu.</p>
              )}
            </div>
            <div className="solve-right">
              <div className="submit-row">
                {state.status === 'failed' && <span className="status-error">{state.error}</span>}
                {state.status === 'none' && state.error && <span className="status-error">Grading failed: {state.error}</span>}
                <button className="btn btn-secondary" onClick={() => handleRun(question.problem_id)} disabled={state.status !== 'none' || state.running}>
                  {state.running ? 'Running…' : 'Run Tests'}
                </button>
                {canRetry ? (
                  <button className="btn btn-primary" onClick={() => handleRetry(question.problem_id)}>Chấm lại</button>
                ) : (
                  <button className="btn btn-primary" onClick={() => submitOne(question.problem_id)} disabled={state.status !== 'none' || state.submitting}>
                    {waiting ? 'Grading…' : state.status === 'done' ? 'Đã chấm' : state.status === 'failed' ? 'Đã nộp' : 'Submit'}
                  </button>
                )}
              </div>
              <CodeEditor
                filename={`solution_${active + 1}.py`} value={state.code}
                onChange={(code) => patch(question.problem_id, { code })} readOnly={state.status !== 'none' || state.submitting}
              />
              <TestRunPanel runResult={state.runResult} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
