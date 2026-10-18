import { ActsOutputSchema, FidelityOutputSchema, FindingsOutputSchema, MandateOutputSchema } from '../schema.ts';
import type { TraceInput } from '../schema.ts';
import type { TraceRecord } from '../record.ts';
import type { Completer, Layer } from './completer.ts';
import { layerSystemPrompt, renderTrace } from './prompts.ts';
import { verifyAnnotations } from './verify.ts';

const MAX_ATTEMPTS = 2;

async function runLayer<T>(completer: Completer, trace: TraceInput, layer: Layer, parse: (raw: unknown) => T): Promise<T> {
  const request = { layer, interactionId: trace.interactionId, system: layerSystemPrompt(layer), user: renderTrace(trace) };
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return parse(await completer.complete(request));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`layer ${layer} failed for ${trace.interactionId}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function annotateTrace(trace: TraceInput, completer: Completer): Promise<TraceRecord> {
  const [mandate, fidelity, acts, findings] = await Promise.all([
    runLayer(completer, trace, 'mandate', (raw) => MandateOutputSchema.parse(raw)),
    runLayer(completer, trace, 'fidelity', (raw) => FidelityOutputSchema.parse(raw)),
    runLayer(completer, trace, 'acts', (raw) => ActsOutputSchema.parse(raw)),
    runLayer(completer, trace, 'findings', (raw) => FindingsOutputSchema.parse(raw)),
  ]);
  return verifyAnnotations(trace, { annotator: completer.name, mandate, fidelity, acts, findings });
}
