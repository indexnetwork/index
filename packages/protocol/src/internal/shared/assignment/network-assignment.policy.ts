import type { NetworkAssignmentMetadata, NetworkAssignmentResourceType } from "../../../protocol/schemas/network-assignment.schema.js";

export interface ManualAssignmentArgs {
  resourceType: NetworkAssignmentResourceType;
  /** Provenance tag recorded on the row, e.g. `intent-create`. */
  source: string;
  createdAt?: string;
  reason?: string;
}

export interface NetworkAssignmentDecision {
  finalScore: number;
  metadata: NetworkAssignmentMetadata;
}

/**
 * Builds the row-level metadata for a network assignment.
 *
 * Every assignment is a deliberate act by the resource's owner — nothing is
 * scored or thresholded — so the score is always 1 and the recorded mode is
 * always `manual_override`.
 *
 * @param args - Resource type and provenance for the assignment.
 * @returns The score and explainability metadata to persist.
 */
export function buildManualAssignmentMetadata(args: ManualAssignmentArgs): NetworkAssignmentDecision {
  return {
    finalScore: 1,
    metadata: {
      resourceType: args.resourceType,
      mode: "manual_override",
      scope: "network",
      policy: "unified-threshold-v1",
      threshold: 0,
      promptPresence: "none",
      finalScore: 1,
      assigned: true,
      reason: args.reason ?? "Assigned explicitly by the owner.",
      ...(args.source ? { source: args.source } : {}),
      ...(args.createdAt ? { createdAt: args.createdAt } : {}),
    },
  };
}
