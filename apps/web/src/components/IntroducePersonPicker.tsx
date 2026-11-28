import { useEffect, useRef, useState } from "react";

import UserAvatar from "@/components/UserAvatar";
import type { PickablePerson } from "@/services/introducer";

const kindLabel = (p: PickablePerson) => (p.kind === "member" ? "in your networks" : "your contact");

/**
 * Pick one person to see only their pairs: a member of your networks or one
 * of your contacts, searched by name. Picked, it reads as their face and name.
 */
export default function IntroducePersonPicker({ search, value, onChange }: {
  search: (q: string) => Promise<PickablePerson[]>;
  value: PickablePerson | null;
  onChange: (person: PickablePerson | null) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<PickablePerson[] | null>(null);
  const [active, setActive] = useState(0);
  // Only the latest search's answer is shown.
  const asked = useRef(0);

  useEffect(() => {
    if (!open) return;
    const n = ++asked.current;
    const t = setTimeout(() => {
      search(q.trim())
        .then((people) => { if (n === asked.current) { setResults(people); setActive(0); } })
        .catch(() => { if (n === asked.current) setResults([]); });
    }, 150);
    return () => clearTimeout(t);
  }, [q, open, search]);

  const pick = (person: PickablePerson) => {
    onChange(person);
    setQ("");
    setOpen(false);
    setResults(null);
  };

  if (value) {
    return (
      <div className="ipk ipk-on">
        <UserAvatar id={value.id} name={value.name} avatar={value.avatar} size={22} />
        <b>{value.name}</b>
        <span className="ipk-kind">{kindLabel(value)}</span>
        <button type="button" className="ipk-clear" onClick={() => onChange(null)}>show everyone</button>
      </div>
    );
  }

  const shown = open ? results : null;
  return (
    <div className="ipk" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <input
        type="search"
        value={q}
        placeholder="Pairs for… a contact or someone in your networks"
        aria-label="Pick a person to see their pairs"
        role="combobox"
        aria-expanded={!!shown?.length}
        aria-controls="ipk-list"
        aria-activedescendant={shown?.length ? `ipk-${active}` : undefined}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); return; }
          if (!shown?.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % shown.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + shown.length) % shown.length); }
          else if (e.key === "Enter") { e.preventDefault(); pick(shown[active] ?? shown[0]!); }
        }}
      />
      {shown && (
        shown.length ? (
          <ul id="ipk-list" className="ipk-list" role="listbox">
            {shown.map((p, i) => (
              <li
                key={`${p.kind}:${p.id}`}
                id={`ipk-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                // Before the input's blur closes the list.
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              >
                <UserAvatar id={p.id} name={p.name} avatar={p.avatar} size={28} />
                <span className="who">
                  <b>{p.name}</b>
                  {p.line && <small>{p.line}</small>}
                </span>
                <span className="ipk-kind">{kindLabel(p)}</span>
              </li>
            ))}
          </ul>
        ) : q.trim() ? (
          <div className="ipk-list ipk-none">Nobody by that name in your contacts or networks.</div>
        ) : null
      )}
    </div>
  );
}
