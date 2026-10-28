import { PROFILE_DESCRIPTION, renderProfileThumbnail, type ThumbnailProfile } from "./profile-thumbnail";
import { ORIGIN, type PageMeta } from "./meta.config";

interface PublicProfile extends ThumbnailProfile { id: string }
const TTL = 5 * 60 * 1000;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Uses only the same anonymous profile endpoint as the public profile page. */
export function createProfilePreview(protocolOrigin = process.env.VITE_PROTOCOL_URL || "https://protocol.index.network", request = fetch) {
  const origin = protocolOrigin.replace(/\/+$/, "");
  const profiles = new Map<string, { expires: number; profile: PublicProfile }>();
  const images = new Map<string, { expires: number; png: Buffer }>();

  async function getProfile(id: string): Promise<PublicProfile | null> {
    const cached = profiles.get(id);
    if (cached && cached.expires > Date.now()) return cached.profile;
    try {
      const response = await request(`${origin}/api/users/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(2500) });
      if (!response.ok) return null;
      const { user } = await response.json();
      if (!user || typeof user.id !== "string" || typeof user.name !== "string") return null;
      const profile: PublicProfile = { id: user.id, name: user.name.slice(0, 200), username: typeof user.username === "string" ? user.username : null, avatar: typeof user.avatar === "string" ? user.avatar : null };
      if (profiles.size >= 100) profiles.delete(profiles.keys().next().value!);
      profiles.set(id, { expires: Date.now() + TTL, profile });
      return profile;
    } catch { return null; }
  }

  async function avatarData(avatar: string | null | undefined): Promise<string | undefined> {
    if (!avatar) return;
    try {
      const path = avatar.startsWith("/api/storage/") ? avatar : `/api/storage/${avatar.replace(/^\//, "")}`;
      const url = /^https?:/.test(avatar) ? new URL(avatar) : new URL(path, origin);
      // Arbitrary user-supplied URLs must not turn this endpoint into a server-side proxy.
      const storage = url.origin === new URL(origin).origin && url.pathname.startsWith("/api/storage/avatars/");
      const trustedHost = ["pbs.twimg.com", "avatars.githubusercontent.com", "lh3.googleusercontent.com", "lh4.googleusercontent.com", "lh5.googleusercontent.com", "lh6.googleusercontent.com"].includes(url.hostname);
      if (!storage && !(url.protocol === "https:" && !url.port && trustedHost)) return;
      if (url.username || url.password) return;
      const response = await request(url, { redirect: "error", signal: AbortSignal.timeout(2500) });
      const type = response.headers.get("content-type")?.split(";")[0];
      if (!response.ok || !type || !["image/png", "image/jpeg", "image/webp"].includes(type) || !response.body) return;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_AVATAR_BYTES) { await reader.cancel(); return; }
        chunks.push(value);
      }
      return `data:${type};base64,${Buffer.concat(chunks).toString("base64")}`;
    } catch { return; }
  }

  return {
    async meta(id: string): Promise<PageMeta | undefined> {
      const profile = await getProfile(id);
      if (!profile) return;
      return { title: profile.name, description: PROFILE_DESCRIPTION, image: `${ORIGIN}/profile-preview/${encodeURIComponent(profile.username || profile.id)}.png?v=1`, type: "profile" };
    },
    async image(id: string, head = false): Promise<Response> {
      const profile = await getProfile(id);
      if (!profile) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
      const headers = { "Content-Type": "image/png", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" };
      if (head) return new Response(null, { headers });
      const cached = images.get(id);
      if (cached && cached.expires > Date.now()) return new Response(new Uint8Array(cached.png), { headers });
      try {
        const png = await renderProfileThumbnail(profile, await avatarData(profile.avatar));
        if (images.size >= 100) images.delete(images.keys().next().value!);
        images.set(id, { png, expires: Date.now() + TTL });
        return new Response(new Uint8Array(png), { headers });
      } catch {
        return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
    },
  };
}
