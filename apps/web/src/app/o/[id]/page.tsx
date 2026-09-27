import { useParams } from "react-router";

import AppHandoff from "@/components/AppHandoff";

/**
 * Opportunity link (`/o/:id`). The web has no opportunity page, so this is
 * the handoff only: Hermes when connected, otherwise the download page.
 */
export default function OpportunityLinkPage() {
  const { id } = useParams();
  return <AppHandoff hermesQuery={`o=${encodeURIComponent(id ?? "")}`} />;
}

export const Component = OpportunityLinkPage;
