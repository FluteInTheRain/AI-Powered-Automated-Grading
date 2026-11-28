import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/api.js'
import ExamAppealsPage from '../src/pages/ExamAppealsPage.jsx'

vi.mock('../src/api.js')

const exam = { id: 'e1', title: 'Quiz 1', questions: [{ problem_id: 'p1', position: 0 }, { problem_id: 'p2', position: 1 }] }
const row = (over = {}) => ({ id: 'a1', student_name: 'An', problem_id: 'p2', status: 'open', created_at: '2026-11-27T01:00:00Z', ...over })
const detail = (over = {}) => ({
  id: 'a1', exam_id: 'e1', student_name: 'An', problem_id: 'p2', submission_id: 's1', status: 'open', message: 'Please recheck',
  decision_note: null, decided_by: null, created_at: '2026-11-27T01:00:00Z', decided_at: null, code: 'def f(x): return 3',
  revisions: [{ revision: 0, source: 'ai', score: 60, author: 'pipeline', reason: null, created_at: '2026-11-27T00:00:00Z' }],
  ai_result: {
    final_score_0_to_100: 60,
    sub_scores_0_to_1: { correctness: 0.5, efficiency: 0, code_style: 1, edge_case_handling: 0.5 },
    execution_result: { pass_count: 1, total: 2, status: 'ran', errors: [] },
    check_details: {
      efficiency: { meets_expected_complexity: false, observed_pattern: 'nested loop O(n^2)' },
      code_style: { level: 'clean' },
      edge_case_handling: { handled: false, missing_cases: ['empty list'] },
    },
    feedback: { summary: 'Works on simple inputs only.', issues: [{ line: 2, issue: 'off-by-one', explanation: 'Loop stops early.', suggested_fix: 'use range(n+1)' }] },
  },
  audit: { call_log: [{ kind: 'check', schema: 'S', model: 'm', system_prompt: 'SYS-PROMPT', user_prompt: 'USER-PROMPT', raw_response: 'RAW-RESPONSE' }] },
  ...over,
})

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/teacher/exams/e1/appeals']}>
      <Routes><Route path="/teacher/exams/:id/appeals" element={<ExamAppealsPage />} /></Routes>
    </MemoryRouter>,
  )
const open = async () => {
  renderPage()
  const view = await screen.findByRole('button', { name: 'Xem' })
  await act(async () => { fireEvent.click(view) })
}

beforeEach(() => {
  api.getExamDetail.mockResolvedValue(exam)
  api.listExamAppeals.mockResolvedValue([row()])
  api.getAppeal.mockResolvedValue(detail())
  api.startAppealReview.mockResolvedValue({ status: 'under_review' })
  api.decideAppeal.mockResolvedValue({ status: 'adjusted' })
})
afterEach(() => vi.resetAllMocks())

