import { useAuth } from '@/hooks/useAuth';

export function LoginButton() {
  const { isAuthenticated, login, logout } = useAuth();

  return (
    <button
      onClick={() => (isAuthenticated ? logout() : login())}
      className="btn-primary flex items-center gap-2"
    >
      {isAuthenticated ? 'Sign Out' : 'Sign In'}
    </button>
  );
} 