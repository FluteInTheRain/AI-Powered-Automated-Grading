import { useCallback, useEffect, useState } from 'react'
import { getProblem, listProblems, runPublicTests, submitCode } from './api.js'
import ProblemHeader from './components/ProblemHeader.jsx'
import CodeEditor from './components/CodeEditor.jsx'
import Timer from './components/Timer.jsx'
import ResultPanel from './components/ResultPanel.jsx'
import TestRunPanel from './components/TestRunPanel.jsx'

// phase: 'loading' | 'idle' | 'in_progress' | 'grading' | 'done' | 'error'

export default function App() {
  const [problems, setProblems] = useState([])
  const [problemId, setProblemId] = useState(null)
  const [problem, setProblem] = useState(null)
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState('loading')
  const [result, setResult] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)
  const [runResult, setRunResult] = useState(null)
  const [isRunningTests, setIsRunningTests] = useState(false)

  useEffect(() => {
    listProblems()
      .then((list) => {
        setProblems(list)
        if (list.length > 0) setProblemId(list[0].id)
      })
      .catch((e) => {
        setErrorMessage(e.message)
        setPhase('error')
      })
  }, [])

  useEffect(() => {
    if (!problemId) return
    setPhase('loading')
    getProblem(problemId)
      .then((p) => {
        setProblem(p)
        setCode(p.starter_code)
        setPhase('idle')
      })
      .catch((e) => {
        setErrorMessage(e.message)
        setPhase('error')
      })
  }, [problemId])

  const handleSubmit = useCallback(async () => {
    setPhase('grading')
    setErrorMessage(null)
    try {
      const data = await submitCode(problemId, code)
      setResult(data)
      setPhase('done')
    } catch (e) {
      setErrorMessage(e.message)
      setPhase('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId, code])

  const handleRunTests = useCallback(async () => {
    setIsRunningTests(true)
    try {
      const data = await runPublicTests(problemId, code)
      setRunResult(data)
    } catch (e) {
      setRunResult({ status: 'error', message: e.message, cases: [] })
    } finally {
      setIsRunningTests(false)
    }
  }, [problemId, code])

  const handleStart = () => {
    setResult(null)
    setRunResult(null)
    setPhase('in_progress')
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI-Powered Automated Grading</h1>
        {phase !== 'idle' && phase !== 'loading' && problem && (
          <Timer
            durationSeconds={problem.time_limit_seconds}
            isRunning={phase === 'in_progress'}
            onExpire={handleSubmit}
          />
        )}
      </header>

      {phase === 'loading' && <p className="status-line">Loading…</p>}

      {phase === 'error' && (
        <p className="status-line status-error">Error: {errorMessage}</p>
      )}

      {problem && phase !== 'loading' && (
        <>
          {phase === 'idle' && (
            <div className="problem-select">
              <label htmlFor="problem-picker">Problem</label>
              <select
                id="problem-picker"
                value={problemId ?? ''}
                onChange={(e) => setProblemId(e.target.value)}
              >
                {problems.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <ProblemHeader problem={problem} />

          {phase === 'idle' && (
            <button className="btn btn-primary btn-start" onClick={handleStart}>
              Start ({Math.round(problem.time_limit_seconds / 60)} min)
            </button>
          )}

          {(phase === 'in_progress' || phase === 'grading' || phase === 'done' || phase === 'error') && (
            <>
              <CodeEditor
                value={code}
                onChange={setCode}
                readOnly={phase !== 'in_progress'}
              />
              <div className="submit-row">
                <button
                  className="btn btn-secondary"
                  onClick={handleRunTests}
                  disabled={phase !== 'in_progress' || isRunningTests}
                >
                  {isRunningTests ? 'Running…' : 'Run Tests'}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSubmit}
                  disabled={phase !== 'in_progress'}
                >
                  {phase === 'grading' ? 'Grading…' : 'Submit'}
                </button>
                {phase === 'error' && (
                  <span className="status-error">Grading failed: {errorMessage}</span>
                )}
              </div>
              <TestRunPanel runResult={runResult} />
            </>
          )}

          {phase === 'done' && <ResultPanel result={result} />}
        </>
      )}
    </div>
  )
}
