import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import ProblemPicker from '../src/components/ProblemPicker.jsx'

const problems = [
  { id: 'a', title: 'Two Sum', category: 'Arrays & Search', difficulty: 'medium', statement: '## Ví dụ\n\nFind two numbers that add up to the target.' },
  { id: 'b', title: 'Is Prime', category: 'Math', difficulty: 'easy', statement: 'Return true for primes.' },
  { id: 'c', title: 'Reverse a String', category: 'Strings', difficulty: 'easy', statement: 'Reverse the input.' },
  { id: 'd', title: 'Binary Search', category: 'Arrays & Search', difficulty: 'hard', statement: 'Search a sorted list.' },
  { id: 'e', title: 'Factorial', category: 'Math', difficulty: 'easy', statement: 'n factorial.' },
]

function Harness() {
  const [chosen, setChosen] = useState({})
  return (
    <ProblemPicker
      problems={problems} chosen={chosen}
      onToggle={(id, on) => setChosen((p) => { const n = { ...p }; if (on) n[id] = '1'; else delete n[id]; return n })}
      onWeight={(id, v) => setChosen((p) => ({ ...p, [id]: v }))}
    />
  )
}
const titles = () => screen.getAllByRole('checkbox').map((c) => document.querySelector(`label[for="${c.id}"]`).textContent)

describe('ProblemPicker', () => {
  it('shows title, category and the Vietnamese difficulty per problem and a count', () => {
    render(<Harness />)
    const row = screen.getByLabelText(/Two Sum/).closest('.problem-row')
    expect(within(row).getByText('Arrays & Search')).toBeInTheDocument()
    expect(within(row).getByText('Vừa')).toBeInTheDocument()
    expect(screen.getByText('Hiện 5 trên 5 bài')).toBeInTheDocument()
  })

  it('narrows by search, category and difficulty and updates the count', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Tìm theo tiêu đề'), { target: { value: 'sum' } })
    expect(screen.getByText('Hiện 1 trên 5 bài')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Tìm theo tiêu đề'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Loại'), { target: { value: 'Arrays & Search' } })
    expect(screen.getByText('Hiện 2 trên 5 bài')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Độ khó'), { target: { value: 'hard' } })
    expect(screen.getByText('Hiện 1 trên 5 bài')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Binary Search' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Two Sum' })).toBeNull()
  })

  it('filters by category', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Loại'), { target: { value: 'Math' } })
    expect(screen.getByText('Hiện 2 trên 5 bài')).toBeInTheDocument()
  })

  it('sorts by title and by difficulty', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Sắp xếp'), { target: { value: 'title' } })
    expect(titles().map((t) => t.split('Math')[0].split('Strings')[0].slice(0, 6))).toEqual(['Binary', 'Factor', 'Is Pri', 'Revers', 'Two Su'])
    fireEvent.change(screen.getByLabelText('Sắp xếp'), { target: { value: 'difficulty' } })
    expect(titles()[0]).toContain('Factorial')
    expect(titles()[4]).toContain('Binary Search')
  })

  it('shows an empty state when nothing matches', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Tìm theo tiêu đề'), { target: { value: 'zzz' } })
    expect(screen.getByText('Không có bài nào khớp bộ lọc')).toBeInTheDocument()
    expect(screen.getByText('Hiện 0 trên 5 bài')).toBeInTheDocument()
  })

  it('keeps a chosen problem and its weight while it is filtered out and back in', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Two Sum' }))
    fireEvent.change(screen.getByLabelText('Trọng số Two Sum'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Tìm theo tiêu đề'), { target: { value: 'prime' } })
    expect(screen.queryByRole('checkbox', { name: 'Two Sum' })).toBeNull()
    expect(screen.getByText(/Đã chọn 1 bài/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Tìm theo tiêu đề'), { target: { value: '' } })
    expect(screen.getByRole('checkbox', { name: 'Two Sum' })).toBeChecked()
    expect(screen.getByLabelText('Trọng số Two Sum')).toHaveValue(3)
  })

  it('opens the whole statement, rendered as markdown, in a dialog', () => {
    render(<Harness />)
    expect(screen.queryByRole('dialog')).toBeNull()
    const row = screen.getByRole('checkbox', { name: 'Two Sum' }).closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: 'Xem đề' }))
    const dialog = screen.getByRole('dialog', { name: 'Two Sum' })
    expect(within(dialog).getByRole('heading', { name: 'Ví dụ' })).toBeInTheDocument() // markdown, not raw "## Ví dụ"
    expect(within(dialog).getByText('Find two numbers that add up to the target.')).toBeInTheDocument()
    expect(within(dialog).getByText('Arrays & Search')).toBeInTheDocument()
    expect(within(dialog).getByText('Vừa')).toBeInTheDocument()
  })

  it('closes the dialog with the close button and with Escape', () => {
    render(<Harness />)
    fireEvent.click(within(screen.getByRole('checkbox', { name: 'Two Sum' }).closest('tr')).getByRole('button', { name: 'Xem đề' }))
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(screen.getByRole('checkbox', { name: 'Two Sum' }).closest('tr')).getByRole('button', { name: 'Xem đề' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('chooses and unchooses the problem from inside the dialog', () => {
    render(<Harness />)
    fireEvent.click(within(screen.getByRole('checkbox', { name: 'Two Sum' }).closest('tr')).getByRole('button', { name: 'Xem đề' }))
    fireEvent.click(screen.getByRole('button', { name: 'Chọn câu này' }))
    expect(screen.getByRole('checkbox', { name: 'Two Sum' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn' }))
    expect(screen.getByRole('checkbox', { name: 'Two Sum' })).not.toBeChecked()
  })

  it('is a real table with column headers and one row per problem', () => {
    render(<Harness />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Tiêu đề', 'Loại', 'Độ khó', 'Trọng số'])
    expect(screen.getAllByRole('row')).toHaveLength(6) // header + 5 problems
  })

  it('sorts when a column header is clicked and marks it with aria-sort', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Tiêu đề' }))
    expect(titles()[0]).toBe('Binary Search')
    expect(screen.getByRole('columnheader', { name: 'Tiêu đề' })).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(screen.getByRole('button', { name: 'Độ khó' }))
    expect(titles()[0]).toBe('Factorial')
    expect(screen.getByRole('columnheader', { name: 'Độ khó' })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: 'Tiêu đề' })).not.toHaveAttribute('aria-sort')
  })
})
