/**
 * ProfileDocument DTO — pure Zod schema and inferred type.
 * Shared contract for the database/interface layer.
 * The LLM-facing Zod schema with .describe() annotations lives in
 * profile/profile.generator.ts alongside the generator itself.
 */
import { z } from "zod";

export const ProfileIdentitySchema = z.object({
  name: z.string(),
  bio: z.string(),
  location: z.string(),
});

export const ProfileNarrativeSchema = z.object({
  context: z.string(),
});

export const ProfileAttributesSchema = z.object({
  interests: z.array(z.string()),
  skills: z.array(z.string()),
});

export const ProfileDocumentSchema = z.object({
  userId: z.string(),
  identity: ProfileIdentitySchema,
  narrative: ProfileNarrativeSchema,
  attributes: ProfileAttributesSchema,
});

export type ProfileDocument = z.infer<typeof ProfileDocumentSchema>;