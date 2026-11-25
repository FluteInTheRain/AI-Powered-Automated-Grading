import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ResultPanel from '../src/components/ResultPanel.jsx'

const result = {
  score: 94,
  sub_scores: { correctness: 1, efficiency: 1, code_style: 0.6, edge_case_handling: 1 },
  tests: { passed: 3, total: 3 },
  feedback: { summary: 'Works well', issues: [{ line: 2, issue: 'Naming', explanation: 'Use clearer names', suggested_fix: 'rename x' }] },
}

describe('ResultPanel', () => {
  it('shows the score, test counts and AI feedback', () => {
    render(<ResultPanel result={result} />)
    expect(screen.getByText('94.0 / 100')).toBeInTheDocument()
    expect(screen.getByText(/Passed 3\/3 hidden test cases/)).toBeInTheDocument()
    expect(screen.getByText('Works well')).toBeInTheDocument()
    expect(screen.getByText(/Gợi ý sửa/)).toBeInTheDocument()
  })

  it('never renders a per-case error list', () => {
    const { container } = render(<ResultPanel result={result} />)
    expect(container.querySelector('.exec-errors')).toBeNull()
  })

  it('renders nothing without a result and tolerates null feedback', () => {
    const { container, rerender } = render(<ResultPanel result={null} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ResultPanel result={{ ...result, feedback: null }} />)
    expect(screen.getByText('94.0 / 100')).toBeInTheDocument()
  })
})
