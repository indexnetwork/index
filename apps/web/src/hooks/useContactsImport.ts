import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { authClient } from "@/lib/auth-client";
import { requestedScopes, type createIntroducerService, type IntroducerStatus } from "@/services/introducer";

type Service = ReturnType<typeof createIntroducerService>;

/**
 * Connect Google and read your contacts, from whichever page you're on.
 * Google sends you back to `here`; with the contacts scope granted, the
 * contacts are read straight away, once.
 */
export function useContactsImport({ service, status, reload, here }: {
  service: Service;
  status: IntroducerStatus | null;
  reload: () => Promise<void>;
  here: string;
}) {
  const [params, setParams] = useSearchParams();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? "Google didn't connect. Use the Google account with the same email as your Index account." : null);
  const autoImported = useRef(false);

  const doImport = useCallback(async () => {
    setImporting(true);
    setError(null);
    try {
      await service.importContacts();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }, [service, reload]);

  useEffect(() => {
    if (!status || autoImported.current || params.get("connected") !== "1") return;
    autoImported.current = true;
    setParams((p) => { p.delete("connected"); return p; }, { replace: true });
    if (status.google.contactsScope) void doImport();
  }, [status, params, setParams, doImport]);

  const connect = useCallback(async () => {
    const { data, error: linkError } = await authClient.linkSocial({
      provider: "google",
      scopes: requestedScopes(),
      callbackURL: `${window.location.origin}${here}?connected=1`,
      errorCallbackURL: `${window.location.origin}${here}?error=1`,
      disableRedirect: true,
    });
    if (linkError || !data?.url) {
      setError(linkError?.message || "Couldn't reach Google");
      return;
    }
    // Google hands out a refresh token only from its consent screen, and skips
    // that screen for scopes already granted. Without one, the grant dies
    // after an hour, so always show it here.
    const url = new URL(data.url);
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("access_type", "offline");
    window.location.href = url.toString();
  }, [here]);

  return { importing, error, setError, connect, doImport };
}
