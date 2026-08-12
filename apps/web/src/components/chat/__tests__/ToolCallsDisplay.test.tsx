import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TraceEvent } from "@/contexts/AIChatContext";

import { ToolCallsDisplay } from "../ToolCallsDisplay";

const PROFILE_TOOL_LABELS = [
  ["read_user_contexts", "Read profile", "Reading your profile..."],
  ["create_user_context", "Create profile", "Creating your profile..."],
  ["update_user_context", "Update profile", "Updating your profile..."],
] as const;

function toolEvents(name: string, complete: boolean): TraceEvent[] {
  const events: TraceEvent[] = [{ type: "tool_start", name, timestamp: Date.now() }];
  if (complete) {
    events.push({ type: "tool_end", name, status: "success", timestamp: Date.now() + 10 });
  }
  return events;
}

describe("ToolCallsDisplay profile labels", () => {
  for (const [name, action, running] of PROFILE_TOOL_LABELS) {
    it(`uses the friendly profile label for ${name}`, () => {
      const { rerender } = render(<ToolCallsDisplay traceEvents={toolEvents(name, false)} />);
      expect(screen.getByText(running)).toBeInTheDocument();

      rerender(<ToolCallsDisplay traceEvents={toolEvents(name, true)} />);
      expect(screen.getByText(action)).toBeInTheDocument();
    });
  }
});
