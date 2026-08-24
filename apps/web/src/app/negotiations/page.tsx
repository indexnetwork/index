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
      <div className="px-10 py-6 lg:px-16">
        <ContentContainer size="wide">
          <h1 className="font-ibm-plex-mono text-lg font-bold text-black">Negotiation task index</h1>
          <p className="mt-1 text-sm text-gray-500">One row per owned intent seat. This is task state, not a conversation inbox.</p>
          <div className="mt-6">
            {loading ? <p className="text-sm text-gray-500">Loading negotiation tasks…</p>
              : error ? <p className="text-sm text-red-600">Negotiation task index could not be loaded.</p>
                : <NegotiationTaskIndex entries={entries} />}
          </div>
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = NegotiationsPage;
