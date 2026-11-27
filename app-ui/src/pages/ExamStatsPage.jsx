import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getExamDetail, getExamStats } from '../api.js'
import ThemeToggle from '../components/ThemeToggle.jsx'

const CRITERIA = {
  correctness: 'Đúng chức năng',
  efficiency: 'Hiệu năng',
  code_style: 'Phong cách code',
  edge_case_handling: 'Trường hợp biên',
}
const pct = (v) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const binLabel = (i) => (i === 9 ? '90-100' : `${i * 10}-${i * 10 + 9}`)

export default function ExamStatsPage() {
  const { id } = useParams()
  const [exam, setExam] = useState(null)
  const [stats, setStats] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)

  useEffect(() => {
    Promise.all([getExamDetail(id), getExamStats(id)])
      .then(([e, s]) => { setExam(e); setStats(s) })
      .catch((e) => setErrorMessage(e.message))
  }, [id])

  if (errorMessage) return <p className="status-line status-error">Error: {errorMessage}</p>
  if (!exam || !stats) return <p className="status-line">Loading…</p>
  const number = (problemId) => exam.questions.findIndex((q) => q.problem_id === problemId) + 1
  const tallest = Math.max(1, ...stats.histogram)

  return (
    <>
      <header className="top">
        <Link className="word" to="/teacher">AI Grader</Link>
        <span className="sp" />
        <Link className="link" to={`/teacher/exams/${id}`}>Kết quả</Link>
        <ThemeToggle />
      </header>
      <div className="wrap wrap-wide">
        <div className="head">
          <div>
            <h1>Thống kê — {exam.title}</h1>
            <p className="muted">Điểm theo thang 100. Chỉ tính các câu đã chấm xong.</p>
          </div>
        </div>
        {stats.attempts === 0 || stats.submitted === 0 ? (
          <p className="status-line">Chưa có bài nộp nào.</p>
        ) : (
          <>
            <dl className="summary-grid">
              <div><dt>Đã bắt đầu</dt><dd className="num">{stats.attempts}</dd></div>
              <div><dt>Đã nộp</dt><dd className="num">{stats.submitted}</dd></div>
              <div><dt>Điểm trung bình</dt><dd className="num">{stats.mean_total === null ? '—' : String(Math.round(stats.mean_total * 10) / 10)}</dd></div>
              <div><dt>Cần xem lại</dt><dd className="num">{stats.needs_review}</dd></div>
              <div><dt>Đang chấm</dt><dd className="num">{stats.grading}</dd></div>
              <div><dt>Lỗi chấm</dt><dd className="num">{stats.failed}</dd></div>
            </dl>
            <h3>Phân bố điểm</h3>
            <div className="histo">
              {stats.histogram.map((n, i) => (
                <div key={i} className="histo-col">
                  <span className="histo-bar" role="img" aria-label={`${binLabel(i)}: ${n} bài`} style={{ height: `${(n / tallest) * 100}%` }} />
                  <span className="histo-x" aria-hidden="true">{i * 10}</span>
                </div>
              ))}
            </div>
            <h3>Từng câu</h3>
            <table className="stack">
              <thead>
                <tr><th>Câu</th><th>Qua hết test ẩn</th><th>Điểm trung bình</th>{Object.values(CRITERIA).map((l) => <th key={l}>{l}</th>)}</tr>
              </thead>
              <tbody>
                {stats.questions.map((q) => (
                  <tr key={q.problem_id}>
                    <td className="name">Câu {number(q.problem_id)}</td>
                    <td className="num" data-l="Qua hết test ẩn">{pct(q.pass_rate)}</td>
                    <td className="num" data-l="Điểm trung bình">{q.mean_score === null ? '—' : Math.round(q.mean_score)}</td>
                    {Object.entries(CRITERIA).map(([key, label]) => <td key={key} className="num" data-l={label}>{pct(q.criteria[key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Khiếu nại</h3>
            <p>{`${stats.appeals.filed} đã gửi · ${stats.appeals.decided} đã quyết định · ${stats.appeals.adjusted} chỉnh điểm`}</p>
          </>
        )}
      </div>
    </>
  )
}