describe('ExamAppealsPage', () => {
  it('tells a failed audit read apart from missing audit data', async () => {
    api.getAppeal.mockResolvedValue(detail({ audit: null, audit_read_failed: true }))
    await open()
    expect(await screen.findByText(/Chưa đọc được dữ liệu chấm/)).toBeInTheDocument()
    expect(screen.queryByText(/Không còn dữ liệu chấm/)).not.toBeInTheDocument()
  })

  it('lists the appeals with student, question number and status', async () => {
    renderPage()
    expect(await screen.findByText('An')).toBeInTheDocument()
    expect(screen.getByText('Câu 2')).toBeInTheDocument()
    expect(screen.getByText('Đang chờ')).toBeInTheDocument()
  })

  it('says so when there are no appeals', async () => {
    api.listExamAppeals.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('Chưa có khiếu nại nào.')).toBeInTheDocument()
  })

  it('opening an open appeal takes it for review once and shows the message, code, revisions and AI call log', async () => {
    await open()
    expect(api.startAppealReview).toHaveBeenCalledTimes(1)
    expect(api.startAppealReview).toHaveBeenCalledWith('a1')
    expect(await screen.findByText('Please recheck')).toBeInTheDocument()
    expect(screen.getByText('def f(x): return 3')).toBeInTheDocument()
    expect(screen.getByText(/pipeline/)).toBeInTheDocument()
    expect(screen.getByText('SYS-PROMPT')).toBeInTheDocument()
    expect(screen.getByText('RAW-RESPONSE')).toBeInTheDocument()
  })

  it('does not take an appeal that is already under review again', async () => {
    api.listExamAppeals.mockResolvedValue([row({ status: 'under_review' })])
    api.getAppeal.mockResolvedValue(detail({ status: 'under_review' }))
    await open()
    expect(api.startAppealReview).not.toHaveBeenCalled()
  })

  it('shows the score field only for an adjustment', async () => {
    await open()
    await screen.findByText('Please recheck')
    expect(screen.queryByLabelText('Điểm mới')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Chỉnh điểm'))
    expect(screen.getByLabelText('Điểm mới')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Từ chối'))
    expect(screen.queryByLabelText('Điểm mới')).not.toBeInTheDocument()
  })

  it('sends the decision with note and score, then reloads the list', async () => {
    await open()
    await screen.findByText('Please recheck')
    fireEvent.click(screen.getByLabelText('Chỉnh điểm'))
    fireEvent.change(screen.getByLabelText('Điểm mới'), { target: { value: '85' } })
    fireEvent.change(screen.getByLabelText('Ghi chú cho sinh viên'), { target: { value: 'Edge case was fine' } })
    const loads = api.listExamAppeals.mock.calls.length
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Lưu quyết định' })) })
    expect(api.decideAppeal).toHaveBeenCalledWith('a1', { decision: 'adjusted', note: 'Edge case was fine', score: 85 })
    expect(api.listExamAppeals.mock.calls.length).toBeGreaterThan(loads)
  })

  it('marks the new score field as out of 100', async () => {
    await open()
    await screen.findByText('Please recheck')
    fireEvent.click(screen.getByLabelText('Chỉnh điểm'))
    expect(screen.getByText(/thang 100/)).toBeInTheDocument()
  })

  it('keeps the save button disabled until there is a note (and a score when adjusting)', async () => {
    await open()
    await screen.findByText('Please recheck')
    const save = screen.getByRole('button', { name: 'Lưu quyết định' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Ghi chú cho sinh viên'), { target: { value: 'ok' } })
    expect(save).toBeEnabled()
    fireEvent.click(screen.getByLabelText('Chỉnh điểm'))
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Điểm mới'), { target: { value: '70' } })
    expect(save).toBeEnabled()
  })

  it('shows the server message when the decision is refused', async () => {
    api.decideAppeal.mockRejectedValue(new Error('This appeal was already decided.'))
    await open()
    await screen.findByText('Please recheck')
    fireEvent.change(screen.getByLabelText('Ghi chú cho sinh viên'), { target: { value: 'ok' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Lưu quyết định' })) })
    expect(await screen.findByText('This appeal was already decided.')).toBeInTheDocument()
  })

  it('a 409 on the decision reloads the appeal and the list instead of leaving a stale form', async () => {
    api.decideAppeal.mockRejectedValue(Object.assign(new Error('This appeal was already decided.'), { status: 409 }))
    await open()
    await screen.findByText('Please recheck')
    api.getAppeal.mockResolvedValue(detail({ status: 'rejected', decision_note: 'No merit', decided_by: 't@x.com' }))
    api.listExamAppeals.mockClear()
    fireEvent.change(screen.getByLabelText('Ghi chú cho sinh viên'), { target: { value: 'ok' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Lưu quyết định' })) })
    expect(await screen.findByText(/No merit/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lưu quyết định' })).not.toBeInTheDocument()
    expect(screen.getByText(/đã được quyết định ở nơi khác/)).toBeInTheDocument()
    expect(api.listExamAppeals).toHaveBeenCalled()
  })

  it('a decided appeal shows its note and no decision form', async () => {
    api.listExamAppeals.mockResolvedValue([row({ status: 'rejected' })])
    api.getAppeal.mockResolvedValue(detail({ status: 'rejected', decision_note: 'No merit', decided_by: 't@x.com' }))
    await open()
    expect(await screen.findByText(/No merit/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lưu quyết định' })).not.toBeInTheDocument()
    expect(api.startAppealReview).not.toHaveBeenCalled()
  })
  it('switching to another appeal starts with an empty decision form', async () => {
    api.listExamAppeals.mockResolvedValue([row(), row({ id: 'a2', student_name: 'Binh' })])
    api.getAppeal.mockImplementation(async (id) => detail({ id, student_name: id === 'a2' ? 'Binh' : 'An' }))
    renderPage()
    const views = await screen.findAllByRole('button', { name: 'Xem' })
    await act(async () => { fireEvent.click(views[0]) })
    fireEvent.click(await screen.findByLabelText('Chỉnh điểm'))
    fireEvent.change(screen.getByLabelText('Điểm mới'), { target: { value: '85' } })
    fireEvent.change(screen.getByLabelText('Ghi chú cho sinh viên'), { target: { value: 'for An' } })
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Xem' })[1]) })
    await screen.findByText(/Binh/, { selector: 'h2' })
    expect(screen.getByLabelText('Ghi chú cho sinh viên')).toHaveValue('')
    expect(screen.getByLabelText('Giữ nguyên điểm')).toBeChecked()
  })

  it('a 409 on taking the review (another tab got there first) still opens the detail and refreshes the list', async () => {
    api.startAppealReview.mockRejectedValue(new Error('Only an open appeal can be taken for review.'))
    api.getAppeal.mockResolvedValue(detail({ status: 'under_review' }))
    await open()
    expect(await screen.findByText('Please recheck')).toBeInTheDocument()
    expect(api.listExamAppeals).toHaveBeenCalledTimes(2)
  })
  it('shows the AI result in plain Vietnamese before any raw log: tests passed, each check, the feedback', async () => {
    await open()
    await screen.findByText('Please recheck')
    expect(screen.getByText(/Test ẩn đạt: 1\/2/)).toBeInTheDocument()
    expect(screen.getByText(/Hiệu năng/)).toHaveTextContent(/Không đạt.*nested loop O\(n\^2\)/)
    expect(screen.getByText(/Phong cách code/)).toHaveTextContent(/Tốt/)
    expect(screen.getByText(/Trường hợp biên/)).toHaveTextContent(/Thiếu.*empty list/)
    expect(screen.getByText(/Works on simple inputs only/)).toBeInTheDocument()
    expect(screen.getByText(/dòng 2/i)).toBeInTheDocument()
  })

  it('keeps the raw prompts and responses in a collapsed technical section', async () => {
    await open()
    await screen.findByText('Please recheck')
    const tech = screen.getByText(/Chi tiết kỹ thuật/).closest('details')
    expect(tech).not.toHaveAttribute('open')
    expect(tech).toHaveTextContent('RAW-RESPONSE')
  })

  it('still opens when the AI result is missing', async () => {
    api.getAppeal.mockResolvedValue(detail({ ai_result: null }))
    await open()
    expect(await screen.findByText('Please recheck')).toBeInTheDocument()
    expect(screen.getByText(/Không có kết quả chấm chi tiết/)).toBeInTheDocument()
  })
})
