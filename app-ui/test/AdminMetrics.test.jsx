import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/api.js'
import AdminMetricsPage from '../src/pages/AdminMetricsPage.jsx'

vi.mock('../src/api.js')

const metrics = (over = {}) => ({
  canary: [
    { ran_at: '2026-11-27T03:17:00Z', score: 80, status: 'ok', verdict: 'mismatch', error: null },
    { ran_at: '2026-11-26T03:17:00Z', score: 82, status: 'ok', verdict: 'stable', error: null },
    { ran_at: '2026-11-25T03:17:00Z', score: null, status: 'error', verdict: 'error', error: 'Error: grader 502' },
    { ran_at: '2026-11-24T03:17:00Z', score: 82, status: 'ok', verdict: 'baseline', error: null },
  ],
  overturn: { filed: 5, decided: 3, adjusted: 2, mean_delta: 10 },
  health: [{ day: '2026-11-27', outcome: 'done', count: 12, p50_ms: 900, p95_ms: 2100 }],
  label: 'overturn signal (selection-biased, single rater)',
  ...over,
})
const renderPage = () => render(<MemoryRouter><AdminMetricsPage /></MemoryRouter>)

beforeEach(() => api.getAdminMetrics.mockResolvedValue(metrics()))
afterEach(() => vi.resetAllMocks())

describe('AdminMetricsPage', () => {
  it('marks a canary mismatch loudly and an error differently', async () => {
    renderPage()
    const bad = await screen.findByText('LỆCH')
    expect(bad).toHaveClass('canary-bad')
    expect(screen.getByText('Lỗi chấm bài chuẩn')).toBeInTheDocument()
    expect(screen.getByText('Ổn định')).toBeInTheDocument()
    expect(screen.getByText('Mốc')).toBeInTheDocument()
  })

  it('shows the overturn numbers under the biased-signal label and never calls them accuracy', async () => {
    renderPage()
    const section = (await screen.findByText(/selection-biased, single rater/)).closest('section')
    expect(within(section).getByText(/Đã gửi: 5/)).toBeInTheDocument()
    expect(within(section).getByText(/Điểm đổi trung bình: \+10/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/độ chính xác|accuracy|human graders/i)
  })

  it('shows the health table', async () => {
    renderPage()
    const row = (await screen.findByText('2026-11-27')).closest('tr')
    expect(within(row).getByText('done')).toBeInTheDocument()
    expect(within(row).getByText('900')).toBeInTheDocument()
    expect(within(row).getByText('2100')).toBeInTheDocument()
  })

  it('says health is unavailable when the server could not read it', async () => {
    api.getAdminMetrics.mockResolvedValue(metrics({ health: null }))
    renderPage()
    expect(await screen.findByText('Không có dữ liệu sức khoẻ chấm bài')).toBeInTheDocument()
    expect(screen.getByText('LỆCH')).toBeInTheDocument() // the other sections still render
  })

  it('points to the AI Gateway for cost', async () => {
    renderPage()
    expect(await screen.findByText(/AI Gateway/)).toBeInTheDocument()
  })

  it('tells a non-admin they have no access', async () => {
    api.getAdminMetrics.mockRejectedValue(Object.assign(new Error('Not allowed'), { status: 403 }))
    renderPage()
    expect(await screen.findByText('Không có quyền truy cập')).toBeInTheDocument()
  })

  it('shows any other error', async () => {
    api.getAdminMetrics.mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText('Error: boom')).toBeInTheDocument()
  })
  it('explains an empty health table instead of showing bare headers', async () => {
    api.getAdminMetrics.mockResolvedValue(metrics({ health: [] }))
    renderPage()
    expect(await screen.findByText(/Chưa có dữ liệu trong 14 ngày/)).toBeInTheDocument()
  })

  it('warns when the canary has not run for more than a day, and stays quiet when it is fresh', async () => {
    api.getAdminMetrics.mockResolvedValue(metrics({ canary: [{ ran_at: new Date(Date.now() - 40 * 3600_000).toISOString(), score: 80, status: 'ok', verdict: 'stable', error: null }] }))
    const { unmount } = renderPage()
    expect(await screen.findByText(/Bài chuẩn chưa chạy 40 giờ/)).toBeInTheDocument()
    unmount()
    api.getAdminMetrics.mockResolvedValue(metrics({ canary: [{ ran_at: new Date(Date.now() - 2 * 3600_000).toISOString(), score: 80, status: 'ok', verdict: 'stable', error: null }] }))
    renderPage()
    await screen.findByText('Ổn định')
    expect(screen.queryByText(/Bài chuẩn chưa chạy/)).toBeNull()
  })

  it('does not call a canary that has never run stale', async () => {
    api.getAdminMetrics.mockResolvedValue(metrics({ canary: [] }))
    renderPage()
    expect(await screen.findByText(/Chưa có lần chạy nào/)).toBeInTheDocument()
    expect(screen.queryByText(/Bài chuẩn chưa chạy/)).toBeNull()
  })
})
