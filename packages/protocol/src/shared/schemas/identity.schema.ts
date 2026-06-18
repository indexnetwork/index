/**
 * UserIdentity DTO — pure Zod schema and inferred type.
 * Shared contract for the database/interface layer.
 *
 * A user is represented by their `users` identity row + `user_contexts`; there
 * is no separate "profile" entity. `identity` carries the thin name/bio/location
 * fields sourced from `users`, and `context` carries the synthesized identity
 * paragraph (the global `user_context` text).
 */
import { z } from "zod";

export const UserIdentitySchema = z.object({
  userId: z.string().optional(),
  identity: z.object({
    name: z.string(),
    bio: z.string(),
    location: z.string(),
  }),
  context: z.string(),
});

export type UserIdentity = z.infer<typeof UserIdentitySchema>;
