import type { ReactNode } from "react";

import type { IntroducerStatus } from "@/services/introducer";

/** The two steps: connect Google contacts, then read them. */
export function ContactsSetup({ status, importing, error, onConnect, onImport, children }: {
  status: IntroducerStatus;
  importing: boolean;
  error: string | null;
  onConnect: () => void;
  onImport: () => void;
  children: ReactNode;
}) {
  const googleDone = status.google.linked && status.google.contactsScope;
  return (
    <div className="idk-setup">
      {children}
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
