import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDifficultyCalibration } from '../api.js'
import DifficultyMark from '../components/DifficultyMark.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'

const VERDICT = {
  match: 'Khớp',
  easier: 'Có vẻ dễ hơn nhãn',
  harder: 'Có vẻ khó hơn nhãn',
  insufficient: 'Chưa đủ dữ liệu',
  no_label: 'Chưa có nhãn',
}
const pct = (v) => `${Math.round(v * 100)}%`

export default function DifficultyPage() {
  const [data, setData] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)

  useEffect(() => {
    getDifficultyCalibration().then(setData).catch((e) => setErrorMessage(e.message))
  }, [])

  if (errorMessage) return <p className="status-line status-error">Error: {errorMessage}</p>
  if (!data) return <p className="status-line">Loading…</p>

  return (
    <>
      <header className="top">
        <Link className="word" to="/teacher">AI Grader</Link>
        <span className="sp" />
        <ThemeToggle />
      </header>
      <div className="wrap wrap-wide">
        <div className="head">
          <div>
            <h1>Độ khó thực tế</h1>
            <p>So nhãn độ khó của từng câu với kết quả thật trong các bài kiểm tra của bạn. Kết quả chỉ là gợi ý về cái nhãn và về nhóm học sinh đã làm bài, không đo năng lực của từng em. Hệ thống không tự đổi nhãn.</p>
            <p className="muted">
              Tỉ lệ là phần học sinh qua hết test ẩn ở lần nộp đầu. Chỉ nhận xét khi có ít nhất {data.min_attempts} bài. Một lớp 30 người vẫn là mẫu nhỏ,
              nên khoảng ước lượng (95%) khá rộng. Một câu chỉ bị báo lệch khi cả khoảng nằm ngoài mức thường gặp của nhãn đó.
            </p>
          </div>
        </div>
        {data.problems.length === 0 ? (
          <p className="status-line">Bạn chưa dùng câu nào trong bài kiểm tra.</p>
        ) : (
          <table className="stack">
            <thead>
              <tr><th>Câu</th><th>Nhãn</th><th>Số bài</th><th>Qua hết test ẩn</th><th>Điểm trung bình</th><th>Nhận xét</th></tr>
            </thead>
            <tbody>
              {data.problems.map((p) => (
                <tr key={p.problem_id}>
                  <td className="name">{p.title ?? p.problem_id}</td>
                  <td data-l="Nhãn">{p.difficulty ? <DifficultyMark difficulty={p.difficulty} /> : '—'}</td>
                  <td className="num" data-l="Số bài">{p.n}</td>
                  <td className="num" data-l="Qua hết test ẩn">
                    {p.pass_rate === null ? '—' : `${pct(p.pass_rate)} (khoảng ${pct(p.ci_low)} đến ${pct(p.ci_high)})`}
                  </td>
                  <td className="num" data-l="Điểm trung bình">{p.mean_score === null ? '—' : Math.round(p.mean_score)}</td>
                  <td data-l="Nhận xét">{VERDICT[p.verdict]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
