import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import AppHandoff from "@/components/AppHandoff";
import { apiUrl } from "@/lib/api";
import { parseSocial } from "@/lib/socials";

/**
 * Opportunity link (`/o/:id`). The web has no opportunity page, so this is
 * the handoff screen: open in the Mac app or Hermes, otherwise the download page.
 * `?action=&viewer=&sig=` accepts or declines from a signed link, then
 * `?surface=` opens the other person's profile on that surface when there is
 * exactly one. Otherwise it opens their public profile at `/u/`. No sign-in.
 */
export default function OpportunityLinkPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const action = params.get("action")?.trim() ?? "";
  const viewer = params.get("viewer")?.trim() ?? "";
  const sig = params.get("sig")?.trim() ?? "";
  const surface = params.get("surface")?.trim() ?? "";
  if (action && viewer && sig) {
    return <ActionOpportunityLink id={id ?? ""} action={action} viewer={viewer} sig={sig} surface={surface} />;
  }
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

function ActionOpportunityLink({ id, action, viewer, sig, surface }: {
  id: string;
  action: string;
  viewer: string;
  sig: string;
  surface: string;
}) {
  const navigate = useNavigate();
  const [fallback, setFallback] = useState(!id || navigator.webdriver);

  useEffect(() => {
    if (!id || navigator.webdriver) return;
    let cancelled = false;
    fetch(apiUrl(`/api/opportunities/${encodeURIComponent(id)}/link-action`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, viewer, sig, ...(surface ? { surface } : {}) }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({})) as { values?: string[]; userId?: string };
        if (!res.ok && !body.userId) throw res;
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        const found = surface ? surfaceHrefs(surface, body.values ?? []) : [];
        if (found.length === 1) window.location.assign(found[0]);
        else if (body.userId) navigate(`/u/${encodeURIComponent(body.userId)}`, { replace: true });
        else setFallback(true);
      })
      .catch(() => { if (!cancelled) setFallback(true); });
    return () => { cancelled = true; };
  }, [id, action, viewer, sig, surface, navigate]);

  if (fallback) return <AppHandoff kind="o" id={id} />;
  return null;
}

export const Component = OpportunityLinkPage;
