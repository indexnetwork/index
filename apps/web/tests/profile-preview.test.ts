// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createProfilePreview } from "../profile-preview";
import { profileThumbnailSvg, renderProfileThumbnail } from "../profile-thumbnail";
import { createWebHandler } from "../server";
import { readFileSync } from "fs";

const profile = { id: "user-123", name: "Seren Sandikci", username: "seren", avatar: null };

describe("profile link thumbnail 1b", () => {
  it("renders a 1200 by 630 PNG without an avatar", async () => {
    const png = await renderProfileThumbnail(profile);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it("escapes names and keeps very long names within two lines", () => {
    const svg = profileThumbnailSvg({ name: '<script> & "Someone" with a very very very long name', username: "a".repeat(64) });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("…");
    expect(svg).not.toContain("NaN");
  });

  it("uses anonymous public data, caches the image, and blocks untrusted avatar fetches", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ user: { ...profile, avatar: "http://127.0.0.1/private" } }));
    const preview = createProfilePreview("https://protocol.example", request as typeof fetch);
    const meta = await preview.meta("seren");
    expect(meta?.title).toBe(profile.name);
    expect(meta?.image).toContain("/profile-preview/seren.png?v=1");
    const first = await preview.image("seren");
    const second = await preview.image("seren");
    expect(first.headers.get("content-type")).toBe("image/png");
    expect(await first.arrayBuffer()).toEqual(await second.arrayBuffer());
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("https://protocol.example/api/users/seren");
  });

  it("falls back cleanly when a profile is missing or the API fails", async () => {
    const preview = createProfilePreview("https://protocol.example", vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as typeof fetch);
    expect(await preview.meta("missing")).toBeUndefined();
    expect((await preview.image("missing")).status).toBe(404);
    const failed = createProfilePreview("https://protocol.example", vi.fn().mockRejectedValue(new Error("offline")) as typeof fetch);
    expect(await failed.meta("seren")).toBeUndefined();
  });

  it("loads uploaded avatars from the configured protocol without forwarding credentials", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ user: { ...profile, avatar: "/api/storage/avatars/user-123/photo.png" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(await renderProfileThumbnail(profile)), { headers: { "Content-Type": "image/png" } }));
    const preview = createProfilePreview("https://protocol.example", request as typeof fetch);
    const response = await preview.image("seren");
    expect(response.status).toBe(200);
    expect(request.mock.calls[1][0].href).toBe("https://protocol.example/api/storage/avatars/user-123/photo.png");
    expect(request.mock.calls[1][1].redirect).toBe("error");
    expect(request.mock.calls[1][1].headers).toBeUndefined();
  });

  it("injects escaped metadata for both profile URLs and respects preview suppression", async () => {
    const meta = vi.fn().mockResolvedValue({ title: 'A < B & "$&"', description: "Pair agents", image: "https://index.network/profile-preview/seren.png?v=1", type: "profile" });
    const image = vi.fn().mockResolvedValue(new Response(null, { headers: { "Content-Type": "image/png" } }));
    const handler = createWebHandler({ distDir: "/tmp/nonexistent-profile-preview-test", template: readFileSync(new URL("../index.html", import.meta.url), "utf8"), metaMap: {}, profilePreview: { meta, image } });
    for (const path of ["/seren", "/u/user-123"]) {
      const html = await (await handler(new Request(`https://index.network${path}`))).text();
      expect(html).toContain("<title>A &lt; B &amp; &quot;$&amp;&quot;</title>");
      expect(html).toContain('property="og:image" content="https://index.network/profile-preview/seren.png?v=1"');
    }
    const hidden = await (await handler(new Request("https://index.network/seren?link_preview=false"))).text();
    expect(hidden).not.toContain("og:image");
    expect(meta).toHaveBeenCalledTimes(2);
    await handler(new Request("https://index.network/settings"));
    expect(meta).toHaveBeenCalledTimes(2);
    await handler(new Request("https://index.network/profile-preview/seren.png", { method: "HEAD" }));
    expect(image).toHaveBeenCalledWith("seren", true);
    expect((await handler(new Request("https://index.network/profile-preview/seren.png", { method: "POST" }))).status).toBe(404);
  });
});
