import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/api.js'
import ExamPage from '../src/pages/ExamPage.jsx'

vi.mock('../src/api.js')
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react')
  return {
    default: ({ value, onChange, path }) =>
      React.createElement('textarea', { 'aria-label': 'editor', 'data-path': path, value, onChange: (e) => onChange(e.target.value) }),
  }
})
vi.mock('../src/components/TurnstileWidget.jsx', async () => {
  const React = await import('react')
  return { default: ({ onToken }) => React.createElement('button', { onClick: () => onToken('tok123') }, 'Verify') }
})

const rubric = { correctness: 60, efficiency: 15, code_style: 15, edge_case_handling: 10 }
const summary = (over = {}) => ({ title: 'Quiz', deadline: null, time_limit_seconds: 600, is_closed: false, question_count: 2, turnstile_site_key: 'site', ...over })
const questions = (status = 'none') => [
  { problem_id: 'p1', position: 0, weight: 1, statement: 'Add **numbers**', starter_code: 'def f1(): pass', rubric, public_case_count: 1, hidden_case_count: 2, status },
  { problem_id: 'p2', position: 1, weight: 1, statement: 'Reverse a string', starter_code: 'def f2(): pass', rubric, public_case_count: 1, hidden_case_count: 1, status },
]
const started = (over = {}) => ({ attempt_id: 'att1', receipt_code: 'RCPT123', remaining_seconds: 600, questions: questions(), ...over })
const done = (score = 94) => ({
  status: 'done', score, sub_scores: { correctness: 1, efficiency: 1, code_style: 1, edge_case_handling: 1 },
  tests: { passed: 2, total: 2 }, feedback: { summary: 'Good job', issues: [] },
})

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/exam/tok']}>
      <Routes><Route path="/exam/:token" element={<ExamPage />} /></Routes>
    </MemoryRouter>,
  )
const editor = () => screen.getByLabelText('editor')
const tick = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const startExam = async (name = 'An') => {
  await screen.findByLabelText('Họ tên')
  fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
  fireEvent.click(screen.getByRole('button', { name: /Bắt đầu/ }))
  await screen.findByRole('button', { name: 'Submit' })
}

beforeEach(() => {
  api.getExam.mockResolvedValue(summary())
  api.startAttempt.mockResolvedValue(started())
  api.checkSyntax.mockResolvedValue({ ok: true })
  api.submitQuestion.mockResolvedValue({ status: 'queued' })
  api.getQuestionStatus.mockResolvedValue(done())
  api.getAttemptByReceipt.mockResolvedValue({ student_name: 'An', questions: [], total: 80 })
})
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); localStorage.clear() })

describe('starting', () => {
  it('needs a name and a Turnstile token before the exam can start', async () => {
    renderPage()
    const start = await screen.findByRole('button', { name: /Bắt đầu/ })
    expect(start).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: 'An' } })
    expect(start).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(start).toBeEnabled()
  })

  it('sends the name and token, shows the receipt code at once and remembers the attempt', async () => {
    renderPage()
    await startExam('An')
    expect(api.startAttempt).toHaveBeenCalledWith('tok', 'An', 'tok123')
    expect(screen.getByText('RCPT123')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('exam:tok'))).toEqual({ attempt_id: 'att1', receipt_code: 'RCPT123' })
  })

  it('shows the API message when the name is taken or the client is rate limited', async () => {
    api.startAttempt.mockRejectedValueOnce(new Error('This name is already used in this exam. Use your receipt code to continue or to see your score.'))
    renderPage()
    await screen.findByLabelText('Họ tên')
    fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: 'An' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu/ }))
    expect(await screen.findByText(/receipt code to continue/)).toBeInTheDocument()
    api.startAttempt.mockRejectedValueOnce(new Error('Too many requests, slow down.'))
    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu/ }))
    expect(await screen.findByText(/Too many requests/)).toBeInTheDocument()
  })

  it('shows the closed message, and a readable message for an unknown link', async () => {
    api.getExam.mockResolvedValueOnce(summary({ is_closed: true }))
    const first = renderPage()
    expect(await screen.findByText('Đề kiểm tra này đã đóng.')).toBeInTheDocument()
    first.unmount()
    api.getExam.mockRejectedValueOnce(new Error('Unknown exam link'))
    renderPage()
    expect(await screen.findByText(/Error: Unknown exam link/)).toBeInTheDocument()
  })
})

