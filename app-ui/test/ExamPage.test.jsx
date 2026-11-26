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
const started = (over = {}) => ({ attempt_id: 'att1', receipt_code: 'RCPT123', remaining_seconds: 600, submitted: false, questions: questions(), ...over })
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
  await screen.findByRole('button', { name: 'Nộp bài' })
}
const confirmSubmit = async () => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Xác nhận nộp' })) })
}

beforeEach(() => {
  api.getExam.mockResolvedValue(summary())
  api.startAttempt.mockResolvedValue(started())
  api.checkSyntax.mockResolvedValue({ ok: true })
  api.submitExam.mockResolvedValue({ status: 'queued', problem_ids: ['p1', 'p2'] })
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
    api.startAttempt.mockRejectedValueOnce(new Error('This name is already used in this exam. If it was you, continue in the browser where you started.'))
    renderPage()
    await screen.findByLabelText('Họ tên')
    fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: 'An' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu/ }))
    expect(await screen.findByText(/already used in this exam/)).toBeInTheDocument()
    api.startAttempt.mockRejectedValueOnce(new Error('Too many requests, slow down.'))
    fireEvent.click(screen.getByRole('button', { name: 'Verify' })) // the spent token was discarded
    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu/ }))
    expect(await screen.findByText(/Too many requests/)).toBeInTheDocument()
  })

  it('asks for a fresh Turnstile token after a failed start, because tokens are single-use', async () => {
    api.startAttempt.mockRejectedValueOnce(new Error('This name is already used in this exam.'))
    renderPage()
    await screen.findByLabelText('Họ tên')
    fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: 'An' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu/ }))
    await screen.findByText(/already used/)
    expect(screen.getByRole('button', { name: /Bắt đầu/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(screen.getByRole('button', { name: /Bắt đầu/ })).toBeEnabled()
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
    api.resumeAttempt.mockResolvedValue({ student_name: 'An', receipt_code: 'RCPT123', remaining_seconds: 123, submitted: false, questions: questions() })
    renderPage()
    expect(await screen.findByText('02:03')).toBeInTheDocument()
    expect(api.resumeAttempt).toHaveBeenCalledWith('tok', 'att1')
    expect(api.startAttempt).not.toHaveBeenCalled()
    expect(screen.getByText('RCPT123')).toBeInTheDocument()
  })

  it('an unknown stored attempt (404) is forgotten and the name gate is shown', async () => {
    saved()
    api.resumeAttempt.mockRejectedValue(Object.assign(new Error('Unknown attempt'), { status: 404 }))
    renderPage()
    expect(await screen.findByLabelText('Họ tên')).toBeInTheDocument()
    expect(localStorage.getItem('exam:tok')).toBeNull()
  })

  it('a resume that fails for another reason keeps the stored attempt and shows the error, not the name gate', async () => {
    saved()
    api.resumeAttempt.mockRejectedValue(Object.assign(new Error('Service unavailable'), { status: 503 }))
    renderPage()
    expect(await screen.findByText(/Service unavailable/)).toBeInTheDocument()
    expect(localStorage.getItem('exam:tok')).not.toBeNull()
    expect(screen.queryByLabelText('Họ tên')).toBeNull()
  })

  it('a reload after submitting opens the submitted view, keeps polling and ends with the total', async () => {
    saved()
    api.resumeAttempt.mockResolvedValue({ student_name: 'An', receipt_code: 'RCPT123', remaining_seconds: 300, submitted: true, questions: questions('queued') })
    vi.useFakeTimers({ shouldAdvanceTime: false })
    renderPage()
    await tick(0) // let the exam and the attempt load (findBy* would hang under fake timers)
    expect(screen.queryByRole('button', { name: 'Nộp bài' })).toBeNull()
    expect(screen.getByText(/Đã chấm 0\/2 câu/)).toBeInTheDocument()
    await tick(2000)
    expect(screen.getByText(/Đã chấm 2\/2 câu/)).toBeInTheDocument()
    expect(screen.getByText('94.0 / 100')).toBeInTheDocument()
    expect(screen.getByText(/Tổng điểm: 80/)).toBeInTheDocument()
  })
})

