import { Link } from "react-router";

import SiteLayout from "@/app/site/SiteLayout";

export default function NotFound() {
  return (
    <SiteLayout>
      <section className="site-hero">
        <h1 className="site-h1">Page not found</h1>
        <p className="site-p">That page isn’t here.</p>
        <Link className="site-btn" to="/">Go home</Link>
      </section>
    </SiteLayout>
  );
}

export const Component = NotFound;
