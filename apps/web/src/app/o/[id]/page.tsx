import DeepLinkLanding from "@/components/DeepLinkLanding";

/**
 * Opportunity deep-link landing (`/o/:id`).
 *
 * Canonical deep links delivered by the plugin/digests are ordinary HTTPS
 * URLs; with the macOS app installed the OS opens the app directly. This page
 * is the no-app fallback only — no auth, no API calls.
 */
export default function OpportunityLinkPage() {
  return <DeepLinkLanding />;
}

export const Component = OpportunityLinkPage;
