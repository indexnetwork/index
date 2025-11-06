/**
 * Intent Inferrer Agent
 * 
 * Minimal, dynamic implementation that extracts explicit and implicit intents.
 */

import { UnstructuredClient } from "unstructured-client";
import { traceableStructuredLlm } from "../../../lib/agents";
import { isFileExtensionSupported } from "../../../lib/uploads.config";
import { loadFilesInParallel } from "../../../lib/uploads";
import * as fs from 'fs';
import path from 'path';
import { z } from "zod";

// Type definitions
export interface Intent {
  intent: string;
  type: 'explicit' | 'implicit';
  confidence: number;
}

export interface InferredIntent {
  payload: string;
  confidence: number;
  type: 'explicit' | 'implicit';
}

export interface IntentInferenceResult {
  success: boolean;
  intents: InferredIntent[];
}

// Lazy initialization for unstructured client
let unstructuredClient: UnstructuredClient | null = null;

function getUnstructuredClient(): UnstructuredClient | null {
  if (!process.env.UNSTRUCTURED_API_URL) return null;
  if (!unstructuredClient) {
    unstructuredClient = new UnstructuredClient({
      serverURL: process.env.UNSTRUCTURED_API_URL
    });
  }
  return unstructuredClient;
}

// Minimal Intent Inferrer Prompt
const SYSTEM_PROMPT = `You extract social intents from content.

Rules:
1. Intents must be substantial and meaningful, not procedural calls-to-action
2. Remove temporal markers ("Now", "Currently", "Just") - focus on the actual intent
3. Skip generic instructions ("fill out form", "apply here", "contact us", "pass it along")
4. Combine related technical requirements into cohesive intents, not fragmented lists
5. Forward-looking (what they seek/offer), not backward-looking (what they've done)
6. Intents MUST be self-contained with enough context to be understood independently
7. Add relevant context from surrounding content to make intents substantial

EXPLICIT (directly stated) → preserve core statement but add relevant context to make it self-contained

IMPLICIT (inferred) → express through topic/direction in source tone, not as role-seeking

Examples:

Content: "Looking for Rust devs. Been thinking about privacy-preserving computation."

✅ "Looking for Rust devs to work on privacy-preserving computation" (explicit, self-contained)

✅ "Thinking about privacy-preserving computation" (implicit)

❌ "Looking for Rust devs" (too short, not self-contained)

❌ "Seeking collaborators in privacy tech" (constructed role)

Content: "PhD on climate models. The question is making them accessible to smaller groups."

✅ "Figuring out how to make climate models accessible" (implicit, in source tone)

✅ "Working on climate modeling approaches" (implicit)

❌ "Looking for research partners" (constructed role)

❌ "Seeking collaboration opportunities" (constructed role)

Content: "Now looking for a founding engineer. Fill out the form if interested."

✅ "Looking for a founding engineer" (explicit, temporal marker removed, but needs more context if available)

❌ "Fill out the form if interested" (procedural call-to-action)

❌ "Now looking for a founding engineer" (keep temporal marker)

Content: "Looking for Founding Fullstack Engineer to build protocol for private, intent-driven discovery. Apply here."

✅ "Looking for Founding Fullstack Engineer to build protocol for private, intent-driven discovery" (explicit, self-contained)

❌ "Looking for Founding Fullstack Engineer" (too short, not self-contained)

❌ "Apply here" (procedural call-to-action)

Content: "Been playing with agent coordination. Not sure anyone's solved the game theory."

✅ "Playing with agent coordination mechanisms" (implicit, keeps casual tone)

✅ "Figuring out game theory for agent systems" (implicit)

❌ "Need game theory experts" (constructed role)

❌ "Seeking technical advisors" (constructed role)

Content: "Building tools for decentralized research. The hard part is incentive alignment."

✅ "Building tools for decentralized research" (implicit)

✅ "Figuring out incentive alignment for research networks" (implicit)

❌ "Looking for partners in research infrastructure" (constructed role)

Content: "Job posting: Need experience with Next.js, React, TypeScript, Postgres, Redis, Docker."

✅ "Looking for fullstack engineering experience (Next.js, React, TypeScript, Postgres, Redis)" (cohesive)

❌ "Need experience with Next.js" (fragmented)

❌ "Need experience with React" (fragmented)

❌ "Need experience with TypeScript" (fragmented)

Content: "Exploring how privacy and discovery can coexist. Interested in agent-native protocols."

✅ "Exploring how privacy and discovery can coexist" (implicit, as stated)

✅ "Interested in agent-native protocols" (implicit)

❌ "Seeking privacy researchers" (constructed role)

Content: "Open to consulting in distributed systems. Working on consensus mechanisms."

✅ "Open to consulting in distributed systems" (explicit)

✅ "Working on consensus mechanisms" (implicit)

❌ "Looking for consulting opportunities" (rephrased explicit wrong)

Content: "Trying to understand how trust emerges in P2P networks. No clear answer yet."

✅ "Trying to understand how trust emerges in P2P networks" (implicit, keeps exploratory tone)

✅ "Exploring trust models without central authority" (implicit)

❌ "Seeking P2P networking experts" (constructed role)

Pattern: 

- Explicit → preserve exactly, remove temporal markers
- Implicit → what they're doing/exploring, not who they're seeking
- Skip procedural instructions and calls-to-action
- Combine related items into cohesive intents
- Keep the voice: casual stays casual, technical stays technical, exploratory stays exploratory

Generate intents naturally, you decide how many intents to generate. 

Output: [{"intent": "...", "type": "explicit|implicit", "confidence": 0-1}]`;

