import LegalPage, { type LegalSection } from "@/app/pages/LegalPage";

export const TITLE = "Privacy Policy";
export const LEDE = "How Index Network handles personal information — what we collect, why, and what choices you have.";

export const SECTIONS: LegalSection[] = [
  {
    id: "overview",
    title: "overview & scope",
    body: (
      <p>
        This Privacy Policy explains how Index Network, Inc. (&ldquo;Index&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, shares, and safeguards
        personal information when you visit our website, use our services, or
        otherwise interact with us. It applies to information we process as a
        controller under the GDPR and as a business under the CCPA, as amended.
        By using our services, you agree to the practices described here.
      </p>
    ),
  },
  {
    id: "information-we-collect",
    title: "information we collect",
    body: (
      <ul className="legal-list">
        <li>
          <strong>Information you provide</strong> — account details, content
          you upload or submit (notes, files), preferences, and communications.
        </li>
        <li>
          <strong>Usage information</strong> — interactions with our site and
          services, such as page views, navigation flows, and feature usage.
        </li>
        <li>
          <strong>Device and technical data</strong> — browser type, operating
          system, device identifiers, IP address, and cookie identifiers.
        </li>
        <li>
          <strong>Cookies and similar technologies</strong> — essential cookies
          and privacy-respecting analytics to understand aggregate usage. See
          sharing &amp; processors for details.
        </li>
        <li>
          <strong>Signals and matches</strong> — the text of a signal (who you
          want to meet), the networks you share it with, matches, and the
          messages your agent exchanges while negotiating a match.
        </li>
        <li>
          <strong>Your agent conversation</strong> — notes, progress updates,
          questions your agent asks you, and the answers you give.
        </li>
        <li>
          <strong>Connected assistants, including ChatGPT</strong> — when you
          connect Index, each tool call sends only the fields that tool needs,
          and we return only that tool&apos;s result. A profile read returns
          your name, intro, location, timezone, avatar, and social links. A
          signal read returns the signal text, status, and networks. A match
          read returns who it is with, why it fits, and any negotiation. A
          write saves the field you asked to change, on your account only.
        </li>
      </ul>
    ),
  },
  {
    id: "how-we-use",
    title: "how we use information",
    body: (
      <ul className="legal-list">
        <li>Provide, maintain, and improve our services and features.</li>
        <li>Personalize experiences, including content relevance and discovery.</li>
        <li>Communicate with you about updates, security, and support.</li>
        <li>Monitor performance, debug issues, and ensure reliability.</li>
        <li>Comply with legal obligations and enforce our terms.</li>
        <li>
          Match a signal with people in networks you belong to, and let your
          agent negotiate a match using the signal and the facts you confirmed.
        </li>
      </ul>
    ),
  },
  {
    id: "legal-bases",
    title: "legal bases (gdpr)",
    body: (
      <p>
        We process personal data under these legal bases:{" "}
        <strong>contract</strong> to provide the services you request;{" "}
        <strong>legitimate interests</strong> such as securing, improving, and
        measuring our services; <strong>consent</strong> for optional features
        where required; and <strong>legal obligations</strong>.
      </p>
    ),
  },
  {
    id: "sharing",
    title: "sharing & processors",
    body: (
      <>
        <p>
          We do not sell personal information. We share data with service
          providers who act as processors and follow our instructions:
        </p>
        <ul className="legal-list">
          <li>
            <strong>Analytics</strong> — Plausible Analytics, a privacy-focused
            platform that measures aggregate site usage without tracking cookies
            for individual profiles.
          </li>
          <li>
            <strong>Hosting</strong> — infrastructure providers to serve our
            website and APIs.
          </li>
          <li>
            <strong>Communications</strong> — Resend, to send email you request
            or that the service needs to operate your account.
          </li>
          <li>
            <strong>Matching</strong> — OpenRouter, which receives signal text
            so we can compute embeddings and find relevant people. It does not
            receive your password or your agent conversation.
          </li>
          <li>
            <strong>Other members</strong> — people in a network you join can
            see the profile and signals you share there. The other person in a
            match can see that match and its negotiation.
          </li>
          <li>
            <strong>OpenAI, when you connect ChatGPT</strong> — ChatGPT sends
            us the tool arguments and receives the tool result, so that text
            is also processed by OpenAI under its own policy. Disconnecting
            the plugin in ChatGPT stops further calls. We do not receive your
            ChatGPT chat history beyond the tool call itself.
          </li>
        </ul>
        <p>
          We may disclose information if required by law, to protect rights and
          safety, or in connection with a merger, acquisition, or asset transfer.
        </p>
      </>
    ),
  },
  {
    id: "transfers",
    title: "international transfers",
    body: (
      <p>
        If personal data is transferred internationally, we rely on appropriate
        safeguards such as Standard Contractual Clauses or adequacy decisions, as
        applicable, to protect your information.
      </p>
    ),
  },
  {
    id: "retention",
    title: "data retention",
    body: (
      <p>
        We keep your account, profile, signals, matches, negotiation messages,
        and agent conversation while your account exists. Pausing a signal
        stops new matching and leaves the signal in place. Archiving a signal
        removes it from its networks and expires related matches; the archived
        copy stays until you ask us to delete the account. Email{" "}
        <a href="mailto:hello@index.network">hello@index.network</a> to access,
        correct, or delete your account, and we delete it except where we must
        keep a record for a legal claim or obligation. Operational logs used
        to secure the service are kept only as long as that purpose requires
        and are not used to profile you. ChatGPT keeps its own copy of your
        chat under OpenAI&apos;s policy.
      </p>
    ),
  },
  {
    id: "your-rights",
    title: "your rights (gdpr/ccpa)",
    body: (
      <>
        <p>
          Subject to applicable law, you may have rights to access, correct,
          delete, port, or restrict processing of your personal information, as
          well as to object to processing or withdraw consent where processing is
          based on consent.
        </p>
        <p>
          California residents may have additional rights, including to know
          categories of personal information, sources, purposes, and recipients;
          to request deletion or correction; to opt out of certain sharing; and
          to not be discriminated against for exercising rights. In the product
          you can edit your profile, pause or archive a signal, accept or pass
          on a match, and disconnect a connected assistant. Those controls take
          effect on your Index account immediately.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "security",
    body: (
      <p>
        We use administrative, technical, and organizational measures designed to
        protect personal information. No system is perfectly secure, and we
        cannot guarantee absolute security; we regularly evaluate and improve our
        safeguards.
      </p>
    ),
  },
  {
    id: "children",
    title: "children's privacy",
    body: (
      <p>
        Our services are not directed to children under 13 (or as defined by
        local law). We do not knowingly collect personal information from
        children. If you believe a child has provided personal information,
        please contact us and we will take appropriate steps to delete it.
      </p>
    ),
  },
  {
    id: "changes",
    title: "changes to this policy",
    body: (
      <p>
        We may update this Policy to reflect changes in our practices or the law.
        We will post the updated version with a new effective date, and if
        changes are material, we will provide additional notice where required.
      </p>
    ),
  },
  {
    id: "contact",
    title: "contact",
    body: (
      <>
        <p>
          Questions or requests related to this Policy or your personal
          information?{" "}
          <a href="mailto:hello@index.network">hello@index.network</a>
        </p>
        <p>Index Network, Inc.</p>
      </>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title={TITLE} lede={LEDE} sections={SECTIONS} />
  );
}

export const Component = PrivacyPolicyPage;
