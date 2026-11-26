import { DIFFICULTY_LABEL } from '../catalog.js'

const LEVEL = { easy: 1, medium: 2, hard: 3 }

/** Three bars filled by difficulty, followed by the label (the label carries the meaning; the bars are decoration). */
export default function DifficultyMark({ difficulty }) {
  const n = LEVEL[difficulty] ?? 0
  return (
    <span className={`diff diff-${difficulty}`}>
      <svg className="bars" viewBox="0 0 16 14" aria-hidden="true" focusable="false">
        {[0, 1, 2].map((i) => <rect key={i} x={i * 6} y={10 - i * 4} width="4" height={4 + i * 4} rx="1" opacity={i < n ? 1 : 0.25} />)}
      </svg>
      {DIFFICULTY_LABEL[difficulty]}
    </span>
  )
}
