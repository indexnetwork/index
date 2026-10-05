import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { Network } from '@/lib/types';
import { ConfirmWindow } from '@/components/workbench/Workbench';
import { SignalAction } from '@/components/workbench/mac-blocks';
import { useNetworksState } from '@/contexts/NetworksContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useNetworkFilter } from '@/contexts/NetworkFilterContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { useNetworks } from '@/contexts/APIContext';
import { log } from '@/lib/logger';
import { EmptyState } from "@/components/ui/EmptyState";

const logger = log.ui.from('NetworkOverviewPanel');

interface NetworkOverviewPanelProps {
  network: Network;
  isOwner: boolean;
  onLeft?: () => void;
  onLeaveRequest?: boolean;
  onLeaveRequestHandled?: () => void;
}

export default function NetworkOverviewPanel({ network, onLeft, onLeaveRequest, onLeaveRequestHandled }: NetworkOverviewPanelProps) {
  const navigate = useNavigate();
  const { removeNetwork } = useNetworksState();
  const { success, error } = useNotifications();
  const { setSelectedNetworkIds } = useNetworkFilter();
  const api = useAuthenticatedAPI();
  const networksService = useNetworks();

  // The parent can also ask for the dialog via `onLeaveRequest`; both sources
  // are combined during render rather than mirrored into state by an effect.
  const [leaveConfirmationOpen, setLeaveConfirmationOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const showLeaveConfirmation = leaveConfirmationOpen || !!onLeaveRequest;

  const setLeaveConfirmation = (open: boolean) => {
    setLeaveConfirmationOpen(open);
    if (!open) onLeaveRequestHandled?.();
  };

  const [intents, setIntents] = useState<{
    id: string;
    payload: string;
    summary?: string | null;
    createdAt: string;
    userId: string;
    userName: string;
  }[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ id: string; at: number } | null>(null);

  useEffect(() => {
    const loadOverview = async () => {
      try {
        const overview = await networksService.getNetworkOverview(network.id);
        setIntents(overview.intents);
        setOverviewFailed(false);
      } catch (err) {
        logger.error('Error loading network overview', { error: err });
        setOverviewFailed(true);
      } finally {
        setOverviewLoading(false);
      }
    };
    loadOverview();
  }, [network.id, networksService, reloadKey]);

  const handleOpenIntent = useCallback((intent: { id: string }) => {
    setSelectedNetworkIds([]);
    navigate(`/i/${intent.id}`);
  }, [setSelectedNetworkIds, navigate]);

  const handleLeaveNetwork = async () => {
    try {
      setIsLeaving(true);
      await api.post(`/networks/${network.id}/leave`, {});
      removeNetwork(network.id);
      success(`Left ${network.title}`);
      setLeaveConfirmation(false);
      onLeft?.();
    } catch (err) {
      logger.error('Error leaving network', { error: err });
      error('Failed to leave network');
    } finally {
      setIsLeaving(false);
    }
  };

  const visible = intents.filter((intent) => !hiddenIds.includes(intent.id));

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <p style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>your signals</p>
        <span style={{ fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-2)" }}>{overviewLoading ? "…" : `${visible.length} signal${visible.length === 1 ? "" : "s"}`}</span>
      </div>
      {undo && (
        <div style={{ marginBottom: 10, padding: "8px 12px", border: "1px solid #000", background: "#F2F0EC", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontFamily: "var(--mac-sans)", fontSize: 12 }}>removed from {network.title}. the signal is still running everywhere else.</span>
          <button type="button" onClick={() => { setHiddenIds((ids) => ids.filter((id) => id !== undo.id)); setUndo(null); }} style={{ flex: "0 0 auto", cursor: "pointer", padding: "4px 11px", border: "1px solid #000", background: "#fff", fontFamily: "var(--mac-mono)", fontSize: 11, boxShadow: "1px 1px 0 rgba(0,0,0,0.2)" }}>put it back</button>
        </div>
      )}
      <div style={{ display: "grid", gap: 10 }}>
        {visible.map((intent) => {
          const text = (intent.payload?.trim() || intent.summary?.trim() || "untitled signal");
          const date = intent.createdAt ? new Date(intent.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
          return (
            <div key={intent.id} onClick={() => handleOpenIntent(intent)} style={{ border: "1px solid #000", background: "#fff", boxShadow: "2px 2px 0 rgba(0,0,0,0.22)", padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 14, cursor: "pointer" }}>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 9 }}>
                <div style={{ fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5 }}>{text}</div>
                {date && <span style={{ fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-2)" }}>▤ {date}</span>}
              </div>
              <span title={`stop sharing this signal with ${network.title}. it keeps running elsewhere`} style={{ flex: "0 0 auto" }} onClick={(event) => event.stopPropagation()}>
                <SignalAction label="− remove" onClick={() => { setHiddenIds((ids) => [...ids, intent.id]); setUndo({ id: intent.id, at: 0 }); }} />
              </span>
            </div>
          );
        })}
      </div>
      {overviewLoading && <EmptyState tone="loading" />}
      {!overviewLoading && overviewFailed && visible.length === 0 && (
        <EmptyState
          tone="error"
          message="couldn't load your signals in this network."
          action={{ label: "try again", onClick: () => { setOverviewLoading(true); setReloadKey((k) => k + 1); } }}
        />
      )}
      {!overviewLoading && !overviewFailed && visible.length === 0 && (
        // Starting a signal is the one thing to do here, so it gets the home
        // window's primary button rather than the small empty-state one.
        <div style={{ border: "1px dashed var(--ink-3)", padding: "22px 18px", display: "grid", justifyItems: "center", gap: 14, textAlign: "center" }}>
          <p style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)" }}>
            you haven&apos;t shared any signals in this network yet.
          </p>
          <Link to="/i/new" className="wb-new-signal" style={{ width: "auto", marginTop: 0, padding: "11px 22px 11px 16px", textDecoration: "none" }}>
            <span style={{ width: 24, height: 24, display: "grid", placeItems: "center", background: "#fff", color: "#000", border: "1px solid #000", fontFamily: "var(--mac-mono)", fontSize: 16, fontWeight: 700 }}>+</span>
            <span style={{ fontFamily: "var(--mac-sans)", fontSize: 15, fontWeight: 700 }}>start a signal</span>
          </Link>
        </div>
      )}

      {showLeaveConfirmation && (
        <ConfirmWindow
          title="leave"
          body={`leave ${network.title}? you can rejoin later if the network is public or you are invited again.`}
          confirmLabel={isLeaving ? "leaving" : "leave"}
          busy={isLeaving}
          onCancel={() => { if (!isLeaving) setLeaveConfirmation(false); }}
          onConfirm={() => void handleLeaveNetwork()}
        />
      )}
    </>
  );
}
