/**
 * Profile command handlers for the Index CLI.
 *
 * Implements: (default), show, sync subcommands.
 */

import type { ApiClient } from "./api.client";
import * as output from "./output";

/**
 * Route a profile subcommand to the appropriate handler.
 */
export async function handleProfile(
  client: ApiClient,
  subcommand: string | undefined,
  positionals: string[],
  options: { json?: boolean; name?: string; intro?: string; location?: string; socials?: { label: string; value: string }[] } = {},
): Promise<void> {
  if (subcommand === "update") {
    const { name, intro, location, socials } = options;
    if (name === undefined && intro === undefined && location === undefined && socials === undefined) {
      throw new Error("Usage: index profile update [--name <text>] [--intro <text>] [--location <text>] [--social label=value]");
    }
    const user = await client.updateProfile({ name, intro, location, socials });
    if (options.json) console.log(JSON.stringify(user));
    else output.success("Profile updated.");
    return;
  }
  if (subcommand === "create" || subcommand === "search") {
    output.error(
      `profile ${subcommand} is not available; use "index profile sync" for public research prefill`,
      1,
    );
    return;
  }

  if (subcommand === "sync") {
    await profileSync(client, options?.json);
    return;
  }

  if (subcommand === "show") {
    const userId = positionals[0];
    if (!userId) {
      output.error("Usage: index profile show <user-id>", 1);
      return;
    }
    await profileShow(client, userId, options?.json);
    return;
  }

  // Default: show own profile
  await profileMe(client, options?.json);
}

async function profileMe(client: ApiClient, json?: boolean): Promise<void> {
  if (!json) {
    output.info("Loading your profile...");
  }
  const me = await client.getMe();
  const user = await client.getUser(me.id);
  if (json) {
    console.log(JSON.stringify(user));
    return;
  }
  output.profileCard(user);
}

async function profileShow(client: ApiClient, userId: string, json?: boolean): Promise<void> {
  if (!json) {
    output.info("Loading profile...");
  }
  const user = await client.getUser(userId);
  if (json) {
    console.log(JSON.stringify(user));
    return;
  }
  output.profileCard(user);
}

/** Trigger synchronous public profile research for the authenticated user. */
async function profileSync(client: ApiClient, json?: boolean): Promise<void> {
  if (!json) output.info("Enriching profile...");
  const result = await client.enrichProfile();
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  output.success("Profile enriched.");
  if (result.profile?.name) output.dim(`  Name: ${result.profile.name}`);
  if (result.profile?.location) output.dim(`  Location: ${result.profile.location}`);
  output.dim(`  Social links: ${result.profile?.socials?.length ?? 0}`);
}
