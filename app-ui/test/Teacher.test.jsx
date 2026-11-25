import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/api.js'
import ExamResultsPage from '../src/pages/ExamResultsPage.jsx'
import TeacherHomePage from '../src/pages/TeacherHomePage.jsx'

vi.mock('../src/api.js')

const exams = [{ id: 'e1', title: 'Quiz 1', student_token: 'tok1', student_path: '/exam/tok1', deadline: null, time_limit_seconds: 600, created_at: '2026-11-25T00:00:00Z' }]
const bank = [
  { id: 'bank:a', statement: 'Add numbers', func_name: 'add', rubric: {} },
  { id: 'bank:b', statement: 'Reverse a string', func_name: 'rev', rubric: {} },
]

const renderHome = () => render(<MemoryRouter><TeacherHomePage /></MemoryRouter>)
const renderResults = () =>
  render(
    <MemoryRouter initialEntries={['/teacher/exams/e1']}>
      <Routes><Route path="/teacher/exams/:id" element={<ExamResultsPage />} /></Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  api.getMe.mockResolvedValue({ id: 't1', email: 't@x.com' })
  api.listExams.mockResolvedValue(exams)
  api.listBank.mockResolvedValue(bank)
})
afterEach(() => vi.resetAllMocks())

describe('TeacherHomePage', () => {
  it('lists own exams with student links and a results link', async () => {
    renderHome()
    expect(await screen.findByText('t@x.com')).toBeInTheDocument()
    const link = await screen.findByRole('link', { name: 'Quiz 1' })
    expect(link).toHaveAttribute('href', '/teacher/exams/e1')
    expect(screen.getByText(`${window.location.origin}/exam/tok1`)).toBeInTheDocument()
  })

  it('keeps Create disabled until a title and a question are chosen', async () => {
    renderHome()
    const create = await screen.findByRole('button', { name: 'Tạo bài kiểm tra' })
    expect(create).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'Midterm' } })
    expect(create).toBeDisabled()
    fireEvent.click(await screen.findByLabelText(/Add numbers/))
    expect(create).toBeEnabled()
  })

  it('posts title, minutes as seconds, deadline as ISO and weighted questions', async () => {
    api.createExam.mockResolvedValue({ id: 'e2', student_token: 'tok2', student_path: '/exam/tok2' })
    renderHome()
    fireEvent.change(await screen.findByLabelText('Tiêu đề'), { target: { value: 'Midterm' } })
    fireEvent.change(screen.getByLabelText('Thời gian (phút)'), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText('Hạn chót'), { target: { value: '2030-01-01T10:00' } })
    fireEvent.click(await screen.findByLabelText(/Add numbers/))
    fireEvent.click(screen.getByLabelText(/Reverse a string/))
    fireEvent.change(screen.getByLabelText('Trọng số Add numbers'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bài kiểm tra' }))
    expect(await screen.findByText(`${window.location.origin}/exam/tok2`)).toBeInTheDocument()
    expect(api.createExam).toHaveBeenCalledWith({
      title: 'Midterm', time_limit_seconds: 900, deadline: new Date('2030-01-01T10:00').toISOString(),
      questions: [{ problem_id: 'bank:a', weight: 2 }, { problem_id: 'bank:b', weight: 1 }],
    })
  })

  it('shows the error when creating fails', async () => {
    api.createExam.mockRejectedValue(new Error('Unknown problem_id: bank:zzz'))
    renderHome()
    fireEvent.change(await screen.findByLabelText('Tiêu đề'), { target: { value: 'X' } })
    fireEvent.click(await screen.findByLabelText(/Add numbers/))
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bài kiểm tra' }))
    expect(await screen.findByText(/Unknown problem_id/)).toBeInTheDocument()
  })
})

describe('ExamResultsPage', () => {
  const detail = {
    id: 'e1', title: 'Quiz 1', student_path: '/exam/tok1', deadline: null,
    questions: [{ problem_id: 'p1', position: 0, weight: 1, statement_excerpt: 'Q1' }, { problem_id: 'p2', position: 1, weight: 1, statement_excerpt: 'Q2' }],
  }
  const results = [
    { attempt_id: 'a1', student_name: 'An', started_at: '2026-11-25T01:00:00Z', questions: [{ problem_id: 'p1', score: 80 }, { problem_id: 'p2', score: null }], total: null },
    { attempt_id: 'a2', student_name: 'Binh', started_at: '2026-11-25T02:00:00Z', questions: [{ problem_id: 'p1', score: 70 }, { problem_id: 'p2', score: 60 }], total: 65 },
  ]
  beforeEach(() => {
    api.getExamDetail.mockResolvedValue(detail)
    api.getResults.mockResolvedValue(results)
    api.updateDeadline.mockResolvedValue({})
  })

  it('shows scores, dashes for missing ones and the total', async () => {
    renderResults()
    const an = (await screen.findByText('An')).closest('tr')
    expect(within(an).getByText('80.0')).toBeInTheDocument()
    expect(within(an).getAllByText('—').length).toBe(2) // missing score and no total yet
    const binh = screen.getByText('Binh').closest('tr')
    expect(within(binh).getByText('65')).toBeInTheDocument()
  })

  it('saves the deadline and closes now with a past time', async () => {
    renderResults()
    fireEvent.change(await screen.findByLabelText('Hạn chót'), { target: { value: '2030-01-01T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu hạn chót' }))
    await screen.findByText('Quiz 1')
    expect(api.updateDeadline).toHaveBeenCalledWith('e1', new Date('2030-01-01T10:00').toISOString())
    fireEvent.click(screen.getByRole('button', { name: 'Đóng ngay' }))
    await vi.waitFor(() => expect(api.updateDeadline).toHaveBeenCalledTimes(2))
    expect(new Date(api.updateDeadline.mock.calls[1][1]).getTime()).toBeLessThan(Date.now())
  })

  it('shows a readable error when the exam is not found', async () => {
    api.getExamDetail.mockRejectedValue(new Error('Unknown exam'))
    renderResults()
    expect(await screen.findByText(/Error: Unknown exam/)).toBeInTheDocument()
  })
})
