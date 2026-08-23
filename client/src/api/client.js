import axios from 'axios';

/**
 * Single axios instance for the whole app.
 *
 * `VITE_API_BASE_URL` points at the deployed backend in production. Left
 * blank (the local default) requests go to a relative `/api/...` path, which
 * the Vite dev server proxies to localhost:5000.
 *
 * Vite inlines import.meta.env at build time, so this must be set as a Vercel
 * environment variable *before* the build, not at runtime.
 */
const baseURL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 45000, // generous: confirmation waits on the LLM and Calendar API
});

/** Attach the stored JWT to every request. */
export const setAuthToken = (token) => {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
};

// Restore the header on a hard page reload before any component mounts.
const stored = localStorage.getItem('token');
if (stored) setAuthToken(stored);

/** Normalised error message from an axios failure. */
export const errorMessage = (err, fallback = 'Something went wrong. Please try again.') => {
  if (err?.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  if (err?.response?.data?.message) return err.response.data.message;
  if (!err?.response) return 'Cannot reach the server. Check that the backend is running.';
  return fallback;
};

export default api;
