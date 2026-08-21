import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ExamPage from './pages/ExamPage.jsx'
import AdminResultsPage from './pages/AdminResultsPage.jsx'
import TeacherHomePage from './pages/TeacherHomePage.jsx'
import './index.css'

// No router library — the app only ever has 3 URL shapes, so a plain
// pathname switch is enough (see the plan this was built from).
function resolvePage() {
  const path = window.location.pathname
  const examMatch = path.match(/^\/exam\/(.+)$/)
  if (examMatch) return <ExamPage studentToken={examMatch[1]} />
  const adminMatch = path.match(/^\/admin\/(.+)$/)
  if (adminMatch) return <AdminResultsPage adminToken={adminMatch[1]} />
  if (path === '/demo') return <App />
  return <TeacherHomePage />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{resolvePage()}</React.StrictMode>,
)
