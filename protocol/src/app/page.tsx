'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { HeroSection } from "@/components/HeroSection";
import { AgentsSection } from "@/components/AgentsSection";
import Script from 'next/script';
import GitHubButton from 'react-github-btn'

export default function Home() {
  return (
    <>
      <Script src="https://buttons.github.io/buttons.js" />
      
      <header className="z-50">
        <nav className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Image
              src="/logo.svg"
              alt="Index Network"
              width={192}
              height={32}
            />
          </Link>
          <div className="flex gap-6">
          <Link href="https://x.com/indexnetwork_" className="nav-link">x.com</Link>
          <Link href="https://blog.index.network" className="nav-link">blog</Link>
            <GitHubButton href="https://github.com/indexnetwork/index" data-color-scheme="no-preference: dark; light: dark; dark: dark;" data-size="large" data-show-count="true" aria-label="Star indexnetwork/index on GitHub">Star</GitHubButton>
          </div>
        </nav>
      </header>
      <div className="max-w-3xl mx-auto px-4 space-y-16 ">
      <HeroSection />

      </div>
      { false && <div className="max-w-3xl mx-auto px-4 space-y-16 ">
        <HeroSection />
        <AgentsSection />

        {/* Indexes Section */}
        <section className="space-y-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-violet-200">Indexes</h2>
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="text-md font-medium mb-2">Public Indexes</h3>
              <p className="text-gray-400 mb-2 text-sm">
                Discovery spans platforms, with insights scattered everywhere. Index unites conversations, events, and insights, helping you find what matters.
              </p>
              <ul className="space-y-4 text-gray-400 text-sm list-disc">
                <li className="flex items-center">
                  <Image src="/icons/indexes/farcaster.png" alt="Farcaster Icon" width={20} height={20} className="mr-2" />
                  <p className="font-semibold"><span className="text-white">Farcaster:</span> Real-time discussions from the web3 ecosystem</p>
                </li>
                <li className="flex items-center">
                  <Image src="/icons/indexes/luma.png" alt="Lu.ma Icon" width={20} height={20} className="mr-2" />
                  <p className="font-semibold"><span className="text-white">Lu.ma:</span> Community gatherings and industry events</p>
                </li>
                <li className="flex items-center">
                  <Image src="/icons/indexes/paragraph.png" alt="Paragraph.xyz Icon" width={20} height={20} className="mr-2" />
                  <p className="font-semibold"><span className="text-white">Paragraph.xyz:</span> Long-form thought leadership (soon)</p>
                </li>
                <li className="flex items-center">
                  <p className="font-semibold"><span>More sources being added regularly</span></p>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-md font-medium  mt-8 mb-2">Private Indexes</h3>
              <p className="text-gray-400 mb-2 text-sm">
                Your personal spaces hold valuable context. Indexing them unlocks discovery tailored to your world.
              </p>
              <ul className="space-y-2 text-gray-400 text-sm list-disc">
                <li className="flex items-center">
                  <Image src="/icons/indexes/telegram.png" alt="Telegram Icon" width={20} height={20} className="mr-2" />
                  <p className="font-semibold"><span className="text-white">Telegram:</span> Track messages from your groups and channels, receive updates about discussions</p>
                </li>
                <li className="flex items-center">
                  <Image src="/icons/indexes/google_calendar.png" alt="Google Calendar Icon" width={20} height={20} className="mr-2" />
                  <p className="font-semibold"><span className="text-white">Google Calendar:</span> Connect your calendar to get proactive insights about upcoming events and discover relevant discussions</p>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Testimonials Section */}
        <section className="space-y-8">
          <h2 className="text-2xl font-bold text-violet-200">
            What people are saying
          </h2>
          <div className="space-y-6">
            {testimonials.map((testimonial, index) => (
              <div key={index}>
                <blockquote className="">
                  <p className="text-gray-400 text-sm">“{testimonial.quote}”</p>
                  <footer className="text-sm mt-1">
                    <p className="text-gray-400"><cite className="font-medium text-white not-italic"><u><a href={testimonial.link} target="_blank" rel="noopener noreferrer">{testimonial.author}</a></u></cite> - {testimonial.title}</p>
                  </footer>
                </blockquote>
              </div>
            ))}
          </div>
        </section>


      </div>}
    </>
  );
}
const testimonials = [
  {
    quote: "Apps need to deliver better information and experiences faster. Index's semantic index does that. Index can make better discovery a primitive all apps rely on.",
    author: "Danny Zuckerman",
    title: "3Box Labs, Co-founder",
    link: "https://twitter.com/dazuck"
  },
  {
    quote: "Index is attempting to create a totally novel discovery and social experience. They aim to deploy autonomous agents in a way that can uniquely benefit from web3 technology and I'm really excited to see their progress.",
    author: "Oak",
    title: "Autonolas, Co-founder",
    link: "https://x.com/tannedoaksprout"
  },
  {
    quote: "Index Network is a foundational base layer for the user owned web. We're so glad to be collaborators on privacy at Lit Protocol!",
    author: "David Sneider",
    title: "Lit Protocol, Co-founder",
    link: "https://x.com/davidlsneider"
  },
  {
    quote: "Index Network is going to change the way we think about discovering information and interacting with the web. The ability to use autonomous AI agents to index and interpret data from multiple sources through an intuitive natural language interface is a total game changer!",
    author: "Simon Brown",
    title: "Consensys, Researcher & Advisor",
    link: "https://x.com/orbmis"
  },
  {
    quote: "The future is AI. And in this future, the efficacy of AI will only be as good as the data our agents are ingesting. Index plays a pivotal role in this future, enabling our AI counterparts to return increasingly relevant, contextual, and accurate results and information.",
    author: "Billy Luedtke",
    title: "Intuition Systems, Founder",
    link: "https://x.com/0xbilly"
  }
];
