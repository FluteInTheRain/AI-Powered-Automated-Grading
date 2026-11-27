import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAdminMetrics } from '../api.js'
import ThemeToggle from '../components/ThemeToggle.jsx'

const VERDICT = {
  baseline: ['Mốc', 'canary-base'],
  stable: ['Ổn định', 'canary-ok'],
  mismatch: ['LỆCH', 'canary-bad'],
  error: ['Lỗi chấm bài chuẩn', 'canary-err'],
}
const delta = (v) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}`)

export default function AdminMetricsPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getAdminMetrics().then(setData).catch(setError)
  }, [])

  if (error) {
    return <p className="status-line status-error">{error.status === 403 ? 'Không có quyền truy cập' : `Error: ${error.message}`}</p>
  }
  if (!data) return <p className="status-line">Loading…</p>
  const { canary, overturn, health, label } = data

  return (
    <>
      <header className="top">
        <Link className="word" to="/teacher">AI Grader</Link>
        <span className="sp" />
        <ThemeToggle />
      </header>
      <div className="wrap wrap-wide">
        <div className="head"><div><h1>Chỉ số AI</h1><p className="muted">Điểm theo thang 100.</p></div></div>

        <section aria-label="Độ ổn định">
          <h2>Độ ổn định (bài chuẩn chấm mỗi ngày)</h2>
          <p className="muted">Cùng một bài, cùng điểm. Dòng LỆCH nghĩa là điểm hoặc phản hồi của AI khác với mốc.</p>
          <table className="stack">
            <thead><tr><th>Lúc chạy</th><th>Điểm</th><th>Kết quả</th></tr></thead>
            <tbody>
              {canary.length === 0 && <tr><td colSpan={3} className="status-line">Chưa có lần chạy nào (Cron chạy lúc 03:17 UTC).</td></tr>}
              {canary.map((r) => {
                const [text, cls] = VERDICT[r.verdict] ?? [r.verdict, '']
                return (
                  <tr key={r.ran_at}>
                    <td className="num" data-l="Lúc chạy">{new Date(r.ran_at).toLocaleString()}</td>
                    <td className="num" data-l="Điểm">{r.score ?? '—'}</td>
                    <td data-l="Kết quả"><span className={cls}>{text}</span>{r.error ? ` (${r.error})` : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <section aria-label="Sức khoẻ chấm bài">
          <h2>Sức khoẻ chấm bài (14 ngày)</h2>
          {health === null ? (
            <p className="muted">Không có dữ liệu sức khoẻ chấm bài</p>
          ) : (
            <table className="stack">
              <thead><tr><th>Ngày</th><th>Kết quả</th><th>Số lượt</th><th>p50 (ms)</th><th>p95 (ms)</th></tr></thead>
              <tbody>
                {health.map((h) => (
                  <tr key={`${h.day}-${h.outcome}`}>
                    <td className="num">{h.day}</td><td>{h.outcome}</td>
                    <td className="num">{h.count}</td><td className="num">{Math.round(h.p50_ms)}</td><td className="num">{Math.round(h.p95_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section aria-label="Khiếu nại">
          <h2>Khiếu nại và đảo điểm</h2>
          <p className="muted">{label}. Chỉ gồm bài bị khiếu nại, do một giáo viên quyết định.</p>
          <p>{`Đã gửi: ${overturn.filed} · Đã quyết định: ${overturn.decided} · Chỉnh điểm: ${overturn.adjusted} · Điểm đổi trung bình: ${delta(overturn.mean_delta)}`}</p>
        </section>

        <section aria-label="Chi phí">
          <h2>Chi phí</h2>
          <p className="muted">Token và độ trễ từng lần gọi AI: xem AI Gateway trong dashboard Cloudflare.</p>
        </section>
      </div>
    </>
  )
}
