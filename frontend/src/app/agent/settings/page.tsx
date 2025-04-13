'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function AgentSettings() {
  const [agentName, setAgentName] = useState('');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [intentListeners, setIntentListeners] = useState(['', '']);
  const [selectedModel, setSelectedModel] = useState('DeepSeek-V3-0324');

  const aiModels = [
    { id: 'DeepSeek-V3-0324', name: 'DeepSeek-V3-0324', description: "DeepSeek's updated V3 model released on 03/24/2025.", type: 'LLM', precision: 'FP8', status: 'New' },
    { id: 'QwQ-32B', name: 'QwQ-32B', description: 'The lastest Qwen reasoning model.', type: 'LLM', precision: 'BF16', status: 'New' },
    { id: 'DeepSeek-R1', name: 'DeepSeek-R1', description: 'The best open-source reasoner LLM released by DeepSeek.', type: 'LLM', precision: 'FP8', status: 'New' },
    { id: 'DeepSeek-V3', name: 'DeepSeek-V3', description: 'The best open-source LLM released by DeepSeek.', type: 'LLM', precision: 'FP8', status: 'New' },
    { id: 'Llama-3.3-70B', name: 'Llama-3.3-70B', description: "Meta's latest 70B LLM with performance comparable to llama 3.1 405B", type: 'LLM', precision: 'FP8', status: 'Popular' },
    { id: 'QwQ-32B-Preview', name: 'QwQ-32B-Preview', description: 'The lastest reasoner from the Qwen Team.', type: 'LLM', precision: 'FP8', status: 'New' },
    { id: 'Qwen2.5-Coder-32B', name: 'Qwen2.5-Coder-32B', description: 'The best coder from the Qwen Team.', type: 'LLM', precision: 'FP8', status: '' },
    { id: 'Llama-3.2-3B', name: 'Llama-3.2-3B', description: 'The latest Llama 3.2 instruction-tuned model by Meta.', type: 'LLM', precision: 'FP8', status: '' },
    { id: 'Qwen2.5-72B', name: 'Qwen2.5-72B', description: 'The latest Qwen LLM with more knowledge in coding and math.', type: 'LLM', precision: 'BF16', status: '' },
    { id: 'Llama-3-70B', name: 'Llama-3-70B', description: 'A highly efficient and powerful model designed for a variety of tasks.', type: 'LLM', precision: 'FP8', status: '' },
    { id: 'Hermes-3-70B', name: 'Hermes-3-70B', description: 'The latest flagship model in the Hermes series and the first full parameter fine-tune since the release of Llama 3.1.', type: 'LLM', precision: 'FP8', status: '' },
    { id: 'Llama-3.1-405B', name: 'Llama-3.1-405B', description: 'The Biggest and Best open-source AI model trained by Meta, beating GPT-4o across most benchmarks.', type: 'LLM', precision: 'FP8', status: '' },
    { id: 'Llama-3.1-8B', name: 'Llama-3.1-8B', description: 'The smallest and fastest member of the Llama 3.1 family.', type: 'LLM', precision: 'FP8', status: '' },
    { id: 'Llama-3.1-70B', name: 'Llama-3.1-70B', description: 'The best LLM at its size with faster response times compared to the 405B model.', type: 'LLM', precision: 'FP8', status: '' },
  ];

  const handleAddIntentListener = () => {
    setIntentListeners([...intentListeners, '']);
  };

  const handleIntentListenerChange = (index: number, value: string) => {
    const newListeners = [...intentListeners];
    newListeners[index] = value;
    setIntentListeners(newListeners);
  };

  const handleRemoveIntentListener = (index: number) => {
    const newListeners = intentListeners.filter((_, i) => i !== index);
    setIntentListeners(newListeners);
  };

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Page Title and Actions */}
          <div className="flex flex-col space-y-4 mb-8">
            <Link 
              href="/agent"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              ← Back to Agent
            </Link>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Save & Redeploy Agent</h2>
          </div>

          <div className="bg-white dark:bg-gray-800/50 backdrop-blur-sm rounded-lg shadow dark:shadow-gray-900/10 p-8 border border-gray-100 dark:border-gray-700/50">
            <p className="text-lg leading-8 text-gray-600 dark:text-gray-300/95 font-light tracking-normal mb-10 max-w-2xl">
              Update your agent's settings and redeploy it to apply changes.
            </p>

            <div className="space-y-8">
              {/* Agent Name */}
              <div className="space-y-2">
                <label htmlFor="agentName" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Agent Name
                </label>
                <input
                  type="text"
                  id="agentName"
                  placeholder="e.g., Research Collaborator Finder"
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                />
              </div>

              {/* AI Model Selector */}
              <div className="space-y-2">
                <label htmlFor="aiModel" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  AI Model
                </label>
                <div className="relative">
                  <select
                    id="aiModel"
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600 appearance-none"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                  >
                    {aiModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} {model.status && `(${model.status})`}
                      </option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {aiModels.find(model => model.id === selectedModel)?.description}
                </p>
              </div>

              {/* Agent Prompt */}
              <div className="space-y-2">
                <label htmlFor="agentPrompt" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Agent Prompt
                </label>
                <textarea
                  id="agentPrompt"
                  rows={4}
                  placeholder="I am an agent that helps connect researchers working on similar problems..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600"
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                />
              </div>

              {/* Intent Listeners */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Intent Listeners
                  </label>
                  <button
                    type="button"
                    onClick={handleAddIntentListener}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
                  >
                    + Add Another Intent Listener
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Your intent listeners are encrypted and only accessible by your agent. No external parties, including our team, can view or access these listeners.
                </p>
                <div className="space-y-3">
                  {intentListeners.map((listener, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-blue-100 dark:bg-blue-900 rounded-full text-sm text-blue-600 dark:text-blue-400">
                        {index + 1}
                      </div>
                      <input
                        type="text"
                        placeholder="e.g., Seeking research collaborators interested in multi-agent systems"
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600"
                        value={listener}
                        onChange={(e) => handleIntentListenerChange(index, e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveIntentListener(index)}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  className="px-4 py-2 text-white bg-indigo-600 dark:bg-indigo-500 rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
                >
                  Save & Redeploy
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 