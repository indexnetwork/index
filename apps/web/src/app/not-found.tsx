import { Link } from "react-router";

import { StatusPage } from "@/components/SiteSignIn";

export default function NotFound() {
  return (
    <StatusPage bar="not found" title="nothing here" message="this link doesn’t go anywhere. it may have been mistyped or moved.">
      <Link className="site-btn" to="/">go home →</Link>
    </StatusPage>
  );
}

export const Component = NotFound;
