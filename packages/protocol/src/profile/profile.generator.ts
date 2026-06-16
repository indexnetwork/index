import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import { createModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

const logger = protocolLogger("ProfileGenerator");

const systemPrompt = `
    You are an expert profiler. Your task is to synthesize a structured User Profile from raw data or user requests.

    When given EXISTING PROFILE + USER REQUEST: Apply the request to the existing profile. Add, update, or remove skills and interests as the user asks. Preserve everything else. Output the full updated profile.

    When given raw data only: Infer name, bio, location, narrative.context, and extract skills and interests.

    PRIVACY: identity.bio and narrative.context are public-facing. Never include email addresses, phone numbers, physical addresses, government IDs, or other contact identifiers — even if they appear in the raw data. Describe the person professionally; do not embed ways to contact them.
`;

const responseFormat = z.object({
  identity: z.object({
    name: z.string().describe("The user's full name"),
    bio: z.string().describe("Professional summary (2-3 sentences) only; no email, phone, physical address, government ID, or other contact identifiers"),
    location: z.string().describe("Inferred location (City, Country) or 'Remote'"),
  }),
  narrative: z.object({
    context: z.string().describe("Rich narrative without email, phone, physical address, government ID, or other contact identifiers"),
  }),
  attributes: z.object({
    interests: z.array(z.string()).describe("Inferred or explicit interests"),
    skills: z.array(z.string()).describe("Professional skills"),
  }),
});

type Profile = z.infer<typeof responseFormat>;
export type ProfileDocument = Profile & { userId: string };

export class ProfileGenerator {
  private static baseModel: ReturnType<typeof createModel> | undefined;
  private model: { invoke(input: unknown, config?: { signal?: AbortSignal }): Promise<unknown> };

  constructor() {
    const baseModel = ProfileGenerator.baseModel ??= createModel("profileGenerator");
    this.model = baseModel.withStructuredOutput(responseFormat, {
      name: "profile_generator"
    });
  }

  private toString(profile: Profile): string {
    return [
      '# Identity',
      '## Name', profile.identity.name,
      '## Bio', profile.identity.bio,
      '## Location', profile.identity.location,
      '# Narrative',
      '## Context', profile.narrative.context,
      '# Attributes',
      '## Interests', profile.attributes.interests.join(', '),
      '## Skills', profile.attributes.skills.join(', ')
    ].join('\n');
  }

  @Timed()
  public async invoke(input: string) {
    logger.verbose("Received input", { inputLength: input?.length });
    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(`Here is the raw data:\n${input}`)
    ];
    const result = await invokeWithAbortSignal(this.model, messages);
    const output = responseFormat.parse(result);
    const textToEmbed = this.toString(output);
    logger.verbose("Generated profile", {
      skillsCount: output.attributes.skills.length,
      interestsCount: output.attributes.interests.length
    });
    return { output, textToEmbed };
  }

  public static asTool() {
    return tool(
      async (args: { input: string }) => {
        const profileGenerator = new ProfileGenerator();
        return await profileGenerator.invoke(args.input);
      },
      {
        name: 'profileGenerator',
        description: 'Profile Generator',
        schema: z.object({
          input: z.string().describe('Raw data scraped from the web (via Parallel.ai)'),
        })
      }
    );
  }
}