import { auth } from '../betterauth/auth.instance';
import { API_URL, WEB_APP_URL } from '../betterauth/betterauth';

/** Mint a Better Auth session JWT for a lab user (development only). */
export async function mintLabSessionJwt(email: string, password: string): Promise<string> {
  const origin = WEB_APP_URL || 'http://localhost:3000';
  const signIn = await auth.handler(new Request(`${API_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password }),
  }));
  if (!signIn.ok) {
    throw new Error(`Floor lab sign-in failed for ${email}: ${await signIn.text()}`);
  }
  const cookie = signIn.headers.getSetCookie().map((value) => value.split(';')[0]!).join('; ');
  const tokenRes = await auth.handler(new Request(`${API_URL}/api/auth/token`, {
    headers: { Cookie: cookie, Origin: origin },
  }));
  if (!tokenRes.ok) {
    throw new Error(`Floor lab token failed for ${email}: ${await tokenRes.text()}`);
  }
  const body = await tokenRes.json() as { token?: string };
  if (!body.token) throw new Error(`Floor lab token missing for ${email}`);
  return body.token;
}
