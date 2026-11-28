import { useEffect, useState } from 'react'
import { getExamSimilarity } from '../api.js'

// PR-E3: a signal for the teacher to look again. It never changes a score.
export default function SimilarityPanel({ examId }) {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    getExamSimilarity(examId).then(setData).catch(() => setFailed(true))
  }, [examId])

  const withPairs = data ? data.questions.filter((q) => q.pairs.length > 0) : []
  const percent = (v) => `${Math.round(v * 100)}%`

  return (
    <section className="similarity" aria-label="Bài giống nhau">
      <h3>Bài giống nhau</h3>
      <p className="muted">
        Các cặp bài dưới đây có cấu trúc code gần như trùng nhau sau khi bỏ chú thích và đổi tên biến.
        Đáng xem lại, nhưng đây chưa phải kết luận và không thay đổi điểm.
      </p>
      {failed && <p className="status-line">Không tải được danh sách bài giống nhau.</p>}
      {!failed && !data && <p className="status-line">Đang kiểm tra…</p>}
      {data && withPairs.length === 0 && <p className="status-line">Chưa có cặp bài nào đáng xem lại.</p>}
      {withPairs.map((q) => (
        <div key={q.problem_id}>
          <h4>Câu {q.position + 1}</h4>
          <ul>
            {q.pairs.map((p) => (
              <li key={`${p.a.attempt_id}-${p.b.attempt_id}`}>
                {p.a.student_name} và {p.b.student_name} <span className="num muted">· giống {percent(p.similarity)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {data && (
        <p className="muted">
          Bài ngắn hơn {data.min_tokens} token, bài chưa sửa so với code khởi đầu và bài trùng đáp án mẫu không được so sánh. Chỉ liệt kê cặp giống từ {percent(data.threshold)}.
        </p>
      )}
    </section>
  )
}
