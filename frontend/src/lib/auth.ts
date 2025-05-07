import Cookies from 'js-cookie';

export const TOKEN_NAME = 'auth_token';

// Cookie options
const COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  expires: 30, // 30 days
};

export const getAuthToken = () => {
  // Try localStorage first, then cookies as fallback
  return localStorage.getItem(TOKEN_NAME) || Cookies.get(TOKEN_NAME);
};

export const setAuthToken = (token: string) => {
  // Store in both localStorage and cookies
  localStorage.setItem(TOKEN_NAME, token);
  // Set cookie for server-side access through middleware
  Cookies.set(TOKEN_NAME, token, COOKIE_OPTIONS);
};

export const removeAuthToken = () => {
  localStorage.removeItem(TOKEN_NAME);
  Cookies.remove(TOKEN_NAME, { path: '/' });
}; 