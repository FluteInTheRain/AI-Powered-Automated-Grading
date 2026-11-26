import { useEffect, useRef } from 'react'

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading = null

function loadScript() {
  if (window.turnstile) return Promise.resolve()
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const el = document.createElement('script')
      el.src = SCRIPT
      el.async = true
      el.onload = resolve
      el.onerror = () => {
        loading = null
        reject(new Error('Turnstile failed to load'))
      }
      document.head.appendChild(el)
    })
  }
  return loading
}

// Calls onToken(token) when the visitor passes the challenge and onToken('') when it expires or fails.
export default function TurnstileWidget({ siteKey, onToken }) {
  const box = useRef(null)
  const widgetId = useRef(null)

  useEffect(() => {
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !box.current) return
        widgetId.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          callback: onToken,
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        })
      })
      .catch(() => onToken(''))
    return () => {
      cancelled = true
      if (widgetId.current !== null && window.turnstile) window.turnstile.remove(widgetId.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey])

  return <div ref={box} className="turnstile-widget" />
}
