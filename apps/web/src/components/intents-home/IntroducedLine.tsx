import { Link } from "react-router";

import UserAvatar from "@/components/UserAvatar";
import type { RadarCardItem } from "@/services/opportunities";

/**
 * The line above an introduced card, like a forwarded message: who
 * introduced you two, with their face and a text link to their profile.
 */
export function IntroducedLine({ introducer }: { introducer: NonNullable<RadarCardItem["introducer"]> }) {
  return (
    <div className="sv-cintro">
      <UserAvatar id={introducer.userId} name={introducer.name} avatar={introducer.avatar} size={16} />
      <span><Link to={`/u/${introducer.userId}`}>{introducer.name.split(" ")[0]}</Link> introduced you</span>
    </div>
  );
}
