import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/api.js'
import SettingsPage from '../src/pages/SettingsPage.jsx'

vi.mock('../src/api.js')

const saved = { default_rubric: { correctness: 50, efficiency: 20, code_style: 20, edge_case_handling: 10 }, default_time_limit_seconds: 1800 }
const renderPage = () => render(<MemoryRouter><SettingsPage /></MemoryRouter>)

beforeEach(() => {
  api.getMe.mockResolvedValue({ id: 't1', email: 't@x.com' })
  api.getSettings.mockResolvedValue(saved)
})
afterEach(() => vi.resetAllMocks())

describe('SettingsPage', () => {
  it('loads the saved weights and minutes and shows percentages and the total', async () => {
    renderPage()
    expect(await screen.findByLabelText(/Đúng sai/)).toHaveValue(50)
    expect(screen.getByLabelText(/Hiệu năng/)).toHaveValue(20)
    expect(screen.getByLabelText(/Phong cách code/)).toHaveValue(20)
    expect(screen.getByLabelText(/Trường hợp biên/)).toHaveValue(10)
    expect(screen.getByLabelText(/Thời gian làm bài mặc định/)).toHaveValue(30)
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getAllByText('20%').length).toBe(2)
    expect(screen.getByText('10%')).toBeInTheDocument()
    expect(screen.getByText(/Tổng: 100/)).toBeInTheDocument()
  })

  it('starts from 60/15/15/10 and 10 minutes when nothing is saved', async () => {
    api.getSettings.mockResolvedValue({})
    renderPage()
    expect(await screen.findByLabelText(/Đúng sai/)).toHaveValue(60)
    expect(screen.getByLabelText(/Thời gian làm bài mặc định/)).toHaveValue(10)
  })

  it('disables Save when the total is 0', async () => {
    renderPage()
    for (const name of [/Đúng sai/, /Hiệu năng/, /Phong cách code/, /Trường hợp biên/]) {
      fireEvent.change(await screen.findByLabelText(name), { target: { value: '0' } })
    }
    expect(screen.getByRole('button', { name: 'Lưu cài đặt' })).toBeDisabled()
  })

  it('disables Save and says so when the total is not 100', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText(/Đúng sai/), { target: { value: '70' } })
    expect(screen.getByRole('button', { name: 'Lưu cài đặt' })).toBeDisabled()
    expect(screen.getByText(/Tổng phải bằng 100/)).toBeInTheDocument()
  })

  it('saves integers and shows that it saved', async () => {
    api.putSettings.mockResolvedValue({})
    renderPage()
    fireEvent.change(await screen.findByLabelText(/Đúng sai/), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText(/Hiệu năng/), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText(/Phong cách code/), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/Thời gian làm bài mặc định/), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cài đặt' }))
    expect(await screen.findByText('Đã lưu')).toBeInTheDocument()
    expect(api.putSettings).toHaveBeenCalledWith({
      default_rubric: { correctness: 70, efficiency: 0, code_style: 20, edge_case_handling: 10 }, default_time_limit_seconds: 2700,
    })
  })

  it('shows the error and keeps the typed values when saving fails', async () => {
    api.putSettings.mockRejectedValue(new Error('rubric weights cannot all be zero'))
    renderPage()
    fireEvent.change(await screen.findByLabelText(/Đúng sai/), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText(/Hiệu năng/), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cài đặt' }))
    expect(await screen.findByText(/cannot all be zero/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Đúng sai/)).toHaveValue(70)
  })
})
