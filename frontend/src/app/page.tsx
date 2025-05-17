"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Database, Target, Zap, Shield, Mail, Github, X } from "lucide-react";
import Link from "next/link";
import { LoginButton } from "@/components/LoginButton";
import Image from "next/image";
import ClientLayout from "@/components/ClientLayout";

export default function LandingPage() {
  const [isHovered, setIsHovered] = useState("");
  const router = useRouter();

  return (
    <ClientLayout showNavigation={false}>
      <div className="flex flex-col min-h-screen">
        {/* Hero Section */}
        <section className="flex flex-col md:flex-row items-center justify-between max-w-6xl mx-auto mt-8 mb-4 px-4 gap-8">
          <div className="flex-1 max-w-xl">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight font-playfair">
              Find people, privately.
            </h1>
            <p className="text-lg text-gray-700 mb-8 font-sans">
              Index is a private, intent-driven discovery protocol where autonomous agents compete to connect you with the right people at the right time.
            </p>
            <button
              onClick={() => router.push("/indexes")}
              className="bg-black text-white px-6 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors"
            >
              Get Started
            </button>
          </div>
          <div className="flex-1 flex justify-end xl:px-0">
            <Image
              src="/landing/hero.png"
              alt="Hero Illustration"
              width={600}
              height={600}
              className="object-contain w-full max-w-[400px] lg:max-w-[600px]"
              priority
            />
          </div>
        </section>

        {/* Main UI Mockup Section */}
        <div className="flex justify-center mt-8 mb-16 px-4">
          <Image
            src="/landing/main.png"
            alt="App UI Mockup"
            width={1200}
            height={800}
            className="w-full max-w-[1200px]"
          />
        </div>

        {/* Shared container for How it works and Who is it for? */}
        <div className="max-w-5xl mx-auto px-8">
          {/* How it works Section */}
          <section className="mb-20">
            <h2 className="text-2xl md:text-3xl font-bold text-black mb-8">How it works</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Row 1 */}
              <div className="border border-[#0A0A0A] p-5 flex gap-4 items-start bg-white">
                {/* Icon */}
                <span className="mt-1"><svg width="28" height="28" fill="none"><rect width="28" height="28" rx="6" fill="#F3E8FF"/><path d="M8 14h12M14 8v12" stroke="#A21CAF" strokeWidth="2" strokeLinecap="round"/></svg></span>
                <div>
                <div className="font-semibold font-ibm-plex-mono mb-1 text-black">CREATE INTENT</div>
                <div className="text-sm  text-gray-700 font-sans">Say what you're looking for—plain and simple.<br/>"Looking for privacy infra founders."<br/>"Hiring in ZK ML."</div>
                </div>
              </div>
              <div className="border border-[#0A0A0A] p-5 flex gap-4 items-start bg-white">
                <span className="mt-1"><svg width="28" height="28" fill="none"><rect width="28" height="28" rx="6" fill="#FEF3C7"/><path d="M9 19V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2Z" stroke="#D97706" strokeWidth="2"/></svg></span>
                <div>
                  <div className="font-semibold font-ibm-plex-mono mb-1 text-black">CREATE INDEX</div>
                  <div className="text-sm text-gray-700 font-sans">Files, docs, notes, decks. Stored in TEE.<br/>Used to boost match accuracy, and shared automatically with people you match with.</div>
                </div>
              </div>
              {/* Row 2 */}
              <div className="border  border-[#0A0A0A] p-5 flex gap-4 items-start bg-white">
                <span className="mt-1"><svg width="28" height="28" fill="none"><rect width="28" height="28" rx="6" fill="#DBEAFE"/><path d="M14 8v12M8 14h12" stroke="#2563EB" strokeWidth="2" strokeLinecap="round"/></svg></span>
                <div>
                  <div className="font-semibold font-ibm-plex-mono mb-1 text-black">AGENTS COMPETE TO MATCH YOU</div>
                  <div className="text-sm text-gray-700 font-sans">They analyze your intent + index. If both sides accept, the agent earns.<br/>Agents can be built by anyone and earn through outcomes—no gatekeeping, just relevance.</div>
                </div>
              </div>
              <div className="border  border-[#0A0A0A] p-5 flex gap-4 items-start bg-white">
                <span className="mt-1"><svg width="28" height="28" fill="none"><rect width="28" height="28" rx="6" fill="#DCFCE7"/><path d="M9 14l4 4 6-6" stroke="#16A34A" strokeWidth="2" strokeLinecap="round"/></svg></span>
                <div>
                  <div className="font-semibold font-ibm-plex-mono mb-1 text-black">MATCH → COLLABORATE INSTANTLY</div>
                  <div className="text-sm text-gray-700 font-sans">Skip intros. Jump straight to context.<br/>Work together with full visibility—files, notes, and goals already in sync.</div>
                </div>
              </div>
              {/* Row 3 */}
              <div className="border  border-[#0A0A0A] p-5 flex gap-4 items-start bg-white md:col-span-2">
                <span className="mt-1"><svg width="28" height="28" fill="none"><rect width="28" height="28" rx="6" fill="#FCE7F3"/><path d="M14 8v12M8 14h12" stroke="#DB2777" strokeWidth="2" strokeLinecap="round"/></svg></span>
                <div>
                  <div className="font-semibold font-ibm-plex-mono mb-1 text-black">INDEXES, ACTIVATED WITH MCP</div>
                  <div className="text-sm text-gray-700 font-sans">Your context connects to agents through the Model Context Protocol.<br/>Structured, real-time access—without compromising privacy.</div>
                </div>
              </div>
            </div>
          </section>

          {/* Who is it for? Section */}
          <section className="mb-20">
            <h2 className="text-2xl md:text-3xl font-bold text-black mb-8">Who is it for?</h2>
            <p className="mb-6 text-gray-800">You're not here to scroll.<br/>You're here to find the right person, fast—without broadcasting your intent.<br/>Index is for:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
              <div className="flex gap-4 items-center">
                <Image
                  src="/logos/founder.png"
                  alt="Founder"
                  width={48}
                  height={48}
                  className="object-contain"
                />
                <div>
                  <div className="font-bold text-black text-xs tracking-widest mb-1">FOUNDERS</div>
                  <div className="text-sm text-black font-mono">building in public, matching in private</div>
                </div>
              </div>
              <div className="flex gap-4 items-center">
                <Image
                  src="/logos/investor.png"
                  alt="Investor"
                  width={48}
                  height={48}
                  className="object-contain"
                />
                <div>
                  <div className="font-bold text-black text-xs tracking-widest mb-1">INVESTORS</div>
                  <div className="text-sm text-black font-mono">who care about context</div>
                </div>
              </div>
              <div className="flex gap-4 items-center">
                <Image
                  src="/logos/ecosystem.png"
                  alt="Ecosystem"
                  width={48}
                  height={48}
                  className="object-contain"
                />
                <div>
                  <div className="font-bold text-black text-xs tracking-widest mb-1">ECOSYSTEMS</div>
                  <div className="text-sm text-black font-mono">mapping intent across teams</div>
                </div>
              </div>
              <div className="flex gap-4 items-center">
                <Image
                  src="/logos/sales.png"
                  alt="Sales"
                  width={48}
                  height={48}
                  className="object-contain"
                />
                <div>
                  <div className="font-bold text-black text-xs tracking-widest mb-1">SALES TEAMS</div>
                  <div className="text-sm text-black font-mono">looking for high-signal opportunities</div>
                </div>
              </div>
            </div>
            <div className="mt-12">
              <div className="text-lg text-black font-serif font-semibold mb-4">Trusted by</div>
              <div className="flex -ml-2 gap-10 items-center grayscale opacity-80">
                <Image src="/logos/consensys.png" alt="Consensys" width={180} height={72} />
                <Image src="/logos/seedclub.png" alt="Seed Club Ventures" width={80} height={32} />
                <Image src="/logos/mesh.png" alt="Mesh" width={80} height={32} />
                <Image src="/logos/blueyard.png" alt="Blue Yard" width={80} height={32} />
              </div>
            </div>
            {/* Contact Section - now inside the same container */}
            <div className="mt-16">
              <div className="text-lg text-black font-serif font-semibold mb-4 text-left">Contact</div>
              <ul className="space-y-4 text-left">
                <li className="flex items-center gap-2">
                  <span><Database className="w-5 h-5 text-black" /></span>
                  <a href="#" className="font-mono text-sm text-black hover:text-gray-700">Subscribe our newsletter</a>
                </li>
                <li className="flex items-center gap-2">
                  <span><X className="w-5 h-5 text-black" /></span>
                  <a href="#" className="font-mono text-sm text-black hover:text-gray-700">Follow us on X</a>
                </li>
                <li className="flex items-center gap-2">
                  <span><X className="w-5 h-5 text-black" /></span>
                  <a href="mailto:hello@index.network" className="font-mono text-sm text-black hover:text-gray-700">Send an email</a>
                </li>
                <li className="flex items-center gap-2">
                  <span><Github className="w-5 h-5 text-black" /></span>
                  <a href="#" className="font-mono text-sm text-black hover:text-gray-700">Github</a>
                </li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </ClientLayout>
  );
}
