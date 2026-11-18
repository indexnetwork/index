import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Network } from '@/lib/types';
import { ConfirmWindow } from '@/components/workbench/Workbench';
import { IntentAction } from '@/components/workbench/mac-blocks';
import { useNetworksState } from '@/contexts/NetworksContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useNetworkFilter } from '@/contexts/NetworkFilterContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { useNetworks } from '@/contexts/APIContext';
import { log } from '@/lib/logger';
import { EmptyState } from "@/components/ui/EmptyState";
import { useInAppFrame } from "@/components/intents-home/appFrameContext";

const logger = log.ui.from('NetworkOverviewPanel');

interface NetworkOverviewPanelProps {
  network: Network;
  isOwner: boolean;
  onLeft?: () => void;
  onLeaveRequest?: boolean;
  onLeaveRequestHandled?: () => void;
}

export default function NetworkOverviewPanel({ network, onLeft, onLeaveRequest, onLeaveRequestHandled }: NetworkOverviewPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { removeNetwork } = useNetworksState();
  const { success, error } = useNotifications();
  const { setSelectedNetworkIds } = useNetworkFilter();
  const api = useAuthenticatedAPI();
  const networksService = useNetworks();
  const plain = useInAppFrame();

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
    setHiddenIds([]);
    setUndo(null);
    setIntents([]);
    setOverviewLoading(true);
  }, [network.id]);

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
      success(t('Left {{title}}', { title: network.title }));
      setLeaveConfirmation(false);
      onLeft?.();
    } catch (err) {
      logger.error('Error leaving network', { error: err });
      error(t('Failed to leave network'));
    } finally {
      setIsLeaving(false);
    }
  };

  const handleRemove = async (intentId: string) => {
    setHiddenIds((ids) => (ids.includes(intentId) ? ids : [...ids, intentId]));
    setUndo({ id: intentId, at: 0 });
    try {
      await api.delete(`/intents/${intentId}/networks/${network.id}`);
    } catch (err) {
      logger.error('Error removing intent from network', { error: err });
      setHiddenIds((ids) => ids.filter((id) => id !== intentId));
      setUndo((current) => (current?.id === intentId ? null : current));
      error(t('Failed to remove intent'));
    }
  };

  const handlePutBack = async () => {
    if (!undo) return;
    const intentId = undo.id;
    setHiddenIds((ids) => ids.filter((id) => id !== intentId));
    setUndo(null);
    try {
      await api.post(`/intents/${intentId}/networks`, { networkId: network.id });
    } catch (err) {
      logger.error('Error restoring intent to network', { error: err });
      setHiddenIds((ids) => (ids.includes(intentId) ? ids : [...ids, intentId]));
      setUndo({ id: intentId, at: 0 });
      error(t('Failed to restore intent'));
    }
  };

  const visible = intents.filter((intent) => !hiddenIds.includes(intent.id));

  const leaveDialog = showLeaveConfirmation && (
    <ConfirmWindow
      title={t("leave")}
      body={t('leave {{title}}? you can rejoin later if the network is public or you are invited again.', { title: network.title })}
      confirmLabel={isLeaving ? t("leaving") : t("leave")}
      busy={isLeaving}
      onCancel={() => { if (!isLeaving) setLeaveConfirmation(false); }}
      onConfirm={() => void handleLeaveNetwork()}
    />
  );

  // Inside the desktop shell: plain rows like the rest of the app.
  if (plain) {
    return (
      <>
        <h2>{t('your intents here')} {!overviewLoading && `(${visible.length})`}</h2>
        {undo && (
          <div className="pl-netdetail-undo">
            <span>{t('removed from {{title}}. the intent is still running everywhere else.', { title: network.title })}</span>
            <button type="button" onClick={() => { void handlePutBack(); }}>{t('put it back')}</button>
          </div>
        )}
        {overviewLoading ? (
          <p className="pl-dim">{t('loading')}<span className="pl-blink">_</span></p>
        ) : overviewFailed && visible.length === 0 ? (
          <div className="pl-profile-empty">
            <p>{t("couldn't load your intents in this network.")}</p>
            <button type="button" onClick={() => { setOverviewLoading(true); setReloadKey((k) => k + 1); }}>{t('try again')}</button>
          </div>
        ) : visible.length === 0 ? (
          <div className="pl-profile-empty">
            <p>{t("you haven't shared any intents in this network yet.")}</p>
            <button type="button" className="go" onClick={() => navigate("/i/new")}>{t('+ new intent')}</button>
          </div>
        ) : (
          <ul className="pl-rows pl-netdetail-intents">
            {visible.map((intent) => {
              const text = intent.payload?.trim() || intent.summary?.trim() || t("untitled intent");
              const date = intent.createdAt ? new Date(intent.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
              return (
                <li key={intent.id}>
                  <div className="pl-netdetail-intent">
                    <button type="button" className="pl-row" onClick={() => handleOpenIntent(intent)} title={t("open this intent")}>
                      <span className="pl-row-title">{text}</span>
                      {date && <span className="pl-net-n">{date}</span>}
                    </button>
                    <button type="button" className="pl-netdetail-remove" title={t('stop sharing this intent with {{title}}. it keeps running elsewhere', { title: network.title })} onClick={() => { void handleRemove(intent.id); }}>{t('remove')}</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {leaveDialog}
      </>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <p style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>{t("your intents")}</p>
        <span style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-2)" }}>{overviewLoading ? "…" : visible.length === 1 ? t("{{count}} intent", { count: visible.length }) : t("{{count}} intents", { count: visible.length })}</span>
          {/* The empty state has its own big button; once intents exist, this keeps adding more one click away. */}
          {!overviewLoading && visible.length > 0 && <IntentAction label={t('+ new intent')} onClick={() => navigate("/i/new")} />}
        </span>
      </div>
      {undo && (
        <div style={{ marginBottom: 10, padding: "8px 12px", border: "1px solid #e3e3e0", borderRadius: 3, background: "#f7f7f5", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#555" }}>{t('removed from {{title}}. the intent is still running everywhere else.', { title: network.title })}</span>
          <button type="button" onClick={() => { void handlePutBack(); }} style={{ flex: "0 0 auto", cursor: "pointer", padding: "4px 11px", border: "1px solid #ddd", borderRadius: 3, background: "#fff", color: "var(--ink)", fontSize: 12 }}>{t('put it back')}</button>
        </div>
      )}
      <div style={{ display: "grid", gap: 10 }}>
        {visible.map((intent) => {
          const text = (intent.payload?.trim() || intent.summary?.trim() || t("untitled intent"));
          const date = intent.createdAt ? new Date(intent.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
          return (
            <div key={intent.id} onClick={() => handleOpenIntent(intent)} style={{ border: "1px solid #e3e3e0", borderRadius: 3, background: "#fff", padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 14, cursor: "pointer" }}>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink)" }}>{text}</div>
                {date && <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{date}</span>}
              </div>
              <span title={t('stop sharing this intent with {{title}}. it keeps running elsewhere', { title: network.title })} style={{ flex: "0 0 auto" }} onClick={(event) => event.stopPropagation()}>
                <IntentAction label={t("− remove")} onClick={() => { void handleRemove(intent.id); }} />
              </span>
            </div>
          );
        })}
      </div>
      {overviewLoading && <EmptyState tone="loading" />}
      {!overviewLoading && overviewFailed && visible.length === 0 && (
        <EmptyState
          tone="error"
          message={t("couldn't load your intents in this network.")}
          action={{ label: t("try again"), onClick: () => { setOverviewLoading(true); setReloadKey((k) => k + 1); } }}
        />
      )}
      {!overviewLoading && !overviewFailed && visible.length === 0 && (
        // Starting an intent is the one thing to do here, so it gets the home
        // window's primary button rather than the small empty-state one.
        <div style={{ border: "1px solid #e3e3e0", borderRadius: 3, padding: "22px 18px", display: "grid", justifyItems: "center", gap: 14, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
            {t("you haven't shared any intents in this network yet.")}
          </p>
          <Link to="/i/new" className="wb-new-intent" style={{ width: "auto", marginTop: 0, padding: "8px 16px 8px 12px", gap: 8, textDecoration: "none" }}>
            <span style={{ width: 16, display: "grid", placeItems: "center", color: "var(--ink)", fontSize: 16, fontWeight: 400 }}>+</span>
            <span style={{ color: "var(--ink)", fontSize: 13, fontWeight: 500 }}>{t("start an intent")}</span>
          </Link>
        </div>
      )}

      {leaveDialog}
    </>
  );
}
