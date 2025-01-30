'use client';

import React from 'react';
import Image from 'next/image';

const agents = [
  {
    title: "Search",
    icon: "/icons/search.png",
    description: "Search public graphs and your private data in a composable way",
    exampleResponse: "Here is the summary of discussions about your project from Farcaster."
  },
  {
    title: "Listener",
    icon: "/icons/listener.png",
    description: "Tracks updates across platforms to bring you relevant insights",
    exampleResponse: "Since you're curious about AI agents, I'll send you relevant updates."
  },
  {
    title: "Context Broker",
    icon: "/icons/context_broker.png",
    description: "Connects peers contextually while respecting privacy",
    exampleResponse: "I noticed your curiousity about decentralized AI events, you might want to join Adam's conversation."
  },
  {
    title: "Link",
    icon: "/icons/link.png",
    description: "Connects the right minds to Index App at the perfect time",
    exampleResponse: "As you're discussing AI agents, I sent an invite to Simon on Twitter, since he's an expert in AI."
  },
  {
    title: "Contextual Privacy",
    icon: "/icons/contextual_privacy.png",
    description: "Ensures context-aware connections with privacy and relevance",
    exampleResponse: "Would it be appropriate for the Context Broker Agent to share this private conversation with Link Agent to help you find more information about web3 events?"
  }
];

export function AgentsSection() {
  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-violet-200">Agents</h2>
        <p className="text-md text-gray-400">
          Here are your specialized agents, each playing a unique role in making your discovery experience more natural and effective.
        </p>
      </div>

      <div className="space-y-4">
        {agents.map((agent, index) => (
          <div key={index} className="flex gap-3 py-3">
            <div className="w-16 h-16 flex-shrink-0 mt-1">
              <Image
                src={agent.icon}
                alt={`${agent.title} icon`}
                width={80}
                height={80}
              />
            </div>
            <div className="space-y-2 flex-1">
              <div>
                <h3 className="text-lg font-bold">{agent.title}</h3>
                <p className="text-gray-400 text-sm">{agent.description}</p>
              </div>
              <div className="italic p-0 rounded-lg text-sm max-w-[90%]">
                “{agent.exampleResponse}”
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
} 