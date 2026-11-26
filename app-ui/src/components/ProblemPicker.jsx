import { useMemo, useState } from 'react'
import { DIFFICULTY_LABEL, categoriesOf, filterProblems, sortProblems } from '../catalog.js'

/** Chooses the questions of an exam: search, filters and sorting; `chosen` maps problem id -> weight and is never filtered. */
export default function ProblemPicker({ problems, chosen, onToggle, onWeight }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [sort, setSort] = useState('category')

  const categories = useMemo(() => categoriesOf(problems), [problems])
  const shown = useMemo(() => sortProblems(filterProblems(problems, { search, category, difficulty }), sort), [problems, search, category, difficulty, sort])
  const chosenCount = Object.keys(chosen).length

  return (
    <div className="picker">
      <div className="picker-bar">
        <input
          type="search" name="problem-search" autoComplete="off" placeholder="Tìm theo tiêu đề…" aria-label="Tìm theo tiêu đề"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <label>
          Loại
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Tất cả</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Độ khó
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="">Tất cả</option>
            {Object.entries(DIFFICULTY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          Sắp xếp
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="category">Loại</option>
            <option value="title">Tiêu đề</option>
            <option value="difficulty">Độ khó</option>
          </select>
        </label>
      </div>
      <p className="field-hint num" aria-live="polite">
        <span>{`Hiện ${shown.length} trên ${problems.length} bài`}</span>
        {chosenCount > 0 && <span>{` — Đã chọn ${chosenCount} bài`}</span>}
      </p>

      {shown.length === 0 && <p className="status-line">Không có bài nào khớp bộ lọc</p>}
      {shown.map((p) => (
        <div key={p.id} className="problem-row">
          <div className="problem-main">
            <label>
              <input type="checkbox" checked={p.id in chosen} onChange={(e) => onToggle(p.id, e.target.checked)} />
              <span>{p.title}</span>
            </label>
            <span className="muted">{p.category}</span>
            <span className={`diff diff-${p.difficulty}`}>{DIFFICULTY_LABEL[p.difficulty]}</span>
            {p.id in chosen && (
              <input
                type="number" min="0" step="any" aria-label={`Trọng số ${p.title}`}
                value={chosen[p.id]} onChange={(e) => onWeight(p.id, e.target.value)}
              />
            )}
          </div>
          <details>
            <summary>Xem đề</summary>
            <p className="statement-preview">{p.statement}</p>
          </details>
        </div>
      ))}
    </div>
  )
}
