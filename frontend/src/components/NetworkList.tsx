import { useState } from 'react';

interface Relationship {
  user1: string;
  user2: string;
  relationship: string;
  contact: string;
}

export default function NetworkList() {
  const [relationships] = useState<Relationship[]>([
    {
      user1: 'BlueYard Ventures',
      user2: 'Alice',
      relationship: 'We co-led Alice\'s seed round—she\'s now hiring a founding engineer with deep cryptography background.',
      contact: 'alice.eth'
    },
    {
      user1: 'BlueYard Ventures',
      user2: 'Bob',
      relationship: 'Bob is one of our LPs with a strong interest in decentralized identity systems.',
      contact: 'bob@example.com'
    },
    {
      user1: 'BlueYard Ventures',
      user2: 'Reclaim.ID',
      relationship: 'Reclaim.ID is a portfolio company working on privacy-first identity infrastructure.',
      contact: 'reclaim.id/agent.json'
    },
    {
      user1: 'BlueYard Ventures',
      user2: 'Charlie',
      relationship: 'Charlie helps our teams with infrastructure scaling; he\'s advised two of our portfolio protocols.',
      contact: '+15551234567'
    },
    {
      user1: 'BlueYard Ventures',
      user2: 'Diana',
      relationship: 'Diana runs product strategy sessions for several BlueYard-backed founders building in privacy tech.',
      contact: 'diana.eth'
    },
    {
      user1: 'BlueYard Ventures',
      user2: 'MindMesh',
      relationship: 'MindMesh is an early-stage company we\'re supporting on GTM and hiring efforts.',
      contact: 'mindmesh.xyz/agent.json'
    },
    {
      user1: 'BlueYard Ventures',
      user2: 'Ethan',
      relationship: 'Ethan collaborates with us on decentralized governance models and hosts working groups.',
      contact: 'ethan@example.com'
    }
  ]);

  return (
    <div className="overflow-hidden bg-white dark:bg-gray-800 shadow sm:rounded-lg">
      <div className="flow-root">
        <ul role="list" className="divide-y divide-gray-200 dark:divide-gray-700">
          <li className="py-4 px-4 bg-gray-50 dark:bg-gray-700">
            <div className="flex items-center space-x-4">
              <div className="w-1/6">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  Name
                </p>
              </div>
              <div className="w-3/5">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  Relationship
                </p>
              </div>
              <div className="w-1/5">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  Contact
                </p>
              </div>
            </div>
          </li>
          {relationships.map((item, index) => (
            <li key={index} className="py-4 px-4">
              <div className="flex items-center space-x-4">
                <div className="w-1/6">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {item.user2}
                  </p>
                </div>
                <div className="w-3/5">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {item.relationship}
                  </p>
                </div>
                <div className="w-1/5">
                  <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                    {item.contact}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
} 