import ClientLayout from "@/components/ClientLayout";

export default function PrivacyPolicyPage() {
  const effectiveDate = new Date(2025, 9, 20).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  return (
    <ClientLayout>
      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl md:text-4xl font-bold font-ibm-plex-mono text-black mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-600 mb-8">Effective: {effectiveDate}</p>

        <nav className="mb-10 text-sm">
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li><a className="hover:underline" href="#overview">Overview & Scope</a></li>
            <li><a className="hover:underline" href="#information-we-collect">Information We Collect</a></li>
            <li><a className="hover:underline" href="#how-we-use">How We Use Information</a></li>
            <li><a className="hover:underline" href="#legal-bases">Legal Bases (GDPR)</a></li>
            <li><a className="hover:underline" href="#sharing">Sharing & Processors</a></li>
            <li><a className="hover:underline" href="#transfers">International Transfers</a></li>
            <li><a className="hover:underline" href="#retention">Data Retention</a></li>
            <li><a className="hover:underline" href="#your-rights">Your Rights (GDPR/CCPA)</a></li>
            <li><a className="hover:underline" href="#security">Security</a></li>
            <li><a className="hover:underline" href="#children">Children’s Privacy</a></li>
            <li><a className="hover:underline" href="#changes">Changes to This Policy</a></li>
            <li><a className="hover:underline" href="#contact">Contact</a></li>
          </ul>
        </nav>

        <section id="overview" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Overview & Scope</h2>
          <p className="text-gray-800">
            This Privacy Policy explains how Index Network, Inc. ("Index", "we", "us") collects, uses, shares,
            and safeguards personal information when you visit our website, use our services, or otherwise
            interact with us. This Policy applies to information we process as a controller under the General
            Data Protection Regulation (GDPR) and as a business under the California Consumer Privacy Act (CCPA),
            as amended. By using our services, you agree to the practices described here.
          </p>
        </section>

        <section id="information-we-collect" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Information We Collect</h2>
          <div className="space-y-3 text-gray-800">
            <p>
              <span className="font-medium">Information you provide</span>: account details, content you upload or
              submit (e.g., notes, files), preferences, and communications.
            </p>
            <p>
              <span className="font-medium">Usage information</span>: interactions with our site and services, such
              as page views, navigation flows, and feature usage.
            </p>
            <p>
              <span className="font-medium">Device and technical data</span>: browser type, operating system, device
              identifiers, IP address, and cookie identifiers.
            </p>
            <p>
              <span className="font-medium">Cookies and similar technologies</span>: we use essential cookies and
              privacy‑respecting analytics to understand aggregate usage. See Sharing & Processors for details.
            </p>
          </div>
        </section>

        <section id="how-we-use" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">How We Use Information</h2>
          <ul className="list-disc pl-5 space-y-2 text-gray-800">
            <li>Provide, maintain, and improve our services and features.</li>
            <li>Personalize experiences, including content relevance and discovery.</li>
            <li>Communicate with you about updates, security, and support.</li>
            <li>Monitor performance, debug issues, and ensure reliability.</li>
            <li>Comply with legal obligations and enforce our terms.</li>
          </ul>
        </section>

        <section id="legal-bases" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Legal Bases (GDPR)</h2>
          <p className="text-gray-800">
            We process personal data under these legal bases: (i) <span className="font-medium">contract</span> to
            provide the services you request; (ii) <span className="font-medium">legitimate interests</span> such as
            securing, improving, and measuring our services; (iii) <span className="font-medium">consent</span> for
            optional features where required; and (iv) <span className="font-medium">legal obligations</span>.
          </p>
        </section>

        <section id="sharing" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Sharing & Processors</h2>
          <p className="text-gray-800 mb-3">
            We do not sell personal information. We share data with service providers who act as processors and
            follow our instructions:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-gray-800">
            <li>
              <span className="font-medium">Analytics</span>: We use Plausible Analytics, a privacy‑focused platform,
              to measure aggregate site usage without tracking cookies for individual profiles.
            </li>
            <li><span className="font-medium">Hosting</span>: Infrastructure providers to serve our website and APIs.</li>
            <li><span className="font-medium">Communications</span>: Email and support tools to contact you upon request.</li>
          </ul>
          <p className="text-gray-800 mt-3">
            We may disclose information if required by law, to protect rights and safety, or in connection with a
            merger, acquisition, or asset transfer.
          </p>
        </section>

        <section id="transfers" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">International Transfers</h2>
          <p className="text-gray-800">
            If personal data is transferred internationally, we rely on appropriate safeguards such as Standard
            Contractual Clauses or adequacy decisions, as applicable, to protect your information.
          </p>
        </section>

        <section id="retention" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Data Retention</h2>
          <p className="text-gray-800">
            We retain personal information only as long as necessary for the purposes described in this Policy,
            to comply with legal obligations, resolve disputes, and enforce agreements. Retention periods depend on
            the type and context of the data.
          </p>
        </section>

        <section id="your-rights" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Your Rights (GDPR/CCPA)</h2>
          <p className="text-gray-800 mb-3">
            Subject to applicable law, you may have rights to access, correct, delete, port, or restrict processing of
            your personal information, as well as to object to processing or withdraw consent where processing is
            based on consent.
          </p>
          <p className="text-gray-800">
            California residents may have additional rights, including to know categories of personal information,
            sources, purposes, and recipients; to request deletion or correction; to opt out of certain sharing; and
            to not be discriminated against for exercising rights.
          </p>
        </section>

        <section id="security" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Security</h2>
          <p className="text-gray-800">
            We use administrative, technical, and organizational measures designed to protect personal information.
            No system is perfectly secure, and we cannot guarantee absolute security; we regularly evaluate and
            improve our safeguards.
          </p>
        </section>

        <section id="children" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Children’s Privacy</h2>
          <p className="text-gray-800">
            Our services are not directed to children under 13 (or as defined by local law). We do not knowingly
            collect personal information from children. If you believe a child has provided personal information,
            please contact us and we will take appropriate steps to delete it.
          </p>
        </section>

        <section id="changes" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Changes to This Policy</h2>
          <p className="text-gray-800">
            We may update this Policy to reflect changes in our practices or the law. We will post the updated
            version with a new effective date, and if changes are material, we will provide additional notice where
            required.
          </p>
        </section>

        <section id="contact" className="mb-2">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Contact</h2>
          <p className="text-gray-800">
            If you have questions or requests related to this Policy or your personal information, contact us at
            <span className="whitespace-pre"> </span>
            <a href="mailto:hello@index.network" className="underline">hello@index.network</a>.
          </p>
          <p className="text-gray-800 mt-2">Index Network, Inc.</p>
        </section>
      </main>
    </ClientLayout>
  );
}


