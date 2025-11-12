"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { OnboardingMember } from "@/lib/onboardingTypes";

interface MemberInvitationSectionProps {
  wasSummaryLoaded: boolean;
  displayMembers: OnboardingMember[];
  displayTotalIntents: number;
  handleInviteMembers: (method: "automatic" | "link") => void;
}

export default function MemberInvitationSection({
  wasSummaryLoaded,
  displayMembers,
  displayTotalIntents,
  handleInviteMembers,
}: MemberInvitationSectionProps) {
  if (!wasSummaryLoaded) {
    return (
      <div className="mt-4 mb-4">
        {/* Loading state */}
        <div className="flex items-center gap-3 mb-3">
          <div className="h-5 bg-[#F5F5F5] rounded animate-pulse w-64"></div>
        </div>
      </div>
    );
  }

  if (!displayMembers.length) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center pb-8">
        <p className="text-black text-[14px] font-ibm-plex-mono mt-4">
          We're still processing your connected sources to generate your
          intents and find potential members. This usually takes a few
          minutes. Check back later to see your results.
        </p>
        <Image
          className="h-auto"
          src={"/loading2.gif"}
          alt="Loading..."
          width={300}
          height={200}
          style={{
            mixBlendMode: "multiply",
            imageRendering: "auto",
          }}
        />
      </div>
    );
  }
  
  
  return (
    <div className="mt-6 mb-12">
      <div className="mt-4">
        {/* Show member info when there are multiple members and intents */}
        <div>
          <span className="text-black text-[14px] font-ibm-plex-mono">
            We found{" "}
            {displayMembers.slice(0, 3).map((member, index) => (
              <span key={member.id}>
                <strong>{member.name}</strong>
                {index < Math.min(3, displayMembers.length) - 1 &&
                index < 2
                  ? ", "
                  : ""}
              </span>
            ))}
            {displayMembers.length > 3 && (
              <span>
                {" "}
                and{" "}
                <strong>{displayMembers.length - 3} more members</strong>
              </span>
            )}{" "}
            sharing{" "}
            <strong>{displayTotalIntents.toLocaleString()}</strong>{" "}
            intents.
          </span>
        </div>
        <p className="text-black text-[14px] font-ibm-plex-mono mb-4 mt-4">
          Now, invite them to add their intents! The more intents people
          share, the easier it becomes to discover each other and connect
          at the right moment.
        </p>

        <div className="flex gap-3">
          <Button
            onClick={() => {
              handleInviteMembers("automatic");
            }}
            className="bg-[#1976D2] text-white hover:bg-[#1565C0] font-ibm-plex-mono"
          >
            Invite Automatically
          </Button>
          <Button
            onClick={() => {
              handleInviteMembers("link");
            }}
            variant="outline"
            className="font-ibm-plex-mono"
          >
            Copy invite link
          </Button>
        </div>
      </div>
    </div>
  );
}
