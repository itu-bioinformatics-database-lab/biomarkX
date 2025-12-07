// Centralized backend host for redirects/downloads; update before deployment.
const DEFAULT_BACKEND_URL = 'http://localhost:5003';

const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');
const trimLeadingSlash = (value = '') => value.replace(/^\/+/, '');

export const BACKEND_BASE_URL = trimTrailingSlash(
  process.env.REACT_APP_BACKEND_URL || process.env.REACT_APP_API_URL || DEFAULT_BACKEND_URL
);

export const buildBackendUrl = (path = '') => {
  const base = BACKEND_BASE_URL || DEFAULT_BACKEND_URL;
  const cleanPath = trimLeadingSlash(path);
  return cleanPath ? `${base}/${cleanPath}` : base;
};
