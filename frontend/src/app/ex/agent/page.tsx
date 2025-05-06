'use client';

import { Info } from 'lucide-react';

interface Activity {
  action: string;
  intent: string;
  date: string;
  status: 'Completed' | 'Pending' | 'Failed';
  earnings: number;
}

const recentActivity: Activity[] = [
  {
    action: 'Connection Facilitated',
    intent: 'Looking for research collaborator on AI ethics',
    date: 'Mar 28, 2025',
    status: 'Completed',
    earnings: 150
  },
  {
    action: 'Opportunity Identified',
    intent: 'Funding for privacy tech startup',
    date: 'Mar 27, 2025',
    status: 'Pending',
    earnings: 80
  },
  {
    action: 'Intent Analysis',
    intent: 'Open to collaboration on research infrastructure',
    date: 'Mar 26, 2025',
    status: 'Completed',
    earnings: 50
  },
  {
    action: 'Pattern Recognition',
    intent: 'Seeking technical co-founder with ML experience',
    date: 'Mar 25, 2025',
    status: 'Failed',
    earnings: 0
  }
];

export default function AgentDashboard() {
  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Agent Dashboard</h2>
            <div className="flex items-center gap-2 px-4 py-2 bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-400 rounded-full text-sm font-medium">
              <span className="w-2 h-2 bg-green-500 dark:bg-green-400 rounded-full animate-pulse"></span>
              Active
            </div>
          </div>

          {/* New Feature Alert */}
          <div className="bg-white dark:bg-gray-800/50 backdrop-blur-sm rounded-lg shadow dark:shadow-gray-900/10 p-6 mb-8 border border-gray-100 dark:border-gray-700/50">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
              <div className="text-gray-600 dark:text-gray-300">
                New feature available: Enhanced pattern recognition has been enabled. Your agent can now identify more subtle connection opportunities.
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-6 mb-8">
            <div className="bg-white dark:bg-gray-800/50 backdrop-blur-sm rounded-lg shadow dark:shadow-gray-900/10 p-6 border border-gray-100 dark:border-gray-700/50 hover:shadow-md dark:hover:shadow-gray-900/20 transition-all">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Revenue</div>
              <div className="mt-2 flex items-baseline gap-3">
                <div className="text-3xl font-bold text-gray-900 dark:text-white">$2,840</div>
                <div className="text-sm font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50 px-2 py-1 rounded-full">+18% from last week</div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800/50 backdrop-blur-sm rounded-lg shadow dark:shadow-gray-900/10 p-6 border border-gray-100 dark:border-gray-700/50 hover:shadow-md dark:hover:shadow-gray-900/20 transition-all">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Success Rate</div>
              <div className="mt-2 flex items-baseline gap-3">
                <div className="text-3xl font-bold text-gray-900 dark:text-white">78%</div>
                <div className="text-sm font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50 px-2 py-1 rounded-full">+12% from last week</div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800/50 backdrop-blur-sm rounded-lg shadow dark:shadow-gray-900/10 p-6 border border-gray-100 dark:border-gray-700/50 hover:shadow-md dark:hover:shadow-gray-900/20 transition-all">
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Monthly Earnings</div>
              <div className="mt-2 flex items-baseline gap-3">
                <div className="text-3xl font-bold text-gray-900 dark:text-white">$1,280</div>
                <div className="text-sm font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50 px-2 py-1 rounded-full">$280 this week</div>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Recent Activity</h2>
              <button className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors duration-200">•••</button>
            </div>

            <div className="bg-white dark:bg-gray-800/50 backdrop-blur-sm rounded-lg shadow dark:shadow-gray-900/10 overflow-hidden border border-gray-100 dark:border-gray-700/50">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700/50">
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Intent</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Earnings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700/50">
                  {recentActivity.map((activity, index) => (
                    <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700/20 transition-colors duration-150">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                        {activity.action}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {activity.intent}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {activity.date}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          activity.status === 'Completed' ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-400' :
                          activity.status === 'Pending' ? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-400' :
                          'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-400'
                        }`}>
                          {activity.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        ${activity.earnings}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 