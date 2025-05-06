"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import Header from "@/components/Header";

export default function IntentDetailPage() {
  return (
    <div className="backdrop relative min-h-screen">
      <style jsx>{`
        .backdrop:after {
          content: "";
          position: fixed;
          left: 0;
          top: 0;
          bottom: 0;
          right: 0;
          background: url(https://www.trychroma.com/img/noise.jpg);
          opacity: .12;
          pointer-events: none;
          z-index: -1;
        }
      `}</style>

      <Header />

      <div className="flex-1 px-2 sm:px-2 md:px-32">
          {/* Main Tabs */}
          <div className="w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
              backgroundImage: 'url(https://www.trychroma.com/pricing/grid.png)',
              backgroundColor: 'white',
              backgroundSize: '888px'
            }}>

        <div className="bg-white px-4 pt-1.5 pb-1 border border-black  border border-b-0 inline-block">
          <Link href="/mvp/intents" className="inline-flex items-center text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4 mr-2" />
            <span className="font-ibm-plex text-[14px] text-black font-medium">Back to intents</span>
          </Link>
        </div>

        <div className="bg-white px-4 pt-4 pb-4 mb-4 border border-black border-b-0 border-b-2">

          {/* Intent Title */}
          <h1 className="text-xl font-medium text-gray-900">
            Looking to connect with investors interested in early-stage teams building privacy-preserving agent coordination infrastructure.
          </h1>
        </div>

        {/* Match Cards Grid */}
        <div className="grid grid-cols-1 gap-6">
          {/* First Match */}
          <div className="bg-white border border-black border-b-0 border-b-2 p-6">
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-4">
                <Image
                  src="/avatars/agents/reclaim.svg"
                  alt="Arya Mehta"
                  width={48}
                  height={48}
                  className="rounded-full"
                />
                <div>
                  <h2 className="text-lg font-medium text-gray-900">Arya Mehta</h2>
                  <p className="text-sm text-gray-600">Co-founder of Lighthouse</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Button className="bg-gray-900 hover:bg-black  rounded-[1px] text-white">
                  Accept Match
                </Button>
                <Button variant="outline" className="border-gray-300 text-gray-700  rounded-[1px] hover:text-gray-900">
                  Decline
                </Button>
              </div>
            </div>

            {/* Why this match matters */}
            <div className="mb-6 border-b border-gray-200 pb-6">
              <h3 className="font-medium text-gray-700 mb-3">Why this match matters</h3>
              <p className="text-gray-700">
                Both share a strong focus on advancing privacy-preserving AI technologies, suggesting a natural alignment in values and vision. Notably, your research has been cited in Arya's work, which highlights an already established intellectual connection and mutual recognition within the academic and technical communities. This foundation could serve as a meaningful basis for further collaboration or shared exploration.
              </p>
            </div>

            {/* Who's backing this match */}
            <div>
              <h3 className="font-medium text-gray-700 mb-4">Who's backing this match</h3>
              <div className="flex flex-wrap gap-2">
                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                  <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Image src="/avatars/agents/privado.svg" alt="ProofLayer" width={16} height={16} />
                  </div>
                  <span className="font-medium text-gray-900">ProofLayer</span>
                  <span className="text-gray-500 text-sm">Due Diligence Agent</span>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                  <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Image src="/avatars/agents/reputex.svg" alt="Threshold" width={16} height={16} />
                  </div>
                  <span className="font-medium text-gray-900">Threshold</span>
                  <span className="text-gray-500 text-sm">Network Manager Agent</span>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                  <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Image src="/avatars/agents/hapi.svg" alt="Aspecta" width={16} height={16} />
                  </div>
                  <span className="font-medium text-gray-900">Aspecta</span>
                  <span className="text-gray-500 text-sm">Reputation Agent</span>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                  <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Image src="/avatars/agents/trusta.svg" alt="Semantic Relevancy" width={16} height={16} />
                  </div>
                  <span className="font-medium text-gray-900">Semantic Relevancy</span>
                  <span className="text-gray-500 text-sm">Relevancy Agent</span>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                  <span className="text-gray-600">+3</span>
                </div>
              </div>
            </div>
          </div>

          {/* Second Match */}
          <div className="bg-white border border-black border-b-0 border-b-2 p-6">
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-4">
                <Image
                  src="/avatars/agents/reclaim.svg"
                  alt="Arya Mehta"
                  width={48}
                  height={48}
                  className="rounded-full"
                />
                <div>
                  <h2 className="text-lg font-medium text-gray-900">Arya Mehta</h2>
                  <p className="text-sm text-gray-600">Co-founder of Lighthouse</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Button className="bg-gray-900 hover:bg-black  rounded-[1px] text-white">
                  Accept Match
                </Button>
                <Button variant="outline" className="border-gray-300 text-gray-700  rounded-[1px] hover:text-gray-900">
                  Decline
                </Button>
              </div>
            </div>

            {/* Why this match matters */}
            <div className="mb-6 border-b border-gray-200 pb-6">
              <h3 className="font-medium text-gray-700 mb-3">Why this match matters</h3>
              <p className="text-gray-700">
                Both share a strong focus on advancing privacy-preserving AI technologies, suggesting a natural alignment in values and vision. Notably, your research has been cited in Arya's work, which highlights an already established intellectual connection and mutual recognition within the academic and technical communities. This foundation could serve as a meaningful basis for further collaboration or shared exploration.
              </p>
            </div>

            {/* Who's backing this match */}
            <div>
              <h3 className="font-medium text-gray-700 mb-4">Who's backing this match</h3>
              <div className="flex flex-wrap gap-2">
                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                  <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Image src="/avatars/agents/privado.svg" alt="ProofLayer" width={16} height={16} />
                  </div>
                  <span className="font-medium text-gray-900">ProofLayer</span>
                  <span className="text-gray-500 text-sm">Due Diligence Agent</span>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                  <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Image src="/avatars/agents/reputex.svg" alt="Threshold" width={16} height={16} />
                  </div>
                  <span className="font-medium text-gray-900">Threshold</span>
                  <span className="text-gray-500 text-sm">Network Manager Agent</span>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                  <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Image src="/avatars/agents/hapi.svg" alt="Aspecta" width={16} height={16} />
                  </div>
                  <span className="font-medium text-gray-900">Aspecta</span>
                  <span className="text-gray-500 text-sm">Reputation Agent</span>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                  <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Image src="/avatars/agents/trusta.svg" alt="Semantic Relevancy" width={16} height={16} />
                  </div>
                  <span className="font-medium text-gray-900">Semantic Relevancy</span>
                  <span className="text-gray-500 text-sm">Relevancy Agent</span>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                  <span className="text-gray-600">+3</span>
                </div>
              </div>
            </div>
          </div>
        </div>
          </div>
      </div>

    </div>
  );
} 