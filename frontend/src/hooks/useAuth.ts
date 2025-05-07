import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { removeAuthToken, setAuthToken } from '@/lib/auth';

export function useAuth() {
  const {
    ready,
    authenticated,
    user,
    login: privyLogin,
    logout: privyLogout,
    createWallet,
    linkWallet,
    unlinkWallet,
  } = usePrivy();
  
  const [isLoading, setIsLoading] = useState(!ready);
  const router = useRouter();

  // Store authentication token when user is authenticated
  useEffect(() => {
    if (authenticated && user?.id) {
      setAuthToken(user.id);
      router.push('/indexes');
    }
    
    if (ready) {
      setIsLoading(false);
    }
  }, [authenticated, user, ready, router]);

  const login = () => {
    privyLogin();
  };

  const logout = async () => {
    try {
      await privyLogout();
      removeAuthToken();
      router.push('/');
    } catch (error) {
      console.error('Logout error:', error);
      // Still remove token and redirect even if privy logout fails
      removeAuthToken();
      router.push('/');
    }
  };

  return {
    isReady: ready,
    isLoading,
    isAuthenticated: authenticated,
    user,
    login,
    logout,
    createWallet,
    linkWallet,
    unlinkWallet,
  };
} 