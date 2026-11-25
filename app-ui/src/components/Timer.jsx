import { useEffect, useRef, useState } from 'react'

// Counts down to a fixed end time read from the wall clock, not by subtracting one per tick: browsers
// throttle timers in hidden tabs and freeze them on sleep, while the server enforces real time.
export default function Timer({ durationSeconds, isRunning, onExpire }) {
  const [remaining, setRemaining] = useState(Math.ceil(durationSeconds))
  const endAtRef = useRef(null)
  const expiredRef = useRef(false)
  const onExpireRef = useRef(onExpire)

  useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  useEffect(() => {
    setRemaining(Math.ceil(durationSeconds))
    endAtRef.current = null
    expiredRef.current = false
  }, [durationSeconds])

  useEffect(() => {
    if (!isRunning) return undefined
    if (endAtRef.current === null) endAtRef.current = Date.now() + durationSeconds * 1000
    const tick = () => {
      const left = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000))
      setRemaining(left)
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true
        onExpireRef.current()
      }
    }
    const id = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [isRunning, durationSeconds])

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  const isLow = remaining <= 60 && isRunning

  return (
    <div className={`timer${isLow ? ' timer-low' : ''}`}>
      <span className="timer-label">Time left</span>
      <span className="timer-value">{mm}:{ss}</span>
    </div>
  )
}
