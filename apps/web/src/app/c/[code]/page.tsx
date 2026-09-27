import AppHandoff from "@/components/AppHandoff";

/**
 * Legacy connect-link landing (`/c/:code`).
 *
 * The connect-link continuation flow (login → `GET /api/c/:code/go`) is gone;
 * this page is now the universal-link fallback only. With the macOS app
 * installed the OS intercepts the URL before this renders.
 */
export default function ConnectLinkPage() {
  return <AppHandoff />;
}

export const Component = ConnectLinkPage;
