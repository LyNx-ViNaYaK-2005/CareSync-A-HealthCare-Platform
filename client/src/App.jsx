import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Register from './pages/Register';
import SetPassword from './pages/SetPassword';
import Privacy from './pages/Privacy';
import PatientDashboard from './pages/patient/PatientDashboard';
import BookAppointment from './pages/patient/BookAppointment';
import DoctorDashboard from './pages/doctor/DoctorDashboard';
import AdminDashboard from './pages/admin/AdminDashboard';

const dashboardFor = (role) =>
  role === 'ADMIN' ? '/admin/dashboard' : role === 'DOCTOR' ? '/doctor/dashboard' : '/patient/dashboard';

const FullPageSpinner = () => (
  <div className="flex flex-col items-center justify-center py-32 gap-3 text-slate-500">
    <Loader2 className="w-8 h-8 animate-spin text-sky-600" />
    <span className="text-sm font-medium">Restoring your session...</span>
  </div>
);

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Wait for token revalidation, or a refresh bounces the user to /login.
  if (loading) return <FullPageSpinner />;

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  // Invited doctors are held on /set-password until they pick a real password.
  if (user.mustResetPassword && location.pathname !== '/set-password') {
    return <Navigate to="/set-password" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={dashboardFor(user.role)} replace />;
  }

  return children;
};

/** Signed-in users should never see the login or register screens. */
const PublicOnlyRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (user) return <Navigate to={user.mustResetPassword ? '/set-password' : dashboardFor(user.role)} replace />;
  return children;
};

const HomeRedirect = () => {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return <Navigate to={user ? dashboardFor(user.role) : '/login'} replace />;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="min-h-screen bg-slate-50 flex flex-col">
          <Navbar />
          <main className="grow">
            <Routes>
              <Route
                path="/login"
                element={
                  <PublicOnlyRoute>
                    <Login />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/register"
                element={
                  <PublicOnlyRoute>
                    <Register />
                  </PublicOnlyRoute>
                }
              />

              {/* Public and unguarded: Google's OAuth verification crawler must
                  be able to read this without an account. */}
              <Route path="/privacy" element={<Privacy />} />

              <Route
                path="/set-password"
                element={
                  <ProtectedRoute>
                    <SetPassword />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/patient/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['PATIENT']}>
                    <PatientDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/patient/book"
                element={
                  <ProtectedRoute allowedRoles={['PATIENT']}>
                    <BookAppointment />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/doctor/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['DOCTOR']}>
                    <DoctorDashboard />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/admin/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['ADMIN']}>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />

              <Route path="*" element={<HomeRedirect />} />
            </Routes>
          </main>

          <footer className="border-t border-slate-200 py-5 mt-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
              <span>CareSync &middot; Healthcare Appointment &amp; Follow-up Manager</span>
              <Link to="/privacy" className="font-semibold text-slate-600 hover:text-sky-600 transition">
                Privacy Policy
              </Link>
            </div>
          </footer>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
