import type { ApiClient } from "./api.client";

/** Explicitly confirm the profile or complete onboarding using server prerequisites. */
export async function handleOnboarding(client: ApiClient, subcommand: string | undefined, options?: { json?: boolean; intentId?: string }): Promise<void> {
  let result: unknown;
  if (subcommand === "confirm-profile") result = await client.confirmProfile();
  else if (subcommand === "complete") result = await client.completeOnboarding(options?.intentId);
  else throw new Error("Usage: index onboarding confirm-profile | complete [--intent-id <id>]");
  console.log(JSON.stringify(result, null, options?.json ? undefined : 2));
}
