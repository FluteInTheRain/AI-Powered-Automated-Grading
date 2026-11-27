import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useParams } from 'react-router-dom'
import {
  getAttemptByReceipt, getExam, getQuestionStatus, listAppeals, resumeAttempt, retryQuestion, runTests, startAttempt, submitExam,
} from '../api.js'
import AppealForm, { APPEAL_STATUS } from '../components/AppealForm.jsx'
import CodeEditor from '../components/CodeEditor.jsx'
import Icon from '../components/Icon.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import ResultPanel from '../components/ResultPanel.jsx'
import TestRunPanel from '../components/TestRunPanel.jsx'
import Timer from '../components/Timer.jsx'
import TurnstileWidget from '../components/TurnstileWidget.jsx'

// phase: 'loading' | 'closed' | 'name_gate' | 'in_progress' | 'error' (the exam could not be loaded)
// per-question status: 'none' | 'queued' | 'grading' | 'done' | 'failed'
// The whole exam is submitted at once: before that every status is 'none'; after it each question is graded on its own.

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

// Typed code is kept in this browser (not on the server) so a reload or a crash does not lose it.
const draftsKey = (token, attemptId) => `exam:${token}:${attemptId}:drafts` // per attempt: a shared browser must not mix people
function readDrafts(token, attemptId) {
  try {
    return JSON.parse(localStorage.getItem(draftsKey(token, attemptId))) || {}
  } catch {
    return {}
  }
}
function writeDraft(token, attemptId, problemId, code) {
  try {
    localStorage.setItem(draftsKey(token, attemptId), JSON.stringify({ ...readDrafts(token, attemptId), [problemId]: code }))
  } catch {
    /* storage can be blocked; the draft then lives only in memory */
  }
}
function clearDrafts(token, attemptId) {
  try {
    localStorage.removeItem(draftsKey(token, attemptId))
  } catch {
    /* nothing to clear */
  }
}

