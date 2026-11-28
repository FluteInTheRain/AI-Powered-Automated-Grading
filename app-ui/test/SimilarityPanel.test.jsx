import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/api.js'
import SimilarityPanel from '../src/components/SimilarityPanel.jsx'

vi.mock('../src/api.js')
afterEach(() => vi.resetAllMocks())

const person = (id, name) => ({ attempt_id: id, student_name: name })

describe('SimilarityPanel', () => {
  it('lists pairs with careful wording', async () => {
    api.getExamSimilarity.mockResolvedValue({
      threshold: 0.85, min_tokens: 40,
      questions: [{ problem_id: 'p1', position: 0, compared: 3, skipped: 0, truncated: false, pairs: [{ a: person('a1', 'An'), b: person('a2', 'Bình'), similarity: 0.93 }] }],
    })
    render(<SimilarityPanel examId="e1" />)
    expect(await screen.findByText(/An và Bình/)).toBeInTheDocument()
    expect(screen.getByText(/giống 93%/)).toBeInTheDocument()
    expect(screen.getByText(/đáng xem lại/i)).toBeInTheDocument()
    expect(screen.queryByText(/chép/i)).not.toBeInTheDocument()
  })

  it('says so when there is nothing to review', async () => {
    api.getExamSimilarity.mockResolvedValue({ threshold: 0.85, min_tokens: 40, questions: [{ problem_id: 'p1', position: 0, compared: 2, skipped: 0, truncated: false, pairs: [] }] })
    render(<SimilarityPanel examId="e1" />)
    expect(await screen.findByText('Chưa có cặp bài nào đáng xem lại.')).toBeInTheDocument()
  })

  it('shows a short message when the request fails', async () => {
    api.getExamSimilarity.mockRejectedValue(new Error('x'))
    render(<SimilarityPanel examId="e1" />)
    expect(await screen.findByText(/Không tải được/)).toBeInTheDocument()
  })
})
