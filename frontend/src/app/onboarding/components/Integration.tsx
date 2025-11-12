"use client";

import React from "react";
import Image from "next/image";
import { IntegrationState } from "@/types/onboarding";

interface IntegrationProps {
  integration: IntegrationState;
  integrationsLoaded: boolean;
  pendingIntegration: string | null;
  onToggle: (type: string) => void;
}

export default function Integration({
  integration,
  integrationsLoaded,
  pendingIntegration,
  onToggle,
}: IntegrationProps) {
  return (
    <div
      className="border border-b-2 border-[#000] p-4 bg-white"
    >
      <div className="flex items-center justify-between mb-0">
        <div className="flex items-center gap-3">
          <Image
            src={`/integrations/${integration.type}.png?3`}
            width={24}
            height={24}
            alt={integration.name}
          />
          <span className="font-small text-black font-ibm-plex-mono text-[14px]">
            {integration.name}
          </span>
        </div>
        {!integrationsLoaded ? (
          // Show loading placeholder for toggle only
          <div className="w-11 h-6 bg-[#F5F5F5] rounded-full animate-pulse" />
        ) : (
          <button
            onClick={() => onToggle(integration.type)}
            disabled={pendingIntegration === integration.type}
            className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${
              integration.connected ? 'bg-[#006D4B]' : 'bg-[#D9D9D9]'
            } ${pendingIntegration === integration.type ? 'opacity-70' : ''}`}
          >
            <span
              className={`absolute top-[1px] left-[1px] h-[22px] w-[22px] rounded-full bg-white transition-transform duration-200 shadow-sm ${
                integration.connected ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
            {pendingIntegration === integration.type && (
              <span className="absolute inset-0 grid place-items-center">
              <span
                className={`h-3 w-3 border-2 border-white/70 border-t-transparent rounded-full animate-spin`}
                style={{
                  marginLeft: integration.connected ? "-20px" : "20px"
                }}
              />
            </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
