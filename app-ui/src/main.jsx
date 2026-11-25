import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ExamPage from './pages/ExamPage.jsx'
import ExamResultsPage from './pages/ExamResultsPage.jsx'
import TeacherHomePage from './pages/TeacherHomePage.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/exam/:token" element={<ExamPage />} />
        <Route path="/teacher" element={<TeacherHomePage />} />
        <Route path="/teacher/exams/:id" element={<ExamResultsPage />} />
        <Route path="*" element={<Navigate to="/teacher" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
