import { renderAsync } from "@resvg/resvg-js";
import { fileURLToPath } from "url";

export interface ThumbnailProfile {
  name: string;
  username?: string | null;
  avatar?: string | null;
}

export const PROFILE_DESCRIPTION = "Pair your agent with mine. They'll keep talking in the background, exploring possibilities and bringing us together.";

export function escapeMarkup(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function shorten(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : value;
}

/** Option 1b (Thumbnail B Dialog): fixed 1200 × 630 social image. */
export function profileThumbnailSvg(profile: ThumbnailProfile, avatarData?: string): string {
  const name = profile.name.trim() || "Index member";
  const words = name.split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.length - 1;
    if (last >= 0 && (lines[last] + " " + word).length <= 12) lines[last] += " " + word;
    else lines.push(word);
  }
  const displayLines = lines.length > 2 ? [lines[0], shorten(lines.slice(1).join(" "), 18)] : lines;
  const fontSize = Math.min(76, 350 / (Math.max(...displayLines.map((line) => Array.from(line).length)) * 0.62));
  const handle = profile.username ? `@${shorten(profile.username, 19)}` : "";
  const agent = shorten(profile.username || words[0].toLowerCase(), 16);
  const agentLabel = `${agent}'s agent`;
  const titleBar = (x: number, y: number, width: number, title: string) => `
    <rect x="${x + 15}" y="${y + 8}" width="${width - 30}" height="36" fill="url(#stripes)"/>
    <rect x="${x + 15}" y="${y + 3}" width="${title.length * 13 + 58}" height="46" fill="white"/>
    <rect x="${x + 15}" y="${y + 13}" width="26" height="26" fill="white" stroke="#1d1f20" stroke-width="3"/>
    <rect x="${x + 23}" y="${y + 21}" width="10" height="10" fill="#1d1f20"/>
    <text x="${x + 58}" y="${y + 34}" font-size="21" font-weight="500">${title}</text>
    <path d="M${x} ${y + 59}h${width}" stroke="#1d1f20" stroke-width="3"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <pattern id="dots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="4.5" cy="4.5" r="1.2" fill="white" fill-opacity=".55"/></pattern>
      <pattern id="stripes" width="7" height="7" patternUnits="userSpaceOnUse"><rect width="7" height="3" fill="#1d1f20"/></pattern>
      <clipPath id="photo"><rect x="115" y="163" width="240" height="240"/></clipPath>
    </defs>
    <rect width="1200" height="630" fill="#1468c4"/><rect width="1200" height="630" fill="url(#dots)"/>
    <g fill="#1d1f20" font-family="IBM Plex Mono Medium">
      <rect x="68" y="64" width="766" height="436"/>
      <rect x="60" y="56" width="766" height="436" fill="white" stroke="#1d1f20" stroke-width="3"/>
      ${titleBar(60, 56, 766, "profile")}
      <rect x="111" y="159" width="248" height="248" fill="#c7d9ef" stroke="#1d1f20" stroke-width="4"/>
      <text x="235" y="307" text-anchor="middle" font-size="80" font-family="IBM Plex Sans" font-weight="700">${escapeMarkup(Array.from(name)[0].toUpperCase())}</text>
      ${avatarData ? `<image href="${escapeMarkup(avatarData)}" x="115" y="163" width="240" height="240" preserveAspectRatio="xMidYMid slice" clip-path="url(#photo)"/>` : ""}
      ${displayLines.map((line, i) => `<text x="399" y="${159 + fontSize + i * fontSize * .98}" font-size="${fontSize}" font-family="IBM Plex Sans" font-weight="700" letter-spacing="-1.1">${escapeMarkup(line)}</text>`).join("")}
      <text x="399" y="${159 + displayLines.length * fontSize * .98 + 48}" font-size="${Math.min(36, 350 / (handle.length * .6 || 1))}" fill="#5c5c5c">${escapeMarkup(handle)}</text>
      <rect x="570" y="310" width="586" height="282"/>
      <rect x="560" y="300" width="586" height="282" fill="white" stroke="#1d1f20" stroke-width="3"/>
      ${titleBar(560, 300, 586, "opportunities")}
      <text x="710" y="421" text-anchor="middle" fill="#5c5c5c" font-size="30">your agent</text>
      <path d="M815 400h26l-6-6m6 6-6 6M841 412h-26l6-6m-6 6 6 6" fill="none" stroke="#5c5c5c" stroke-width="2"/>
      <text x="980" y="421" text-anchor="middle" fill="#5c5c5c" font-size="${Math.min(30, 260 / (agentLabel.length * .6))}">${escapeMarkup(agentLabel)}</text>
      <rect x="670" y="465" width="380" height="88"/>
      <rect x="663" y="458" width="380" height="88" fill="#ff8a00" stroke="#1d1f20" stroke-width="4"/>
      <text x="853" y="516" text-anchor="middle" font-size="40" font-family="IBM Plex Mono SemiBold" font-weight="600" letter-spacing=".8">pair agents</text>
    </g>
  </svg>`;
}

export async function renderProfileThumbnail(profile: ThumbnailProfile, avatarData?: string): Promise<Buffer> {
  const image = await renderAsync(profileThumbnailSvg(profile, avatarData), {
    font: {
      loadSystemFonts: false,
      fontFiles: ["sans-bold.ttf", "mono-medium.ttf", "mono-semibold.ttf"].map((name) => fileURLToPath(new URL(`./og-fonts/${name}`, import.meta.url))),
    },
  });
  return image.asPng();
}
