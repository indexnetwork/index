import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import ClientLayout from "@/components/ClientLayout";
import IntentNegotiationInspector from "@/components/IntentNegotiationInspector";
import { ContentContainer } from "@/components/layout";
import { useConversations } from "@/contexts/APIContext";
import type { IntentCycleNegotiationDetail } from "@/services/conversation";

export default function IntentNegotiationInspectorPage() {
  const { intentId, taskId } = useParams<{ intentId: string; taskId: string }>();
  const conversations = useConversations();
  const [detail, setDetail] = useState<IntentCycleNegotiationDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!intentId || !taskId) return;
    let active = true;
    conversations.getIntentCycleNegotiation(intentId, taskId)
      .then((result) => { if (active) setDetail(result); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [conversations, intentId, taskId]);

  return (
    <ClientLayout>
      <div className="px-10 py-6 lg:px-16">
        <ContentContainer size="wide">
          <Link to={intentId ? `/i/${intentId}` : "/"} className="text-sm text-gray-600 hover:text-black">← Intent workspace</Link>
          <h1 className="mt-4 font-ibm-plex-mono text-lg font-bold text-black">Negotiation inspector</h1>
          <p className="mt-1 text-sm text-gray-500">Owner-scoped debug view. Counterparty context and private decisions are not shown.</p>
          <div className="mt-6">
            {error ? <p className="text-sm text-red-600">This negotiation could not be loaded.</p> : detail ? <IntentNegotiationInspector detail={detail} /> : <p className="text-sm text-gray-500">Loading negotiation…</p>}
          </div>
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = IntentNegotiationInspectorPage;
