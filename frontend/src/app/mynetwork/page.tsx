import { Navigate } from 'react-router';
import { Loader2 } from 'lucide-react';

import { useAuthContext } from '@/contexts/AuthContext';
import { useNetworksState } from '@/contexts/NetworksContext';
import ClientLayout from '@/components/ClientLayout';
import NetworkDetailPage from '@/app/networks/[id]/page';

function MyNetworkPage() {
  const { isLoading: authLoading, isAuthenticated } = useAuthContext();
  const { networks, loading: networksLoading } = useNetworksState();

  const personalNetwork = networks?.find((i) => i.isPersonal);

  if (authLoading || networksLoading) {
    return (
      <ClientLayout>
        <div className="flex justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
        </div>
      </ClientLayout>
    );
  }

  if (!isAuthenticated || !personalNetwork) {
    return <Navigate to="/" replace />;
  }

  return (
    <NetworkDetailPage
      networkIdOverride={personalNetwork.id}
      basePath="/mynetwork"
    />
  );
}

export default MyNetworkPage;
export const Component = MyNetworkPage;
