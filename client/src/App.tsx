import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';

// Import Pages (We will create these next)
import LoginScreen from './pages/LoginScreen';
import MainLayout from './layouts/MainLayout';
// Admin
import DashboardScreen from './pages/DashboardScreen'; // Replaces the old dashboard with the new one
import Users from './pages/admin/Users';
import Groups from './pages/admin/Groups';

// Admin Quizzes
import QuizHub from './pages/admin/quizzes/QuizHub';
import QuestionBank from './pages/admin/quizzes/QuestionBank';
import CreateQuiz from './pages/admin/quizzes/CreateQuiz';
import Analytics from './pages/admin/quizzes/Analytics';
import ImportQuiz from './pages/admin/quizzes/ImportQuiz';
import RetestRequests from './pages/admin/quizzes/RetestRequests';
import Chat from './pages/Chat';

// Protected Route Wrapper
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#01b4ae] border-t-transparent"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<LoginScreen />} />

          {/* Protected Routes inside Main Layout */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardScreen />} />
            {/* Add more routes here as we port them: e.g., /exams, /analytics */}

            {/* Admin Routes - these will replace the mobile dashboard and tabs */}
            {/* The /admin path here is a placeholder, actual admin routes are below */}
            <Route path="admin" element={<Navigate to="/dashboard" replace />} />
            
            <Route path="users" element={
              <ProtectedRoute>
                <Users />
              </ProtectedRoute>
            } />
            <Route path="groups" element={
              <ProtectedRoute>
                <Groups />
              </ProtectedRoute>
            } />
            <Route path="groups/:id" element={
              <ProtectedRoute>
                <Chat />
              </ProtectedRoute>
            } />

            {/* Quizzes Module */}
            <Route path="quizzes" element={
              <ProtectedRoute>
                <QuizHub />
              </ProtectedRoute>
            } />
            <Route path="quizzes/question-bank" element={
              <ProtectedRoute>
                <QuestionBank />
              </ProtectedRoute>
            } />
            <Route path="quizzes/create" element={
              <ProtectedRoute>
                <CreateQuiz />
              </ProtectedRoute>
            } />
            <Route path="quizzes/analytics" element={
              <ProtectedRoute>
                <Analytics />
              </ProtectedRoute>
            } />
            <Route path="quizzes/import" element={
              <ProtectedRoute>
                <ImportQuiz />
              </ProtectedRoute>
            } />
            <Route path="quizzes/retests" element={
              <ProtectedRoute>
                <RetestRequests />
              </ProtectedRoute>
            } />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </BrowserRouter>
      </NotificationProvider>
    </AuthProvider>
  );
}

export default App;
