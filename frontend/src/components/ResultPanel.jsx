export default function ResultPanel({ result }) {
  if (!result) return null
  const { sub_scores_0_to_1: scores, final_score_0_to_100: finalScore, execution_result: exec, feedback } = result

  return (
    <div className="result-panel">
      <div className="final-score">
        <span className="final-score-label">Final score</span>
        <span className="final-score-value">{finalScore.toFixed(1)} / 100</span>
      </div>

      <div className="score-grid">
        {Object.entries(scores).map(([key, val]) => (
          <div key={key} className="score-card">
            <div className="score-card-label">{key.replace(/_/g, ' ')}</div>
            <div className="score-card-value">{val.toFixed(2)}</div>
          </div>
        ))}
      </div>

      <div className="exec-detail">
        <h3>Sandbox execution (hidden test cases)</h3>
        <p>
          Passed {exec.pass_count}/{exec.total} hidden test cases ({exec.status})
        </p>
        {exec.errors.length > 0 && (
          <ul className="exec-errors">
            {exec.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        )}
      </div>

      {feedback && (
        <div className="feedback-section">
          <h3>Nhận xét từ AI</h3>
          <p className="feedback-summary">{feedback.summary}</p>
          {feedback.issues.length > 0 && (
            <ul className="feedback-issue-list">
              {feedback.issues.map((item, i) => (
                <li key={i} className="feedback-issue">
                  <div className="feedback-issue-title">
                    <span className="feedback-issue-line">Dòng {item.line}</span>
                    {item.issue}
                  </div>
                  <p className="feedback-issue-explanation">{item.explanation}</p>
                  <p className="feedback-issue-fix">
                    <strong>Gợi ý sửa:</strong> {item.suggested_fix}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
