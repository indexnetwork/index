import { Navigate } from 'react-router';
import { Loader2 } from 'lucide-react';

import { useAuthContext } from '@/contexts/AuthContext';
import { useNetworksState } from '@/contexts/IndexesContext';
import ClientLayout from '@/components/ClientLayout';
import NetworkDetailPage from '@/app/networks/[id]/page';

function MyNetworkPage() {
  const { isLoading: authLoading, isAuthenticated } = useAuthContext();
  const { indexes, loading: indexesLoading } = useNetworksState();

  const personalIndex = indexes?.find((i) => i.isPersonal);

  if (authLoading || indexesLoading) {
    return (
      <ClientLayout>
        <div className="flex justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
        </div>
      </ClientLayout>
    );
  }

  if (!isAuthenticated || !personalIndex) {
    return <Navigate to="/" replace />;
  }

  return (
    <NetworkDetailPage
      networkIdOverride={personalIndex.id}
      basePath="/mynetwork"
    />
  );
}

export default MyNetworkPage;
export const Component = MyNetworkPage;
