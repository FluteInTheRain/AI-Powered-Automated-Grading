import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSettings, putSettings } from '../api.js'
import Icon from '../components/Icon.jsx'
import RubricFields, { DEFAULT_RUBRIC, isValidRubric, rubricToNumbers, rubricToStrings } from '../components/RubricFields.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'

export default function SettingsPage() {
  const [loaded, setLoaded] = useState(false)
  const [rubric, setRubric] = useState(DEFAULT_RUBRIC)
  const [minutes, setMinutes] = useState('10')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)

  useEffect(() => {
    getSettings()
      .then((s) => {
        if (s?.default_rubric) setRubric(rubricToStrings(s.default_rubric))
        if (s?.default_time_limit_seconds) setMinutes(String(Math.round(s.default_time_limit_seconds / 60)))
        setLoaded(true)
      })
      .catch((e) => setErrorMessage(e.message))
  }, [])

  const canSave = isValidRubric(rubric) && Number(minutes) > 0 && Number.isInteger(Number(minutes)) && !saving

  const save = async () => {
    setSaving(true)
    setSaved(false)
    setErrorMessage(null)
    try {
      await putSettings({ default_rubric: rubricToNumbers(rubric), default_time_limit_seconds: Math.round(Number(minutes) * 60) })
      setSaved(true)
    } catch (e) {
      setErrorMessage(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (errorMessage && !loaded) return <p className="status-line status-error">Error: {errorMessage}</p>
  if (!loaded) return <p className="status-line">Loading…</p>

  return (
    <>
      <header className="top">
        <Link className="word" to="/teacher">AI Grader</Link>
        <span className="sp" />
        <ThemeToggle />
      </header>
      <div className="wrap">
        <div className="head">
          <div>
            <h1>Cài đặt</h1>
            <p>Giá trị mặc định cho các bài kiểm tra mới của bạn. Mỗi đề vẫn chỉnh được riêng khi tạo; sau khi tạo thì trọng số được giữ cố định.</p>
          </div>
        </div>

        <section className="form-sec" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
          <h2>Trọng số tiêu chí chấm</h2>
          <RubricFields value={rubric} onChange={(next) => { setRubric(next); setSaved(false) }} />
          <h2 style={{ marginTop: 32 }}>Thời gian làm bài</h2>
          <div className="field-row">
            <label htmlFor="default-minutes">Thời gian làm bài mặc định (phút)</label>
            <input id="default-minutes" type="number" min="1" step="1" value={minutes} onChange={(e) => { setMinutes(e.target.value); setSaved(false) }} />
          </div>
          <div className="submit-row">
            <button className="btn btn-primary" onClick={save} disabled={!canSave}><Icon name="check" />Lưu cài đặt</button>
            {saved && <span className="status-success" aria-live="polite">Đã lưu</span>}
            {errorMessage && <span className="status-error" role="alert">{errorMessage}</span>}
          </div>
        </section>
      </div>
    </>
  )
}
