'use client';

import { useState } from 'react';
import FileUpload from '@/components/FileUpload';
import Link from 'next/link';

const STAKE_TIERS = [
  { name: 'Basic', range: '5-25', min: 5, max: 25, multiplier: 1 },
  { name: 'Standard', range: '26-50', min: 26, max: 50, multiplier: 2 },
  { name: 'Premium', range: '51-75', min: 51, max: 75, multiplier: 3 },
  { name: 'Flagship', range: '76-100', min: 76, max: 100, multiplier: 4 },
];

export default function CreateIntentPage() {
  const [title, setTitle] = useState('');
  const [stake, setStake] = useState(25);
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // TODO: Implement actual intent creation logic
    console.log('Creating intent:', { title, stake, files });
    
    setTitle('');
    setStake(25);
    setFiles([]);
    setIsProcessing(false);
    setIsSuccess(true);
    
    // Reset success state after 3 seconds
    setTimeout(() => {
      setIsSuccess(false);
    }, 3000);
  };

  const handleFilesSelected = (selectedFiles: File[]) => {
    setFiles(selectedFiles);
  };

  const getCurrentTier = () => {
    return STAKE_TIERS.find(tier => stake >= tier.min && stake <= tier.max) || STAKE_TIERS[0];
  };

  const currentTier = getCurrentTier();

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Page Title and Actions */}
          <div className="flex flex-col space-y-4 mb-8">
            <Link 
              href="/intents"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              ← Back to Intents
            </Link>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Create New Intent</h2>
          </div>

          <div className="bg-white dark:bg-gray-800/50 backdrop-blur-sm rounded-lg shadow dark:shadow-gray-900/10 p-8 border border-gray-100 dark:border-gray-700/50">
            <p className="text-lg leading-8 text-gray-600 dark:text-gray-300/95 font-light tracking-normal mb-10 max-w-2xl">
              Define what you're looking for and choose how much to stake. <br />Higher stakes increase your intent's visibility and potential match quality.
            </p>
            
            {!isProcessing && !isSuccess ? (
              <form onSubmit={handleSubmit} className="space-y-8">
                <div>
                  <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Your Intent
                  </label>
                  <textarea
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 min-h-[120px] whitespace-pre-line"
                    placeholder={`Examples:
• Looking for experienced ZK proof researchers interested in privacy-preserving identity systems
• Seeking co-founder with ML expertise for healthcare startup with early traction
• Want to connect with climate tech investors focused on hardware solutions`}
                    required
                  />
                </div>

                <div>
                  <label htmlFor="stake" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Stake Amount
                  </label>
                  <div className="flex items-center space-x-4">
                    <input
                      type="number"
                      id="stake"
                      value={stake}
                      onChange={(e) => setStake(Number(e.target.value))}
                      min="5"
                      max="100"
                      className="w-32 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 text-gray-900 dark:text-white"
                      required
                    />
                    <span className="text-gray-500 dark:text-gray-400">Ξ</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">+{currentTier.multiplier}× Match Priority</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Estimated 48 hour resolution</p>
                </div>

                <div className="grid grid-cols-4 gap-4">
                  {STAKE_TIERS.map((tier) => (
                    <div
                      key={tier.name}
                      className={`p-4 rounded-lg border ${
                        stake >= tier.min && stake <= tier.max
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-400'
                          : 'border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      <h3 className="font-medium text-gray-900 dark:text-white">{tier.name}</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Ξ {tier.range}</p>
                    </div>
                  ))}
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700/50 pt-8">
                  <FileUpload onFilesSelected={handleFilesSelected} />
                </div>

                {/* Integrations Section */}
                <div className="border-t border-gray-200 dark:border-gray-700/50 pt-8">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Integrations</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">(Optional) Connect your intent to external platforms</p>
                  
                  <div className="grid grid-cols-3 gap-4">

                    {/* My Agent Integration */}
                    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-indigo-500 dark:hover:border-indigo-400 transition-colors cursor-pointer">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-emerald-600 rounded flex items-center justify-center">
                          <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
                          </svg>
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900 dark:text-white">My Personal Agent</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">MCP Server</p>
                        </div>
                      </div>
                    </div>

                    {/* Slack Integration */}
                    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-indigo-500 dark:hover:border-indigo-400 transition-colors cursor-pointer">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-purple-600 rounded flex items-center justify-center">
                          <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 15a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm12-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-8 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-8-12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
                          </svg>
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900 dark:text-white">Slack</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Notifications</p>
                        </div>
                      </div>
                    </div>


                    {/* Add Integration Button */}
                    <div className="p-4 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-500 dark:hover:border-indigo-400 transition-colors cursor-pointer flex items-center justify-center">
                      <div className="text-center">
                        <span className="text-gray-500 dark:text-gray-400 text-sm">+ Add Integration</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    type="submit"
                    className="px-4 py-2 text-white bg-indigo-600 dark:bg-indigo-500 rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
                  >
                    Stake & Broadcast Intent
                  </button>
                </div>
              </form>
            ) : isProcessing ? (
              <div className="text-center py-8">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Processing Your Intent</h2>
                <p className="text-gray-600 dark:text-gray-300 mb-6">
                  Your intent is being processed and broadcasted to the network. This will just take a moment...
                </p>
                <div className="flex justify-center space-x-2">
                  {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((letter) => (
                    <div
                      key={letter}
                      className="w-8 h-8 flex items-center justify-center bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full animate-pulse"
                    >
                      {letter}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Intent Successfully Staked!</h2>
                <p className="text-gray-600 dark:text-gray-300 mb-6">
                  Your intent has been broadcasted to the network with a stake of Ξ {stake}. Agents will now begin searching for matches.
                </p>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">14</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Agents Now Searching</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">~48h</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Estimated Match Time</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">85%</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Match Probability</p>
                  </div>
                </div>
                <div className="flex justify-center space-x-3">
                  <Link
                    href="/intents"
                    className="px-4 py-2 text-white bg-indigo-600 dark:bg-indigo-500 rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
                  >
                    View My Intents
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
} 