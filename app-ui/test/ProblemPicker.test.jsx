import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import ProblemPicker from '../src/components/ProblemPicker.jsx'

const problems = [
  { id: 'a', title: 'Two Sum', category: 'Arrays & Search', difficulty: 'medium', statement: 'Find two numbers that add up to the target.' },
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
const titles = () => screen.getAllByRole('checkbox').map((c) => c.closest('label').textContent)

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

  it('reveals the statement under "Xem đề"', () => {
    render(<Harness />)
    const row = screen.getByLabelText(/Two Sum/).closest('.problem-row')
    fireEvent.click(within(row).getByText('Xem đề'))
    expect(within(row).getByText('Find two numbers that add up to the target.')).toBeVisible()
  })
})
