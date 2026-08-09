import NetworkWebInviteLanding from "@/components/NetworkWebInviteLanding";

/**
 * Private network invite landing (`/l/:code`).
 *
 * Preview the network, sign in on the web, accept the invitation automatically,
 * then redirect to the app download page.
 */
export default function InvitationPage() {
  return <NetworkWebInviteLanding />;
}

export const Component = InvitationPage;
