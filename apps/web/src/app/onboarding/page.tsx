import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { ProfileSettings } from "@/app/settings/page";
import { Btn, Stage, Window } from "@/components/workbench/Workbench";
import { useAuthContext } from "@/contexts/AuthContext";
import { needsOnboarding, onboardingService, type PublicProfileLookup } from "@/services/onboarding";

type Step = "name" | "looking-up" | "review" | "how";

const LOOKUP_LINES = ["looking you up…", "reading what's already public…", "almost there"];

const HOW_STEPS = [
  { title: "tell me what you're after", body: "\"a cofounder who's shipped ai.\" \"investors who get devtools.\" each one is an intent. i'll draft a few from your profile next." },
  { title: "i go find them", body: "in the background, i talk with other people's agents on index and check who fits, both ways." },
  { title: "you decide who to meet", body: "every opportunity says who and why. say yes to start a chat, or pass. nobody is introduced without you." },
];

/**
 * First run: confirm the name, look the person up, review the profile, a
 * short how-it-works, then the first intent. The review confirms the profile; the first
 * intent completes onboarding.
 */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading, signOut } = useAuthContext();
  // Coming back from the first intent (the step after these) lands on how-it-works.
  const cameBack = (useLocation().state as { step?: Step } | null)?.step === "how";
  const [step, setStep] = useState<Step>(cameBack ? "how" : "name");
  // Once the review is confirmed, going back shows the saved profile, not the lookup's note.
  const [confirmed, setConfirmed] = useState(cameBack);
  const [moved, setMoved] = useState(cameBack);
  const [name, setName] = useState("");
  const [lookup, setLookup] = useState<PublicProfileLookup | null>(null);

  useEffect(() => {
    if (step !== "looking-up") return;
    let cancelled = false;
    // Nothing found is not a failure: the review just opens empty and says so.
    onboardingService.lookUp(name)
      .catch(() => null)
      .then((result) => {
        if (cancelled) return;
        setLookup(result);
        setStep("review");
      });
    return () => { cancelled = true; };
  }, [step, name]);

  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login?next=/onboarding" replace />;
  // Already confirmed (another tab, the Mac app): nothing to set up here.
  // Not when they stepped back here themselves.
  if (step === "name" && !moved && user && !needsOnboarding(user)) return <Navigate to="/" replace />;

  const onSignOut = () => void signOut();

  let body;
  if (step === "looking-up") body = <LookingUp />;
  else if (step === "how") body = <HowItWorks onDone={() => navigate("/i/new", { replace: true })} onBack={() => setStep("review")} onSignOut={onSignOut} />;
  else if (step === "review") body = <ProfileSettings firstRun={{ lookup, name, returning: confirmed, onBack: () => setStep("name"), onDone: () => { setConfirmed(true); setStep("how"); } }} />;
  else {
    body = (
      <AskName
        initialName={name || user?.name || ""}
        onSubmit={(typed) => { setName(typed); setMoved(true); setStep("looking-up"); }}
        onSignOut={onSignOut}
      />
    );
  }

  // The steps carry no title bar here, so the way out sits in the corner of the page instead.
  return (
    <>
      <button type="button" className="wb-onboarding-out" onClick={onSignOut}>sign out</button>
      {body}
    </>
  );
}

function AskName({ initialName, onSubmit, onSignOut }: {
  initialName: string;
  onSubmit: (name: string) => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState(initialName);
  const ready = !!name.trim();

  return (
    <Stage width={420}>
      <Window title="getting started" onClose={onSignOut} style={{ height: "auto" }}>
        <form
          onSubmit={(e) => { e.preventDefault(); if (ready) onSubmit(name.trim()); }}
          style={{ padding: "30px 30px 26px" }}
        >
          {/* Smaller than the sign-in heading: that one introduces the app, this one asks a question. */}
          <h1 style={{ fontFamily: "var(--mac-sans)", fontWeight: 500, fontSize: 16, lineHeight: 1.3, margin: 0, color: "var(--ink)" }}>
            what&apos;s your <span style={{ fontWeight: 500 }}>name</span>?
          </h1>
          <p style={{ marginTop: 12, marginBottom: 0, fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
            i&apos;ll use it to find what&apos;s already public about you, so you don&apos;t
            have to type it all out.
          </p>
          {/* Underlined, not a sunken well: it is the only thing on the card, the line to write on. */}
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="your name"
            aria-label="your name"
            style={{
              width: "100%", marginTop: 22, padding: "7px 0",
              background: "transparent", border: "none", borderBottom: "1px solid var(--wb-control)", borderRadius: 0,
              outline: "none", fontFamily: "var(--mac-sans)", fontSize: 16, color: "var(--ink)",
            }}
          />
          <div style={{ marginTop: 22, display: "flex" }}>
            <Btn primary type="submit" disabled={!ready}>continue →</Btn>
          </div>
        </form>
      </Window>
    </Stage>
  );
}

function HowItWorks({ onDone, onBack, onSignOut }: { onDone: () => void; onBack: () => void; onSignOut: () => void }) {
  return (
    <Stage width={960}>
      <Window title="how this works" onClose={onSignOut} style={{ height: "auto" }}>
        <div style={{ padding: "36px 40px 30px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "26px 44px" }}>
            {HOW_STEPS.map((step, i) => (
              <div key={step.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{
                  flex: "0 0 auto", width: 26, height: 26, display: "grid", placeItems: "center",
                  background: "#ededea", color: "var(--ink-2)", borderRadius: "50%",
                  fontFamily: "var(--mac-sans)", fontSize: 12, fontWeight: 500,
                }}>{i + 1}</span>
                <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--mac-sans)", fontSize: 14, fontWeight: 500, lineHeight: 1.3, color: "var(--ink)" }}>{step.title}</div>
                  <div style={{ fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>{step.body}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 32, display: "flex", alignItems: "center", gap: 14 }}>
            <Btn primary onClick={onDone}>got it →</Btn>
            <button type="button" className="st-link" onClick={onBack}>‹ back</button>
          </div>
        </div>
      </Window>
    </Stage>
  );
}

function LookingUp() {
  return (
    <Stage width={420}>
      <Window title="looking you up" style={{ height: "auto" }}>
        <div style={{ padding: "26px 28px 24px", textAlign: "center" }} role="status" aria-live="polite">
          {LOOKUP_LINES.map((line, i) => (
            <div key={line} className="fade-up" style={{
              animationDelay: `${i * 350}ms`, fontFamily: "var(--mac-sans)", fontSize: 14,
              color: i === LOOKUP_LINES.length - 1 ? "var(--ink)" : "var(--ink-2)",
              padding: "4px 0",
              fontWeight: i === LOOKUP_LINES.length - 1 ? 500 : 400,
            }}>
              <span style={{ marginRight: 8, color: "var(--ink-3)" }}>›</span>{line}
            </div>
          ))}
        </div>
      </Window>
    </Stage>
  );
}

export const Component = OnboardingPage;
