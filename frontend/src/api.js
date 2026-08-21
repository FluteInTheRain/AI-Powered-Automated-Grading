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

export function runPublicTests(problemId, code) {
  return request('/api/run', {
    method: 'POST',
    body: JSON.stringify({ problem_id: problemId, code }),
  })
}

export function checkSyntax(code) {
  return request('/api/syntax-check', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

// --- Teacher: problem authoring -------------------------------------------

export function previewTestCases({ reference_solution, func_name, cases, wrong_solution }) {
  return request('/api/teacher/preview-test-cases', {
    method: 'POST',
    body: JSON.stringify({ reference_solution, func_name, cases, wrong_solution: wrong_solution || null }),
  })
}

export function createProblem(problem) {
  return request('/api/teacher/problems', {
    method: 'POST',
    body: JSON.stringify(problem),
  })
}

// --- Teacher: exam links ----------------------------------------------------

export function createExam({ problem_id, deadline, time_limit_seconds }) {
  return request('/api/teacher/exams', {
    method: 'POST',
    body: JSON.stringify({ problem_id, deadline: deadline || null, time_limit_seconds: time_limit_seconds || null }),
  })
}

export function getAdminResults(adminToken) {
  return request(`/api/teacher/exams/${adminToken}`)
}

export function updateExamDeadline(adminToken, deadline) {
  return request(`/api/teacher/exams/${adminToken}`, {
    method: 'PATCH',
    body: JSON.stringify({ deadline: deadline || null }),
  })
}

export function exportUrl(adminToken) {
  return `${API_BASE}/api/teacher/exams/${adminToken}/export.xlsx`
}

// --- Student: exam-scoped flow ----------------------------------------------

export function getExamByToken(studentToken) {
  return request(`/api/exam/${studentToken}`)
}

export function runExamTests(studentToken, code) {
  return request(`/api/exam/${studentToken}/run`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export function submitExam(studentToken, studentName, code) {
  return request(`/api/exam/${studentToken}/submit`, {
    method: 'POST',
    body: JSON.stringify({ student_name: studentName, code }),
  })
}
