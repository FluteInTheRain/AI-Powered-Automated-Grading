import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/api.js'
import ExamPage from '../src/pages/ExamPage.jsx'

vi.mock('../src/api.js')
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react')
  return {
    default: ({ value, onChange }) =>
      React.createElement('textarea', { 'aria-label': 'editor', value, onChange: (e) => onChange(e.target.value) }),
  }
})

const rubric = { correctness: 60, efficiency: 15, code_style: 15, edge_case_handling: 10 }
const exam = (over = {}) => ({
  title: 'Quiz', deadline: null, time_limit_seconds: 600, is_closed: false,
  questions: [
    { problem_id: 'p1', position: 0, weight: 1, statement: 'Add **numbers**', starter_code: 'def f1(): pass', rubric, public_case_count: 1, hidden_case_count: 2 },
    { problem_id: 'p2', position: 1, weight: 1, statement: 'Reverse a string', starter_code: 'def f2(): pass', rubric, public_case_count: 1, hidden_case_count: 1 },
  ],
  ...over,
})
const graded = (score) => ({
  problem_id: 'p1', score, sub_scores: { correctness: 1, efficiency: 1, code_style: 1, edge_case_handling: 1 },
  tests: { passed: 2, total: 2 }, feedback: { summary: 'Good job', issues: [] },
})

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/exam/tok']}>
      <Routes><Route path="/exam/:token" element={<ExamPage />} /></Routes>
    </MemoryRouter>,
  )
const editor = () => screen.getByLabelText('editor')
const startExam = async (name = 'An') => {
  await screen.findByLabelText('Họ tên')
  fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: /Bắt đầu/ }))
  await screen.findByRole('button', { name: 'Submit' })
}

beforeEach(() => {
  api.getExam.mockResolvedValue(exam())
  api.startAttempt.mockResolvedValue({ attempt_id: 'att1', receipt_code: 'RCPT123' })
  api.checkSyntax.mockResolvedValue({ ok: true })
  api.submitQuestion.mockResolvedValue(graded(94))
  api.getAttemptByReceipt.mockResolvedValue({ student_name: 'An', questions: [], total: 80 })
})
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })

describe('student ExamPage', () => {
  it('requires a name before the exam can start', async () => {
    renderPage()
    const start = await screen.findByRole('button', { name: /Bắt đầu/ })
    expect(start).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: '  ' } })
    expect(start).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: 'An' } })
    expect(start).toBeEnabled()
  })

  it('creates an attempt and shows the receipt code immediately', async () => {
    renderPage()
    await startExam('An')
    expect(api.startAttempt).toHaveBeenCalledWith('tok', 'An')
    expect(screen.getByText('RCPT123')).toBeInTheDocument()
  })

  it('submits the selected question code and shows the score and feedback', async () => {
    renderPage()
    await startExam()
    fireEvent.change(editor(), { target: { value: 'NEWCODE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('94.0 / 100')).toBeInTheDocument()
    expect(api.submitQuestion).toHaveBeenCalledWith('tok', 'att1', 'p1', 'NEWCODE')
    expect(screen.getByText('Good job')).toBeInTheDocument()
  })

  it('shows pass/fail counts for Run Tests', async () => {
    api.runTests.mockResolvedValue({ status: 'ran', message: null, cases: [{ passed: true, error: null }] })
    renderPage()
    await startExam()
    fireEvent.click(screen.getByRole('button', { name: 'Run Tests' }))
    expect(await screen.findByText(/1\/1 public test case\(s\) passed/)).toBeInTheDocument()
    expect(api.runTests).toHaveBeenCalledWith('tok', 'att1', 'p1', 'def f1(): pass')
  })

  it('keeps each question code when switching tabs', async () => {
    renderPage()
    await startExam()
    fireEvent.change(editor(), { target: { value: 'CODE-ONE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Câu 2' }))
    expect(editor()).toHaveValue('def f2(): pass')
    fireEvent.change(editor(), { target: { value: 'CODE-TWO' } })
    fireEvent.click(screen.getByRole('button', { name: 'Câu 1' }))
    expect(editor()).toHaveValue('CODE-ONE')
    fireEvent.click(screen.getByRole('button', { name: 'Câu 2' }))
    expect(editor()).toHaveValue('CODE-TWO')
  })

  it('timer expiry submits each unsubmitted question exactly once and treats 409 as done', async () => {
    api.getExam.mockResolvedValue(exam({ time_limit_seconds: 3 }))
    api.submitQuestion.mockImplementation(async (_t, _a, pid) => {
      if (pid === 'p2') throw new Error('Already submitted')
      return graded(80)
    })
    renderPage()
    await screen.findByLabelText('Họ tên')
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: 'An' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Bắt đầu/ })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    const ids = api.submitQuestion.mock.calls.map((c) => c[2]).sort()
    expect(ids).toEqual(['p1', 'p2'])
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(api.submitQuestion).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/Grading failed/)).toBeNull()
  })

  it('shows the total once every question is submitted', async () => {
    api.getAttemptByReceipt.mockResolvedValue({ student_name: 'An', questions: [], total: 65 })
    renderPage()
    await startExam()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await screen.findByText('94.0 / 100')
    fireEvent.click(screen.getByRole('button', { name: 'Câu 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText(/Tổng điểm: 65/)).toBeInTheDocument()
    expect(api.getAttemptByReceipt).toHaveBeenCalledWith('tok', 'RCPT123')
  })

  it('shows a failed submit and lets the student try again', async () => {
    api.submitQuestion.mockRejectedValueOnce(new Error('Grading service error, please try again.'))
    renderPage()
    await startExam()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText(/Grading failed: Grading service error/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('94.0 / 100')).toBeInTheDocument()
  })

  it('shows the closed message for a closed exam', async () => {
    api.getExam.mockResolvedValue(exam({ is_closed: true }))
    renderPage()
    expect(await screen.findByText('Đề kiểm tra này đã đóng.')).toBeInTheDocument()
  })

  it('shows a readable message for an unknown link or a network error', async () => {
    api.getExam.mockRejectedValue(new Error('Unknown exam link'))
    renderPage()
    expect(await screen.findByText(/Error: Unknown exam link/)).toBeInTheDocument()
  })

  it('never renders test inputs or expected values, even if the API sent them', async () => {
    const e = exam()
    e.questions[0].public_cases = [{ args: [1], expected: 'PUBEXP' }]
    e.questions[0].hidden_cases = [{ args: [2], expected: 'HIDDENEXP' }]
    api.getExam.mockResolvedValue(e)
    renderPage()
    await startExam()
    expect(document.body.textContent).not.toContain('PUBEXP')
    expect(document.body.textContent).not.toContain('HIDDENEXP')
  })

  it('looks a score up by receipt code', async () => {
    api.getAttemptByReceipt.mockResolvedValue({
      student_name: 'An', total: 70, questions: [{ problem_id: 'p1', score: 80, feedback: null }, { problem_id: 'p2', score: 60, feedback: null }],
    })
    renderPage()
    fireEvent.change(await screen.findByLabelText('Mã biên nhận'), { target: { value: 'RCPT123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Xem điểm' }))
    expect(await screen.findByText(/Tổng điểm: 70/)).toBeInTheDocument()
    expect(screen.getByText('80.0')).toBeInTheDocument()
    expect(screen.getByText('60.0')).toBeInTheDocument()
    expect(api.getAttemptByReceipt).toHaveBeenCalledWith('tok', 'RCPT123')
  })
})
