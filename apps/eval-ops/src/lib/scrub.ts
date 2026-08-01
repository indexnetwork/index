/**
 * Client-side credential scrubbing, applied to anything server-provided before it
 * reaches the DOM.
 *
 * The server already scrubs credentials; this is defence in depth, so a value
 * still reaching the browser with a password in it cannot be rendered. It is a
 * deliberate duplicate of scrubCredentials in
 * packages/protocol/eval/ops/ops.fixture.ts, and tests/fixture.test.tsx pins the
 * two together so they cannot silently diverge.
 */
export function scrubCredentials(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1')
    .replace(/\b(password|pgpassword)=[^\s&"']+/gi, '$1=');
}
