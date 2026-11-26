import { useMemo, useState } from 'react'
import { DIFFICULTY_LABEL, categoriesOf, filterProblems, sortProblems } from '../catalog.js'

const SORTABLE = [['title', 'Tiêu đề'], ['category', 'Loại'], ['difficulty', 'Độ khó']]

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

      <table className="picker-table stack">
        <thead>
          <tr>
            <th />
            {SORTABLE.map(([key, label]) => (
              <th key={key} aria-sort={sort === key ? 'ascending' : undefined}>
                <button type="button" className="th-sort" onClick={() => setSort(key)}>{label}</button>
              </th>
            ))}
            <th>Trọng số</th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr><td colSpan={5} className="status-line">Không có bài nào khớp bộ lọc</td></tr>
          )}
          {shown.map((p) => (
            <tr key={p.id} className={`problem-row${p.id in chosen ? ' is-chosen' : ''}`}>
              <td className="pick-cell">
                <input id={`pick-${p.id}`} type="checkbox" checked={p.id in chosen} onChange={(e) => onToggle(p.id, e.target.checked)} />
              </td>
              <td className="name">
                <label htmlFor={`pick-${p.id}`}>{p.title}</label>
                <details>
                  <summary>Xem đề</summary>
                  <p className="statement-preview">{p.statement}</p>
                </details>
              </td>
              <td className="muted" data-l="Loại">{p.category}</td>
              <td data-l="Độ khó"><span className={`diff diff-${p.difficulty}`}>{DIFFICULTY_LABEL[p.difficulty]}</span></td>
              <td data-l="Trọng số">
                {p.id in chosen && (
                  <input
                    type="number" min="0" step="any" aria-label={`Trọng số ${p.title}`}
                    value={chosen[p.id]} onChange={(e) => onWeight(p.id, e.target.value)}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
