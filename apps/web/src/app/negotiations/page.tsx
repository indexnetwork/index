import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';

import ClientLayout from '@/components/ClientLayout';
import UserAvatar from '@/components/UserAvatar';
import { ContentContainer } from '@/components/layout';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { deriveNegotiationInbox, type NegotiationInboxItem } from '@/lib/negotiation-inbox';

function NegotiationRow({ item }: { item: NegotiationInboxItem }) {
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <Link to={`/u/${item.counterpart.id}`} className="shrink-0">
          <UserAvatar id={item.counterpart.id} name={item.counterpart.name} avatar={item.counterpart.avatar} size={36} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/u/${item.counterpart.id}`} className="text-sm font-bold text-gray-900 hover:underline">
              {item.counterpart.name}
            </Link>
            <span className={`rounded-full border px-1.5 py-0.5 text-xs font-medium ${item.chipClass}`}>{item.label}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-gray-600">{item.statement}</p>
          <p className="mt-1 font-ibm-plex-mono text-[10px] text-gray-400">
            {item.turnCount} {item.turnCount === 1 ? 'turn' : 'turns'} · {item.timeAgo}
          </p>
        </div>
      </div>
    </li>
  );
}

function Section({ title, items }: { title: string; items: NegotiationInboxItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="font-ibm-plex-mono text-xs uppercase tracking-wide text-gray-500">{title}</h2>
      <ol className="mt-2 space-y-2">
        {items.map((item) => <NegotiationRow key={item.id} item={item} />)}
      </ol>
    </section>
  );
}

export default function NegotiationsPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, user } = useAuthContext();
  const { negotiations } = useConversation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, isLoading, navigate]);

  const groups = useMemo(() => deriveNegotiationInbox(negotiations, user?.id), [negotiations, user?.id]);
  const isEmpty = groups.yourMove.length + groups.inProgress.length + groups.resolved.length === 0;

  if (isLoading || !isAuthenticated) return null;
  return (
    <ClientLayout>
      <div className="px-10 py-6 lg:px-16">
        <ContentContainer size="wide">
          <h1 className="font-ibm-plex-mono text-lg font-bold text-black">Negotiations</h1>
          <p className="mt-1 text-sm text-gray-500">Your agent and theirs, one record per opportunity.</p>
          {isEmpty ? (
            <p className="mt-6 rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center font-ibm-plex-mono text-sm text-gray-500">
              No negotiations yet.
            </p>
          ) : (
            <>
              <Section title="Your move" items={groups.yourMove} />
              <Section title="In progress" items={groups.inProgress} />
              <Section title="Resolved" items={groups.resolved} />
            </>
          )}
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = NegotiationsPage;
