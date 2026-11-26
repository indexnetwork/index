import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import PageHead from "@/components/intents-home/PageHead";
import { PageView } from "@/components/intents-home/SplitView";
import { useInAppFrame } from "@/components/intents-home/appFrameContext";
import { Stage, Window } from "@/components/workbench/Workbench";
import { useAuthContext } from "@/contexts/AuthContext";
import { useCompact } from "@/hooks/useCompact";
import { authClient } from "@/lib/auth-client";
import { useAuthenticatedAPI } from "@/lib/api";
import { since } from "@/lib/since";
import { CONTACT_SCOPES, createIntroducerService, type ContactEntry, type ContactFilter, type IntroducerStatus } from "@/services/introducer";
import "@/styles/plain.css";
import "@/styles/introduce.css";

type Service = ReturnType<typeof createIntroducerService>;

const HERE = "/networks/contacts";

function Setup({ status, importing, error, onConnect, onImport }: {
  status: IntroducerStatus;
  importing: boolean;
  error: string | null;
  onConnect: () => void;
  onImport: () => void;
}) {
  const googleDone = status.google.linked && status.google.contactsScope;
  return (
    <div className="idk-setup">
      <p><b>Bring the people you know.</b> Index reads your saved Google contacts and the people you&apos;ve emailed, and marks who is already on Index. Introduce uses them to suggest pairs.</p>
      <ol className="idk-steps">
        <li className={googleDone ? "done" : ""}>
          <span className="n">{googleDone ? "✓" : "1"}</span>
          <div>
            <b>Connect Google contacts</b>
            <small>{googleDone ? "Connected." : status.google.linked ? "Your Google account is linked. Allow Index to read your contacts." : "Sign in with Google and allow Index to read your contacts."}</small>
          </div>
          {!googleDone && <button type="button" className="idk-btn go" onClick={onConnect}>Connect Google ▸</button>}
        </li>
        <li className={googleDone ? "" : "todo"}>
          <span className="n">2</span>
          <div>
            <b>Read your contacts</b>
            <small>Your saved contacts and the people you&apos;ve emailed. Index reads them again once a day.</small>
          </div>
          {googleDone && <button type="button" className="idk-btn go" disabled={importing} onClick={onImport}>{importing ? "Reading…" : "Read contacts ▸"}</button>}
        </li>
      </ol>
      <div className="idk-note">Your contacts stay private to you. Nobody else sees them, they are never reached through a network, and never passed on.</div>
      {error && <div className="idk-error">{error}</div>}
    </div>
  );
}

const FILTERS: { key: ContactFilter; label: string }[] = [
  { key: "all", label: "all" },
  { key: "not_on_index", label: "not on Index" },
  { key: "on_index", label: "on Index" },
  { key: "excluded", label: "never suggest" },
];

