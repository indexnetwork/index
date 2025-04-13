'use client';

import ConnectionCard from '@/components/ConnectionCard';
import IntentHeader from '@/components/IntentHeader';
import Link from 'next/link';
import { useIntent } from '@/contexts/IntentContext';
import { useParams } from 'next/navigation';

export default function IntentPage() {
  const { id } = useParams();
  const { getIntentById, getConnectionsByIntentId, updateIntentStatus, handleConnectionAction } = useIntent();
  
  const intent = getIntentById(Number(id));
  const connections = getConnectionsByIntentId(Number(id));

  if (!intent) {
    return <div>Intent not found</div>;
  }

  const handleStatusToggle = () => {
    updateIntentStatus(intent.id, intent.status === 'open' ? 'closed' : 'open');
  };

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Page Title and Actions */}
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Intent Details</h2>
            <div className="flex space-x-3">
              <Link 
                href="/intents"
                className="flex items-center px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Back to Intents
              </Link>
            </div>
          </div>

          <div className="space-y-8">
            <IntentHeader intent={intent} />

            {/* Connections Section */}
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">Connections</h2>
              <div className="space-y-4">
                {connections.map((connection) => (
                  <ConnectionCard
                    key={connection.id}
                    connection={connection}
                    onAccept={() => handleConnectionAction(intent.id, connection.id, 'accept')}
                    onDecline={() => handleConnectionAction(intent.id, connection.id, 'decline')}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 