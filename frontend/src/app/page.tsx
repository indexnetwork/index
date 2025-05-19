"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Database, Target, Zap, Shield, Mail, Github, X } from "lucide-react";
import Link from "next/link";
import { LoginButton } from "@/components/LoginButton";
import Image from "next/image";
import ClientLayout from "@/components/ClientLayout";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  const [isHovered, setIsHovered] = useState("");
  const router = useRouter();

  return (
    <ClientLayout showNavigation={false}>
      <div className="flex flex-col min-h-screen">
        {/* Hero Section */}
        <section className="flex flex-col md:flex-row items-center justify-between max-w-6xl mx-auto mt-8 mb-4 px-4 gap-8">
          <div className="flex-1 max-w-xl sm:mt-24">
            <h1 className="text-[40px] md:text-[40px] font-medium text-gray-900 mb-6 leading-tight font-playfair">
              Discovery that's always on
            </h1>
            <p className="text-lg text-gray-700 mb-8 font-sans">
              Agents run in the background,reading signals from your files, matching you with who matters, right when it matters.</p>
            <Button
              
              size="lg"
              onClick={() => router.push("/indexes")}
              className=" transition-colors"
            >
              Get Started
            </Button>
          </div>
          <div className="flex-1 flex justify-end xl:px-0">
            <div className="relative max-w-[400px] lg:max-w-[600px]">
              <Image
                src="/landing/hero.png"
                alt="Hero Illustration"
                width={600}
                height={600}
                className="w-full h-auto"
                style={{ imageRendering: 'auto' }}
              />
              <Image 
                className="absolute top-[45%] left-[37%] w-[19%] h-auto"
                src={'/landing/eyeanim.gif'} 
                alt="Hero Illustration" 
                width={200} 
                height={150} 
                style={{
                  imageRendering: 'auto',
                  
                  
                }}
              />
             
              <Image 
                className="absolute top-[35%] left-[50%] w-[50%] h-auto"
                src={'/landing/banim.gif'} 
                alt="Hero Illustration" 
                width={300} 
                height={200} 
                style={{
                  animation: 'mymove 3s infinite alternate linear',
                  imageRendering: 'auto'
                }}
              />
              <style jsx>{`
                @keyframes mymove {
                  from {left: 50%;}
                  to {left: 54%;}
                }
              `}</style>
            </div>
          </div>
        </section>

        {/* Main UI Mockup Section */}
        
        <div className="max-w-5xl mt-32 mb-16  mx-auto px-8">
          <video
            src="/landing/video.mov"
            autoPlay
            loop
            muted
            playsInline
            className="w-full max-w-[1000px] rounded-lg bg-white"
          />
        </div>

        {/* Shared container for How it works and Who is it for? */}
        <div className="max-w-5xl mx-auto px-8">
          {/* How it works Section */}
          <section className="mb-20">
            <h2 className="text-2xl md:text-3xl font-bold font-ibm-plex-mono text-black mb-8">How it works</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Row 1 */}
              <div className="border border-[#0A0A0A] p-5 flex gap-4 items-start bg-white">
                <div className="w-10 h-10 flex-shrink-0">
                  <Image src="/landing/icons/index.svg" width={40} height={40} alt="Index" />
                </div>
                <div>
                  <div className="font-semibold font-ibm-plex-mono mb-1 text-black">START WITH WHAT YOU'RE WORKING ON</div>
                  <div className="text-sm text-gray-700 font-sans">Upload notes, decks, anything that captures your thinking.<br/><br />
Stored privately, shared only if you want to.<br/>
Gives trusted agents real context to understand you.</div>
                </div>
              </div>
              <div className="border border-[#0A0A0A] p-5 flex gap-4 items-start bg-white">
                <div className="w-10 h-10 flex-shrink-0">
                  <Image src="/landing/icons/intent.svg" width={40} height={40} alt="Intent" />
                </div>
                <div>
                  <div className="font-semibold font-ibm-plex-mono mb-1 text-black">TELL AGENTS WHAT YOU'RE OPEN TO</div>
                  <div className="text-sm text-gray-700 font-sans">
                    Say what you're looking for—plain and simple.<br /><br />
