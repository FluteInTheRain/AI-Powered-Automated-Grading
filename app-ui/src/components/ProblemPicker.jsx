import { useMemo, useState } from 'react'
import { DIFFICULTY_LABEL, categoriesOf, filterProblems, sortProblems } from '../catalog.js'
import DifficultyMark from './DifficultyMark.jsx'
import Icon from './Icon.jsx'
import ProblemDialog from './ProblemDialog.jsx'


/** A sortable column header: a button that sorts by `sortKey`, and reverses the order when it is already the active key. */
function SortTh({ sortKey, sort, setSort, aria, children }) {
  const active = sort.key === sortKey
  return (
    <th aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button" className="th-sort" aria-label={aria}
        onClick={() => setSort(active ? { key: sortKey, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: sortKey, dir: 'asc' })}
      >
        {children}
        {active && <Icon name={sort.dir === 'asc' ? 'up' : 'down'} />}
      </button>
    </th>
  )
}

/** Chooses the questions of an exam: search, filters and sorting; `chosen` maps problem id -> weight and is never filtered. */
export default function ProblemPicker({ problems, chosen, onToggle, onWeight }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [sort, setSort] = useState({ key: 'category', dir: 'asc' })
  const [viewingId, setViewingId] = useState(null)

  const categories = useMemo(() => categoriesOf(problems), [problems])
  const shown = useMemo(() => sortProblems(filterProblems(problems, { search, category, difficulty }), sort.key, sort.dir, chosen), [problems, search, category, difficulty, sort, chosen])
  const chosenCount = Object.keys(chosen).length
  const viewing = problems.find((p) => p.id === viewingId)

  return (
    <div className="picker">
      <div className="picker-bar">
        <span className="search-box">
          <Icon name="search" />
          <input
            type="search" name="problem-search" autoComplete="off" placeholder="Tìm theo tiêu đề…" aria-label="Tìm theo tiêu đề"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
        </span>
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
      </div>
      <div className="picker-meta">
      <p className="field-hint num" aria-live="polite" style={{ margin: 0 }}>
        <span>{`Hiện ${shown.length} trên ${problems.length} bài`}</span>
        {chosenCount > 0 && <span>{` — Đã chọn ${chosenCount} bài`}</span>}
      </p>
        <div className="sort-group">
          <label>
          Sắp xếp
          <select value={sort.key} onChange={(e) => setSort({ key: e.target.value, dir: 'asc' })}>
            <option value="category">Loại</option>
            <option value="title">Tiêu đề</option>
            <option value="difficulty">Độ khó</option>
            <option value="selected">Câu đã chọn</option>
            <option value="weight">Trọng số</option>
          </select>
        </label>
        <button
          type="button" className="ibtn" aria-label="Đảo chiều sắp xếp" title={sort.dir === 'asc' ? 'Đang tăng dần' : 'Đang giảm dần'}
          onClick={() => setSort((prev) => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))}
        >
          <Icon name={sort.dir === 'asc' ? 'up' : 'down'} />
        </button>
        </div>
      </div>

      <table className="picker-table stack">
        <thead>
          <tr>
            <SortTh sortKey="selected" sort={sort} setSort={setSort} aria="Sắp xếp theo câu đã chọn"><Icon name="check" /></SortTh>
            <SortTh sortKey="title" sort={sort} setSort={setSort}>Tiêu đề</SortTh>
            <SortTh sortKey="category" sort={sort} setSort={setSort}>Loại</SortTh>
            <SortTh sortKey="difficulty" sort={sort} setSort={setSort}>Độ khó</SortTh>
            <SortTh sortKey="weight" sort={sort} setSort={setSort}>Trọng số</SortTh>
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
                <button type="button" className="view-btn" onClick={() => setViewingId(p.id)}><Icon name="eye" />Xem đề</button>
              </td>
              <td className="muted" data-l="Loại">{p.category}</td>
              <td data-l="Độ khó"><DifficultyMark difficulty={p.difficulty} /></td>
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
      {viewing && <ProblemDialog problem={viewing} chosen={viewing.id in chosen} onToggle={onToggle} onClose={() => setViewingId(null)} />}
    </div>
  )
}