describe('resume', () => {
  const saved = () => localStorage.setItem('exam:tok', JSON.stringify({ attempt_id: 'att1', receipt_code: 'RCPT123' }))

  it('a reload resumes the stored attempt with the server clock and skips the name gate', async () => {
    saved()
    api.resumeAttempt.mockResolvedValue({ student_name: 'An', receipt_code: 'RCPT123', remaining_seconds: 123, questions: questions() })
    renderPage()
    expect(await screen.findByText('02:03')).toBeInTheDocument()
    expect(api.resumeAttempt).toHaveBeenCalledWith('tok', 'att1')
    expect(api.startAttempt).not.toHaveBeenCalled()
    expect(screen.getByText('RCPT123')).toBeInTheDocument()
  })

  it('an unknown stored attempt is forgotten and the name gate is shown', async () => {
    saved()
    api.resumeAttempt.mockRejectedValue(new Error('Unknown attempt'))
    renderPage()
    expect(await screen.findByLabelText('Họ tên')).toBeInTheDocument()
    expect(localStorage.getItem('exam:tok')).toBeNull()
  })

  it('a question that was still being graded keeps being polled and ends with its score', async () => {
    saved()
    api.resumeAttempt.mockResolvedValue({ student_name: 'An', receipt_code: 'RCPT123', remaining_seconds: 300, questions: questions('queued') })
    vi.useFakeTimers({ shouldAdvanceTime: false })
    renderPage()
    await tick(0) // let the exam and the attempt load (findBy* would hang under fake timers)
    await tick(2000)
    expect(screen.getByText('94.0 / 100')).toBeInTheDocument()
    expect(api.getQuestionStatus).toHaveBeenCalledWith('tok', 'att1', 'p1')
  })
})

