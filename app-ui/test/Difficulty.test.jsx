import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/api.js'
import DifficultyPage from '../src/pages/DifficultyPage.jsx'

vi.mock('../src/api.js')

const p = (over) => ({ problem_id: 'x', title: 'X', difficulty: 'hard', n: 0, mean_score: null, pass_rate: null, ci_low: null, ci_high: null, verdict: 'insufficient', ...over })
const data = {
  min_attempts: 20,
  problems: [
    p({ problem_id: 'a', title: 'Cộng hai số', difficulty: 'hard', n: 25, mean_score: 96.4, pass_rate: 0.96, ci_low: 0.8, ci_high: 0.99, verdict: 'easier' }),
    p({ problem_id: 'b', title: 'Đảo chuỗi', difficulty: 'easy', n: 30, mean_score: 40, pass_rate: 0.1, ci_low: 0.03, ci_high: 0.26, verdict: 'harder' }),
    p({ problem_id: 'c', title: 'Tổng mảng', difficulty: 'medium', n: 40, mean_score: 70, pass_rate: 0.5, ci_low: 0.35, ci_high: 0.65, verdict: 'match' }),
    p({ problem_id: 'd', title: 'Mới dùng', difficulty: 'medium', n: 3, mean_score: 80, pass_rate: 1, ci_low: 0.44, ci_high: 1, verdict: 'insufficient' }),
    p({ problem_id: 'e', title: 'Chưa dùng', difficulty: 'easy' }),
  ],
}
const renderPage = () => render(<MemoryRouter><DifficultyPage /></MemoryRouter>)
afterEach(() => vi.resetAllMocks())

const rowOf = (name) => screen.getByText(name).closest('tr')

describe('DifficultyPage', () => {
  it('shows the verdict, n and the interval for each problem', async () => {
    api.getDifficultyCalibration.mockResolvedValue(data)
    renderPage()
    expect(await screen.findByText('Độ khó thực tế', { selector: 'h1' })).toBeInTheDocument()
    const a = within(rowOf('Cộng hai số'))
    expect(a.getByText('Có vẻ dễ hơn nhãn')).toBeInTheDocument()
    expect(a.getByText('25')).toBeInTheDocument()
    expect(a.getByText('96% (khoảng 80% đến 99%)')).toBeInTheDocument()
    expect(within(rowOf('Đảo chuỗi')).getByText('Có vẻ khó hơn nhãn')).toBeInTheDocument()
    expect(within(rowOf('Tổng mảng')).getByText('Khớp')).toBeInTheDocument()
  })

  it('says not enough data instead of a verdict, and dashes when there is no attempt', async () => {
    api.getDifficultyCalibration.mockResolvedValue(data)
    renderPage()
    await screen.findByText('Mới dùng')
    expect(within(rowOf('Mới dùng')).getByText('Chưa đủ dữ liệu')).toBeInTheDocument()
    expect(within(rowOf('Chưa dùng')).getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('states the minimum, the small-sample caveat and that nothing is changed automatically', async () => {
    api.getDifficultyCalibration.mockResolvedValue(data)
    renderPage()
    await screen.findByText('Cộng hai số')
    expect(screen.getByText(/ít nhất 20 bài/)).toBeInTheDocument()
    expect(screen.getByText(/mẫu nhỏ/)).toBeInTheDocument()
    expect(screen.getByText(/không tự đổi nhãn/)).toBeInTheDocument()
  })

  it('handles no used problems and a load error', async () => {
    api.getDifficultyCalibration.mockResolvedValue({ min_attempts: 20, problems: [] })
    const { unmount } = renderPage()
    expect(await screen.findByText(/chưa dùng câu nào/)).toBeInTheDocument()
    unmount()
    api.getDifficultyCalibration.mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText(/boom/)).toBeInTheDocument()
  })
})