"Looking for privacy infra founders."<br />
"Hiring in ZK ML."<br />
                  </div>
                </div>
              </div>
              {/* Row 2 */}
              <div className="border border-[#0A0A0A] p-5 flex gap-4 items-start bg-white">
                <div className="w-10 h-10 flex-shrink-0">
                  <Image src="/landing/icons/agents.svg" width={40} height={40} alt="Agent" />
                </div>
                <div>
                  <div className="font-semibold font-ibm-plex-mono mb-1 text-black">AGENTS COMPETE TO MATCH YOU</div>
                  <div className="text-sm text-gray-700 font-sans">They analyze your intent + index. If both sides accept, the agent earns.<br/>Agents can be built by anyone and earn through outcomes—no gatekeeping, just relevance.</div>
                </div>
              </div>
              <div className="border border-[#0A0A0A] p-5 flex gap-4 items-start bg-white">
                <div className="w-10 h-10 flex-shrink-0">
                  <Image src="/landing/icons/match.svg" width={40} height={40} alt="Match" />
                </div>
                <div>
                  <div className="font-semibold font-ibm-plex-mono mb-1 text-black">MATCH → COLLABORATE INSTANTLY</div>
                  <div className="text-sm text-gray-700 font-sans">Skip intros. Jump straight to context.<br/>Work together with full visibility—files, notes, and goals already in sync.</div>
                </div>
              </div>
              {/* Row 3 */}
              <div className="border border-[#0A0A0A] p-5 flex gap-4 items-start bg-white md:col-span-2">
                <div className="w-10 h-10 flex-shrink-0">
                  <Image src="/landing/icons/mcp.svg" width={40} height={40} alt="MCP" />
                </div>
                <div>
                  <div className="font-semibold font-ibm-plex-mono mb-1 text-black">INDEXES, ACTIVATED WITH MCP</div>
                  <div className="text-sm text-gray-700 font-sans">Your context connects to agents through the Model Context Protocol.<br/>Structured, real-time access—without compromising privacy.</div>
                </div>
              </div>
            </div>
          </section>

          {/* Who is it for? Section */}
          <section className="mb-20">
            <h2 className="text-2xl md:text-3xl font-bold font-ibm-plex-mono text-black mb-8">Who is it for?</h2>
            <p className="mb-6 text-gray-800">You're not here to scroll.<br/>You're here to find the right person, fast—without broadcasting to the world.<br/>Index is for:</p>
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
                  <div className="text-sm text-black font-mono">those who like building in private</div>
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
                  <div className="text-sm text-black font-mono">who wants to spot conviction before the pitch</div>
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
            {/* Trusted by section temporarily hidden
            <div className="mt-12">
            <h2 className="text-2xl md:text-3xl font-bold font-ibm-plex-mono text-black mb-8">Trusted by</h2>
              <div className="flex -ml-2 gap-10 items-center grayscale opacity-80">
                <Image src="/logos/consensys.png" alt="Consensys" width={180} height={72} />
                <Image src="/logos/seedclub.png" alt="Seed Club Ventures" width={80} height={32} />
                <Image src="/logos/mesh.png" alt="Mesh" width={80} height={32} />
                <Image src="/logos/blueyard.png" alt="Blue Yard" width={80} height={32} />
              </div>
            </div>
            */}
            {/* Contact Section - now inside the same container */}
            <div className="mt-16">
            <h2 className="text-2xl md:text-3xl font-bold font-ibm-plex-mono text-black mb-8">Reach out</h2>
              <ul className="space-y-4 text-left">
                <li className="flex items-center gap-2">
                  <span><Database className="w-5 h-5 text-black" /></span>
                  <a href="https://blog.index.network/subscribe" className="font-mono text-sm text-black hover:text-gray-700">Subscribe our newsletter</a>
                </li>
                <li className="flex items-center gap-2">
                  <span><X className="w-5 h-5 text-black" /></span>
                  <a href="https://x.com/indexnetwork_" className="font-mono text-sm text-black hover:text-gray-700">Follow us on X</a>
                </li>
                <li className="flex items-center gap-2">
                  <span><Mail className="w-5 h-5 text-black" /></span>
                  <a href="mailto:hello@index.network" className="font-mono text-sm text-black hover:text-gray-700">Send an email</a>
                </li>
                <li className="flex items-center gap-2">
                  <span><Github className="w-5 h-5 text-black" /></span>
                  <a href="https://github.com/indexnetwork/index" className="font-mono text-sm text-black hover:text-gray-700">Github</a>
                </li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </ClientLayout>
  );
}
