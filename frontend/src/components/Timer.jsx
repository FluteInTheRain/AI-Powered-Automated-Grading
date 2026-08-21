import { useEffect, useRef, useState } from 'react'

export default function Timer({ durationSeconds, isRunning, onExpire }) {
  const [remaining, setRemaining] = useState(durationSeconds)
  const expiredRef = useRef(false)
  const onExpireRef = useRef(onExpire)

  useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  useEffect(() => {
    setRemaining(durationSeconds)
    expiredRef.current = false
  }, [durationSeconds])

  useEffect(() => {
    if (!isRunning) return undefined
    const id = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(id)
          if (!expiredRef.current) {
            expiredRef.current = true
            onExpireRef.current()
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [isRunning])

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