const blankQuestion = (q) => ({
  code: q.starter_code, status: q.status ?? 'none', result: null, runResult: null,
  running: false, error: null, gaveUp: false, stuck: false, retryable: undefined,
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
  const [submitted, setSubmitted] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [total, setTotal] = useState(null)
  const [lookupCode, setLookupCode] = useState('')
  const [lookup, setLookup] = useState(null)
  const [lookupError, setLookupError] = useState(null)
  const [lookupReceipt, setLookupReceipt] = useState('') // the code the shown lookup was made with
  const [appeals, setAppeals] = useState([])
  const [appealing, setAppealing] = useState(null) // problem id whose appeal form is open
  const [mobileTab, setMobileTab] = useState('problem') // phones show the statement or the editor, not both
  const [savedAt, setSavedAt] = useState(null)

  // Refs let long-lived callbacks (timer expiry, polling loops) read the latest values.
  const qsRef = useRef(qs)
  const attemptRef = useRef(attempt)
  const submitRef = useRef(false) // true once a submit started: the button and the timer share this guard
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
        if (s.status === 'none') return patch(problemId, { status: 'none', error: null, stuck: false }) // nothing was stored
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

  const enterExam = useCallback((att, qList, remainingSeconds, wasSubmitted) => {
    attemptRef.current = att
    setAttempt(att)
    setQuestions(qList)
    const drafts = wasSubmitted ? {} : readDrafts(token, att.attempt_id)
    const initial = Object.fromEntries(qList.map((q) => [q.problem_id, { ...blankQuestion(q), code: drafts[q.problem_id] ?? q.starter_code }]))
    qsRef.current = initial
    setQs(initial)
    setDurationSeconds(remainingSeconds)
    submitRef.current = !!wasSubmitted
    setSubmitted(!!wasSubmitted)
    setPhase('in_progress')
    qList.forEach((q) => {
      if (q.status === 'queued' || q.status === 'grading') watch(q.problem_id)
      else if (q.status === 'done' || q.status === 'failed') settle(q.problem_id, att.attempt_id)
    })
  }, [token, watch, settle])

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
          if (!cancelled) enterExam({ attempt_id: stored.attempt_id, receipt_code: r.receipt_code }, r.questions, r.remaining_seconds, r.submitted)
          return
        } catch (err) {
          if (err.status !== 404) {
            // An outage or a blip: keep the stored attempt so the student can reload and continue.
            if (!cancelled) { setErrorMessage(`Không thể tải lại bài làm: ${err.message}`); setPhase('error') }
            return
          }
          clearDrafts(token, stored.attempt_id) // forget the attempt and its drafts together
          writeStored(token, null) // the server does not know this attempt: start fresh
        }
      }
      if (!cancelled) setPhase('name_gate')
    })()
    return () => { cancelled = true }
  }, [token, enterExam])

  /** Submits every answer in one call. Shared by the confirm button and the timer, guarded so it runs once. */
  const submitWholeExam = useCallback(async () => {
    if (submitRef.current || !attemptRef.current) return
    submitRef.current = true
    setConfirming(false)
    setSubmitError(null)
    const answers = Object.fromEntries(questions.map((q) => [q.problem_id, qsRef.current[q.problem_id].code]))
    const markSubmitted = () => {
      clearDrafts(token, attemptRef.current.attempt_id)
      setQs((prev) => Object.fromEntries(Object.entries(prev).map(([id, st]) => [id, { ...st, status: 'queued', error: null }])))
      setSubmitted(true)
      questions.forEach((q) => watch(q.problem_id))
    }
    try {
      await submitExam(token, attemptRef.current.attempt_id, answers)
      markSubmitted()
    } catch (e) {
      // A 409 (already stored) and a 503 (stored, but the queue send failed) both mean the answers are on the server:
      // lock the exam and watch the questions; "Chấm lại" appears for any job that stays stuck.
      if (/already submitted|in progress/i.test(e.message) || e.status === 503) {
        markSubmitted()
      } else {
        submitRef.current = false // let the student try again
        setSubmitError(e.message)
      }
    }
  }, [token, questions, watch])

  // If the server says nothing was stored for any question, the exam is open again.
  useEffect(() => {
    if (submitted && questions.length > 0 && questions.every((q) => qs[q.problem_id]?.status === 'none')) {
      submitRef.current = false
      setSubmitted(false)
    }
  }, [submitted, questions, qs])

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
      enterExam(att, r.questions, r.remaining_seconds, r.submitted)
    } catch (e) {
      setErrorMessage(e.message)
      setTurnstileToken('')
      setChallenge((n) => n + 1)
    } finally {
      setStarting(false)
    }
  }

  // A permanently failed question (the code killed the sandbox) is settled: the server scores it 0 and still gives a total.
  const isSettled = (st) => st?.status === 'done' || (st?.status === 'failed' && st.retryable === false)
  const gradedCount = questions.filter((q) => isSettled(qs[q.problem_id])).length
  const allDone = questions.length > 0 && gradedCount === questions.length
  useEffect(() => {
    if (!allDone || !attempt) return
    getAttemptByReceipt(token, attempt.receipt_code).then((r) => setTotal(r.total)).catch(() => {})
  }, [allDone, token, attempt])

  const handleLookup = async () => {
    setLookup(null)
    setLookupError(null)
    setAppealing(null)
    const receipt = lookupCode.trim()
    try {
      const [result, filed] = await Promise.allSettled([getAttemptByReceipt(token, receipt), listAppeals(token, receipt)])
      if (result.status === 'rejected') throw result.reason
      setLookup(result.value)
      setAppeals(filed.status === 'fulfilled' ? filed.value : [])
      if (filed.status === 'rejected') setLookupError('Không tải được trạng thái khiếu nại. Điểm vẫn hiển thị bình thường.')
      setLookupReceipt(receipt)
    } catch (e) {
      setLookupError(e.message)
    }
  }

  const handleAppealFiled = async () => {
    const problemId = appealing
    setAppealing(null)
    try {
      setAppeals(await listAppeals(token, lookupReceipt))
    } catch {
      // The appeal is filed; only the refresh failed. Show it as waiting so the student does not file it twice.
      setAppeals((prev) => [...prev, { problem_id: problemId, status: 'open', message: '', decision_note: null, created_at: '', decided_at: null, score: null }])
      setLookupError('Khiếu nại đã gửi, nhưng chưa tải lại được trạng thái.')
    }
  }

  if (phase === 'loading') return <p className="status-line">Loading…</p>
  if (phase === 'error') return <p className="status-line status-error">Error: {errorMessage}</p>
  if (phase === 'closed') return <p className="status-line">Đề kiểm tra này đã đóng.</p>

  const question = questions[active]
  const state = question ? qs[question.problem_id] : null
  const canRetry = state && ((state.status === 'failed' && state.retryable !== false) || (state.stuck && state.status !== 'done'))
  const inProgress = phase === 'in_progress' && question
  const answered = questions.filter((q) => qs[q.problem_id] && qs[q.problem_id].code !== q.starter_code).length
  const unanswered = questions.length - answered
  const clock = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <header className="top">
        <span className="word">{exam.title}</span>
        <span className="sp" />
        {inProgress && !submitted && <span className="muted num hide-s">Đã làm {answered} trên {questions.length} câu</span>}
        {phase === 'in_progress' && <Timer durationSeconds={durationSeconds} isRunning={!submitted} onExpire={submitWholeExam} />}
        <ThemeToggle />
        {inProgress && !submitted && !confirming && (
          <button className="btn btn-primary" onClick={() => setConfirming(true)}><Icon name="send" />Nộp bài</button>
        )}
      </header>

      {inProgress && (
        <div className="bar" role="progressbar" aria-label="Số câu đã làm" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={submitted ? questions.length : answered}>
          <i style={{ width: `${questions.length ? ((submitted ? questions.length : answered) / questions.length) * 100 : 0}%` }} />
        </div>
      )}

      {phase === 'name_gate' && (
        <div className="gate">
          <h1>{exam.title}</h1>
          <p className="hidden-note">Bài gồm {exam.question_count} câu. Đề sẽ hiện sau khi bạn bấm Bắt đầu.</p>
          <div className="gate-sec">
            <div className="field-row">
              <label htmlFor="student-name">Họ tên</label>
              <input id="student-name" name="name" type="text" autoComplete="name" value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="Nhập họ tên của bạn…" />
            </div>
            {needsTurnstile && <TurnstileWidget key={challenge} siteKey={exam.turnstile_site_key} onToken={setTurnstileToken} />}
            <button className="btn btn-primary" onClick={handleStart} disabled={!canStart}>
              Bắt đầu ({Math.round(exam.time_limit_seconds / 60)} phút)
            </button>
            {errorMessage && <p className="status-error" role="alert">{errorMessage}</p>}
          </div>
          <div className="gate-sec">
            <div className="field-row">
              <label htmlFor="receipt-code">Mã biên nhận</label>
              <input id="receipt-code" name="receipt" type="text" autoComplete="off" spellCheck={false} value={lookupCode} onChange={(e) => setLookupCode(e.target.value)} placeholder="Đã làm bài? Nhập mã để xem điểm…" />
            </div>
            <button className="btn" onClick={handleLookup} disabled={!lookupCode.trim()}>
              Xem điểm
            </button>
            {lookupError && <p className="status-error" role="alert">{lookupError}</p>}
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
                {lookup.questions.map((q, i) => {
                  if (q.score === null) return null
                  const appeal = appeals.find((a) => a.problem_id === q.problem_id)
                  return (
                    <div key={q.problem_id} className="appeal-row">
                      {appeal ? (
                        <>
                          <p>Câu {i + 1}: <strong>{APPEAL_STATUS[appeal.status] ?? appeal.status}</strong></p>
                          {appeal.decision_note && <p className="muted">Giáo viên: {appeal.decision_note}</p>}
                        </>
                      ) : appealing === q.problem_id ? (
                        <AppealForm token={token} receipt={lookupReceipt} problemId={q.problem_id} siteKey={exam?.turnstile_site_key ?? ''} onFiled={handleAppealFiled} />
                      ) : (
                        <button className="btn" onClick={() => setAppealing(q.problem_id)}>Khiếu nại câu {i + 1}</button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {inProgress && (
        <>
          {submitted && (
            <div className="notice" aria-live="polite">
              <p style={{ margin: 0 }}>Đã chấm {gradedCount}/{questions.length} câu{allDone ? '' : '…'}</p>
              {allDone && total !== null && <p className="final-score-value">Tổng điểm: {total}</p>}
            </div>
          )}
          {!submitted && confirming && (
            <div className="confirm-bar" role="alert">
              <span>{unanswered > 0 ? `Nộp bài? Bạn còn ${unanswered} câu chưa làm. Sau khi nộp không thể sửa.` : 'Nộp bài? Sau khi nộp không thể sửa.'}</span>
              <button className="btn btn-primary" onClick={submitWholeExam}>Xác nhận nộp</button>
              <button className="btn" onClick={() => setConfirming(false)}>Hủy</button>
            </div>
          )}
          {!submitted && submitError && <div className="confirm-bar status-error" role="alert">Không nộp được: {submitError}</div>}

          <div className="mtabs" role="tablist" aria-label="Chuyển giữa đề bài và bài làm">
            <button role="tab" aria-selected={mobileTab === 'problem'} onClick={() => setMobileTab('problem')}>Đề bài</button>
            <button role="tab" aria-selected={mobileTab === 'code'} onClick={() => setMobileTab('code')}>Bài làm</button>
          </div>

          <div className="ide" data-p={mobileTab}>
            <nav className="pane qnav" aria-label="Danh sách câu hỏi">
              <div className="ph">Câu hỏi</div>
              {questions.map((q, i) => {
                const st = qs[q.problem_id]
                const done = submitted ? st?.status === 'done' : st && st.code !== q.starter_code
                return (
                  <button key={q.problem_id} className={`q${i === active ? ' on' : ''}${done ? ' done' : ''}`} aria-current={i === active ? 'true' : undefined} onClick={() => setActive(i)}>
                    <Icon name={done ? 'check' : 'dot'} />
                    Câu {i + 1}
                  </button>
                )
              })}
            </nav>

            <article className="pane prob-pane">
              <div className="ph"><span>Đề bài</span></div>
              <div className="pb">
                <div className="statement">
                  <ReactMarkdown>{question.statement}</ReactMarkdown>
                </div>
                <div className="rubric">
                  {Object.entries(question.rubric).map(([key, weight]) => (
                    <span key={key}>{key.replace(/_/g, ' ')}: {weight}</span>
                  ))}
                </div>
                <p className="hidden-note">
                  {question.public_case_count} public test case(s) — use "Run Tests" to check pass/fail. Your score is based
                  only on the {question.hidden_case_count} hidden test case(s).
                </p>
                <p className="hidden-note">
                  Mã biên nhận của bạn: <code>{attempt.receipt_code}</code> — hãy lưu lại để xem điểm sau, kể cả khi tải lại trang.
                </p>
                {state.status === 'done' && state.result && <ResultPanel result={state.result} />}
                {state.gaveUp && state.status !== 'done' && (
                  <p className="status-line">Chấm bài đang mất nhiều thời gian. Điểm sẽ hiện trong phần xem điểm bằng mã biên nhận ở trang đầu.</p>
                )}
                <div className="submit-row">
                  <button className="btn" disabled={active === 0} onClick={() => setActive(active - 1)}>Câu trước</button>
                  <button className="btn" disabled={active === questions.length - 1} onClick={() => setActive(active + 1)}>Câu sau</button>
                </div>
              </div>
            </article>

            <section className="pane code-pane">
              <div className="ph">
                <span>Bài làm, Python</span>
                {savedAt && !submitted && <span className="save" aria-live="polite"><Icon name="check" />Đã lưu {clock(savedAt)}</span>}
                <span className="actions">
                  {state.status === 'failed' && <span className="status-error">{state.error}</span>}
                  <button className="btn btn-small" onClick={() => handleRun(question.problem_id)} disabled={state.status !== 'none' || state.running}>
                    <Icon name="play" />
                    {state.running ? 'Running…' : 'Run Tests'}
                  </button>
                  {canRetry && <button className="btn btn-primary btn-small" onClick={() => handleRetry(question.problem_id)}>Chấm lại</button>}
                </span>
              </div>
              <CodeEditor
                filename={`solution_${active + 1}.py`} value={state.code}
                onChange={(code) => { patch(question.problem_id, { code }); writeDraft(token, attempt.attempt_id, question.problem_id, code); setSavedAt(new Date()) }} readOnly={state.status !== 'none'}
              />
              <TestRunPanel runResult={state.runResult} />
            </section>
          </div>
        </>
      )}
    </>
  )
}
