import SiteLayout from "@/app/site/SiteLayout";
import { WaitlistForm } from "@/app/landing/WaitlistForm";
import "./waitlist.css";

function WaitlistPage() {
  return (
    <SiteLayout className="waitlist">
      <section className="site-hero">
        <h1 className="site-h1">Request access</h1>
        <p className="site-p">
          Index is opening in cycles. Get early access, find your networks, or start your own.
        </p>
        <div className="waitlist-form">
          <WaitlistForm idPrefix="waitlist-page" />
        </div>
      </section>
    </SiteLayout>
  );
}

export default WaitlistPage;
export const Component = WaitlistPage;
