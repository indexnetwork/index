import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import AppHandoff from "@/components/AppHandoff";
import { apiUrl } from "@/lib/api";
import { parseSocial } from "@/lib/socials";

/**
 * Opportunity link (`/o/:id`). The web has no opportunity page, so this is
 * the handoff only: Hermes when connected, otherwise the download page.
 * `?surface=` opens that social surface for someone on the opportunity. No sign-in.
 */
export default function OpportunityLinkPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const surface = params.get("surface")?.trim() ?? "";
  if (surface) return <SurfaceOpportunityLink id={id ?? ""} surface={surface} />;
  return <AppHandoff kind="o" id={id ?? ""} />;
}

function surfaceHrefs(surface: string, values: string[]): string[] {
  const want = surface.toLowerCase() === "x" ? "twitter" : surface.toLowerCase();
  const hrefs = new Set<string>();
  for (const value of values) {
    const social = parseSocial({ label: surface, value });
    const platform = social.platform === "x" ? "twitter" : social.platform;
    if (social.href && platform === want) hrefs.add(social.href);
  }
  return [...hrefs];
}

function SurfaceOpportunityLink({ id, surface }: { id: string; surface: string }) {
  const [hrefs, setHrefs] = useState<string[] | null>(null);
  const [fallback, setFallback] = useState(!id);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const query = new URLSearchParams({ surface });
    fetch(apiUrl(`/api/opportunities/${encodeURIComponent(id)}/surface?${query}`))
      .then((res) => (res.ok ? res.json() as Promise<{ values?: string[] }> : Promise.reject(res)))
      .then((body) => {
        if (cancelled) return;
        const found = surfaceHrefs(surface, body.values ?? []);
        if (found.length === 1) window.location.assign(found[0]);
        else if (found.length > 1) setHrefs(found);
        else setFallback(true);
      })
      .catch(() => { if (!cancelled) setFallback(true); });
    return () => { cancelled = true; };
  }, [id, surface]);

  if (fallback) return <AppHandoff kind="o" id={id} />;
  if (!hrefs) return null;
  return (
    <main style={{ padding: 24, display: "grid", gap: 12 }}>
      {hrefs.map((href) => (
        <a key={href} href={href}>{href.replace(/^https:\/\//, "")}</a>
      ))}
    </main>
  );
}

export const Component = OpportunityLinkPage;
