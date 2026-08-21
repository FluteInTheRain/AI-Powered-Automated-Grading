import { useCallback, useEffect, useState } from 'react'
import { getExamByToken, runExamTests, submitExam } from '../api.js'
import CodeEditor from '../components/CodeEditor.jsx'
import Timer from '../components/Timer.jsx'
import ResultPanel from '../components/ResultPanel.jsx'
import TestRunPanel from '../components/TestRunPanel.jsx'

// phase: 'loading' | 'closed' | 'name_gate' | 'in_progress' | 'grading' | 'done' | 'error'

function secondsUntil(isoDeadline) {
  if (!isoDeadline) return Infinity
  return Math.max(0, (new Date(isoDeadline).getTime() - Date.now()) / 1000)
}

export default function ExamPage({ studentToken }) {
  const [exam, setExam] = useState(null)
  const [studentName, setStudentName] = useState('')
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState('loading')
  const [result, setResult] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)
  const [runResult, setRunResult] = useState(null)
  const [isRunningTests, setIsRunningTests] = useState(false)
  const [durationSeconds, setDurationSeconds] = useState(0)

  useEffect(() => {
    getExamByToken(studentToken)
      .then((e) => {
        setExam(e)
        setCode(e.starter_code)
        setPhase(e.is_closed ? 'closed' : 'name_gate')
      })
      .catch((e) => {
        setErrorMessage(e.message)
        setPhase('error')
      })
  }, [studentToken])

  const handleSubmit = useCallback(async () => {
    setPhase('grading')
    setErrorMessage(null)
    try {
      const data = await submitExam(studentToken, studentName, code)
      setResult(data)
      setPhase('done')
    } catch (e) {
      setErrorMessage(e.message)
      setPhase('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentToken, studentName, code])

  const handleRunTests = useCallback(async () => {
    setIsRunningTests(true)
    try {
      const data = await runExamTests(studentToken, code)
      setRunResult(data)
    } catch (e) {
      setRunResult({ status: 'error', message: e.message, cases: [] })
    } finally {
      setIsRunningTests(false)
    }
  }, [studentToken, code])

  const handleStart = () => {
    if (!studentName.trim()) return
    // Whichever runs out first: the problem's own time limit, or the
    // exam's absolute deadline (if the student sat on this screen a
    // while, the deadline may now be the tighter constraint).
    setDurationSeconds(Math.min(exam.time_limit_seconds, secondsUntil(exam.deadline)))
    setResult(null)
    setRunResult(null)
    setPhase('in_progress')
  }

  if (phase === 'loading') return <p className="status-line">Loading…</p>
  if (phase === 'error' && !exam) return <p className="status-line status-error">Error: {errorMessage}</p>
  if (phase === 'closed') return <p className="status-line">Đề kiểm tra này đã đóng.</p>

  return (
    <div className="app">
      <header className="app-header">
        <h1>Bài kiểm tra</h1>
        {(phase === 'in_progress' || phase === 'grading' || phase === 'done' || phase === 'error') && (
          <Timer durationSeconds={durationSeconds} isRunning={phase === 'in_progress'} onExpire={handleSubmit} />
        )}
      </header>

      <div className="problem-header">
        <p className="statement">{exam.statement}</p>
        <div className="rubric">
          {Object.entries(exam.rubric).map(([key, weight]) => (
            <span key={key} className="rubric-chip">
              {key.replace(/_/g, ' ')}: {weight}
            </span>
          ))}
        </div>
        <p className="hidden-note">
          {exam.public_test_case_count} public test case(s) — use "Run Tests" to check pass/fail. Your
          score is based only on the {exam.hidden_test_case_count} hidden test case(s).
        </p>
      </div>

      {phase === 'name_gate' && (
        <div className="name-gate">
          <label htmlFor="student-name">Họ tên</label>
          <input
            id="student-name"
            type="text"
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            placeholder="Nhập họ tên của bạn"
          />
          <button className="btn btn-primary btn-start" onClick={handleStart} disabled={!studentName.trim()}>
            Bắt đầu ({Math.round(exam.time_limit_seconds / 60)} phút)
          </button>
        </div>
      )}

      {(phase === 'in_progress' || phase === 'grading' || phase === 'done' || phase === 'error') && (
        <>
          <CodeEditor value={code} onChange={setCode} readOnly={phase !== 'in_progress'} />
          <div className="submit-row">
            <button
              className="btn btn-secondary"
              onClick={handleRunTests}
              disabled={phase !== 'in_progress' || isRunningTests}
            >
              {isRunningTests ? 'Running…' : 'Run Tests'}
            </button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={phase !== 'in_progress'}>
              {phase === 'grading' ? 'Grading…' : 'Submit'}
            </button>
            {phase === 'error' && <span className="status-error">Grading failed: {errorMessage}</span>}
          </div>
          <TestRunPanel runResult={runResult} />
        </>
      )}

      {phase === 'done' && <ResultPanel result={result} />}
    </div>
  )
}
