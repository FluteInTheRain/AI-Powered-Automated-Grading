import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/api.js'
import ExamStatsPage from '../src/pages/ExamStatsPage.jsx'

vi.mock('../src/api.js')

const exam = { id: 'e1', title: 'Quiz 1', questions: [{ problem_id: 'p1', position: 0 }, { problem_id: 'p2', position: 1 }] }
const stats = (over = {}) => ({
  attempts: 4, submitted: 3, grading: 1, failed: 0, mean_total: 62.5, needs_review: 1,
  histogram: [0, 0, 0, 0, 0, 0, 2, 0, 0, 1],
  questions: [
    { problem_id: 'p1', position: 0, pass_rate: 0.5, mean_score: 55, criteria: { correctness: 0.5, efficiency: 0.25, code_style: null, edge_case_handling: 1 } },
    { problem_id: 'p2', position: 1, pass_rate: null, mean_score: null, criteria: { correctness: null, efficiency: null, code_style: null, edge_case_handling: null } },
  ],
  appeals: { filed: 3, decided: 2, adjusted: 1 },
  ...over,
})
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/teacher/exams/e1/stats']}>
      <Routes><Route path="/teacher/exams/:id/stats" element={<ExamStatsPage />} /></Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  api.getExamDetail.mockResolvedValue(exam)
  api.getExamStats.mockResolvedValue(stats())
})
afterEach(() => vi.resetAllMocks())

describe('ExamStatsPage', () => {
  it('shows the title, the 100-point note and the headline numbers', async () => {
    renderPage()
    expect(await screen.findByText('Thống kê — Quiz 1')).toBeInTheDocument()
    expect(screen.getByText(/thang 100/)).toBeInTheDocument()
    expect(screen.getByText('62.5')).toBeInTheDocument()
    expect(screen.getByText('Cần xem lại').nextSibling).toHaveTextContent('1')
  })

  it('draws ten histogram bars with their counts', async () => {
    renderPage()
    await screen.findByText('Thống kê — Quiz 1')
    expect(screen.getAllByRole('img', { name: /bài$/ })).toHaveLength(10)
    expect(screen.getByRole('img', { name: '60-69: 2 bài' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '90-100: 1 bài' })).toBeInTheDocument()
  })

  it('lists each question with its pass rate, and a dash when nothing was graded', async () => {
    renderPage()
    await screen.findByText('Thống kê — Quiz 1')
    expect(screen.getByText('Câu 1')).toBeInTheDocument()
    const row = screen.getByText('Câu 1').closest('tr')
    expect(within(row).getByText('50%', { selector: '[data-l="Qua hết test ẩn"]' })).toBeInTheDocument()
    expect(within(row).getByText('25%')).toBeInTheDocument()
    expect(within(screen.getByText('Câu 2').closest('tr')).getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('shows the appeal counts', async () => {
    renderPage()
    expect(await screen.findByText('3 đã gửi · 2 đã quyết định · 1 chỉnh điểm')).toBeInTheDocument()
  })

  it('says so when nobody has submitted', async () => {
    api.getExamStats.mockResolvedValue(stats({ attempts: 0, submitted: 0, mean_total: null, histogram: Array(10).fill(0), questions: [] }))
    renderPage()
    expect(await screen.findByText('Chưa có bài nộp nào.')).toBeInTheDocument()
  })

  it('shows the error when the stats cannot be loaded', async () => {
    api.getExamStats.mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText('Error: boom')).toBeInTheDocument()
  })
})
