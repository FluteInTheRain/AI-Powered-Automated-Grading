import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/api.js'
import ExamResultsPage from '../src/pages/ExamResultsPage.jsx'
import TeacherHomePage from '../src/pages/TeacherHomePage.jsx'

vi.mock('../src/api.js')

const exams = [{ id: 'e1', title: 'Quiz 1', student_token: 'tok1', student_path: '/exam/tok1', deadline: null, time_limit_seconds: 600, created_at: '2026-11-25T00:00:00Z' }]
const bank = [
  { id: 'bank:a', title: 'Add numbers', category: 'Math', difficulty: 'easy', statement: 'Add two numbers a and b', func_name: 'add', rubric: {} },
  { id: 'bank:b', title: 'Reverse a string', category: 'Strings', difficulty: 'easy', statement: 'Reverse a string', func_name: 'rev', rubric: {} },
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
  api.listOwnProblems.mockResolvedValue([])
  api.getSettings.mockResolvedValue({})
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
      rubric: { correctness: 60, efficiency: 15, code_style: 15, edge_case_handling: 10 },
      questions: [{ problem_id: 'bank:a', weight: 2 }, { problem_id: 'bank:b', weight: 1 }],
    })
  })

  it('refuses a deadline in the past and tells the teacher, without calling the API', async () => {
    renderHome()
    fireEvent.change(await screen.findByLabelText('Tiêu đề'), { target: { value: 'Midterm' } })
    fireEvent.change(screen.getByLabelText('Hạn chót'), { target: { value: '2020-01-01T10:00' } })
    fireEvent.click(await screen.findByLabelText(/Add numbers/))
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bài kiểm tra' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Hạn chót.*đã qua/)
    expect(api.createExam).not.toHaveBeenCalled()
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

describe('exam weights on the home page', () => {
  it('pre-fills the form from the teacher settings and sends the weights', async () => {
    api.getSettings.mockResolvedValue({
      default_rubric: { correctness: 40, efficiency: 20, code_style: 30, edge_case_handling: 10 }, default_time_limit_seconds: 1800,
    })
    api.createExam.mockResolvedValue({ id: 'e9', student_token: 't9', student_path: '/exam/t9' })
    renderHome()
    expect(await screen.findByLabelText(/Đúng sai/)).toHaveValue(40)
    expect(screen.getByLabelText('Thời gian (phút)')).toHaveValue(30)
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'X' } })
    fireEvent.click(await screen.findByLabelText(/Add numbers/))
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bài kiểm tra' }))
    await screen.findByText(/Đã tạo/)
    expect(api.createExam.mock.calls[0][0]).toMatchObject({
      time_limit_seconds: 1800, rubric: { correctness: 40, efficiency: 20, code_style: 30, edge_case_handling: 10 },
    })
  })

  it('does not create an exam while the weights do not total 100', async () => {
    renderHome()
    fireEvent.change(await screen.findByLabelText('Tiêu đề'), { target: { value: 'X' } })
    fireEvent.click(await screen.findByLabelText(/Add numbers/))
    fireEvent.change(screen.getByLabelText(/Đúng sai/), { target: { value: '70' } })
    expect(screen.getByRole('button', { name: 'Tạo bài kiểm tra' })).toBeDisabled()
  })

  it('does not create an exam while the weights total 0', async () => {
    renderHome()
    fireEvent.change(await screen.findByLabelText('Tiêu đề'), { target: { value: 'X' } })
    fireEvent.click(await screen.findByLabelText(/Add numbers/))
    for (const name of [/Đúng sai/, /Hiệu năng/, /Phong cách code/, /Trường hợp biên/]) {
      fireEvent.change(screen.getByLabelText(name), { target: { value: '0' } })
    }
    expect(screen.getByRole('button', { name: 'Tạo bài kiểm tra' })).toBeDisabled()
  })
})

