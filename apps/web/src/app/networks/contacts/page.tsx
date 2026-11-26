import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router";

import PageHead from "@/components/intents-home/PageHead";
import { PageView } from "@/components/intents-home/SplitView";
import { useUndo } from "@/components/intents-home/undo";
import { useInAppFrame } from "@/components/intents-home/appFrameContext";
import { Stage, Window } from "@/components/workbench/Workbench";
import { ContactsSetup } from "@/components/ContactsImport";
import { useAuthContext } from "@/contexts/AuthContext";
import { useCompact } from "@/hooks/useCompact";
import { useContactsImport } from "@/hooks/useContactsImport";
import { useAuthenticatedAPI } from "@/lib/api";
import { since } from "@/lib/since";
import { createIntroducerService, type ContactEntry, type ContactFilter, type IntroducerStatus } from "@/services/introducer";
import "@/styles/plain.css";
import "@/styles/introduce.css";

type Service = ReturnType<typeof createIntroducerService>;

const HERE = "/networks/contacts";

const FILTERS: { key: ContactFilter; label: string }[] = [
  { key: "all", label: "all" },
  { key: "not_on_index", label: "not on Index" },
  { key: "on_index", label: "on Index" },
];

/** Your imported contacts: search them, see who's on Index, remove the ones you don't want here. */
function Contacts({ service, status, onDeleted, onRemoved }: { service: Service; status: IntroducerStatus; onDeleted: () => void; onRemoved: () => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ContactFilter>("all");
  const [rows, setRows] = useState<ContactEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const later = useUndo();
  // Removals wait behind "undo" for a few seconds before they reach the server.
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());

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

  const unmark = (id: string) => setRemoving((all) => { const next = new Set(all); next.delete(id); return next; });

  const remove = (c: ContactEntry) => {
    setRemoving((all) => new Set(all).add(c.id));
    later(`removed ${c.name}`, () => {
      service.removeContact(c.id)
        .then(() => {
          setRows((all) => all?.filter((r) => r.id !== c.id) ?? all);
          setTotal((n) => Math.max(0, n - 1));
          onRemoved();
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't remove"))
        .finally(() => unmark(c.id));
    }, () => unmark(c.id));
  };

  const shown = rows?.filter((r) => !removing.has(r.id)) ?? null;
  const shownTotal = total - (rows?.length ?? 0) + (shown?.length ?? 0);

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
      {shown === null ? (
        <p className="idk-dim">loading contacts…</p>
      ) : shown.length === 0 ? (
        <div className="idk-empty">{q ? "No contact matches that." : "No contacts here."}</div>
      ) : (
        <>
          <div className="idk-faint" style={{ fontSize: 11, margin: "0 0 6px" }}>{shownTotal} {shownTotal === 1 ? "contact" : "contacts"}</div>
          <ul className="idk-clist">
            {shown.map((c) => (
              <li key={c.id}>
                <span className="idk-ghost" aria-hidden>{c.name.slice(0, 1).toUpperCase()}</span>
                <div className="who" title={c.source === "saved" ? "Saved in your Google contacts" : "Someone you've emailed (Google's \"Other contacts\")"}>
                  <b>{c.name}</b>
                  <small>{c.detail ?? c.email}</small>
                  {c.detail && <small className="idk-faint">{c.email}</small>}
                </div>
                <div className="tags">
                  {c.onIndex && <span className="idk-tag">on Index</span>}
                  {c.excluded && <span className="idk-faint">never suggested</span>}
                </div>
                <button type="button" className="idk-btn small" onClick={() => remove(c)} title="Take them off your contacts. The daily sync won't bring them back.">remove</button>
              </li>
            ))}
          </ul>
          {rows !== null && rows.length < total && (
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
 * them, search them, remove the ones you don't want. Introducing them, and
 * saying who never to suggest, is its own page, /introduce.
 */
export default function ContactsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const api = useAuthenticatedAPI();
  const service = useMemo(() => createIntroducerService(api), [api]);
  const plain = useInAppFrame();
  const compact = useCompact();
  const navigate = useNavigate();

  const [status, setStatus] = useState<IntroducerStatus | null>(null);
  const load = useCallback(async () => setStatus(await service.status()), [service]);
  const { importing, error, setError, connect, doImport } = useContactsImport({ service, status, reload: load, here: HERE });

  useEffect(() => {
    if (!isAuthenticated) return;
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load"));
  }, [load, isAuthenticated, setError]);

  if (!authLoading && !isAuthenticated) return <Navigate to={`/login?next=${HERE}`} replace />;

  const ready = !!status?.contacts.lastImportAt;
  const headStatus = !ready ? "connect your contacts to start" : `${status?.contacts.total ?? 0} contacts, private to you`;

  const body = !status ? (
    error ? <div className="idk-error">{error}</div> : <p className="idk-dim">loading…</p>
  ) : !ready ? (
    <ContactsSetup status={status} importing={importing} error={error} onConnect={() => void connect()} onImport={() => void doImport()}>
      <p><b>Bring the people you know.</b> Index reads your saved Google contacts and the people you&apos;ve emailed, and marks who is already on Index. Introduce uses them to suggest pairs.</p>
    </ContactsSetup>
  ) : (
    <>
      {error && <div className="idk-error" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="idk-bar">
        <span className="idk-faint" title="Index re-reads your Google contacts once a day">{importing ? "syncing…" : `synced ${since(status.contacts.lastImportAt!)} ago`}</span>
      </div>
      <Contacts service={service} status={status} onDeleted={() => void load()} onRemoved={() => void load()} />
    </>
  );

  if (plain && !compact) {
    return (
      <PageView title="My contacts" sub={<span>{headStatus}</span>} back={{ label: "networks", onClick: () => navigate("/networks") }}>
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
