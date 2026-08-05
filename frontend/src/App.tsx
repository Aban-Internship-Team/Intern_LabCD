import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { UserThemeSync } from './components/UserThemeSync'
import { AdminLayout } from './components/admin/AdminLayout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { AdminBlogEditorPage } from './pages/AdminBlogEditorPage'
import { AdminBlogPage } from './pages/AdminBlogPage'
import { AdminBugReportsPage } from './pages/AdminBugReportsPage'
import { AdminOverviewPage } from './pages/AdminOverviewPage'
import { AdminMonitoringPage } from './pages/AdminMonitoringPage'
import { AdminErrorsPage } from './pages/AdminErrorsPage'
import { AdminPlansPage } from './pages/AdminPlansPage'
import { AdminProjectDetailPage } from './pages/AdminProjectDetailPage'
import { AdminProjectsPage } from './pages/AdminProjectsPage'
import { AdminSitePage } from './pages/AdminSitePage'
import { AdminSurveyPage } from './pages/AdminSurveyPage'
import { AdminUserDetailPage } from './pages/AdminUserDetailPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import './index.css'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <UserThemeSync />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Navigate to="/admin" replace />} />
              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<AdminOverviewPage />} />
                <Route path="site" element={<AdminSitePage />} />
                <Route path="blog" element={<AdminBlogPage />} />
                <Route path="blog/:id" element={<AdminBlogEditorPage />} />
                <Route path="monitoring" element={<AdminMonitoringPage />} />
                <Route path="errors" element={<AdminErrorsPage />} />
                <Route path="bug-reports" element={<AdminBugReportsPage />} />
                <Route path="plans" element={<AdminPlansPage />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="users/:userId" element={<AdminUserDetailPage />} />
                <Route path="projects" element={<AdminProjectsPage />} />
                <Route path="projects/:projectId" element={<AdminProjectDetailPage />} />
                <Route path="survey" element={<AdminSurveyPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
