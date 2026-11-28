import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AdminMetricsPage from './pages/AdminMetricsPage.jsx'
import DifficultyPage from './pages/DifficultyPage.jsx'
import ExamStatsPage from './pages/ExamStatsPage.jsx'
import ExamAppealsPage from './pages/ExamAppealsPage.jsx'
import ExamPage from './pages/ExamPage.jsx'
import ExamResultsPage from './pages/ExamResultsPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import TeacherHomePage from './pages/TeacherHomePage.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/exam/:token" element={<ExamPage />} />
        <Route path="/teacher" element={<TeacherHomePage />} />
        <Route path="/teacher/settings" element={<SettingsPage />} />
        <Route path="/teacher/exams/:id" element={<ExamResultsPage />} />
        <Route path="/teacher/difficulty" element={<DifficultyPage />} />
        <Route path="/teacher/admin" element={<AdminMetricsPage />} />
        <Route path="/teacher/exams/:id/stats" element={<ExamStatsPage />} />
        <Route path="/teacher/exams/:id/appeals" element={<ExamAppealsPage />} />
        <Route path="*" element={<Navigate to="/teacher" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
