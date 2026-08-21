import { useEffect } from 'react';
import { useNavigate } from 'react-router';

import ChatLandingPage from '@/app/chat/page';
import { useAuthContext } from '@/contexts/AuthContext';

export default function NegotiationsPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuthContext();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, isLoading, navigate]);

  if (isLoading || !isAuthenticated) return null;
  return <ChatLandingPage />;
}

export const Component = NegotiationsPage;
