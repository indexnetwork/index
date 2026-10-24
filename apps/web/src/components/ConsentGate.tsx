import { useState, type ReactNode } from "react";

import { Btn, Stage, Window } from "@/components/workbench/Workbench";
import { useAuthContext } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/api";

/** V4 participation consent, kept as written. */
const FORM = [
  "We are a team of scientists at the Cooperative Futures Institute out of Arizona State University. We are conducting research about the Zombie Apocalypse Medicine Meeting 2026 \"Agent Village\" study taking place between October 26 and October 28, 2026. I am inviting your participation in this study for the three-day duration of the conference. Participation is voluntary, free of charge, and you have the right to not participate or stop participation at any time over the course of the conference’s three-day duration. You must be 18 years or older to participate.",
  "Participation consists of using the Agent Village network over the course of the study as much or as little as one desires, with no requirement or expectation of a certain level of engagement. You will not be compensated for your participation. Although there is no direct benefit to you, your participation will help us better understand how best to leverage large agent networks in academic settings. There are no foreseeable risks or discomforts associated with participation in the Agent Village beyond those ordinarily encountered in daily life.",
  "As part of this research, Index Network, the developers behind the Agent Village, will share the data Agent Village collects over the course of the study’s duration (text chat logs between individual attendees and their respective AI agents; text chat logs between agents during the social discovery matching process; and general system metrics, i.e. number of matches accepted, number of matches denied, and number of interactions between users and their agents) with us. This transferred data will be de-identified, but free-text content may contain identifying details that could be traced back to specific users. The research team will work to remove such details from any published material but cannot guarantee that data will never be traceable back to you. Research data will be stored on the ASU instance of Dropbox for Education, accessible only to members of the research team, and will be deleted no later than three years after the conclusion of ZAMM 2026. Results of this research may be used in reports, presentations, or publications, and may be shared with Index Network.",
  "After the conclusion of the ZAMM 2026 conference on October 28, 2026, you will be emailed a followup survey regarding your experience with the Agent Village. That survey is separate and optional.",
  "If you have any questions concerning the research study, please contact the research team at: Dr. Athena Aktipis, Principal Investigator, Department of Psychology, Arizona State University, aktipis@asu.edu.",
  "If you have any questions about your rights as a subject/participant in this research, or if you feel you have been placed at risk, you can contact the Chair of the Human Subjects Institutional Review Board, through the ASU Office of Research Integrity and Assurance, at (480) 965-6788.",
  "ASU IRB Protocol Number: STUDY00024518",
  "By signing and selecting \"I agree\" below, you confirm that you are 18 or older, that you have read and understood this consent form, and that you voluntarily agree to participate.",
];

type PendingConsent = { networkId: string; networkTitle: string; version: string };

function pendingOf(user: unknown): PendingConsent[] {
  const list = (user as { pendingConsents?: PendingConsent[] } | null)?.pendingConsents;
  return Array.isArray(list) ? list : [];
}

/**
 * Blocks the signed-in app until every flagged membership has a privacy-policy
 * checkbox and a signed participation consent. Bare routes never mount this.
 */
export default function ConsentGate({ children }: { children: ReactNode }) {
  const { user, refetchUser, signOut } = useAuthContext();
  const pending = pendingOf(user);
  const [privacy, setPrivacy] = useState(false);
  const [participation, setParticipation] = useState(false);
  const [signature, setSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = pending[0];
  if (!current) return children;

  const ready = privacy && participation && !!signature.trim() && !submitting;

  const submit = async () => {
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post("/auth/consent", {
        networkId: current.networkId,
        signature: signature.trim(),
        privacyPolicy: true,
        participation: true,
      });
      setPrivacy(false);
      setParticipation(false);
      setSignature("");
      await refetchUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't record consent");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="workbench mac-desktop wb-viewport">
      <Stage width={640} height="100%">
        <Window title="participation consent" onClose={() => void signOut()} style={{ height: "100%" }}>
          <form
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
            style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
          >
            <div style={{ overflow: "auto", padding: "22px 26px 8px", flex: 1 }}>
              <h1 style={{ fontFamily: "var(--amiga-mono)", fontWeight: 700, fontSize: 16, lineHeight: 1.3, margin: 0, color: "#000" }}>
                ZAMM 2026 Agent Village Participation — Consent Form
              </h1>
              <p style={{ margin: "10px 0 0", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.45, color: "var(--ink-2)" }}>
                Required to continue in {current.networkTitle}.
              </p>
              {FORM.map((paragraph) => (
                <p key={paragraph.slice(0, 24)} style={{ margin: "12px 0 0", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "#000" }}>
                  {paragraph}
                </p>
              ))}
            </div>
            <div style={{ flex: "0 0 auto", borderTop: "1px solid #000", padding: "14px 26px 18px", display: "grid", gap: 12 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.4, color: "#000" }}>
                <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} style={{ marginTop: 2 }} />
                <span>
                  I have read and agree to Index Network&apos;s{" "}
                  <a href="/pages/privacy-policy" target="_blank" rel="noreferrer" style={{ color: "#000" }}>Privacy Policy</a>.
                </span>
              </label>
              <label style={{ display: "grid", gap: 6, fontFamily: "var(--mac-sans)", fontSize: 13, color: "#000" }}>
                Signature
                <input
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="type your full name"
                  aria-label="Signature"
                  autoComplete="name"
                  style={{
                    width: "100%", padding: "6px 0", background: "transparent",
                    border: "none", borderBottom: "1px solid #000", borderRadius: 0,
                    outline: "none", fontFamily: "var(--mac-sans)", fontSize: 16, color: "#000",
                  }}
                />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.4, color: "#000" }}>
                <input type="checkbox" checked={participation} onChange={(e) => setParticipation(e.target.checked)} style={{ marginTop: 2 }} />
                <span>I agree and wish to participate.</span>
              </label>
              {error && (
                <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 13, color: "#000" }}>{error}</p>
              )}
              <Btn primary type="submit" disabled={!ready}>{submitting ? "saving…" : "I agree"}</Btn>
            </div>
          </form>
        </Window>
      </Stage>
    </div>
  );
}
