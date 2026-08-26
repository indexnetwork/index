import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import ClientLayout from '@/components/ClientLayout';
import NegotiationTaskIndex from '@/components/NegotiationTaskIndex';
import { ContentContainer } from '@/components/layout';
import { useConversations } from '@/contexts/APIContext';
import { useAuthContext } from '@/contexts/AuthContext';
import type { NegotiationTaskIndexEntry } from '@/services/conversation';

export default function NegotiationsPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuthContext();
  const conversations = useConversations();
  const [entries, setEntries] = useState<NegotiationTaskIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, isLoading, navigate]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    conversations.getNegotiationTaskIndex()
      .then((result) => { if (active) setEntries(result); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [conversations, isAuthenticated]);

  if (isLoading || !isAuthenticated) return null;
  return (
    <ClientLayout>
      <div className="px-6 pb-12 lg:px-8">
        <ContentContainer size="wide">
          <NegotiationTaskIndex entries={entries} loading={loading} error={error} />
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = NegotiationsPage;
