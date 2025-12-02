// API utility functions for HTTP requests
import axios from 'axios';
import { getSessionId, setSessionId } from './utils/session';

// Base URL for API requests, uses environment variable or defaults to localhost
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5003';

// Axios instance for making API calls
export const api = axios.create({
  baseURL: API_BASE
});

// Attach auth token to each request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  // No need to send x-session-id anymore - guest UUID token in Authorization is the session identifier
  
  return config;
});

// Persist new session IDs issued by the backend
api.interceptors.response.use(
  (response) => {
    const incomingId = response.headers['x-session-id'];
    if (incomingId) {
      setSessionId(incomingId);
    }
    return response;
  },
  (error) => {
    // Handle 401 Unauthorized (expired or invalid token)
    if (error.response && error.response.status === 401) {
      const token = localStorage.getItem('token');
      // Only clear if we actually had a token (avoid clearing on failed login attempts)
      if (token && error.config.url !== '/auth/login' && error.config.url !== '/auth/signup') {
        localStorage.removeItem('token');
        // Redirect to login page
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Helper function to build full API endpoint URLs
export const buildUrl = (path) => `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;

// Thin wrapper around the browser fetch API that automatically
// attaches the session header so non-axios calls stay in the same session.
export async function apiFetch(input, init = {}) {
  const token = localStorage.getItem('token');
  let headers = { ...(init.headers || {}) };
  
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    // Don't send x-session-id if we have a token
  } else {
    const sessionId = getSessionId();
    if (sessionId) {
      headers['x-session-id'] = sessionId;
    }
  }
  
  const response = await fetch(input, { ...init, headers });
  // Persist potential updated session id from the server
  const newId = response.headers.get('x-session-id');
  if (newId) {
    setSessionId(newId);
  }
  return response;
}