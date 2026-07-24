import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import UserAvatar from '@/components/UserAvatar';
import { formatRelativeTime, roleChipLabel, verbFor, type TranscriptTurn } from '@/components/negotiations/negotiation-turns';

export interface TurnParticipantInfo {
  ownerName: string;
  avatar: string | null;
}

interface TurnItemProps {
  turn: TranscriptTurn;
  isLast: boolean;
  seatLabel: string;
  avatar: string | null;
  avatarName: string;
  roleChip: string | null;
  now: number;
}

function TurnItem({ turn, isLast, seatLabel, avatar, avatarName, roleChip, now }: TurnItemProps) {
  const verb = verbFor(turn.action);

  return (
    <div className="relative flex gap-3 py-3">
      {!isLast && (
        <span aria-hidden="true" className="absolute left-[13px] top-[44px] -bottom-3 w-px bg-gray-200" />
      )}
      <div className="shrink-0">
        <UserAvatar avatar={avatar} id={turn.senderId} name={avatarName} size={28} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-ibm-plex-mono text-xs font-semibold text-[#3D3D3D]">{seatLabel}</span>
          {verb && (
            <span className={`font-ibm-plex-mono text-[11px] font-bold tracking-wide ${verb.color}`}>
              {verb.label}
            </span>
          )}
          {roleChip && (
            <span className="rounded-full border border-[#8EC3D8] bg-[#e8f3f9] px-2 py-px font-ibm-plex-mono text-[10px] font-semibold text-[#35799C]">
              {roleChip}
            </span>
          )}
          <span className="flex-1" />
          <span className="font-ibm-plex-mono text-[10px] text-gray-400">
            {formatRelativeTime(turn.createdAt, now)}
          </span>
        </div>
        <article className="mt-1 text-sm text-[#3D3D3D]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.text}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
}

interface TurnRailProps {
  turns: TranscriptTurn[];
  ownAgentId: string | null;
  participantInfo: Map<string, TurnParticipantInfo>;
  counterpartName: string;
  now: number;
  /**
   * Turn id after which the missed-window decay line renders (IND-559): the
   * ask_user consultation lapsed and the negotiation continued unanswered.
   */
  missedWindowTurnId?: string | null;
}

/**
 * Vertical turn rail (proposals §2.3): avatar + seat label + colored action
 * verb + role chips + reasoning per turn. No DM bubbles, no own/other alignment.
 */
export function TurnRail({ turns, ownAgentId, participantInfo, counterpartName, now, missedWindowTurnId }: TurnRailProps) {
  return (
    <div>
      {turns.map((turn, index) => {
        const isOwn = turn.senderId === ownAgentId;
        const info = participantInfo.get(turn.senderId);
        const previousTurn = turns[index - 1];
        const startsSession = previousTurn !== undefined && previousTurn.sessionId !== turn.sessionId;
        const seatLabel = isOwn ? 'Your agent' : `${info?.ownerName ?? counterpartName}'s agent`;

        return (
          <div key={turn.id}>
            {startsSession && (
              <div className="flex items-center gap-3 py-3" role="separator" aria-label="Earlier chat session">
                <span className="h-px flex-1 bg-gray-200" />
                <span className="text-[10px] font-ibm-plex-mono uppercase tracking-[0.12em] text-gray-400">Earlier conversation</span>
                <span className="h-px flex-1 bg-gray-200" />
              </div>
            )}
            <TurnItem
              turn={turn}
              isLast={index === turns.length - 1}
              seatLabel={seatLabel}
              avatar={info?.avatar ?? null}
              avatarName={info?.ownerName ?? counterpartName}
              roleChip={roleChipLabel(turn.suggestedRoles, isOwn, counterpartName)}
              now={now}
            />
            {missedWindowTurnId === turn.id && (
              // Quiet decay state (§2.2) — never styled as a user-caused error.
              <p
                data-testid="consultation-window-missed"
                className="py-2 text-center font-ibm-plex-mono text-[11px] text-gray-400"
              >
                Window missed — negotiation continued without an answer.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default TurnRail;