describe('submitting the whole exam', () => {
  it('has no per-question submit button', async () => {
    renderPage()
    await startExam()
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
  })

  it('"Nộp bài" asks for confirmation, then sends every answer in one call', async () => {
    renderPage()
    await startExam()
    fireEvent.change(editor(), { target: { value: 'NEWCODE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' }))
    expect(screen.getByText(/không thể sửa/)).toBeInTheDocument()
    expect(api.submitExam).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận nộp' }))
    await screen.findByText(/Đã chấm|Đang chấm/)
    expect(api.submitExam).toHaveBeenCalledTimes(1)
    expect(api.submitExam).toHaveBeenCalledWith('tok', 'att1', { p1: 'NEWCODE', p2: 'def f2(): pass' })
  })

  it('cancelling the confirmation keeps the exam open', async () => {
    renderPage()
    await startExam()
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }))
    expect(api.submitExam).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Nộp bài' })).toBeInTheDocument()
  })

  it('after submitting, Run Tests is disabled and the submit button is gone', async () => {
    api.getQuestionStatus.mockResolvedValue({ status: 'queued' })
    renderPage()
    await startExam()
    await confirmSubmit()
    expect(await screen.findByText(/Đã chấm 0\/2 câu/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Tests' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Nộp bài' })).toBeNull()
  })

  it('shows how many questions are graded, then the total and each result', async () => {
    api.getAttemptByReceipt.mockResolvedValue({ student_name: 'An', questions: [], total: 65 })
    api.getQuestionStatus
      .mockResolvedValueOnce(done(70)) // p1 at the first poll
      .mockResolvedValueOnce({ status: 'queued' }) // p2 at the first poll
      .mockResolvedValue(done(60))
    renderPage()
    await startExam()
    vi.useFakeTimers({ shouldAdvanceTime: false })
    await confirmSubmit()
    await tick(2000)
    expect(screen.getByText(/Đã chấm 1\/2 câu/)).toBeInTheDocument()
    expect(screen.getByText('70.0 / 100')).toBeInTheDocument()
    await tick(2000)
    expect(screen.getByText(/Đã chấm 2\/2 câu/)).toBeInTheDocument()
    expect(screen.getByText(/Tổng điểm: 65/)).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Câu 2' })) })
    expect(screen.getByText('60.0 / 100')).toBeInTheDocument()
  })

  it('timer expiry submits once, and nothing can submit a second time afterwards', async () => {
    api.startAttempt.mockResolvedValue(started({ remaining_seconds: 3 }))
    renderPage()
    await screen.findByLabelText('Họ tên')
    fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: 'An' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    vi.useFakeTimers({ shouldAdvanceTime: false })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Bắt đầu/ })) })
    await tick(4000)
    expect(api.submitExam).toHaveBeenCalledTimes(1)
    expect(api.submitExam).toHaveBeenCalledWith('tok', 'att1', { p1: 'def f1(): pass', p2: 'def f2(): pass' })
    await tick(10000)
    expect(api.submitExam).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Nộp bài' })).toBeNull()
  })

  it('a 409 on submit switches to the submitted view without an error', async () => {
    api.submitExam.mockRejectedValue(new Error('Already submitted'))
    renderPage()
    await startExam()
    await confirmSubmit()
    expect(await screen.findByText(/Đã chấm|Đang chấm/)).toBeInTheDocument()
    expect(screen.queryByText(/Không nộp được/)).toBeNull()
  })

  it('a network error keeps the exam open and the student can try again', async () => {
    api.submitExam.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue({ status: 'queued', problem_ids: ['p1', 'p2'] })
    renderPage()
    await startExam()
    await confirmSubmit()
    expect(await screen.findByText(/Không nộp được: Failed to fetch/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nộp bài' })).toBeInTheDocument()
    await confirmSubmit()
    expect(await screen.findByText(/Đã chấm|Đang chấm/)).toBeInTheDocument()
    expect(api.submitExam).toHaveBeenCalledTimes(2)
  })

  it('when another submit is in progress but nothing was stored, the exam opens again', async () => {
    api.submitExam.mockRejectedValueOnce(new Error('A submission is already in progress'))
    api.getQuestionStatus.mockResolvedValue({ status: 'none' })
    renderPage()
    await startExam()
    vi.useFakeTimers({ shouldAdvanceTime: false })
    await confirmSubmit()
    await tick(2000)
    expect(screen.getByRole('button', { name: 'Nộp bài' })).toBeInTheDocument()
  })
})

describe('grading problems', () => {
  const submitThenPoll = async (statusFor) => {
    api.getQuestionStatus.mockImplementation(async (_t, _a, pid) => statusFor(pid))
    renderPage()
    await startExam()
    vi.useFakeTimers({ shouldAdvanceTime: false })
    await confirmSubmit()
    await tick(2000)
  }

  it('a failed question shows the error and "Chấm lại" re-queues it and polls again', async () => {
    let calls = 0
    api.retryQuestion.mockResolvedValue({ status: 'queued' })
    await submitThenPoll((pid) => (pid === 'p1' && calls++ === 0 ? { status: 'failed', error: 'Grading service error, please try again.', retryable: true } : done(70)))
    expect(screen.getByText(/Grading service error/)).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Chấm lại' })) })
    await tick(2000)
    expect(api.retryQuestion).toHaveBeenCalledWith('tok', 'att1', 'p1')
    expect(screen.getByText('70.0 / 100')).toBeInTheDocument()
  })

  it('a job reported stuck offers "Chấm lại"', async () => {
    let calls = 0
    api.retryQuestion.mockResolvedValue({ status: 'queued' })
    await submitThenPoll((pid) => (pid === 'p1' && calls++ === 0 ? { status: 'grading', stuck: true } : done(88)))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Chấm lại' })) })
    await tick(2000)
    expect(api.retryQuestion).toHaveBeenCalledWith('tok', 'att1', 'p1')
    expect(screen.getByText('88.0 / 100')).toBeInTheDocument()
  })

  it('a permanent failure shows the error and no retry button', async () => {
    await submitThenPoll(() => ({ status: 'failed', error: 'Grading failed: your submission exceeded the time/resource limit.', retryable: false }))
    expect(screen.getByText(/time\/resource limit/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Chấm lại' })).toBeNull()
  })

  it('polling gives up after five minutes with a pointer to the receipt lookup', async () => {
    api.getQuestionStatus.mockResolvedValue({ status: 'queued' })
    renderPage()
    await startExam()
    vi.useFakeTimers({ shouldAdvanceTime: false })
    await confirmSubmit()
    await tick(5 * 60 * 1000 + 4000)
    expect(screen.getAllByText(/mất nhiều thời gian/).length).toBeGreaterThan(0)
    const calls = api.getQuestionStatus.mock.calls.length
    await tick(30_000)
    expect(api.getQuestionStatus.mock.calls.length).toBe(calls)
  })
})

describe('working on the exam', () => {
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
