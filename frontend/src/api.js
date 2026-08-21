const API_BASE = 'http://localhost:8001'

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Request failed: ${res.status}`)
  }
  return res.json()
}

export function listProblems() {
  return request('/api/problems')
}

export function getProblem(problemId) {
  return request(`/api/problems/${problemId}`)
}

export function submitCode(problemId, code) {
  return request('/api/submit', {
    method: 'POST',
    body: JSON.stringify({ problem_id: problemId, code }),
  })
}
