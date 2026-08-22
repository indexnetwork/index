import { createContactTools } from "../internal/contacts/contact.tools.js";
import type { ContactToolDeps } from "../internal/contacts/contact.tools.port.js";
import type { DefineTool } from "../internal/shared/agent/tool.helpers.js";

/** Executable contact capability: registers the contact-management tool set. */
export class Contacts {
  public static createTools(defineTool: DefineTool, deps: ContactToolDeps) {
    return createContactTools(defineTool, deps);
  }
}
