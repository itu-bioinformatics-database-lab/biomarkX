// Base path for the deployed app (used as Router basename)
export const BASE_PATH = '/biomark';

// Relative path used inside <Router basename={BASE_PATH}>
export const LOGIN_PATH = '/login';

// Absolute URL path for hard redirects (window.location.href)
export const LOGIN_URL = `${BASE_PATH}${LOGIN_PATH}`;
