export default function TestRunPanel({ runResult }) {
  if (!runResult) return null

  if (runResult.status !== 'ran') {
    return (
      <div className="test-run-panel test-run-panel-error">
        {runResult.message}
      </div>
    )
  }

  const passCount = runResult.cases.filter((c) => c.passed).length
  const total = runResult.cases.length

  return (
    <div className="test-run-panel">
      <div className={`test-run-summary${passCount === total ? ' test-run-summary-ok' : ' test-run-summary-fail'}`}>
        {passCount}/{total} public test case(s) passed
      </div>
      <ul className="test-case-list">
        {runResult.cases.map((c, i) => (
          <li key={i} className={c.passed ? 'test-case-pass' : 'test-case-fail'}>
            <span className="test-case-icon">{c.passed ? '✓' : '✗'}</span>
            Test {i + 1}: {c.passed ? 'Passed' : 'Failed'}
            {!c.passed && c.error && <span className="test-case-error"> — {c.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
