// The only module that calls fetch. All paths are same-origin (the Worker serves the UI and the API).

async function request(path, options = {}) {
  // redirect: 'manual' so an expired Cloudflare Access session (a cross-origin 302 to the login)
  // shows up as an opaque redirect instead of a confusing CORS failure.
  const res = await fetch(path, {
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (res.type === 'opaqueredirect') {
    window.location.reload()
    throw new Error('Session expired, reloading')
  }
  if (!res.ok) {
    // Non-JSON bodies (e.g. platform limit pages from the edge) get a plain message.
    const body = await res.json().catch(() => null)
    if (body === null) {
      throw new Error(
        'Your submission exceeded the time/resource limit or the server is busy. Please try again.',
      )
    }
    throw new Error(body.detail || `Request failed: ${res.status}`)
  }
  return res.json()
}

const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) })

// --- Student (no login) ----------------------------------------------------

export const getExam = (token) => request(`/api/exam/${token}`)
export const startAttempt = (token, studentName) => post(`/api/exam/${token}/attempts`, { student_name: studentName })
export const runTests = (token, attemptId, problemId, code) =>
  post(`/api/exam/${token}/attempts/${attemptId}/questions/${problemId}/run`, { code })
export const submitQuestion = (token, attemptId, problemId, code) =>
  post(`/api/exam/${token}/attempts/${attemptId}/questions/${problemId}/submit`, { code })
export const getAttemptByReceipt = (token, receipt) => request(`/api/exam/${token}/attempts/by-receipt/${receipt}`)
export const checkSyntax = (code) => post('/api/syntax-check', { code })

// --- Teacher (behind Cloudflare Access) ------------------------------------

export const getMe = () => request('/api/teacher/me')
export const listBank = () => request('/api/teacher/bank')
export const listExams = () => request('/api/teacher/exams')
export const createExam = (body) => post('/api/teacher/exams', body)
export const getExamDetail = (id) => request(`/api/teacher/exams/${id}`)
export const getResults = (id) => request(`/api/teacher/exams/${id}/results`)
export const updateDeadline = (id, deadline) =>
  request(`/api/teacher/exams/${id}`, { method: 'PATCH', body: JSON.stringify({ deadline }) })
