/**
 * Contact command handlers for the Index CLI.
 * Implements: list and remove subcommands.
 */
import type { ApiClient } from "./api.client";
import * as output from "./output";

const CONTACT_HELP = `
Usage:
  index contact list             List your contacts
  index contact remove <email>   Remove a contact
`;

/**
 * Route a contact subcommand to the appropriate handler.
 *
 * @param client - Authenticated API client.
 * @param subcommand - The subcommand (list, remove).
 * @param positionals - Positional arguments after the subcommand.
 * @param options - Additional options (json).
 */
export async function handleContact(
  client: ApiClient,
  subcommand: string | undefined,
  positionals: string[],
  options: { json?: boolean },
): Promise<void> {
  if (!subcommand) {
    if (options.json) {
      console.log(JSON.stringify({ error: "No subcommand provided" }));
    } else {
      console.log(CONTACT_HELP);
    }
    return;
  }

  switch (subcommand) {
    case "list": {
      const result = await client.callTool("list_contacts", {});
      if (options.json) { console.log(JSON.stringify(result)); return; }
      if (!result.success) { output.error(result.error ?? "Failed to list contacts", 1); return; }
      const data = result.data as { count: number; contacts: Array<{ userId: string; name: string; email: string }> };
      output.heading("Contacts");
      output.contactTable(data.contacts);
      output.dim(`\n  ${data.count} contact${data.count !== 1 ? "s" : ""}`);
      console.log();
      return;
    }
    case "remove": {
      const email = positionals[0];
      if (!email) { output.error("Missing email. Usage: index contact remove <email>", 1); return; }
      // Resolve email -> userId via list_contacts
      const listResult = await client.callTool("list_contacts", {});
      if (!listResult.success) { output.error("Failed to resolve contact", 1); return; }
      const contacts = (listResult.data as { contacts: Array<{ userId: string; email: string }> }).contacts;
      const match = contacts.find((c) => c.email.toLowerCase() === email.toLowerCase());
      if (!match) { output.error(`No contact found with email: ${email}`, 1); return; }
      const result = await client.callTool("remove_contact", { contactUserId: match.userId });
      if (options.json) { console.log(JSON.stringify(result)); return; }
      if (!result.success) { output.error(result.error ?? "Failed to remove contact", 1); return; }
      output.success(`Removed ${email} from contacts.`);
      return;
    }
    default: {
      if (options.json) {
        console.log(JSON.stringify({ error: `Unknown subcommand: ${subcommand}` }));
      } else {
        output.error(`Unknown subcommand: ${subcommand}`);
        console.log(CONTACT_HELP);
      }
      return;
    }
  }
}
