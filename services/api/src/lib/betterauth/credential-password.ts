/**
 * Password hashing for email/password ("credential") accounts written outside
 * Better Auth's own sign-up route — today, the sandbox seed.
 *
 * `hashPassword` / `verifyPassword` from `better-auth/crypto` are exactly what
 * Better Auth's context resolves `ctx.password.hash` / `ctx.password.verify`
 * to when `emailAndPassword.password` is not overridden — and `createAuth` in
 * `./betterauth.ts` does not override it. A row hashed here therefore verifies
 * through the real sign-in endpoint. If that config ever gains a custom hasher,
 * this module must follow it (the credential spec guards the round trip through
 * a real `createAuth` context).
 *
 * A credential account row mirrors what `signUpEmail` writes:
 * `provider_id = 'credential'`, `account_id = <user id>`, `password = <hash>`.
 */
import { hashPassword, verifyPassword } from 'better-auth/crypto';

export const CREDENTIAL_PROVIDER_ID = 'credential';

export function hashCredentialPassword(password: string): Promise<string> {
  return hashPassword(password);
}

export function verifyCredentialPassword(hash: string, password: string): Promise<boolean> {
  return verifyPassword({ hash, password });
}
