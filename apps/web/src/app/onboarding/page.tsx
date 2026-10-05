import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { ProfileSettings } from "@/app/settings/page";
import { Btn, Stage, Window } from "@/components/workbench/Workbench";
import { useAuthContext } from "@/contexts/AuthContext";
import { needsOnboarding, onboardingService, type PublicProfileLookup } from "@/services/onboarding";

type Step = "name" | "looking-up" | "review";

const LOOKUP_LINES = ["looking you up…", "reading what's already public…", "almost there"];

/**
 * First run, the same three screens as the Mac app: confirm the name, look the
 * person up behind the loader, then review what came back. The review saves
 * and confirms the profile; the first signal after it completes onboarding.
 */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading, signOut } = useAuthContext();
  const [step, setStep] = useState<Step>("name");
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
  if (step === "name" && user && !needsOnboarding(user)) return <Navigate to="/" replace />;

  if (step === "looking-up") return <LookingUp />;

  if (step === "review") {
    return (
      <ProfileSettings
        firstRun={{ lookup, name, onDone: () => navigate("/i/new", { replace: true }) }}
      />
    );
  }

  return (
    <AskName
      initialName={user?.name || ""}
      onSubmit={(confirmed) => { setName(confirmed); setStep("looking-up"); }}
      onSignOut={() => void signOut()}
    />
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
          <h1 style={{ fontFamily: "var(--amiga-mono)", fontWeight: 500, fontSize: 20, lineHeight: 1.15, letterSpacing: -0.3, margin: 0, color: "#000" }}>
            what&apos;s your <span style={{ fontWeight: 700 }}>name</span>?
          </h1>
          <p style={{ marginTop: 12, marginBottom: 0, fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "#000" }}>
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
              background: "transparent", border: "none", borderBottom: "1px solid #000", borderRadius: 0,
              outline: "none", fontFamily: "var(--mac-sans)", fontSize: 16, color: "#000",
            }}
          />
          <div style={{ marginTop: 22, display: "grid" }}>
            <Btn primary type="submit" disabled={!ready}>continue →</Btn>
          </div>
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <button
              type="button"
              onClick={onSignOut}
              style={{ fontFamily: "var(--mac-mono)", fontSize: 10, padding: 0, border: "none", background: "transparent", color: "var(--ink-3)", textDecoration: "underline", cursor: "pointer" }}
            >
              sign out
            </button>
          </div>
        </form>
      </Window>
    </Stage>
  );
}

function LookingUp() {
  return (
    <Stage width={420}>
      <Window title="looking you up" style={{ height: "auto" }}>
        <div style={{ padding: "26px 28px 24px", textAlign: "center" }} role="status" aria-live="polite">
          <div style={{ display: "flex", justifyContent: "center", gap: 10, alignItems: "center", marginBottom: 18 }}>
            <span className="wb-live" style={{ width: 9, height: 9 }} />
            <span style={{ fontFamily: "var(--mac-mono)", letterSpacing: 3, fontSize: 13, textTransform: "uppercase" }}>index</span>
          </div>
          <div style={{ border: "1px solid #000", height: 10, overflow: "hidden", margin: "0 auto 18px", background: "#fff" }}>
            <div style={{ height: "100%", backgroundImage: "repeating-linear-gradient(-45deg, #000 0, #000 6px, #fff 6px, #fff 12px)", animation: "mac-stripes 0.8s linear infinite", backgroundSize: "24px 24px" }} />
          </div>
          {LOOKUP_LINES.map((line, i) => (
            <div key={line} className="fade-up" style={{
              animationDelay: `${i * 350}ms`, fontFamily: "var(--mac-sans)", fontSize: 15,
              color: i === LOOKUP_LINES.length - 1 ? "#000" : "var(--ink-2)",
              letterSpacing: 0.2, padding: "4px 0",
              fontWeight: i === LOOKUP_LINES.length - 1 ? 700 : 400,
            }}>
              <span style={{ marginRight: 8, fontFamily: "var(--mac-mono)" }}>›</span>{line}
            </div>
          ))}
        </div>
      </Window>
    </Stage>
  );
}

export const Component = OnboardingPage;
