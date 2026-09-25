import type { ApiClient } from "./api.client";
import * as output from "./output";

/** Explicitly confirm the profile or complete onboarding using server prerequisites. */
export async function handleOnboarding(client: ApiClient, subcommand: string | undefined, options?: { json?: boolean; intentId?: string }): Promise<void> {
  if (subcommand === "confirm-profile") {
    const result = await client.confirmProfile();
    if (options?.json) { console.log(JSON.stringify(result)); return; }
    output.success("Profile confirmed.");
  } else if (subcommand === "complete") {
    const result = await client.completeOnboarding(options?.intentId);
    if (options?.json) { console.log(JSON.stringify(result)); return; }
    output.success(`Onboarding complete (first intent ${result.intentId}).`);
  } else {
    throw new Error("Usage: index onboarding confirm-profile | complete [--intent-id <id>]");
  }
}
