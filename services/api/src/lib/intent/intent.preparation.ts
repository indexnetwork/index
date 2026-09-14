import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { ClarifyResult, IntentSemanticMetadata, PreparedIntent } from '@indexnetwork/protocol';

/** Invalid or foreign preparation receipts cannot authorize a create. */
export class IntentPreparationReceiptError extends Error {
  constructor() {
    super('This preparation receipt is invalid. Prepare the signal again.');
  }
}

function key(): Uint8Array {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required to authorize intent preparation');
  return new TextEncoder().encode(secret);
}

function digest(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

/** Sign the admitted draft's fingerprint and measurements for its authenticated owner. */
export async function issuePreparationReceipt(userId: string, result: Extract<ClarifyResult, { status: 'ready' }>): Promise<string> {
  return new SignJWT({ digest: digest(result.payload), metadata: result.metadata })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience('intent-preparation')
    .setSubject(userId)
    .sign(key());
}

/** Authenticate preparation; revisions keep permission but must receive fresh measurements. */
export async function readPreparationReceipt(userId: string, description: string, receipt: string): Promise<PreparedIntent> {
  const signingKey = key();
  try {
    const { payload } = await jwtVerify(receipt, signingKey, {
      algorithms: ['HS256'], audience: 'intent-preparation', subject: userId,
    });
    return { metadata: payload.digest === digest(description) ? payload.metadata as IntentSemanticMetadata : null };
  } catch {
    throw new IntentPreparationReceiptError();
  }
}
