import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router';

import { Network } from '@/lib/types';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNetworksState } from '@/contexts/NetworksContext';
import { JoinRequest, Member } from '@/services/networks';
import UserAvatar from '@/components/UserAvatar';
import { GhostTag } from '@/components/workbench/mac-blocks';
import { RuleLabel } from '@/components/workbench/Workbench';
import { log } from '@/lib/logger';
import { EmptyState } from "@/components/ui/EmptyState";
import { useCompact } from "@/hooks/useCompact";

const logger = log.ui.from('AccessTab');
const MEMBERS_PAGE_SIZE = 10;
const act: React.CSSProperties = {
  flex: "0 0 auto", cursor: "pointer", padding: "2px 8px", border: "1px solid #000", background: "#fff",
  fontFamily: "var(--mac-mono)", fontSize: 11, color: "#000",
};

interface AccessTabProps {
  network: Network;
  networkId: string;
  networkService: ReturnType<typeof import('@/contexts/APIContext').useNetworks>;
  onUpdated: (network: Network) => void;
  success: (msg: string, detail?: string) => void;
  error: (msg: string) => void;
  info: (msg: string, detail?: string, duration?: number) => void;
}

export default function AccessTab({
  network,
  networkId,
  networkService,
  onUpdated,
  success,
  error,
  info: _info,
}: AccessTabProps) {
  const navigate = useNavigate();
  const compact = useCompact();
  const { user: currentUser } = useAuthContext();
  const { refreshNetworks } = useNetworksState();

  const [anyoneCanJoin, setAnyoneCanJoin] = useState(network.permissions?.joinPolicy === 'anyone');
  const [requireApproval, setRequireApproval] = useState(network.permissions?.requireAdminApproval === true);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [suggestedUsers, setSuggestedUsers] = useState<Member[]>([]);
  const [isMembersLoading, setIsMembersLoading] = useState(true);
  const [membersFailed, setMembersFailed] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchIsLoading, setSearchIsLoading] = useState(false);
  const [searchHasQueried, setSearchHasQueried] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [invitationLink, setInvitationLink] = useState<{ code: string } | null>(null);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [isRegeneratingLink, setIsRegeneratingLink] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [membersPage, setMembersPage] = useState(1);

  /* eslint-disable react-hooks/set-state-in-effect -- syncs local state from prop changes */
  useEffect(() => {
    setAnyoneCanJoin(network.permissions?.joinPolicy === 'anyone');
    setRequireApproval(network.permissions?.requireAdminApproval === true);
    if (network.permissions?.invitationLink?.code) setInvitationLink({ code: network.permissions.invitationLink.code });
    else setInvitationLink(null);
  }, [network.id, network.permissions]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const loadMembers = useCallback(async () => {
    setIsMembersLoading(true);
    try {
      const response = await networkService.getMembers(networkId, {});
      setMembers(response.members);
      setMembersFailed(false);
    } catch (err) {
      logger.error('Error loading members', { error: err });
      setMembersFailed(true);
    } finally {
      setIsMembersLoading(false);
    }
  }, [networkService, networkId]);

  useEffect(() => {
    loadMembers(); // eslint-disable-line react-hooks/set-state-in-effect -- load on mount
  }, [loadMembers]);

  const isGated = !anyoneCanJoin && requireApproval;

  const loadJoinRequests = useCallback(async () => {
    try {
      setJoinRequests(await networkService.listJoinRequests(networkId));
    } catch (err) {
      logger.error('Error loading join requests', { error: err });
    }
  }, [networkService, networkId]);

  useEffect(() => {
    if (!isGated) {
      setJoinRequests([]); // eslint-disable-line react-hooks/set-state-in-effect -- clears the queue with the gate
      return;
    }
    loadJoinRequests();
  }, [isGated, loadJoinRequests]);

  const searchUsers = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSuggestedUsers([]);
      setSearchHasQueried(false);
      return;
    }
    setSearchIsLoading(true);
    try {
      const users = await networkService.searchUsers(query, networkId);
      setSuggestedUsers(users.map(u => ({ ...u, permissions: [] })));
      setSearchHasQueried(true);
    } catch (err) {
      logger.error('Error searching users', { error: err });
      setSuggestedUsers([]);
    } finally {
      setSearchIsLoading(false);
    }
  }, [networkService, networkId]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (memberSearchQuery) searchUsers(memberSearchQuery);
      else { setSuggestedUsers([]); setSearchHasQueried(false); }
    }, 220);
    return () => clearTimeout(timeoutId);
  }, [memberSearchQuery, searchUsers]);

  const searchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleUpdatePermissions = async (joinPolicy: boolean) => {
    try {
      await networkService.updatePermissions(networkId, { joinPolicy: joinPolicy ? 'anyone' : 'invite_only' });
      const updatedNetwork = await networkService.getNetwork(networkId);
      onUpdated(updatedNetwork);
      if (updatedNetwork.permissions?.invitationLink?.code) setInvitationLink({ code: updatedNetwork.permissions.invitationLink.code });
      await refreshNetworks();
    } catch (err) {
      logger.error('Error updating permissions', { error: err });
      error('Failed to update permissions');
    }
  };

  const handleUpdateApproval = async (nextRequireApproval: boolean) => {
    setRequireApproval(nextRequireApproval);
    try {
      await networkService.updatePermissions(networkId, { requireAdminApproval: nextRequireApproval });
      const updatedNetwork = await networkService.getNetwork(networkId);
      onUpdated(updatedNetwork);
      if (!nextRequireApproval) await loadMembers();
      await refreshNetworks();
    } catch (err) {
      setRequireApproval(!nextRequireApproval);
      logger.error('Error updating approval requirement', { error: err });
      error('Failed to update approval requirement');
    }
  };

  const handleReviewRequest = async (userId: string, decision: 'approve' | 'decline') => {
    setBusyId(userId);
    try {
      await networkService.reviewJoinRequest(networkId, userId, decision);
      setJoinRequests(prev => prev.filter(r => r.id !== userId));
      if (decision === 'approve') await loadMembers();
      await refreshNetworks();
      success(decision === 'approve' ? 'request approved' : 'request declined');
    } catch (err) {
      logger.error('Error reviewing join request', { error: err });
      error('Failed to review request');
    } finally {
      setBusyId(null);
    }
  };

  const shareUrl = invitationLink ? `${window.location.origin}/l/${invitationLink.code}` : '';

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      error('Failed to copy link');
    }
  };

  const handleRegenerateLink = async () => {
    setIsRegeneratingLink(true);
    try {
      const updatedNetwork = await networkService.regenerateInvitationLink(networkId);
      onUpdated(updatedNetwork);
      if (updatedNetwork.permissions?.invitationLink?.code) setInvitationLink({ code: updatedNetwork.permissions.invitationLink.code });
      setShowRegenerateConfirm(false);
      success(invitationLink ? 'Invitation link regenerated' : 'Invitation link created');
    } catch (err) {
      logger.error('Error regenerating invitation link', { error: err });
      error('Failed to regenerate invitation link');
    } finally {
      setIsRegeneratingLink(false);
    }
  };

  const handleAddMember = async (memberUser: Member) => {
    try {
      const newMember = await networkService.addMember(networkId, memberUser.id, ['member']);
      setMembers(prev => [...prev, newMember]);
      setMemberSearchQuery('');
      setSuggestedUsers([]);
      setShowSuggestions(false);
      setSearchHasQueried(false);
    } catch (err) {
      logger.error('Error adding member', { error: err });
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    setBusyId(memberId);
    try {
      await networkService.removeMember(networkId, memberId);
      setMembers(prev => prev.filter(m => m.id !== memberId));
    } catch (err) {
      logger.error('Error removing member', { error: err });
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdateMemberRole = async (memberId: string, newRole: 'owner' | 'member') => {
    setBusyId(memberId);
    try {
      const permissions = newRole === 'owner' ? ['owner'] : ['member'];
      const updated = await networkService.updateMemberPermissions(networkId, memberId, permissions);
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, permissions: updated.permissions } : m));
    } catch (err) {
      logger.error('Error updating member role', { error: err });
      error(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setBusyId(null);
    }
  };

  const handleInviteMember = async (email: string) => {
    if (isAddingMember) return;
    setIsAddingMember(true);
    try {
      await networkService.inviteMember(networkId, email);
      setMemberSearchQuery('');
      setSuggestedUsers([]);
      setShowSuggestions(false);
      setSearchHasQueried(false);
      await loadMembers();
    } catch (err) {
      logger.error('Error inviting member', { error: err });
      error('Failed to invite member');
    } finally {
      setIsAddingMember(false);
    }
  };

  const filteredSuggestions = suggestedUsers.filter(u => !members.find(m => m.id === u.id));
  const totalPages = Math.max(1, Math.ceil(members.length / MEMBERS_PAGE_SIZE));
  const safePage = Math.min(membersPage, totalPages);
  const slice = useMemo(
    () => members.slice((safePage - 1) * MEMBERS_PAGE_SIZE, safePage * MEMBERS_PAGE_SIZE),
    [members, safePage],
  );
  const noResults = showSuggestions && searchHasQueried && !searchIsLoading && memberSearchQuery.trim() && filteredSuggestions.length === 0;

  return (
    <div style={{ display: "grid", gap: 22 }}>
      <div>
        <RuleLabel>Visibility</RuleLabel>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: compact ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
          <ChoiceCard title="Public" sub="Anyone can join" selected={anyoneCanJoin} onClick={() => { setAnyoneCanJoin(true); void handleUpdatePermissions(true); }} />
          <ChoiceCard title="Private" sub="Invite only" selected={!anyoneCanJoin} onClick={() => { setAnyoneCanJoin(false); void handleUpdatePermissions(false); }} />
        </div>
      </div>

      {!anyoneCanJoin && (
        <div>
          <RuleLabel>Approval</RuleLabel>
          <div style={{ marginTop: 12 }}>
            <Toggle on={requireApproval} onClick={() => void handleUpdateApproval(!requireApproval)} title="Require admin approval" blurb="Require an admin to approve new members joining via the group link." />
          </div>
        </div>
      )}

      <div>
        <RuleLabel>Invitation link</RuleLabel>
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid #000", background: "#F2F0EC" }}>
          <code style={{ flex: 1, minWidth: 0, fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shareUrl || "no invitation link yet."}</code>
          {!shareUrl && (
            <button type="button" className="wb-btn small" disabled={isRegeneratingLink} onClick={() => void handleRegenerateLink()}>
              {isRegeneratingLink ? "creating…" : "create link"}
            </button>
          )}
          {shareUrl && (
            <>
              <button type="button" onClick={() => setShowRegenerateConfirm((open) => !open)} disabled={isRegeneratingLink} title="Regenerate invitation link" aria-label="Regenerate invitation link" style={{ ...act, padding: "4px 10px", background: showRegenerateConfirm ? "#000" : "#fff", color: showRegenerateConfirm ? "#fff" : "#000", boxShadow: "1px 1px 0 rgba(0,0,0,0.2)", opacity: isRegeneratingLink ? 0.5 : 1 }}>↻</button>
              <button type="button" onClick={() => void handleCopyLink()} title={isCopied ? "Copied" : "Copy link"} style={{ ...act, padding: "4px 10px", background: isCopied ? "#000" : "#fff", color: isCopied ? "#fff" : "#000", boxShadow: "1px 1px 0 rgba(0,0,0,0.2)" }}>{isCopied ? "copied" : "copy"}</button>
            </>
          )}
        </div>
        {showRegenerateConfirm && shareUrl && (
          <div style={{ marginTop: 8, padding: 12, border: "1px solid #000", background: "#FFF5F5", display: "grid", gap: 10 }}>
            <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 13, color: "#8A0000" }}>The current link stops working immediately. Regenerate?</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" disabled={isRegeneratingLink} onClick={() => setShowRegenerateConfirm(false)} style={{ fontFamily: "var(--mac-mono)", fontSize: 12, padding: "7px 14px", border: "1px solid #000", background: "#fff", cursor: "pointer" }}>Cancel</button>
              <button type="button" disabled={isRegeneratingLink} onClick={() => void handleRegenerateLink()} style={{ fontFamily: "var(--mac-mono)", fontSize: 12, padding: "7px 14px", border: "1px solid #000", background: "#000", color: "#fff", cursor: "pointer" }}>{isRegeneratingLink ? "Regenerating…" : "Regenerate"}</button>
            </div>
          </div>
        )}
      </div>

      {isGated && joinRequests.length > 0 && (
        <div>
          <RuleLabel>Pending ({joinRequests.length})</RuleLabel>
          <div style={{ marginTop: 12, border: "1px solid #000", background: "#fff" }}>
            {joinRequests.map((request) => (
              <div key={request.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
                <UserAvatar id={request.id} name={request.name} avatar={request.avatar} size={28} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: "var(--mac-sans)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{request.name}</span>
                  <span style={{ display: "block", fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{request.email}</span>
                </span>
                <button type="button" title="Approve" disabled={busyId === request.id} onClick={() => void handleReviewRequest(request.id, 'approve')} style={act}>approve</button>
                <button type="button" title="Decline" disabled={busyId === request.id} onClick={() => void handleReviewRequest(request.id, 'decline')} style={{ ...act, color: "var(--ink-warn)" }}>decline</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <RuleLabel>Members ({members.length})</RuleLabel>
        <div ref={searchRef} style={{ marginTop: 12, position: "relative" }}>
          <input
            value={memberSearchQuery}
            onChange={(e) => { setMemberSearchQuery(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Search by name or add by email…"
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", border: "1px solid #000", background: "#fff", fontFamily: "var(--mac-mono)", fontSize: 12 }}
          />
          {showSuggestions && memberSearchQuery.trim() && filteredSuggestions.length > 0 && (
            <div style={{ position: "absolute", left: 0, right: 0, top: "100%", marginTop: 2, zIndex: 5, border: "1px solid #000", background: "#fff", maxHeight: 160, overflowY: "auto", boxShadow: "2px 2px 0 rgba(0,0,0,0.2)" }}>
              {filteredSuggestions.map((person) => (
                <button key={person.id} type="button" onClick={() => void handleAddMember(person)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--mac-sans)", fontSize: 13 }}>
                  <UserAvatar id={person.id} name={person.name} avatar={person.avatar} size={24} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{person.name}</span>
                  <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>Add</span>
                </button>
              ))}
            </div>
          )}
          {noResults && (
            <div style={{ position: "absolute", left: 0, right: 0, top: "100%", marginTop: 2, zIndex: 5, border: "1px solid #000", background: "#fff", boxShadow: "2px 2px 0 rgba(0,0,0,0.2)" }}>
              {memberSearchQuery.includes('@') ? (
                <button type="button" disabled={isAddingMember} onClick={() => void handleInviteMember(memberSearchQuery.trim())} style={{ width: "100%", padding: "10px 12px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--mac-sans)", fontSize: 13 }}>Invite &quot;{memberSearchQuery.trim()}&quot;</button>
              ) : (
                <div style={{ padding: "10px 12px", fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-2)" }}>no one found. enter a full email to invite them.</div>
              )}
            </div>
          )}
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 2 }}>
          {isMembersLoading && members.length === 0 && <EmptyState tone="loading" align="start" message="loading members…" />}
          {!isMembersLoading && membersFailed && members.length === 0 && (
            <EmptyState
              tone="error"
              align="start"
              message="couldn't load members."
              action={{ label: "try again", onClick: () => void loadMembers() }}
            />
          )}
          {!isMembersLoading && !membersFailed && members.length === 0 && (
            // The search box above is the invite action: type a name or a full email.
            <EmptyState align="start" message="no members yet. search above or enter an email to add someone." />
          )}
          {!isMembersLoading && slice.map((member) => {
            const isOwner = member.permissions.includes('owner');
            const isSelf = currentUser?.id === member.id;
            const ghost = Boolean((member as Member & { isGhost?: boolean }).isGhost);
            return (
              <div key={member.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
                <button type="button" onClick={() => navigate(`/u/${member.id}`)} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, border: "none", background: "transparent", cursor: "pointer", textAlign: "left", padding: 0 }}>
                  <UserAvatar id={member.id} name={member.name} avatar={member.avatar} size={28} blur={ghost} />
                  <span style={{ fontFamily: "var(--mac-sans)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {member.name}
                    {ghost && <GhostTag />}
                  </span>
                </button>
                <span style={{ flex: "0 0 auto", fontFamily: "var(--mac-mono)", fontSize: 11, padding: "2px 6px", background: isOwner ? "#000" : "#E8E6E1", color: isOwner ? "#fff" : "var(--ink-2)" }}>{isOwner ? "Owner" : (member.permissions.includes('member') ? "Member" : "Contact")}</span>
                {!isOwner && member.permissions.includes('member') && !isSelf && (
                  <button type="button" title="Promote to owner" disabled={busyId === member.id} onClick={() => void handleUpdateMemberRole(member.id, 'owner')} style={act}>↑</button>
                )}
                {isOwner && !isSelf && (
                  <button type="button" title="Demote to member" disabled={busyId === member.id} onClick={() => void handleUpdateMemberRole(member.id, 'member')} style={act}>↓</button>
                )}
                {!isOwner && (
                  <button type="button" title="Remove member" disabled={busyId === member.id} onClick={() => void handleRemoveMember(member.id)} style={{ ...act, color: "var(--ink-warn)" }}>×</button>
                )}
              </div>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #ddd", paddingTop: 10, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>
            <span>{(safePage - 1) * MEMBERS_PAGE_SIZE + 1}–{Math.min(safePage * MEMBERS_PAGE_SIZE, members.length)} of {members.length}</span>
            <span style={{ display: "flex", gap: 6 }}>
              <button type="button" disabled={safePage <= 1} onClick={() => setMembersPage(safePage - 1)} style={act}>prev</button>
              <button type="button" disabled={safePage >= totalPages} onClick={() => setMembersPage(safePage + 1)} style={act}>next</button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ChoiceCard({ title, sub, selected, onClick }: { title: string; sub: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} style={{ display: "flex", alignItems: "flex-start", gap: 11, width: "100%", textAlign: "left", padding: "10px 12px", cursor: "pointer", border: "1px solid #000", background: selected ? "#F2EFE6" : "#fff", boxShadow: selected ? "inset 1px 1px 0 rgba(0,0,0,0.25)" : "1px 1px 0 rgba(0,0,0,0.2)" }}>
      <span style={{ flex: "0 0 auto", width: 13, height: 13, marginTop: 2, border: "1px solid #000", background: selected ? "#FF8A00" : "#fff", boxShadow: selected ? "inset 1px 1px 0 rgba(0,0,0,0.3)" : "none" }} />
      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span style={{ fontFamily: "var(--mac-mono)", fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ fontFamily: "var(--mac-sans)", fontSize: 12, color: "var(--ink-2)" }}>{sub}</span>
      </span>
    </button>
  );
}

function Toggle({ on, onClick, title, blurb }: { on: boolean; onClick: () => void; title: string; blurb: string }) {
  return (
    <button type="button" onClick={onClick} role="switch" aria-checked={on} style={{ display: "flex", gap: 11, alignItems: "flex-start", textAlign: "left", width: "100%", padding: "10px 12px", cursor: "pointer", border: "1px solid #000", background: "#fff", boxShadow: "2px 2px 0 rgba(0,0,0,0.22)" }}>
      <span style={{ flex: "0 0 auto", width: 16, height: 16, marginTop: 1, border: "1px solid #000", background: on ? "#FF8A00" : "#EDEAE1", boxShadow: on ? "inset 1px 1px 0 #8A4500, inset -1px -1px 0 #FFD7A0" : "inset 1px 1px 0 #fff, inset -1px -1px 0 var(--ink-3)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--mac-mono)", fontSize: 11, fontWeight: 700 }}>{on ? "✓" : ""}</span>
      <span>
        <span style={{ display: "block", fontFamily: "var(--mac-mono)", fontSize: 12, fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", marginTop: 3, fontFamily: "var(--mac-sans)", fontSize: 12, lineHeight: 1.45, color: "var(--ink-2)" }}>{blurb}</span>
      </span>
    </button>
  );
}
