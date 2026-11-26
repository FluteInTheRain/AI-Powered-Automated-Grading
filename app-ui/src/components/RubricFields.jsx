// Four criterion weights as number inputs, with the share each one has of the total.
export const RUBRIC_FIELDS = [
  { key: 'correctness', label: 'Đúng sai (correctness)' },
  { key: 'efficiency', label: 'Hiệu năng (efficiency)' },
  { key: 'code_style', label: 'Phong cách code (code style)' },
  { key: 'edge_case_handling', label: 'Trường hợp biên (edge cases)' },
]
export const DEFAULT_RUBRIC = { correctness: '60', efficiency: '15', code_style: '15', edge_case_handling: '10' }

const toNumber = (v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN)
const total = (value) => RUBRIC_FIELDS.reduce((sum, f) => sum + (toNumber(value[f.key]) || 0), 0)

/** All four are whole numbers of 0 or more, and they do not all equal zero. */
export const isValidRubric = (value) => RUBRIC_FIELDS.every((f) => !Number.isNaN(toNumber(value[f.key]))) && total(value) > 0
export const rubricToNumbers = (value) => Object.fromEntries(RUBRIC_FIELDS.map((f) => [f.key, toNumber(value[f.key])]))
export const rubricToStrings = (rubric) => Object.fromEntries(RUBRIC_FIELDS.map((f) => [f.key, String(rubric[f.key])]))

export default function RubricFields({ value, onChange }) {
  const sum = total(value)
  return (
    <div className="rubric-fields">
      {RUBRIC_FIELDS.map((f) => {
        const n = toNumber(value[f.key])
        return (
          <div key={f.key} className="rubric-row">
            <label htmlFor={`rubric-${f.key}`}>{f.label}</label>
            <input
              id={`rubric-${f.key}`} type="number" min="0" step="1" inputMode="numeric"
              value={value[f.key]} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            />
            <span className="num muted pct">{sum > 0 && !Number.isNaN(n) ? `${Math.round((n / sum) * 100)}%` : '—'}</span>
          </div>
        )
      })}
      <p className="field-hint num">Tổng: {sum}</p>
    </div>
  )
}