describe('ExamResultsPage', () => {
  const detail = {
    id: 'e1', title: 'Quiz 1', student_path: '/exam/tok1', deadline: null,
    questions: [{ problem_id: 'p1', position: 0, weight: 1, statement_excerpt: 'Q1' }, { problem_id: 'p2', position: 1, weight: 1, statement_excerpt: 'Q2' }],
  }
  const results = [
    { attempt_id: 'a1', student_name: 'An', started_at: '2026-11-25T01:00:00Z', questions: [{ problem_id: 'p1', score: 80, status: 'done' }, { problem_id: 'p2', score: null, status: 'none' }], total: null },
    { attempt_id: 'a2', student_name: 'Binh', started_at: '2026-11-25T02:00:00Z', questions: [{ problem_id: 'p1', score: 70, status: 'done' }, { problem_id: 'p2', score: 60, status: 'done' }], total: 65 },
    { attempt_id: 'a3', student_name: 'Chi', started_at: '2026-11-25T03:00:00Z', questions: [{ problem_id: 'p1', score: null, status: 'queued' }, { problem_id: 'p2', score: null, status: 'failed' }], total: null },
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

  it('shows … while grading is pending and "lỗi chấm" when grading failed', async () => {
    renderResults()
    const chi = (await screen.findByText('Chi')).closest('tr')
    expect(within(chi).getByText('…')).toBeInTheDocument()
    expect(within(chi).getByText('lỗi chấm')).toBeInTheDocument()
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

  it('shows the exam weights as rows with their shares, or says each problem keeps its own', async () => {
    api.getExamDetail.mockResolvedValue({ ...detail, rubric: { correctness: 70, efficiency: 10, code_style: 10, edge_case_handling: 10 } })
    const { unmount } = renderResults()
    const box = await screen.findByRole('group', { name: 'Trọng số tiêu chí' })
    expect(within(box).getByText('Đúng sai')).toBeInTheDocument()
    expect(within(box).getByText('70%')).toBeInTheDocument()
    expect(within(box).getAllByText('10%')).toHaveLength(3)
    unmount()
    api.getExamDetail.mockResolvedValue({ ...detail, rubric: null })
    renderResults()
    expect(await screen.findByText(/theo từng bài/)).toBeInTheDocument()
  })

  it('summarises the results: started, average, grading, failed', async () => {
    renderResults()
    const summary = await screen.findByRole('region', { name: 'Tóm tắt kết quả' })
    expect(summary).toHaveTextContent(/Đã bắt đầu\s*3/)
    expect(summary).toHaveTextContent(/Điểm trung bình\s*65/)
    expect(summary).toHaveTextContent(/Đang chấm\s*1/)
    expect(summary).toHaveTextContent(/Lỗi chấm\s*1/)
  })

  it('describes the score distribution (only finished totals count)', async () => {
    renderResults()
    expect(await screen.findByRole('img', { name: /Phân bố điểm.*1 bài từ 50 đến 79.*2 bài chưa có tổng/ })).toBeInTheDocument()
  })

  it('filters by name and to the rows that need a look', async () => {
    renderResults()
    await screen.findByText('An')
    fireEvent.change(screen.getByLabelText('Tìm học sinh'), { target: { value: 'bin' } })
    expect(screen.queryByText('An')).toBeNull()
    expect(screen.getByText('Binh')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Tìm học sinh'), { target: { value: '' } })
    fireEvent.click(screen.getByLabelText(/Chỉ hiện bài cần xem/))
    expect(screen.getByText('Chi')).toBeInTheDocument() // has a failed question
    expect(screen.queryByText('An')).toBeNull()
  })
})

describe('ExamResultsPage appeals link', () => {
  it('links to the exam appeals page', async () => {
    api.getExamDetail.mockResolvedValue({ id: 'e1', title: 'Quiz 1', student_path: '/exam/tok1', deadline: null, rubric: null, questions: [] })
    api.getResults.mockResolvedValue([])
    renderResults()
    expect(await screen.findByRole('link', { name: 'Khiếu nại' })).toHaveAttribute('href', '/teacher/exams/e1/appeals')
  })
})