const USER_PROMPT = (content: string, context?: string) => `
${context ? `Context: ${context}\n` : ''}
Content:
${content}
`;

/**
 * Core intent inference function with dynamic generation
 */
async function inferIntents(
  content: string, 
  context?: string,
  timeoutMs: number = 60000
): Promise<Intent[]> {
  try {
    const IntentSchema = z.object({
      intents: z.array(z.object({
        intent: z.string().describe("The intent in user's voice"),
        type: z.enum(['explicit', 'implicit']).describe("Whether intent is directly stated or inferred"),
        confidence: z.number().min(0).max(1).describe("Confidence score between 0 and 1")
      })).describe("Array of intents, naturally generated (typically 3-7)")
    });

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT(content, context) }
    ];

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Intent generation timeout')), timeoutMs);
    });

    const intentInferCall = traceableStructuredLlm(
      "intent-inferrer",
      { content_length: content.length }
    );

    const response = await Promise.race([
      intentInferCall(messages, IntentSchema),
      timeoutPromise
    ]);

    // Factor implicit intents confidence by 0.8
    const processedIntents = response.intents.map((intent: Intent) => ({
      ...intent,
      confidence: intent.type === 'implicit' ? intent.confidence * 0.8 : intent.confidence
    }));

    console.log(`🎯 Generated ${processedIntents.length} intents:`);
    processedIntents.forEach((intent: Intent, idx: number) => {
      console.log(`  ${idx + 1}. [${intent.type}] ${intent.intent} (${intent.confidence})`);
    });

    return processedIntents;
  } catch (error) {
    console.error('❌ Error inferring intents:', error);
    return [];
  }
}




/**
 * Core intent analysis function that works with any content
 * Uses dynamic inference with backward compatibility
 */
export async function analyzeContent(
  content: string,
  itemCount: number,
  textInstruction?: string,
  existingIntents: string[] = [],
  count: number = 5, // Ignored - kept for backward compatibility
  timeoutMs: number = 60000
): Promise<IntentInferenceResult> {
  try {
    if (!content.trim()) {
      console.log('📄 No content to analyze');
      return { success: true, intents: [] };
    }

    console.log(`📋 Analyzing ${content.length} characters from ${itemCount} items`);

    // Build context from instructions and existing intents
    const contextParts: string[] = [];
    
    if (textInstruction) {
      contextParts.push(`User Guidance: ${textInstruction}`);
    }
    
    if (existingIntents.length > 0) {
      const intentsToShow = existingIntents.slice(0, 50);
      // contextParts.push(`Existing Intents (do NOT generate duplicates): ${intentsToShow.join(', ')}`);
    }
    
    const context = contextParts.length > 0 ? contextParts.join('\n') : undefined;
    
    // Use dynamic inference
    const intents = await inferIntents(content, context, timeoutMs);

    console.log(`✅ Generated ${intents.length} intents`);

    // Convert to old format for backward compatibility
    const inferredIntents: InferredIntent[] = intents.map(intent => ({
      payload: intent.intent,
      confidence: intent.confidence,
      type: intent.type
    }));

    return {
      success: true,
      intents: inferredIntents
    };

  } catch (error) {
    console.error('❌ Error analyzing content:', error);
    return { success: false, intents: [] };
  }
}

