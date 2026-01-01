import axios from 'axios';

// Base URL from environment variables or default to localhost
// In production, VITE_API_URL should be set to: http://34.201.14.102
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const API_BASE = `${API_BASE_URL}/api`;

// Log API configuration (helps debug deployment issues)
console.log('🔧 API Configuration:', {
  mode: import.meta.env.MODE,
  apiBase: API_BASE,
  viteApiUrl: import.meta.env.VITE_API_URL
});

// Always read the latest token from localStorage (no in-memory cache)
export function getAuthToken() {
  try {
    return localStorage.getItem('pc_token') || null;
  } catch {
    return null;
  }
}

export function setAuthToken(token) {
  try {
    if (token) localStorage.setItem('pc_token', token);
    else localStorage.removeItem('pc_token');
  } catch { /* ignore */ }
}

export function clearAuthToken() {
  setAuthToken(null);
}

// Optional: app-wide unauthorized handler (set by app)
let unauthorizedHandler = null;
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

// Axios instance
export const http = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // send cookies if backend issues auth cookies
  headers: {
    'Content-Type': 'application/json'
  }
});

// Attach Authorization header
http.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Normalize errors + handle unauthorized globally
http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      // Clear token and notify app
      clearAuthToken();
      try {
        window.dispatchEvent(new CustomEvent('pc-auth:unauthorized', { detail: { status } }));
      } catch { /* ignore */ }
      if (typeof unauthorizedHandler === 'function') {
        unauthorizedHandler(error);
      } else {
        // Default fallback: redirect to login
        try {
          window.location.href = '/login';
        } catch { /* ignore */ }
      }
    }
    // Create a normalized error object
    const normalized = new Error(error?.response?.data?.error || error.message || 'request_failed');
    normalized.response = error.response;
    throw normalized;
  }
);

export default http;
