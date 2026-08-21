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
    </div>
  )
}
