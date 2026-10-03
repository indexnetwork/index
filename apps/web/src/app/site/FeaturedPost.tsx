import { Link } from "react-router";

const FEATURED = {
  href: "/blog/can-agents-be-trusted",
  meta: "FEATURED · EDGE ESMERALDA",
  title: "We gave 240 personal agents to a village",
  summary:
    "And it worked. Agents helped offload the effort needed for human coordination - and the new constraint became human attention.",
};

/** The spotlight card shared by Home and Hermes. */
export default function FeaturedPost() {
  return (
    <Link className="site-card" to={FEATURED.href} target="_blank" rel="noreferrer">
      <img src="/site/village.jpg" alt="Agent village - Edge City" />
      <span className="site-card-body">
        <span className="site-meta">{FEATURED.meta}</span>
        <span className="site-card-title">{FEATURED.title}</span>
        <span className="site-card-summary">{FEATURED.summary}</span>
      </span>
    </Link>
  );
}
