import { useAuthContext } from '@/contexts/AuthContext';
import { useLogin } from '@privy-io/react-auth';

export function LoginButton() {
  const { login } = useLogin();
  const { isAuthenticated, logout } = useAuthContext();

  return (
    <button
      onClick={() => (isAuthenticated ? logout() : login())}
      className="btn-primary flex items-center gap-2"
    >
      {isAuthenticated ? 'Sign Out' : 'Sign In'}
    </button>
  );
} 