describe('solving', () => {
  it('submit queues the code, polls until done, then shows the score and feedback', async () => {
    api.getQuestionStatus.mockResolvedValueOnce({ status: 'queued' }).mockResolvedValueOnce({ status: 'grading' }).mockResolvedValue(done())
    renderPage()
    await startExam()
    fireEvent.change(editor(), { target: { value: 'NEWCODE' } })
    vi.useFakeTimers({ shouldAdvanceTime: false })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit' })) })
    expect(api.submitQuestion).toHaveBeenCalledWith('tok', 'att1', 'p1', 'NEWCODE')
    expect(screen.getByText(/Đang chờ chấm|Grading/)).toBeInTheDocument()
    await tick(2000)
    await tick(2000)
    await tick(2000)
    expect(screen.getByText('94.0 / 100')).toBeInTheDocument()
    expect(screen.getByText('Good job')).toBeInTheDocument()
  })

  it('a failed grading shows the error and "Chấm lại" re-queues and polls again', async () => {
    api.getQuestionStatus.mockResolvedValueOnce({ status: 'failed', error: 'Grading service error, please try again.' }).mockResolvedValue(done(70))
    api.retryQuestion.mockResolvedValue({ status: 'queued' })
    renderPage()
    await startExam()
    vi.useFakeTimers({ shouldAdvanceTime: false })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit' })) })
    await tick(2000)
    expect(screen.getByText(/Grading service error/)).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Chấm lại' })) })
    await tick(2000)
    expect(api.retryQuestion).toHaveBeenCalledWith('tok', 'att1', 'p1')
    expect(screen.getByText('70.0 / 100')).toBeInTheDocument()
  })

  it('polling gives up after five minutes with a pointer to the receipt lookup', async () => {
    api.getQuestionStatus.mockResolvedValue({ status: 'queued' })
    renderPage()
    await startExam()
    vi.useFakeTimers({ shouldAdvanceTime: false })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit' })) })
    await tick(5 * 60 * 1000 + 4000)
    expect(screen.getByText(/mất nhiều thời gian/)).toBeInTheDocument()
    const calls = api.getQuestionStatus.mock.calls.length
    await tick(30_000)
    expect(api.getQuestionStatus.mock.calls.length).toBe(calls)
  })

  it('shows pass/fail counts for Run Tests', async () => {
    api.runTests.mockResolvedValue({ status: 'ran', message: null, cases: [{ passed: true, error: null }] })
    renderPage()
    await startExam()
    fireEvent.click(screen.getByRole('button', { name: 'Run Tests' }))
    expect(await screen.findByText(/1\/1 public test case\(s\) passed/)).toBeInTheDocument()
    expect(api.runTests).toHaveBeenCalledWith('tok', 'att1', 'p1', 'def f1(): pass')
  })

  it('keeps each question code when switching tabs and gives each its own editor model', async () => {
    renderPage()
    await startExam()
    fireEvent.change(editor(), { target: { value: 'CODE-ONE' } })
    const first = editor().getAttribute('data-path')
    fireEvent.click(screen.getByRole('button', { name: 'Câu 2' }))
    expect(editor()).toHaveValue('def f2(): pass')
    expect(editor().getAttribute('data-path')).not.toBe(first)
    fireEvent.change(editor(), { target: { value: 'CODE-TWO' } })
    fireEvent.click(screen.getByRole('button', { name: 'Câu 1' }))
    expect(editor()).toHaveValue('CODE-ONE')
  })

  it('shows the server remaining time as whole seconds', async () => {
    api.startAttempt.mockResolvedValue(started({ remaining_seconds: 270 }))
    renderPage()
    await startExam()
    expect(screen.getByText('04:30')).toBeInTheDocument()
  })

  it('timer expiry submits each unsubmitted question exactly once and treats a 409 as in flight', async () => {
    api.startAttempt.mockResolvedValue(started({ remaining_seconds: 3 }))
    api.submitQuestion.mockImplementation(async (_t, _a, pid) => {
      if (pid === 'p2') throw new Error('Already submitted')
      return { status: 'queued' }
    })
    renderPage()
    await screen.findByLabelText('Họ tên')
    fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: 'An' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    vi.useFakeTimers({ shouldAdvanceTime: false })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Bắt đầu/ })) })
    await tick(4000)
    expect(api.submitQuestion.mock.calls.map((c) => c[2]).sort()).toEqual(['p1', 'p2'])
    await tick(10000)
    expect(api.submitQuestion).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/Grading failed/)).toBeNull()
  })

  it('shows the total once every question is graded', async () => {
    api.getAttemptByReceipt.mockResolvedValue({ student_name: 'An', questions: [], total: 65 })
    renderPage()
    await startExam()
    vi.useFakeTimers({ shouldAdvanceTime: false })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit' })) })
    await tick(2000)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Câu 2' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit' })) })
    await tick(2000)
    expect(screen.getByText(/Tổng điểm: 65/)).toBeInTheDocument()
    expect(api.getAttemptByReceipt).toHaveBeenCalledWith('tok', 'RCPT123')
  })

  it('never renders test inputs or expected values, even if the API sent them', async () => {
    const q = started()
    q.questions[0].public_cases = [{ args: [1], expected: 'PUBEXP' }]
    q.questions[0].hidden_cases = [{ args: [2], expected: 'HIDDENEXP' }]
    api.startAttempt.mockResolvedValue(q)
    renderPage()
    await startExam()
    expect(document.body.textContent).not.toContain('PUBEXP')
    expect(document.body.textContent).not.toContain('HIDDENEXP')
  })
})

describe('receipt lookup', () => {
  it('shows per-question scores and the total for a receipt code', async () => {
    api.getAttemptByReceipt.mockResolvedValue({
      student_name: 'An', total: 70, questions: [{ problem_id: 'p1', score: 80, feedback: null }, { problem_id: 'p2', score: 60, feedback: null }],
    })
    renderPage()
    fireEvent.change(await screen.findByLabelText('Mã biên nhận'), { target: { value: 'RCPT123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Xem điểm' }))
    expect(await screen.findByText(/Tổng điểm: 70/)).toBeInTheDocument()
    expect(screen.getByText('80.0')).toBeInTheDocument()
    expect(screen.getByText('60.0')).toBeInTheDocument()
  })
})
