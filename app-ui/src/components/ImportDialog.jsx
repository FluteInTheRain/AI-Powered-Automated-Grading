import { useEffect, useRef, useState } from 'react'
import { importProblems } from '../api.js'
import Icon from './Icon.jsx'

// Keep in step with IMPORT_MAX_ITEMS / IMPORT_MAX_BYTES in app-worker/src/routes/teacher_problems.ts.
const MAX_ITEMS = 20
const MAX_KB = 256

const EXAMPLE = {
  problems: [
    {
      title: 'Tổng hai số',
      category: 'Cơ bản',
      difficulty: 'easy',
      statement: 'Viết hàm `add(a, b)` trả về tổng của hai số.',
      func_name: 'add',
      param_names: ['a', 'b'],
      reference_solution: 'def add(a, b):\n    return a + b\n',
      test_cases: [
        { args: [1, 2], expected: 3, is_public: true },
        { args: [-1, 1], expected: 0, is_public: false },
      ],
      rubric: { correctness: 40, efficiency: 20, code_style: 20, edge_case_handling: 20 },
    },
  ],
}

function downloadExample() {
  const blob = new Blob([JSON.stringify(EXAMPLE, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'cau-hoi-mau.json'
  a.click()
  URL.revokeObjectURL(url)
}

/** Pick a JSON file, send it as is, and list what the server rejected. Nothing is saved unless every problem passes. */
export default function ImportDialog({ onClose, onImported }) {
  const closeRef = useRef(null)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [errors, setErrors] = useState([])
  const [done, setDone] = useState(null)

  useEffect(() => {
    const before = document.activeElement
    closeRef.current?.focus()
    return () => before?.focus?.()
  }, [])

  const submit = async () => {
    setBusy(true); setMessage(null); setErrors([]); setDone(null)
    try {
      const res = await importProblems(await file.text())
      setDone(res.imported)
      onImported()
    } catch (e) {
      setMessage(e.message)
      setErrors(e.errors ?? [])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <div className="modal-head">
          <div>
            <h2 id="import-title">Nhập câu hỏi từ file</h2>
            <p className="modal-meta muted">File JSON, tối đa {MAX_ITEMS} câu và {MAX_KB} KB. Chỉ cần một câu sai là không câu nào được lưu.</p>
          </div>
          <button type="button" className="ibtn" ref={closeRef} onClick={onClose} aria-label="Đóng"><Icon name="x" /></button>
        </div>
        <div className="modal-body">
          <p>
            Mỗi câu gồm <code>title</code>, <code>category</code>, <code>difficulty</code> (easy, medium hoặc hard), <code>statement</code> (Markdown),
            {' '}<code>func_name</code>, <code>param_names</code>, <code>reference_solution</code> và <code>test_cases</code>.
            {' '}<code>rubric</code> có thể bỏ trống, khi đó dùng 40/20/20/20. Tên câu không được trùng nhau hay trùng câu bạn đã có.
          </p>
          <p><button type="button" className="btn btn-small" onClick={downloadExample}><Icon name="down" />Tải file mẫu</button></p>
          <div className="field-row">
            <label htmlFor="import-file">Chọn file</label>
            <input id="import-file" type="file" accept=".json,application/json" onChange={(e) => { setFile(e.target.files[0] ?? null); setErrors([]); setMessage(null); setDone(null) }} />
          </div>
          {message && <p className="status-error" role="alert">{message}</p>}
          {errors.length > 0 && (
            <ul aria-label="Danh sách lỗi">
              {errors.map((er, i) => (
                <li key={i}>Câu thứ {er.index + 1}, trường <code>{er.field}</code>: {er.message}</li>
              ))}
            </ul>
          )}
          {done !== null && <p className="status-success" aria-live="polite">Đã nhập {done} câu vào kho của bạn.</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!file || busy}>
            <Icon name="up" />{busy ? 'Đang kiểm tra…' : 'Nhập'}
          </button>
        </div>
      </div>
    </div>
  )
}
