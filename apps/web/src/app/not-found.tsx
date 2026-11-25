import { Link } from "react-router";

import { StatusPage } from "@/components/SiteSignIn";

export default function NotFound() {
  return (
    <StatusPage bar="not found" title="Page not found" message="That page isn’t here.">
      <Link className="site-btn" to="/">Go home</Link>
    </StatusPage>
  );
}

export const Component = NotFound;
