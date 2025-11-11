"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Index as IndexType } from "@/lib/types";

interface IndexCardProps {
  index: IndexType & { isMember?: boolean };
  isJoined: boolean;
  isJoining: boolean;
  onToggleJoin: (index: IndexType) => void;
}

export default function Index({
  index,
  isJoined,
  isJoining,
  onToggleJoin,
}: IndexCardProps) {
  return (
    <div className="border border-[#E0E0E0] rounded-lg p-6 bg-white">
      <div className="text-center">
        <h3 className="text-lg font-bold text-black mb-2 font-ibm-plex-mono">{index.title}</h3>
        <p className="text-xs text-[#888] mb-4 font-ibm-plex-mono">
          {index._count.members.toLocaleString()} members
        </p>
        <Button
          variant={isJoined ? "default" : "outline"}
          onClick={() => onToggleJoin(index)}
          disabled={isJoined || isJoining}
          className={`w-full font-ibm-plex-mono ${
            isJoined
              ? 'bg-[#006D4B] text-white hover:bg-[#005A3E]'
              : 'border-[#E0E0E0] text-black hover:bg-[#F0F0F0]'
          }`}
        >
          {isJoining ? (
            <>
              <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2 inline-block" />
              Joining...
            </>
          ) : isJoined ? (
            'Joined'
          ) : (
            'Join'
          )}
        </Button>
      </div>
    </div>
  );
}
