'use client';

import { use } from 'react';
import ClientLayout from '@/components/ClientLayout';

export default function DirectoryPage({ params }: { params: Promise<{ indexId: string }> }) {
  use(params);

  return (
    <ClientLayout>
      <div className="w-full border border-gray-800 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
        backgroundImage: 'url(/grid.png)',
        backgroundColor: 'white',
        backgroundSize: '888px'
      }}>
        <div className="flex flex-col justify-center items-center py-12">
          <h2 className="text-xl font-bold text-gray-900 font-ibm-plex-mono mb-2">
            Directory
          </h2>
          <p className="text-gray-500 font-ibm-plex-mono">
            Coming soon
          </p>
        </div>
      </div>
    </ClientLayout>
  );
}

