import { useCallback, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { exportUrl, getAdminResults, getSubmissionAudit, updateExamDeadline } from '../api.js'

function toDatetimeLocalValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AdminResultsPage({ adminToken }) {
  const [data, setData] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)
  const [deadlineInput, setDeadlineInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedSubmission, setSelectedSubmission] = useState(null)
  const [auditLog, setAuditLog] = useState(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState(null)

  const load = useCallback(() => {
    getAdminResults(adminToken)
      .then((d) => {
        setData(d)
        setDeadlineInput(toDatetimeLocalValue(d.deadline))
      })
      .catch((e) => setErrorMessage(e.message))
  }, [adminToken])

  useEffect(() => {
    load()
  }, [load])

  const handleSaveDeadline = async () => {
    setSaving(true)
    try {
      await updateExamDeadline(adminToken, deadlineInput ? new Date(deadlineInput).toISOString() : null)
      await load()
    } catch (e) {
      setErrorMessage(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleCloseNow = async () => {
    setSaving(true)
    try {
      await updateExamDeadline(adminToken, new Date(Date.now() - 1000).toISOString())
      await load()
    } catch (e) {
      setErrorMessage(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleViewAudit = async (submission) => {
    setSelectedSubmission(submission)
    setAuditLog(null)
    setAuditError(null)
    setAuditLoading(true)
    try {
      const log = await getSubmissionAudit(adminToken, submission.id)
      setAuditLog(log)
    } catch (e) {
      setAuditError(e.message)
    } finally {
      setAuditLoading(false)
    }
  }

  if (errorMessage && !data) return <p className="status-line status-error">Error: {errorMessage}</p>
  if (!data) return <p className="status-line">Loading…</p>

  const studentUrl = `${window.location.origin}${data.student_path}`

  return (
    <div className="app">
      <header className="app-header">
        <h1>Kết quả bài kiểm tra</h1>
      </header>

      <div className="problem-header">
        <div className="statement">
          <ReactMarkdown>{data.problem.statement}</ReactMarkdown>
        </div>
        <p className="hidden-note">
          Link cho học viên: <code>{studentUrl}</code>
        </p>
      </div>

      <div className="admin-controls">
        <label htmlFor="deadline">Hạn chót</label>
        <input
          id="deadline"
          type="datetime-local"
          value={deadlineInput}
          onChange={(e) => setDeadlineInput(e.target.value)}
        />
        <button className="btn btn-secondary" onClick={handleSaveDeadline} disabled={saving}>
          Lưu hạn chót
        </button>
        <button className="btn btn-secondary" onClick={handleCloseNow} disabled={saving}>
          Đóng ngay
        </button>
        <a className="btn btn-primary" href={exportUrl(adminToken)}>
          Export Excel
        </a>
        <span className={`status-chip${data.is_closed ? ' status-chip-closed' : ' status-chip-open'}`}>
          {data.is_closed ? 'Đã đóng' : 'Đang mở'}
        </span>
      </div>

      <table className="results-table">
        <thead>
          <tr>
            <th>Học viên</th>
            <th>Điểm</th>
            <th>Correctness</th>
            <th>Efficiency</th>
            <th>Code style</th>
            <th>Edge case</th>
            <th>Nộp lúc</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.submissions.length === 0 && (
            <tr>
              <td colSpan={8} className="status-line">
                Chưa có bài nộp nào.
              </td>
            </tr>
          )}
          {data.submissions.map((s, i) => (
            <tr key={i}>
              <td>{s.student_name}</td>
              <td>{s.final_score_0_to_100?.toFixed(1)}</td>
              <td>{s.sub_scores_0_to_1?.correctness?.toFixed(2)}</td>
              <td>{s.sub_scores_0_to_1?.efficiency?.toFixed(2)}</td>
              <td>{s.sub_scores_0_to_1?.code_style?.toFixed(2)}</td>
              <td>{s.sub_scores_0_to_1?.edge_case_handling?.toFixed(2)}</td>
              <td>{new Date(s.submitted_at).toLocaleString()}</td>
              <td>
                <button className="btn btn-secondary" onClick={() => handleViewAudit(s)}>
                  Chi tiết
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedSubmission && (
        <div className="teacher-section audit-section">
          <h2>Audit trail — {selectedSubmission.student_name}</h2>
          <p className="field-hint">
            Toàn bộ prompt gửi cho LLM và phản hồi thô đằng sau điểm số này — dùng để giải thích/bảo vệ
            điểm nếu học viên thắc mắc.
          </p>
          {auditLoading && <p className="status-line">Đang tải…</p>}
          {auditError && <p className="status-error">{auditError}</p>}
          {auditLog && auditLog.length === 0 && (
            <p className="status-line">Không có log nào cho bài nộp này.</p>
          )}
          {auditLog && auditLog.length > 0 && (
            <div className="audit-log-list">
              {auditLog.map((entry) => (
                <details key={entry.call_index} className="audit-log-entry">
                  <summary>
                    Lệnh gọi #{entry.call_index + 1} — {entry.schema || entry.kind} ({entry.model})
                  </summary>
                  <label>System prompt</label>
                  <pre className="audit-log-block">{entry.system_prompt}</pre>
                  <label>User prompt</label>
                  <pre className="audit-log-block">{entry.user_prompt}</pre>
                  <label>Raw response</label>
                  <pre className="audit-log-block">{entry.raw_response}</pre>
                </details>
              ))}
            </div>
          )}
          <button className="btn btn-secondary" onClick={() => setSelectedSubmission(null)}>
            Đóng
          </button>
        </div>
      )}
    </div>
  )
}
