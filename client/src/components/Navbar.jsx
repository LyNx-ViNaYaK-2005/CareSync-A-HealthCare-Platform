import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Stethoscope, LogOut, User, Calendar, PlusCircle, ShieldCheck } from 'lucide-react';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="w-10 h-10 rounded-xl bg-sky-600 flex items-center justify-center text-white shadow-md shadow-sky-600/20 group-hover:bg-sky-700 transition">
            <Stethoscope className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xl font-bold bg-gradient-to-r from-sky-700 to-indigo-700 bg-clip-text text-transparent">
              CareSync
            </span>
            <span className="hidden sm:inline-block ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
              Healthcare Platform
            </span>
          </div>
        </Link>

        <nav className="flex items-center gap-4">
          {user ? (
            <>
              {user.role === 'PATIENT' && (
                <>
                  <Link
                    to="/patient/dashboard"
                    className="flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-sky-600 transition"
                  >
                    <Calendar className="w-4 h-4" />
                    My Appointments
                  </Link>
                  <Link
                    to="/patient/book"
                    className="flex items-center gap-1.5 text-sm font-semibold bg-sky-600 hover:bg-sky-700 text-white px-3.5 py-1.5 rounded-lg shadow-sm transition"
                  >
                    <PlusCircle className="w-4 h-4" />
                    Book Doctor
                  </Link>
                </>
              )}

              {user.role === 'DOCTOR' && (
                <Link
                  to="/doctor/dashboard"
                  className="flex items-center gap-1.5 text-sm font-semibold bg-sky-600 hover:bg-sky-700 text-white px-3.5 py-1.5 rounded-lg shadow-sm transition"
                >
                  <Calendar className="w-4 h-4" />
                  Doctor Schedule
                </Link>
              )}

              {user.role === 'ADMIN' && (
                <Link
                  to="/admin/dashboard"
                  className="flex items-center gap-1.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-lg shadow-sm transition"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Admin Console
                </Link>
              )}

              <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
                <div className="text-right hidden sm:block">
                  <div className="text-sm font-semibold text-slate-800">{user.name}</div>
                  <div className="text-xs text-slate-500 capitalize">{user.role.toLowerCase()}</div>
                </div>

                <button
                  onClick={handleLogout}
                  title="Logout"
                  className="p-2 text-slate-500 hover:text-red-600 hover:bg-slate-100 rounded-lg transition"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Link
                to="/login"
                className="text-sm font-semibold text-slate-700 hover:text-sky-600 px-3 py-1.5 transition"
              >
                Log In
              </Link>
              <Link
                to="/register"
                className="text-sm font-semibold bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg shadow-sm transition"
              >
                Register
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