/** Your imported contacts: search, see who's on Index, and say who never to suggest. */
function Contacts({ service, status, onDeleted }: { service: Service; status: IntroducerStatus; onDeleted: () => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ContactFilter>("all");
  const [rows, setRows] = useState<ContactEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (offset: number) => {
    try {
      const res = await service.contacts(q, filter, offset);
      setTotal(res.total);
      setRows((prev) => (offset === 0 ? res.contacts : [...(prev ?? []), ...res.contacts]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load contacts");
    }
  }, [service, q, filter]);

  useEffect(() => {
    const t = setTimeout(() => void load(0), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const toggle = async (c: ContactEntry) => {
    const excluded = !c.excluded;
    setRows((all) => all?.map((r) => (r.id === c.id ? { ...r, excluded, proposals: excluded ? 0 : r.proposals } : r)) ?? all);
    try {
      await service.setExcluded(c.id, excluded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
      void load(0);
    }
  };

  const deleteAll = async () => {
    if (!window.confirm(`Delete all ${status.contacts.total} contacts from Index? Pairs made from them go too. Introductions you already opened stay. You can read your contacts again later.`)) return;
    setDeleting(true);
    try {
      await service.deleteContacts();
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete");
      setDeleting(false);
    }
  };

  return (
    <div className="idk-contacts">
      <div className="idk-contacts-tools">
        <input type="search" placeholder="Search name, company, email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contacts" />
        <div className="idk-chips" role="tablist" aria-label="Filter contacts">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      </div>
      {error && <div className="idk-error">{error}</div>}
      {rows === null ? (
        <p className="idk-dim">loading contacts…</p>
      ) : rows.length === 0 ? (
        <div className="idk-empty">{q ? "No contact matches that." : filter === "excluded" ? "Nobody is on your never-suggest list." : "No contacts here."}</div>
      ) : (
        <>
          <div className="idk-faint" style={{ fontSize: 11, margin: "0 0 6px" }}>{total} {total === 1 ? "contact" : "contacts"}</div>
          <ul className="idk-clist">
            {rows.map((c) => (
              <li key={c.id} className={c.excluded ? "excluded" : ""}>
                <span className="idk-ghost" aria-hidden>{c.name.slice(0, 1).toUpperCase()}</span>
                <div className="who" title={c.source === "saved" ? "Saved in your Google contacts" : "Someone you've emailed (Google's \"Other contacts\")"}>
                  <b>{c.name}</b>
                  <small>{c.detail ?? c.email}</small>
                  {c.detail && <small className="idk-faint">{c.email}</small>}
                </div>
                <div className="tags">
                  {c.onIndex && <span className="idk-tag">on Index</span>}
                  {c.proposals > 0 && <span className="idk-faint">{c.proposals} pair{c.proposals === 1 ? "" : "s"} waiting</span>}
                </div>
                {!c.onIndex && (
                  <button type="button" className="idk-btn small" onClick={() => void toggle(c)} aria-pressed={c.excluded}>
                    {c.excluded ? "allow" : "never suggest"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {rows.length < total && (
            <button type="button" className="idk-btn small" style={{ marginTop: 10 }} onClick={() => void load(rows.length)}>show more</button>
          )}
        </>
      )}
      <div className="idk-contacts-foot">
        <span>Synced from Google {status.contacts.lastImportAt ? `${since(status.contacts.lastImportAt)} ago` : "never"}. Only you see this list.</span>
        <button type="button" className="idk-btn small danger" disabled={deleting} onClick={() => void deleteAll()}>{deleting ? "deleting…" : "Delete all contacts"}</button>
      </div>
    </div>
  );
}

/**
 * My contacts: your Google contacts, private to you. Connect Google, read
 * them, search them, keep some out of suggestions. Introducing them is its
 * own page, /introduce, which needs these first.
 */
export default function ContactsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const api = useAuthenticatedAPI();
  const service = useMemo(() => createIntroducerService(api), [api]);
  const plain = useInAppFrame();
  const compact = useCompact();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [status, setStatus] = useState<IntroducerStatus | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? "Google didn't connect. Use the Google account with the same email as your Index account." : null);
  const autoImported = useRef(false);

  const load = useCallback(async () => setStatus(await service.status()), [service]);

  const doImport = useCallback(async () => {
    setImporting(true);
    setError(null);
    try {
      await service.importContacts();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }, [service, load]);

  useEffect(() => {
    if (!isAuthenticated) return;
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load"));
  }, [load, isAuthenticated]);

  // Back from Google with the contacts scope: read contacts straight away, once.
  useEffect(() => {
    if (!status || autoImported.current || params.get("connected") !== "1") return;
    autoImported.current = true;
    setParams((p) => { p.delete("connected"); return p; }, { replace: true });
    if (status.google.contactsScope) void doImport();
  }, [status, params, setParams, doImport]);

  const connect = async () => {
    const { data, error: linkError } = await authClient.linkSocial({
      provider: "google",
      scopes: CONTACT_SCOPES,
      callbackURL: `${window.location.origin}${HERE}?connected=1`,
      errorCallbackURL: `${window.location.origin}${HERE}?error=1`,
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
  };

  if (!authLoading && !isAuthenticated) return <Navigate to={`/login?next=${HERE}`} replace />;

  const ready = !!status?.contacts.lastImportAt;
  const headStatus = !ready ? "connect your contacts to start" : `${status?.contacts.total ?? 0} contacts, private to you`;

  const body = !status ? (
    error ? <div className="idk-error">{error}</div> : <p className="idk-dim">loading…</p>
  ) : !ready ? (
    <Setup status={status} importing={importing} error={error} onConnect={() => void connect()} onImport={() => void doImport()} />
  ) : (
    <>
      {error && <div className="idk-error" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="idk-bar">
        <span className="idk-faint" title="Index re-reads your Google contacts once a day">{importing ? "syncing…" : `synced ${since(status.contacts.lastImportAt!)} ago`}</span>
        <span className="sp" />
        <button type="button" className="idk-open" onClick={() => navigate("/introduce")}>introduce them ›</button>
      </div>
      <Contacts service={service} status={status} onDeleted={() => void load()} />
    </>
  );

  if (plain && !compact) {
    return (
      <PageView title="My contacts" sub={<span>{headStatus}</span>}>
        <div className="idk sv-idk-page">{body}</div>
      </PageView>
    );
  }

  if (plain) {
    return (
      <div className="ih-view pl">
        <div className="pl-col">
          <PageHead title="My contacts" status={headStatus} back={{ label: "networks", onClick: () => navigate("/networks") }} />
          <div className="pl-page"><div className="idk">{body}</div></div>
        </div>
      </div>
    );
  }

  return (
    <Stage width={1040} height="min(880px, calc(100vh - 96px))">
      <Window title="my contacts" onClose={() => navigate("/networks")} style={{ height: "100%" }}>
        <div className="mac-scroll" style={{ flex: 1, overflowY: "auto", padding: compact ? "14px 16px 22px" : "18px 24px 22px" }}>
          <div className="idk">{body}</div>
        </div>
      </Window>
    </Stage>
  );
}

export const Component = ContactsPage;
