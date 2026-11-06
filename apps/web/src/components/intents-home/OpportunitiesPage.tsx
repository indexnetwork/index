import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import "@/styles/intents-home.css";
import { PersonRow, isPaused, labelOf, usePeople } from "@/components/intents-home/people";
import { filterOf, intentColor, type Filter } from "@/components/intents-home/stages";
import { useIntentsData } from "@/contexts/IntentsDataContext";

/**
 * Everyone your agent found, one row per person across intents. The chips
 * narrow it to one intent (`?intent=`); `?open=` opens one match's agent log.
 */
export default function OpportunitiesPage() {
  const [params, setParams] = useSearchParams();
  const { intents, intentsLoaded, fetchIntents, radar, radarFailed, loadRadar, activeCount } = useIntentsData();
  const intentId = params.get("intent");
  const openId = params.get("open");
  const current = intentId ? intents.find((intent) => intent.id === intentId) : undefined;
  const { people, sections } = usePeople(current ? intentId : null);
  const [shown, setShown] = useState<Record<Filter, boolean>>({ matches: true, "in progress": true, closed: false });

  // A just-created intent can be missing from the list; read the list again once.
  const refetched = useRef<string | null>(null);
  useEffect(() => {
    if (!intentId || !intentsLoaded || current || refetched.current === intentId) return;
    refetched.current = intentId;
    void fetchIntents();
  }, [intentId, intentsLoaded, current, fetchIntents]);

  // Opening a match from elsewhere unfolds its section.
  const opened = openId ? people.find((person) => person.entries.some((e) => e.item.opportunityId === openId)) : undefined;
  useEffect(() => {
    if (opened) setShown((prev) => ({ ...prev, [filterOf(opened.entries[0].stage)]: true }));
  }, [opened]);

  const pick = (id: string | null) => setParams(id ? { intent: id } : {});
  const loading = current ? !radar[current.id] && !radarFailed[current.id] : intents.some((intent) => !radar[intent.id] && !radarFailed[intent.id]);
  const failed = current && radarFailed[current.id] && !radar[current.id];
  // Each person once, however many intents they came up for.
  const everyone = usePeople().people;
  const allCount = everyone.filter((person) => person.entries[0].stage !== "closed").length;

  const section = (key: Filter, label: string, foldable: boolean) => {
    const list = sections[key];
    if (foldable && !list.length) return null;
    const isShown = shown[key] || !foldable;
    return (
      <div key={key}>
        {foldable ? (
          <button type="button" className="ih-bar ih-bar-toggle" aria-expanded={isShown} onClick={() => setShown((prev) => ({ ...prev, [key]: !prev[key] }))}>
            <span>{label}</span>
            <span className="ih-n">{isShown ? `${list.length} · hide` : `${list.length} · show`}</span>
          </button>
        ) : (
          <div className="ih-bar"><span>{label}</span>{list.length > 0 && <span className="ih-n">{list.length}</span>}</div>
        )}
        {isShown && (list.length
          ? list.map((person) => <PersonRow key={person.key} person={person} initiallyOpen={person === opened} highlight={person === opened} />)
          : <div className="ih-empty ih-empty-sm">{loading ? "loading…" : current && isPaused(current) ? "this intent is paused, so your agent isn't looking." : "nobody waiting on you."}</div>)}
      </div>
    );
  };

  return (
    <div className="ih-view">
      <header className="ih-head">
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="ih-eyebrow">OPPORTUNITIES</div>
          <h1 className="ih-title">
            {people.length === 1 ? "1 person your agent found" : `${people.length} people your agent found`}
            {current && <span className="ih-title-for"> for “{current.payload?.trim() || labelOf(current)}”</span>}
          </h1>
          <div className="ih-status">
            {[`${sections.matches.length} waiting on you`, `${sections["in progress"].length} in progress`, `${sections.closed.length} closed`].join(" · ")}
          </div>
        </div>
      </header>

      <div className="ih-chips" role="toolbar" aria-label="Filter by intent">
        <button type="button" className={`ih-chip${!current ? " on" : ""}`} aria-pressed={!current} onClick={() => pick(null)}>
          all <span className="ih-n">{allCount}</span>
        </button>
        {intents.map((intent) => (
          <button key={intent.id} type="button" title={intent.payload} aria-pressed={current?.id === intent.id}
            className={`ih-chip${current?.id === intent.id ? " on" : ""}${isPaused(intent) ? " paused" : ""}`}
            onClick={() => pick(current?.id === intent.id ? null : intent.id)}>
            <span className="ih-tag-swatch" style={{ background: intentColor(intent.id) }} />
            {labelOf(intent)} <span className="ih-n">{activeCount(intent.id)}</span>
          </button>
        ))}
      </div>

      <div className="ih-cols">
        <section className="ih-people ih-all">
          {failed ? (
            <div className="ih-empty">
              couldn&apos;t load people. <button type="button" className="ih-link" onClick={() => void loadRadar(current!.id)}>try again</button>
            </div>
          ) : (
            <>
              {section("matches", "WAITING ON YOU", false)}
              {section("in progress", "IN PROGRESS", true)}
              {section("closed", "CLOSED", true)}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
