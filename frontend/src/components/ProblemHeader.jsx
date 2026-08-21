export default function ProblemHeader({ problem }) {
  if (!problem) return null
  return (
    <div className="problem-header">
      <h2>{problem.id}</h2>
      <p className="statement">{problem.statement}</p>
      <div className="rubric">
        {Object.entries(problem.rubric).map(([key, weight]) => (
          <span key={key} className="rubric-chip">
            {key.replace(/_/g, ' ')}: {weight}
          </span>
        ))}
      </div>

      {(problem.public_test_case_count > 0 || problem.hidden_test_case_count > 0) && (
        <p className="hidden-note">
          {problem.public_test_case_count} public test case(s) — use "Run Tests" to check pass/fail
          (inputs and expected output are not shown). Your score is based only on the
          {' '}{problem.hidden_test_case_count} hidden test case(s), revealed at grading time.
        </p>
      )}
    </div>
  )
}
