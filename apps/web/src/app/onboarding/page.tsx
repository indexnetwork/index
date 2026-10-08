import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router";

import { NetworkTile } from "@/app/networks/page";
import { ProfileSettings } from "@/app/settings/page";
import { EmptyState } from "@/components/ui/EmptyState";
import RequestNetworkModal from "@/components/modals/RequestNetworkModal";
import { Btn, Stage, Window } from "@/components/workbench/Workbench";
import { useAuthContext } from "@/contexts/AuthContext";
import { useNetworks, useNetworkRequests } from "@/contexts/APIContext";
import { useNetworksState } from "@/contexts/NetworksContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { log } from "@/lib/logger";
import { needsOnboarding, onboardingService, type PublicProfileLookup } from "@/services/onboarding";

const logger = log.page.from("onboarding");

type Step = "name" | "looking-up" | "review" | "networks";

const LOOKUP_LINES = ["looking you up…", "reading what's already public…", "almost there"];

/**
 * First run: confirm the name, look the person up, review the profile, then
 * pick networks. The review confirms the profile and joins Index Early Birds.
 * The first signal after the networks step completes onboarding.
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

  if (step === "networks") return <ChooseNetworks onContinue={() => navigate("/i/new", { replace: true })} onSignOut={() => void signOut()} />;

  if (step === "review") {
    return (
      <ProfileSettings
        firstRun={{ lookup, name, onDone: () => setStep("networks") }}
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

type ListedNetwork = {
  id: string;
  title?: string;
  imageUrl?: string | null;
  isMember?: boolean;
  memberCount?: number;
  _count?: { members?: number };
};

function memberCount(network: ListedNetwork) {
  return network._count?.members ?? network.memberCount ?? 0;
}

/**
 * After the profile is confirmed the person is already in Index Early Birds.
 * They can join other public networks, or ask for one of their own, then move on.
 */
function ChooseNetworks({ onContinue, onSignOut }: { onContinue: () => void; onSignOut: () => void }) {
  const networksService = useNetworks();
  const networkRequestsService = useNetworkRequests();
  const { networks, loading, error: mineError, refreshNetworks, addNetwork } = useNetworksState();
  const { error: notifyError } = useNotifications();
  const [publicNetworks, setPublicNetworks] = useState<ListedNetwork[]>([]);
  const [loadingPublic, setLoadingPublic] = useState(true);
  const [publicError, setPublicError] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  useEffect(() => {
    void refreshNetworks();
  }, [refreshNetworks]);

  useEffect(() => {
    let cancelled = false;
    setLoadingPublic(true);
    networksService.discoverPublicNetworks(1, 20)
      .then((response) => {
        if (!cancelled) setPublicNetworks((response.data ?? []) as ListedNetwork[]);
      })
      .catch((err) => {
        logger.error("Error loading public networks", { error: err });
        if (!cancelled) setPublicError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingPublic(false);
      });
    return () => { cancelled = true; };
  }, [networksService]);

  const mineIds = new Set(networks.map((network) => network.id));
  const others = publicNetworks.filter((network) => !mineIds.has(network.id) && !network.isMember);

  const join = async (network: ListedNetwork) => {
    try {
      setJoiningId(network.id);
      const result = await networksService.joinNetwork(network.id);
      addNetwork(result.network);
    } catch (err) {
      logger.error("Error joining network", { error: err });
      notifyError("couldn't join that network.");
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <Stage width={520} height="min(640px, calc(100vh - 112px))">
      <Window title="getting started" onClose={onSignOut} style={{ height: "100%" }}>
        <div style={{ padding: "22px 24px 0", flex: "0 0 auto" }}>
          <h1 style={{ fontFamily: "var(--amiga-mono)", fontWeight: 500, fontSize: 20, lineHeight: 1.15, letterSpacing: -0.3, margin: 0, color: "#000" }}>
            you&apos;re <span style={{ fontWeight: 700 }}>in</span>.
          </h1>
          <p style={{ marginTop: 12, marginBottom: 0, fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "#000" }}>
            you&apos;re a member of index early birds. join more networks to widen who your agent talks to.
          </p>
        </div>

        <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 12px" }}>
          <p style={{ fontFamily: "var(--mac-mono)", fontSize: 11, margin: "0 12px 6px" }}>your networks</p>
          {loading && networks.length === 0 ? (
            <EmptyState tone="loading" style={{ padding: "24px 12px" }} />
          ) : mineError && networks.length === 0 ? (
            <EmptyState
              tone="error"
              style={{ padding: "24px 12px" }}
              message="couldn't load your networks."
              action={{ label: "try again", onClick: () => void refreshNetworks() }}
            />
          ) : networks.length === 0 ? (
            <EmptyState style={{ padding: "24px 12px" }} message="index early birds will show up here." />
          ) : (
            networks.map((network) => (
              <NetworkRow key={network.id} network={network as ListedNetwork} trailing={<span style={joinedStyle}>joined</span>} />
            ))
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "18px 12px 6px" }}>
            <p style={{ fontFamily: "var(--mac-mono)", fontSize: 11, margin: 0 }}>public networks</p>
            <button type="button" className="wb-btn small" onClick={() => setRequestOpen(true)}>+ request a network</button>
          </div>
          {loadingPublic && others.length === 0 ? (
            <EmptyState tone="loading" style={{ padding: "24px 12px" }} message="loading public networks…" />
          ) : publicError && others.length === 0 ? (
            <EmptyState tone="error" style={{ padding: "24px 12px" }} message="couldn't load public networks." />
          ) : others.length === 0 ? (
            <EmptyState style={{ padding: "24px 12px" }} message="no other public networks right now." />
          ) : (
            others.map((network) => (
              <NetworkRow
                key={network.id}
                network={network}
                trailing={
                  <button
                    type="button"
                    className="wb-btn small"
                    disabled={joiningId === network.id}
                    onClick={() => void join(network)}
                  >
                    {joiningId === network.id ? "joining…" : "join"}
                  </button>
                }
              />
            ))
          )}
        </div>

        <div style={{ padding: "14px 24px 18px", display: "grid", flex: "0 0 auto" }}>
          <Btn primary onClick={onContinue}>continue →</Btn>
        </div>
      </Window>

      <RequestNetworkModal
        key={requestOpen ? "new" : "closed"}
        open={requestOpen}
        onOpenChange={setRequestOpen}
        onSubmit={networkRequestsService.create}
      />
    </Stage>
  );
}

const joinedStyle = { flex: "0 0 auto", color: "var(--ink-3)", fontFamily: "var(--mac-mono)", fontSize: 13 } as const;

function NetworkRow({ network, trailing }: { network: ListedNetwork; trailing: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderBottom: "1px solid #DDD8CC" }}>
      <NetworkTile id={network.id} name={network.title} photo={network.imageUrl} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontFamily: "var(--mac-mono)", fontSize: 15, fontWeight: 700, color: "#000" }}>{network.title}</span>
        <span style={{ display: "block", marginTop: 2, fontFamily: "var(--mac-sans)", fontSize: 13, color: "var(--ink-2)" }}>{memberCount(network)} members</span>
      </span>
      {trailing}
    </div>
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
