import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
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

// Public quiz guest flow (unauthenticated — OTP-verified leads)
import { PublicQuizProvider } from './contexts/PublicQuizContext';
import PublicQuizEntryPage from './pages/public/PublicQuizEntryPage';
import PublicQuizTakingPage from './pages/public/PublicQuizTakingPage';
import PublicQuizResultPage from './pages/public/PublicQuizResultPage';

// TEMPORARY FEATURE FREEZE — route-level guard (config/features.ts)
import { FeatureGate } from './components/FeatureGate';

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

          {/* Public quiz guest flow — OTP-verified leads. All three routes
              share ONE PublicQuizProvider so guest token, lead identity, and
              session state persist across the entry → take → result
              navigation. Previously each route had its own isolated provider,
              which caused the session to reset on every navigation and was
              the root cause of the "quiz restarts after submission" bug. */}
          <Route
            path="/public-quiz/:token"
            element={<PublicQuizProvider><Outlet /></PublicQuizProvider>}
          >
            <Route index element={<PublicQuizEntryPage />} />
            <Route path="take" element={<PublicQuizTakingPage />} />
            <Route path="result/:attemptId" element={<PublicQuizResultPage />} />
          </Route>

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
            {/* TEMPORARY FEATURE FREEZE — non-quiz pages render the Coming
                Soon state via FeatureGate (config/features.ts). Quiz routes
                below are intentionally ungated. */}
            <Route path="dashboard" element={
              <ProtectedRoute>
                <FeatureGate feature="dashboard">
                  <DashboardScreen />
                </FeatureGate>
              </ProtectedRoute>
            } />
            {/* Add more routes here as we port them: e.g., /exams, /analytics */}

            {/* Admin Routes - these will replace the mobile dashboard and tabs */}
            {/* The /admin path here is a placeholder, actual admin routes are below */}
            <Route path="admin" element={<Navigate to="/dashboard" replace />} />

            <Route path="users" element={
              <ProtectedRoute>
                <FeatureGate feature="userManagement">
                  <Users />
                </FeatureGate>
              </ProtectedRoute>
            } />
            <Route path="groups" element={
              <ProtectedRoute>
                <FeatureGate feature="chat">
                  <Groups />
                </FeatureGate>
              </ProtectedRoute>
            } />
            <Route path="groups/:id" element={
              <ProtectedRoute>
                <FeatureGate feature="chat">
                  <Chat />
                </FeatureGate>
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