/**
 * Analyze objects directly and generate intents (efficient for integrations)
 */
export async function analyzeObjects(
  objects: any[],
  textInstruction?: string,
  existingIntents: string[] = [],
  count: number = 5, // Ignored - kept for backward compatibility
  timeoutMs: number = 60000
): Promise<IntentInferenceResult> {
  if (!objects.length) {
    return { success: true, intents: [] };
  }

  console.log(`📄 Processing ${objects.length} objects`);

  // Build concatenated content from objects
  let concatenatedContent = '';
  let processedObjects = 0;
  
  for (const obj of objects) {
    if (obj && typeof obj === 'object') {
      // Convert object to readable format
      const objContent = typeof obj.content === 'string' 
        ? obj.content 
        : JSON.stringify(obj, null, 2);
      
      if (objContent.trim().length > 0) {
        const objName = obj.name || obj.id || `object-${processedObjects + 1}`;
        concatenatedContent += `=== ${objName} ===\n${objContent.substring(0, 5000)}\n\n`;
        processedObjects++;
      }
    }
  }

  return analyzeContent(
    concatenatedContent,
    processedObjects,
    textInstruction,
    existingIntents,
    count,
    timeoutMs
  );
}

/**
 * Analyze files in a folder and generate intents
 */
export async function analyzeFolder(
  folderPath: string,
  fileIds: string[],
  textInstruction?: string,
  existingIntents: string[] = [],
  count: number = 5, // Ignored - kept for backward compatibility
  timeoutMs: number = 60000
): Promise<IntentInferenceResult> {
  try {
    // Validate folder path
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { success: false, intents: [] };
    }

    const folderStat = fs.statSync(folderPath);
    if (!folderStat.isDirectory()) {
      return { success: false, intents: [] };
    }

    if (fileIds.length === 0) {
      return { success: true, intents: [] };
    }

    console.log(`📄 Processing ${fileIds.length} files`);

    // Find all supported files based on fileIds
    const allFiles = fs.readdirSync(folderPath);
    const supportedFiles = allFiles.filter(file => {
      const fileIdMatch = fileIds.some(id => file.startsWith(id + '.'));
      const filePath = path.join(folderPath, file);
      return fileIdMatch && isFileExtensionSupported(filePath, 'general');
    });

    if (supportedFiles.length === 0) {
      console.log('📄 No supported files found');
      return { success: true, intents: [] };
    }

    console.log(`📄 Found ${supportedFiles.length} supported files out of ${fileIds.length} total files`);

    // Process all files in parallel for maximum speed
    const filePaths = supportedFiles.map(file => path.join(folderPath, file));
    const fileResults = await loadFilesInParallel(filePaths);

    // Build concatenated content from successful results
    let concatenatedContent = '';
    let processedFiles = 0;
    
    for (const result of fileResults) {
      if (result.content && result.content.trim().length > 0) {
        const fileName = path.basename(result.filePath);
        concatenatedContent += `=== ${fileName} ===\n${result.content.substring(0, 5000)}\n\n`;
        processedFiles++;
      } else if (result.error) {
        console.warn(`⚠️  Failed to read ${path.basename(result.filePath)}:`, result.error);
      }
    }

    if (!concatenatedContent.trim()) {
      console.log('📄 No readable content found in supported files');
      return { success: true, intents: [] };
    }

    return analyzeContent(
      concatenatedContent,
      processedFiles,
      textInstruction,
      existingIntents,
      count,
      timeoutMs
    );

  } catch (error) {
    console.error('❌ Error analyzing folder:', error);
    return { success: false, intents: [] };
  }
}

export { inferIntents, SYSTEM_PROMPT };
