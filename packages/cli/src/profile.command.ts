/**
 * Profile command handlers for the Index CLI.
 *
 * Implements: (default), show, sync, create, update subcommands.
 * Follows the same handleX(client, subcommand, positionals, options)
 * pattern as network.command.ts and conversation.command.ts.
 */

import type { ApiClient } from "./api.client";
import * as output from "./output";

const _PROFILE_HELP = `
Usage:
  index profile                                   Show your profile
  index profile show <user-id>                    Show another user's profile
  index profile sync                              Regenerate your profile
  index profile search <query>                    Search user profiles
  index profile create [--linkedin <url>] [--github <url>] [--twitter <url>]
                                                  Create your profile from social URLs
  index profile update <action> [--details <text>]
                                                  Update your profile
`;

/**
 * Route a profile subcommand to the appropriate handler.
 *
 * @param client - Authenticated API client.
 * @param subcommand - The subcommand (show, sync, create, update, or undefined for self).
 * @param positionals - Positional arguments after the subcommand.
 * @param options - Additional options (json, linkedin, github, twitter).
 */
export async function handleProfile(
  client: ApiClient,
  subcommand: string | undefined,
  positionals: string[],
  options: { json?: boolean; linkedin?: string; github?: string; twitter?: string; details?: string } = {},
): Promise<void> {
  if (subcommand === "create") {
    await profileCreate(client, options, options?.json);
    return;
  }

  if (subcommand === "update") {
    const action = positionals.join(" ");
    if (!action) {
      output.error("Usage: index profile update <action> [--details <text>]", 1);
      return;
    }
    await profileUpdate(client, action, options.details, options?.json);
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

  if (subcommand === "search") {
    const query = positionals.join(" ");
    if (!query) { output.error("Usage: index profile search <query>", 1); return; }
    const result = await client.callTool("read_user_profiles", { query });
    if (options.json) { console.log(JSON.stringify(result)); return; }
    if (!result.success) { output.error(result.error ?? "Search failed", 1); return; }
    const data = result.data as { profiles: Array<{ userId: string; name: string; profile?: { bio: string } }> };
    output.heading("Search Results");
    if (!data.profiles?.length) {
      output.dim("  No profiles found.");
    } else {
      for (const p of data.profiles) {
        console.log(`  ${p.name} (${p.userId.slice(0, 8)})`);
        if (p.profile?.bio) output.dim(`    ${p.profile.bio.slice(0, 100)}`);
      }
    }
    console.log();
    return;
  }

  // Default: show own profile
  await profileMe(client, options?.json);
}

/**
 * Show the authenticated user's own profile.
 */
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

/**
 * Show another user's profile by ID.
 */
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

/**
 * Trigger profile regeneration for the authenticated user.
 *
 * Checks whether a profile exists via `read_user_profiles`, then calls
 * `create_user_profile` or `update_user_profile` accordingly.
 */
async function profileSync(client: ApiClient, json?: boolean): Promise<void> {
  if (!json) output.info("Regenerating profile...");
  // Check if profile exists
  const check = await client.callTool("read_user_profiles", {});
  if (!check.success) {
    if (json) { console.log(JSON.stringify(check)); return; }
    output.error(check.error ?? "Failed to check profile status", 1);
    return;
  }
  const hasProfile = (check.data as Record<string, unknown>)?.hasProfile;

  let result;
  if (hasProfile) {
    result = await client.callTool("update_user_profile", { action: "regenerate" });
  } else {
    result = await client.callTool("create_user_profile", { confirm: true });
  }

  if (json) { console.log(JSON.stringify(result)); return; }
  if (!result.success) { output.error(result.error ?? "Profile regeneration failed", 1); return; }
  output.success("Profile regeneration triggered. It may take a moment to complete.");
}

/**
 * Create a user profile from social URLs.
 *
 * @param client - Authenticated API client.
 * @param options - Social URL options (linkedin, github, twitter).
 */
async function profileCreate(
  client: ApiClient,
  options: { linkedin?: string; github?: string; twitter?: string },
  json?: boolean,
): Promise<void> {
  if (!json) output.info("Creating profile...");
  const query: Record<string, unknown> = { confirm: true };
  if (options.linkedin) query.linkedinUrl = options.linkedin;
  if (options.github) query.githubUrl = options.github;
  if (options.twitter) query.twitterUrl = options.twitter;

  const result = await client.callTool("create_user_profile", query);
  if (json) { console.log(JSON.stringify(result)); return; }
  if (!result.success) {
    output.error(result.error ?? "Profile creation failed", 1);
    return;
  }
  output.success("Profile created.");
}

/**
 * Update the user's profile with a natural-language action.
 *
 * @param client - Authenticated API client.
 * @param action - The update action description.
 * @param details - Optional additional details.
 */
async function profileUpdate(
  client: ApiClient,
  action: string,
  details?: string,
  json?: boolean,
): Promise<void> {
  if (!json) output.info("Updating profile...");
  const query: Record<string, unknown> = { action };
  if (details) query.details = details;

  const result = await client.callTool("update_user_profile", query);
  if (json) { console.log(JSON.stringify(result)); return; }
  if (!result.success) {
    output.error(result.error ?? "Profile update failed", 1);
    return;
  }
  output.success("Profile updated.");
}
