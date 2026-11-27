import { useState } from 'react'
import { fileAppeal } from '../api.js'
import TurnstileWidget from './TurnstileWidget.jsx'

export const APPEAL_STATUS = {
  open: 'Đang chờ',
  under_review: 'Đang xem xét',
  upheld: 'Giữ nguyên điểm',
  adjusted: 'Đã chỉnh điểm',
  rejected: 'Từ chối',
  expired: 'Hết hạn',
}

const MAX_MESSAGE = 1000

// One question's appeal: a reason and (when the exam uses it) a Turnstile check. onFiled runs after the server accepted it.
export default function AppealForm({ token, receipt, problemId, siteKey, onFiled }) {
  const [message, setMessage] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [challenge, setChallenge] = useState(0) // a Turnstile token works only once: bump to mount a fresh widget after a try
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const needsTurnstile = !!siteKey
  const id = `appeal-${problemId}`
  const canSend = message.trim() !== '' && message.length <= MAX_MESSAGE && (!needsTurnstile || turnstileToken !== '') && !sending

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      await fileAppeal(token, receipt, problemId, message.trim(), turnstileToken)
      onFiled()
    } catch (e) {
      setError(e.message)
      setTurnstileToken('')
      setChallenge((n) => n + 1)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="appeal-form">
      <label htmlFor={id}>Lý do khiếu nại</label>
      <textarea id={id} rows={3} maxLength={MAX_MESSAGE} value={message} onChange={(e) => setMessage(e.target.value)} />
      {needsTurnstile && <TurnstileWidget key={challenge} siteKey={siteKey} onToken={setTurnstileToken} />}
      <button className="btn btn-primary" onClick={send} disabled={!canSend}>Gửi khiếu nại</button>
      {error && <p className="status-error" role="alert">{error}</p>}
    </div>
  )
}
