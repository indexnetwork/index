import ClientLayout from "@/components/ClientLayout";

export default function TermsOfUsePage() {
  const effectiveDate = new Date(2025, 9, 20).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  return (
    <ClientLayout>
      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl md:text-4xl font-bold font-ibm-plex-mono text-black mb-2">Terms of Use</h1>
        <p className="text-sm text-gray-600 mb-8">Effective: {effectiveDate}</p>

        <nav className="mb-10 text-sm">
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li><a className="hover:underline" href="#acceptance">Acceptance of Terms</a></li>
            <li><a className="hover:underline" href="#eligibility">Eligibility & Accounts</a></li>
            <li><a className="hover:underline" href="#conduct">User Conduct & Acceptable Use</a></li>
            <li><a className="hover:underline" href="#ip">Intellectual Property</a></li>
            <li><a className="hover:underline" href="#feedback">Feedback</a></li>
            <li><a className="hover:underline" href="#third-party">Third‑Party Services & Links</a></li>
            <li><a className="hover:underline" href="#disclaimer">Disclaimers</a></li>
            <li><a className="hover:underline" href="#liability">Limitation of Liability</a></li>
            <li><a className="hover:underline" href="#indemnification">Indemnification</a></li>
            <li><a className="hover:underline" href="#termination">Termination & Suspension</a></li>
            <li><a className="hover:underline" href="#law">Governing Law & Dispute Resolution</a></li>
            <li><a className="hover:underline" href="#changes">Changes to Terms</a></li>
            <li><a className="hover:underline" href="#contact">Contact</a></li>
          </ul>
        </nav>

        <section id="acceptance" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Acceptance of Terms</h2>
          <p className="text-gray-800">
            These Terms of Use ("Terms") govern your access to and use of the websites, products, and services
            provided by Index Network, Inc. ("Index", "we", "us"). By accessing or using our services, you agree to
            be bound by these Terms and our Privacy Policy. If you do not agree, do not use the services.
          </p>
        </section>

        <section id="eligibility" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Eligibility & Accounts</h2>
          <p className="text-gray-800">
            You must be legally able to form a binding contract and comply with applicable laws. You are responsible
            for maintaining the confidentiality of your account credentials and for all activities under your account.
            Notify us immediately of any unauthorized use.
          </p>
        </section>

        <section id="conduct" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">User Conduct & Acceptable Use</h2>
          <ul className="list-disc pl-5 space-y-2 text-gray-800">
            <li>Do not violate laws, intellectual property, privacy, or other rights.</li>
            <li>Do not upload harmful code, attempt to disrupt or bypass security, or misuse APIs.</li>
            <li>Do not use the services to spam, harass, or engage in fraudulent or misleading activities.</li>
            <li>Respect rate limits and fair use guidelines we may publish.</li>
          </ul>
        </section>

        <section id="ip" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Intellectual Property</h2>
          <p className="text-gray-800 mb-3">
            We and our licensors own all rights in the services, including software, content, logos, and trademarks.
            These are protected by intellectual property laws. Except as expressly allowed, you may not copy, modify,
            distribute, or create derivative works.
          </p>
          <p className="text-gray-800">
            You retain ownership of content you submit. You grant us a limited, non‑exclusive, worldwide, royalty‑free
            license to host, store, reproduce, and display your content solely to operate and improve the services.
          </p>
        </section>

        <section id="feedback" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Feedback</h2>
          <p className="text-gray-800">
            If you provide feedback or suggestions, you grant us a non‑exclusive, transferable, sublicensable,
            worldwide, perpetual license to use the feedback without restriction or compensation to you.
          </p>
        </section>

        <section id="third-party" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Third‑Party Services & Links</h2>
          <p className="text-gray-800">
            The services may link to or integrate third‑party content or services. We do not control and are not
            responsible for third‑party services. Your use of them is subject to their terms and policies.
          </p>
        </section>

        <section id="disclaimer" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Disclaimers</h2>
          <p className="text-gray-800">
            THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED,
            INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON‑INFRINGEMENT. We do not warrant that
            the services will be uninterrupted, secure, or error‑free.
          </p>
        </section>

        <section id="liability" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Limitation of Liability</h2>
          <p className="text-gray-800">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT WILL INDEX OR ITS AFFILIATES BE LIABLE FOR ANY
            INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES,
            WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOOD‑WILL, OR OTHER INTANGIBLE LOSSES.
          </p>
        </section>

        <section id="indemnification" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Indemnification</h2>
          <p className="text-gray-800">
            You agree to defend, indemnify, and hold harmless Index and its affiliates from and against any claims,
            liabilities, damages, losses, and expenses arising out of or related to your use of the services or your
            violation of these Terms or applicable law.
          </p>
        </section>

        <section id="termination" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Termination & Suspension</h2>
          <p className="text-gray-800">
            We may suspend or terminate access to the services at any time if we believe you have violated these
            Terms or to protect the services or other users. Upon termination, your right to use the services
            ceases immediately.
          </p>
        </section>

        <section id="law" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Governing Law & Dispute Resolution</h2>
          <p className="text-gray-800">
            These Terms are governed by the laws of the State of Delaware, without regard to conflict of law rules.
            Any disputes will be resolved in the state or federal courts located in Delaware, and you consent to
            jurisdiction and venue in those courts. Where applicable law requires, you and Index agree to first
            attempt to resolve disputes informally.
          </p>
        </section>

        <section id="changes" className="mb-8">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Changes to Terms</h2>
          <p className="text-gray-800">
            We may update these Terms from time to time. If changes are material, we will provide notice where
            required by law. The updated Terms will be effective when posted with a revised effective date.
          </p>
        </section>

        <section id="contact" className="mb-2">
          <h2 className="text-xl md:text-2xl font-semibold font-ibm-plex-mono text-black mb-3">Contact</h2>
          <p className="text-gray-800">
            Questions about these Terms? Contact us at
            <span className="whitespace-pre"> </span>
            <a href="mailto:hello@index.network" className="underline">hello@index.network</a>.
          </p>
          <p className="text-gray-800 mt-2">Index Network, Inc.</p>
        </section>
      </main>
    </ClientLayout>
  );
}


