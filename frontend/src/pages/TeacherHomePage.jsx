import { useMemo, useState } from 'react'
import { createExam, createProblem, previewTestCases } from '../api.js'
import CodeEditor from '../components/CodeEditor.jsx'

const RUBRIC_KEYS = ['correctness', 'efficiency', 'code_style', 'edge_case_handling']
const DEFAULT_RUBRIC = { correctness: 70, efficiency: 10, code_style: 10, edge_case_handling: 10 }

function emptyRow(paramCount) {
  return { values: Array(paramCount).fill(''), isPublic: false }
}

// Each cell is typed as a JSON literal (e.g. 9, "hello", [1,2,3]) so
// arbitrary argument shapes are supported without a typed-per-type widget.
function parseArgs(row) {
  return row.values.map((v) => JSON.parse(v))
}

export default function TeacherHomePage() {
  const [statement, setStatement] = useState('')
  const [funcName, setFuncName] = useState('')
  const [paramNamesText, setParamNamesText] = useState('')
  const [rubric, setRubric] = useState(DEFAULT_RUBRIC)
  const [referenceSolution, setReferenceSolution] = useState('def solution(...):\n    pass\n')
  const [wrongSolution, setWrongSolution] = useState('')
  const [rows, setRows] = useState([emptyRow(0)])

  const [previewResult, setPreviewResult] = useState(null)
  const [previewedSignature, setPreviewedSignature] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedProblemId, setSavedProblemId] = useState(null)

  const [deadlineInput, setDeadlineInput] = useState('')
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(10)
  const [examLinks, setExamLinks] = useState(null)
  const [examError, setExamError] = useState(null)
  const [creatingExam, setCreatingExam] = useState(false)
  const [copied, setCopied] = useState(null)

  const paramNames = useMemo(
    () => paramNamesText.split(',').map((s) => s.trim()).filter(Boolean),
    [paramNamesText],
  )
  const rubricTotal = RUBRIC_KEYS.reduce((sum, k) => sum + (Number(rubric[k]) || 0), 0)

  const setRowValue = (rowIndex, colIndex, value) => {
    setRows((prev) => {
      const next = [...prev]
      const values = [...next[rowIndex].values]
      values[colIndex] = value
      next[rowIndex] = { ...next[rowIndex], values }
      return next
    })
  }

  const setRowPublic = (rowIndex, isPublic) => {
    setRows((prev) => prev.map((r, i) => (i === rowIndex ? { ...r, isPublic } : r)))
  }

  const addRow = () => setRows((prev) => [...prev, emptyRow(paramNames.length)])
  const removeRow = (i) => setRows((prev) => prev.filter((_, idx) => idx !== i))

  // Editing anything test-case-relevant invalidates any previous preview —
  // the teacher must re-run it before saving, so a stale computed
  // `expected` can never be persisted for a row that's since changed.
  const buildPreviewRequest = () => {
    let cases
    try {
      cases = rows.map((r) => ({ args: parseArgs(r) }))
    } catch {
      return null
    }
    return { reference_solution: referenceSolution, func_name: funcName, cases, wrong_solution: wrongSolution || null }
  }

  const handlePreview = async () => {
    setPreviewError(null)
    const req = buildPreviewRequest()
    if (!req) {
      setPreviewError('Một hoặc nhiều test case có giá trị không phải JSON hợp lệ (vd: 9, "abc", [1,2]).')
      return
    }
    setPreviewLoading(true)
    try {
      const res = await previewTestCases(req)
      setPreviewResult(res)
      if (res.status === 'ok') {
        setPreviewedSignature(JSON.stringify(req))
      } else {
        setPreviewedSignature(null)
      }
    } catch (e) {
      setPreviewError(e.message)
      setPreviewResult(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  const currentSignatureMatchesPreview = () => {
    const req = buildPreviewRequest()
    return req && previewedSignature === JSON.stringify(req)
  }
  const canSave =
    previewResult?.status === 'ok' &&
    currentSignatureMatchesPreview() &&
    paramNames.length > 0 &&
    rubricTotal === 100 &&
    rows.length > 0

  const handleSave = async () => {
    setSaveError(null)
    if (!canSave) return
    setSaving(true)
    try {
      const testCases = rows.map((r, i) => ({
        args: parseArgs(r),
        expected: previewResult.cases[i].expected,
        is_public: r.isPublic,
      }))
      const res = await createProblem({
        statement,
        func_name: funcName,
        param_names: paramNames,
        rubric,
        reference_solution: referenceSolution,
        test_cases: testCases,
      })
      setSavedProblemId(res.id)
      setExamLinks(null)
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleCreateExam = async () => {
    setExamError(null)
    if (!savedProblemId) {
      setExamError('Lưu đề trước đã.')
      return
    }
    setCreatingExam(true)
    try {
      const res = await createExam({
        problem_id: savedProblemId,
        deadline: deadlineInput ? new Date(deadlineInput).toISOString() : null,
        time_limit_seconds: Number(timeLimitMinutes) * 60,
      })
      setExamLinks(res)
    } catch (e) {
      setExamError(e.message)
    } finally {
      setCreatingExam(false)
    }
  }

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Soạn đề &amp; tạo link chia sẻ</h1>
        <a className="btn btn-secondary" href="/demo">
          Demo mode
        </a>
      </header>

      <section className="teacher-section">
        <h2>1. Soạn đề</h2>

        <label>Đề bài</label>
        <textarea
          className="plain-textarea"
          rows={3}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          placeholder="Viết hàm two_sum(nums, target) trả về..."
        />

        <div className="field-row">
          <div>
            <label>Tên hàm (func_name)</label>
            <input type="text" value={funcName} onChange={(e) => setFuncName(e.target.value)} placeholder="two_sum" />
          </div>
          <div>
            <label>Tên tham số (cách nhau bởi dấu phẩy)</label>
            <input
              type="text"
              value={paramNamesText}
              onChange={(e) => setParamNamesText(e.target.value)}
              placeholder="nums, target"
            />
          </div>
        </div>

        <label>Rubric (tổng phải = 100)</label>
        <div className="rubric-editor">
          {RUBRIC_KEYS.map((key) => (
            <div key={key} className="rubric-editor-field">
              <span>{key.replace(/_/g, ' ')}</span>
              <input
                type="number"
                value={rubric[key]}
                onChange={(e) => setRubric((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
              />
            </div>
          ))}
          <span className={rubricTotal === 100 ? 'status-chip status-chip-open' : 'status-chip status-chip-closed'}>
            Tổng: {rubricTotal}
          </span>
        </div>

        <label>Lời giải mẫu (bắt buộc)</label>
        <p className="field-hint">
          Đây là lời giải ĐÚNG cho bài toán. Hệ thống sẽ chạy thật lời giải này để tự tính ra đáp án
          (expected output) cho từng test case bạn nhập bên dưới — bạn không cần tự tính tay. Lời giải
          này cũng bắt buộc phải pass 100% test case thì mới lưu được đề, để đảm bảo đề không bị lỗi
          ngay từ đầu.
        </p>
        <CodeEditor
          value={referenceSolution}
          onChange={setReferenceSolution}
          readOnly={false}
          filename="loi_giai_mau.py"
        />

        <label>Test cases — mỗi ô là một giá trị JSON (vd: 9, "abc", [1,2,3])</label>
        {paramNames.length === 0 && (
          <p className="status-line">Nhập tên tham số ở trên trước để thêm test case.</p>
        )}
        {paramNames.length > 0 && (
          <table className="results-table">
            <thead>
              <tr>
                {paramNames.map((p) => (
                  <th key={p}>{p}</th>
                ))}
                <th>Expected (tự tính)</th>
                <th>Public?</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {paramNames.map((_, colIndex) => (
                    <td key={colIndex}>
                      <input
                        type="text"
                        className="cell-input"
                        value={row.values[colIndex] ?? ''}
                        onChange={(e) => setRowValue(i, colIndex, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="cell-expected">
                    {previewResult?.status === 'ok' && previewResult.cases[i]
                      ? previewResult.cases[i].error
                        ? `Lỗi: ${previewResult.cases[i].error}`
                        : JSON.stringify(previewResult.cases[i].expected)
                      : '—'}
                  </td>
                  <td>
                    <input type="checkbox" checked={row.isPublic} onChange={(e) => setRowPublic(i, e.target.checked)} />
                  </td>
                  <td>
                    <button className="btn btn-secondary" onClick={() => removeRow(i)} disabled={rows.length <= 1}>
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {paramNames.length > 0 && (
          <button className="btn btn-secondary" onClick={addRow}>
            + Thêm test case
          </button>
        )}

        <label>Lời giải sai (tuỳ chọn)</label>
        <p className="field-hint">
          Dán vào đây một lời giải mà bạn CỐ TÌNH viết sai (vd: quên xử lý một trường hợp biên, tính
          nhầm công thức) để kiểm tra xem bộ test case ở trên có đủ chặt để bắt được lỗi đó không. Nếu
          "Chạy thử" cho thấy lời giải sai này vẫn pass hết test case, nghĩa là bộ test đang quá yếu —
          bạn nên thêm test case, tránh việc sau này học viên nộp code sai tương tự nhưng vẫn được điểm
          tối đa.
        </p>
        <CodeEditor value={wrongSolution} onChange={setWrongSolution} readOnly={false} filename="loi_giai_sai.py" />

        <div className="submit-row">
          <button className="btn btn-secondary" onClick={handlePreview} disabled={previewLoading}>
            {previewLoading ? 'Đang chạy…' : 'Chạy thử'}
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Đang lưu…' : 'Lưu đề'}
          </button>
        </div>

        {previewError && <p className="status-error">{previewError}</p>}
        {previewResult && previewResult.status === 'func_not_found' && (
          <p className="status-error">
            Lời giải mẫu không có hàm tên "{funcName}". Kiểm tra lại: tên hàm bạn viết bằng{' '}
            <code>def ...</code> trong ô "Lời giải mẫu" phải khớp chính xác (kể cả hoa/thường) với ô
            "Tên hàm (func_name)" ở trên.
          </p>
        )}
        {previewResult && previewResult.status === 'compile_error' && (
          <p className="status-error">Lời giải mẫu có lỗi cú pháp: {previewResult.message}</p>
        )}
        {previewResult?.wrong_solution_check?.still_passes_all && (
          <p className="status-error">
            Cảnh báo: lời giải sai vẫn pass {previewResult.wrong_solution_check.pass_count}/
            {previewResult.wrong_solution_check.total} test case — bộ test chưa phát hiện được lỗi này.
          </p>
        )}
        {saveError && <p className="status-error">{saveError}</p>}
        {savedProblemId && <p className="status-line">Đã lưu đề (id: {savedProblemId}).</p>}
      </section>

      <section className="teacher-section">
        <h2>2. Tạo link chia sẻ</h2>
        {!savedProblemId && <p className="status-line">Lưu đề ở bước 1 trước để tạo link chia sẻ cho đề đó.</p>}

        <div className="field-row">
          <div>
            <label>Hạn chót (tuỳ chọn)</label>
            <input
              type="datetime-local"
              value={deadlineInput}
              onChange={(e) => setDeadlineInput(e.target.value)}
              disabled={!savedProblemId}
            />
          </div>
          <div>
            <label>Thời gian làm bài (phút)</label>
            <input
              type="number"
              value={timeLimitMinutes}
              onChange={(e) => setTimeLimitMinutes(e.target.value)}
              disabled={!savedProblemId}
            />
          </div>
        </div>

        <div className="submit-row">
          <button className="btn btn-primary" onClick={handleCreateExam} disabled={!savedProblemId || creatingExam}>
            {creatingExam ? 'Đang tạo…' : 'Tạo link chia sẻ'}
          </button>
        </div>
        {examError && <p className="status-error">{examError}</p>}

        {examLinks && (
          <div className="exam-links">
            <div className="exam-link-row">
              <span>Link cho học viên:</span>
              <code>{`${window.location.origin}${examLinks.student_path}`}</code>
              <button
                className="btn btn-secondary"
                onClick={() => copyToClipboard(`${window.location.origin}${examLinks.student_path}`, 'student')}
              >
                {copied === 'student' ? 'Đã copy' : 'Copy'}
              </button>
            </div>
            <div className="exam-link-row">
              <span>Link quản trị (giữ riêng, xem kết quả):</span>
              <code>{`${window.location.origin}${examLinks.admin_path}`}</code>
              <button
                className="btn btn-secondary"
                onClick={() => copyToClipboard(`${window.location.origin}${examLinks.admin_path}`, 'admin')}
              >
                {copied === 'admin' ? 'Đã copy' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
