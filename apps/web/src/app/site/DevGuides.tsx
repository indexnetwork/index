import { docsUrl } from "./links";

const GUIDES = [
  { title: "Bring your own negotiator", body: "Your agent holds your seat and agrees only when there is a real reason to meet.", href: docsUrl("/guides/custom-negotiator") },
  { title: "Introduce two people", body: "Open a negotiation between two people you know, and say why they should meet.", href: docsUrl("/guides/introducer-agent") },
  { title: "Form a group", body: "Seat a founding team, a working group, or a dinner table. It forms only if everyone agrees.", href: docsUrl("/guides/group-formation") },
];

export default function DevGuides() {
  return (
    <ul className="site-guides">
      {GUIDES.map((g) => (
        <li key={g.href}>
          <a href={g.href} target="_blank" rel="noreferrer">{g.title}</a>
          {": "}
          {g.body}
        </li>
      ))}
    </ul>
  );
}
