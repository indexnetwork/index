import { log } from './log';
import Parallel from 'parallel-web';

const PARALLELS_API_KEY = process.env.PARALLELS_API_KEY || '';

// Initialize Parallel client
const parallelClient = new Parallel({
  apiKey: PARALLELS_API_KEY,
});

interface ParallelsExtractResponse {
  data?: Array<{
    url: string;
    content?: string;
    excerpt?: string;
  }>;
  error?: string;
}

interface ParallelsTaskResponse {
  output?: {
    content?: {
      intro?: string;
      location?: string;
    };
    intro?: string;
    location?: string;
  };
  error?: string;
}

export async function extractUrlContent(url: string): Promise<string | null> {
  if (!PARALLELS_API_KEY) {
    throw new Error('PARALLELS_API_KEY not configured');
  }

  try {
    log.info('Extracting URL content', { url });
    
    const extract = await parallelClient.beta.extract({
      urls: [url],
      excerpts: true,
      full_content: false,
    });
    
    log.info('Parallel extract response received', { url, resultsCount: extract.results?.length || 0 });
    
    if (extract.results && extract.results.length > 0) {
      const result = extract.results[0];
      // Access content from result - check common property names
      const content = (result as any).content || (result as any).excerpts?.[0] || (result as any).excerpt || (result as any).markdown || null;
      log.info('Extracted content', { url, contentLength: content?.length || 0, resultKeys: Object.keys(result) });
      return content;
    }

    log.warn('No results in extract response', { url, extract });
    return null;
  } catch (error) {
    const errorDetails = error instanceof Error ? {
      message: error.message,
      name: error.name,
      stack: error.stack,
    } : { error };
    log.error('Failed to extract URL content', { url, error: errorDetails });
    return null;
  }
}

export interface GenerateIntroInput {
  email?: string;
  linkedin?: string;
  twitter?: string;
  name?: string;
}

export interface GenerateIntroOutput {
  intro: string;
  location: string;
}

export async function generateIntro(input: GenerateIntroInput): Promise<GenerateIntroOutput | null> {
  if (!PARALLELS_API_KEY) {
    throw new Error('PARALLELS_API_KEY not configured');
  }

  try {
    // Map input to match schema (linkedin_profile, twitter_profile)
    // Only include fields that have values
    const mappedInput: Record<string, string> = {};
    
    if (input.email?.trim()) {
      mappedInput.email = input.email.trim();
    }
    
    if (input.linkedin?.trim()) {
      mappedInput.linkedin_profile = input.linkedin.trim();
    }
    
    if (input.twitter?.trim()) {
      mappedInput.twitter_profile = input.twitter.trim();
    }
    
    if (input.name?.trim()) {
      mappedInput.name = input.name.trim();
    }
    
    // Ensure at least one field is provided
    if (Object.keys(mappedInput).length === 0) {
      log.error('No valid fields provided to generateIntro', { input, mappedInput });
      return null;
    }

    // Ensure all values are strings (not undefined/null)
    const cleanedInput: Record<string, string> = {};
    for (const [key, value] of Object.entries(mappedInput)) {
      if (value && typeof value === 'string' && value.trim()) {
        cleanedInput[key] = value.trim();
      }
    }
    
    if (Object.keys(cleanedInput).length === 0) {
      log.error('Cleaned input is empty after filtering', { mappedInput });
      return null;
    }
    
    log.info('Calling Parallels task API', { 
      fieldCount: Object.keys(cleanedInput).length, 
      fields: Object.keys(cleanedInput),
      cleanedInput
    });

    // Use the official Parallel SDK
    const taskRun = await parallelClient.taskRun.create({
      input: cleanedInput,
      processor: 'base',
      task_spec: {
        input_schema: {
          json_schema: {
            properties: {
              email: {
                description: 'The email address of the person.',
                type: 'string',
              },
              linkedin_profile: {
                description: 'The LinkedIn profile URL of the person.',
                type: 'string',
              },
              name: {
                description: 'The full name of the person.',
                type: 'string',
              },
              twitter_profile: {
                description: 'The Twitter profile URL of the person.',
                type: 'string',
              },
            },
            type: 'object',
          },
          type: 'json',
        },
        output_schema: {
          json_schema: {
            additionalProperties: false,
            properties: {
              intro: {
                description: `A short introduction in a clear, warm, lightly playful style, following the tone and structure demonstrated in the few-shot examples below.

Requirements:
- no first-person  
- no third-person  
- no “I / me / my” or “he / she / they / name”  
- upbeat but not cheesy  
- clean, human, lightly happy  
- 2–4 sentences  
- 45–90 words  
- focuses on origins/background → areas of work → interests → current focus  
- no emojis  
- no hype  
- no bullet points in the **output intro**  
- output only the intro, nothing else  

Style Targets:
- light warmth  
- reflective, curious tone  
- slightly playful but still professional  
- introduction written about someone without referring to them directly  

Few-Shot Examples

**Example 1**  
Rooted in curiosity for how people organize, with a background in systems research and community tooling. Drawn to cooperative structures, lightweight governance, and the quiet signals that help groups understand each other. Currently exploring neighborhood-scale coordination with an open, hopeful spirit.

**Example 2**  
Shaped by years in distributed systems and cryptography, with work spanning secure tools and open communities. Interests orbit around privacy, identity, and trust in messy, real-world environments. Now experimenting with intent-sharing models that protect the humans behind the data while keeping collaboration joyful.

**Example 3**  
Blends storytelling, design, and community education into a single thread focused on helping groups express what matters. Energized by participatory processes and narrative-driven decision-making. Currently developing tools that nurture shared meaning and healthier digital spaces.

**Example 4**  
Starting from mathematics and machine learning research, with a growing fascination for small agent ecosystems and emergent behavior. Passion lies in understanding how attention, incentives, and coordination shape complex networks. Now exploring playful experiments where autonomous agents learn from each other in constrained environments.

**Example 5**  
Grounded in civic tech and cooperative product design, with experience building tools that support collective action. Drawn to long-term trust, resource pooling, and structures that let communities govern themselves. Focus now rests on models for shared digital stewardship and smoother group coordination.

Derived from available information such as name, email, LinkedIn profile, and Twitter profile. If insufficient information is available to generate a meaningful intro, return 'Intro unavailable'.`,
                type: 'string',
              },
              location: {
                description: 'The primary geographical location (city, state, or country) associated with the individual, inferred from available information such as their name, email, LinkedIn profile, and Twitter profile. If a specific location cannot be determined, return \'Location unavailable\'.',
                type: 'string',
              },
            },
            required: ['intro', 'location'],
            type: 'object',
          },
          type: 'json',
        },
      },
    });

    log.info('Task created', { runId: taskRun.run_id });

    // Poll for result using the SDK's built-in method
    const runResult = await parallelClient.taskRun.result(taskRun.run_id, {
      timeout: 3600, // 1 hour timeout
    });

    log.info('Task completed', { runId: taskRun.run_id, hasOutput: !!runResult.output, output: runResult.output });

    if (runResult.output) {
      const output = runResult.output as any;
      // Handle nested content structure (output.content.intro, output.content.location)
      const content = output.content || output;
      
      return {
        intro: content.intro || content.bio || 'Intro unavailable',
        location: content.location || 'Location unavailable',
      };
    }

    log.warn('No output in result', { runResult });
    return null;
  } catch (error) {
    log.error('Failed to generate intro', { error: (error as Error).message });
    return null;
  }
}

