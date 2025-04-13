'use client';

import { useIntegrations } from '@/contexts/IntegrationContext';
import { IntegrationSource } from '@/types';
import { 
  Linkedin, 
  Mail, 
  Calendar, 
  RefreshCw, 
  X,
  CheckCircle2,
  AlertCircle,
  Lock,
  Clock
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const integrationIcons: Record<IntegrationSource, React.ReactNode> = {
  linkedin: <Linkedin className="w-6 h-6" />,
  gmail: <Mail className="w-6 h-6" />,
  calendar: <Calendar className="w-6 h-6" />
};

const integrationDescriptions: Record<IntegrationSource, string> = {
  linkedin: "Connect your professional network and experience",
  gmail: "Sync relevant emails and attachments",
  calendar: "Access your calendar availability and events"
};

export default function IntegrationList() {
  const { integrations, connectIntegration, disconnectIntegration, syncIntegration } = useIntegrations();

  const handleConnect = async (source: IntegrationSource) => {
    try {
      await connectIntegration(source);
    } catch (error) {
      console.error('Failed to connect integration:', error);
    }
  };

  const handleSync = async (id: string) => {
    try {
      await syncIntegration(id);
    } catch (error) {
      console.error('Failed to sync integration:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Object.entries(integrationIcons).map(([source, icon]) => {
          const integration = integrations.find(i => i.source === source);
          const isConnected = integration?.status === 'connected';

          return (
            <div
              key={source}
              className={`group relative overflow-hidden rounded-xl border transition-all duration-200 ${
                isConnected
                  ? 'border-blue-100 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 bg-white dark:bg-gray-800/50'
              }`}
            >
              {/* Background pattern */}
              <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]" 
                   style={{ 
                     backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
                     backgroundSize: '24px 24px' 
                   }} 
              />

              <div className="relative p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-4">
                    <div className={`p-3 rounded-xl transition-colors ${
                      isConnected 
                        ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }`}>
                      {icon}
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        {source.charAt(0).toUpperCase() + source.slice(1)}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {integrationDescriptions[source as IntegrationSource]}
                      </p>
                      {integration?.lastSyncedAt && (
                        <div className="flex items-center space-x-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <Clock className="w-3.5 h-3.5" />
                          <span>
                            Synced {formatDistanceToNow(new Date(integration.lastSyncedAt), { addSuffix: true })}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {isConnected ? (
                      <>
                        <button
                          onClick={() => handleSync(integration.id)}
                          className="p-2 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                          title="Sync now"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => disconnectIntegration(integration.id)}
                          className="p-2 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                          title="Disconnect"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleConnect(source as IntegrationSource)}
                        className="inline-flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 dark:bg-blue-500 rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors"
                      >
                        <Lock className="w-4 h-4" />
                        <span>Connect</span>
                      </button>
                    )}
                  </div>
                </div>

                {integration?.status === 'error' && (
                  <div className="mt-4 flex items-center space-x-2 text-red-500 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{integration.error}</span>
                  </div>
                )}

                {isConnected && (
                  <div className="mt-4 flex items-center space-x-2 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Connected and encrypted</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
} 