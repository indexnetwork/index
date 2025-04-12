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
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Create New Intent</h2>
            <Link 
              href="/intents"
              className="flex items-center px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Back to Intents
            </Link>
          </div>

          <div className="bg-white rounded-lg shadow p-8">
            <p className="text-gray-600 mb-8">
              Define what you're looking for and choose how much to stake. Higher stakes increase your intent's visibility and potential match quality.
            </p>
            
            {!isProcessing && !isSuccess ? (
              <form onSubmit={handleSubmit} className="space-y-8">
                <div>
                  <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
                    Your Intent
                  </label>
                  <input
                    type="text"
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="e.g., Looking for a technical co-founder with experience in AI and privacy tech..."
                    required
                  />
                </div>

                <div>
                  <label htmlFor="stake" className="block text-sm font-medium text-gray-700 mb-1">
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
                      className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      required
                    />
                    <span className="text-gray-500">Ξ</span>
                    <span className="text-sm text-gray-500">+{currentTier.multiplier}× Match Priority</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-500">Estimated 48 hour resolution</p>
                </div>

                <div className="grid grid-cols-4 gap-4">
                  {STAKE_TIERS.map((tier) => (
                    <div
                      key={tier.name}
                      className={`p-4 rounded-lg border ${
                        stake >= tier.min && stake <= tier.max
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-gray-200'
                      }`}
                    >
                      <h3 className="font-medium">{tier.name}</h3>
                      <p className="text-sm text-gray-600">Ξ {tier.range}</p>
                    </div>
                  ))}
                </div>

                <div className="border-t border-gray-200 pt-8">
                  <FileUpload onFilesSelected={handleFilesSelected} />
                </div>

                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    type="submit"
                    className="px-4 py-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                  >
                    Stake & Broadcast Intent
                  </button>
                </div>
              </form>
            ) : isProcessing ? (
              <div className="text-center py-8">
                <h2 className="text-xl font-semibold mb-4">Processing Your Intent</h2>
                <p className="text-gray-600 mb-6">
                  Your intent is being processed and broadcasted to the network. This will just take a moment...
                </p>
                <div className="flex justify-center space-x-2">
                  {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((letter) => (
                    <div
                      key={letter}
                      className="w-8 h-8 flex items-center justify-center bg-indigo-100 rounded-full animate-pulse"
                    >
                      {letter}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <h2 className="text-xl font-semibold mb-4">Intent Successfully Staked!</h2>
                <p className="text-gray-600 mb-6">
                  Your intent has been broadcasted to the network with a stake of Ξ {stake}. Agents will now begin searching for matches.
                </p>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div>
                    <p className="text-2xl font-bold">14</p>
                    <p className="text-sm text-gray-600">Agents Now Searching</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">~48h</p>
                    <p className="text-sm text-gray-600">Estimated Match Time</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">85%</p>
                    <p className="text-sm text-gray-600">Match Probability</p>
                  </div>
                </div>
                <div className="flex justify-center space-x-3">
                  <Link
                    href="/intents"
                    className="px-4 py-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
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