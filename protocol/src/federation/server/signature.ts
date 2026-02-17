import { createSign, createVerify, generateKeyPairSync, createHash } from 'crypto';

export function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey as string, privateKeyPem: privateKey as string };
}

function digestBody(body: string): string {
  const hash = createHash('sha256').update(body).digest('base64');
  return `SHA-256=${hash}`;
}

interface SignInput {
  method: string;
  url: string;
  body: string;
  privateKeyPem: string;
  keyId: string;
}

export function signRequest({ method, url, body, privateKeyPem, keyId }: SignInput): Record<string, string> {
  const parsedUrl = new URL(url);
  const date = new Date().toUTCString();
  const digest = digestBody(body);
  const target = `${method.toLowerCase()} ${parsedUrl.pathname}`;

  const signingString = [
    `(request-target): ${target}`,
    `host: ${parsedUrl.host}`,
    `date: ${date}`,
    `digest: ${digest}`,
  ].join('\n');

  const signer = createSign('RSA-SHA256');
  signer.update(signingString);
  const signature = signer.sign(privateKeyPem, 'base64');

  const signatureHeader = `keyId="${keyId}",headers="(request-target) host date digest",signature="${signature}"`;

  return {
    Host: parsedUrl.host,
    Date: date,
    Digest: digest,
    Signature: signatureHeader,
  };
}

interface VerifyInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  publicKeyPem: string;
}

export function verifyRequest({ method, url, headers, body, publicKeyPem }: VerifyInput): boolean {
  // Verify digest
  const expectedDigest = digestBody(body);
  if (headers['Digest'] !== expectedDigest) return false;

  // Parse signature header
  const sigHeader = headers['Signature'];
  if (!sigHeader) return false;

  const sigMatch = sigHeader.match(/signature="([^"]+)"/);
  if (!sigMatch) return false;
  const signature = sigMatch[1];

  const parsedUrl = new URL(url);
  const target = `${method.toLowerCase()} ${parsedUrl.pathname}`;

  const signingString = [
    `(request-target): ${target}`,
    `host: ${headers['Host'] || parsedUrl.host}`,
    `date: ${headers['Date']}`,
    `digest: ${headers['Digest']}`,
  ].join('\n');

  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingString);
  return verifier.verify(publicKeyPem, signature, 'base64');
}
