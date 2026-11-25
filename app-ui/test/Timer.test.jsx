import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Timer from '../src/components/Timer.jsx'

afterEach(() => vi.useRealTimers())

describe('Timer', () => {
  it('follows the wall clock, so a throttled or sleeping tab does not run late', async () => {
    vi.useFakeTimers()
    const onExpire = vi.fn()
    render(<Timer durationSeconds={600} isRunning onExpire={onExpire} />)
    vi.setSystemTime(Date.now() + 8 * 60 * 1000) // 8 minutes pass with no timer ticks at all
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('01:59')).toBeInTheDocument()
    expect(onExpire).not.toHaveBeenCalled()
    vi.setSystemTime(Date.now() + 3 * 60 * 1000)
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(onExpire).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('recomputes immediately when the tab becomes visible again', async () => {
    vi.useFakeTimers()
    render(<Timer durationSeconds={600} isRunning onExpire={() => {}} />)
    vi.setSystemTime(Date.now() + 8 * 60 * 1000)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(screen.getByText('02:00')).toBeInTheDocument()
  })

  it('shows whole seconds for a fractional duration', () => {
    render(<Timer durationSeconds={269.7} isRunning={false} onExpire={() => {}} />)
    expect(screen.getByText('04:30')).toBeInTheDocument()
  })
})
