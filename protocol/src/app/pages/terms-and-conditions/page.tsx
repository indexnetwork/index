"use client";

import React, { CSSProperties } from "react";

const styles: { [key: string]: CSSProperties } = {
  container: {
    alignItems: "center",
    padding: "2rem",
    maxWidth: "800px",
    margin: "0 auto",
    color: "#fff",
  },
  content: {
    width: "100%",
  },
  mainTitle: {
    marginBottom: "2rem",
    textAlign: "center",
    color: "#fff",
    fontSize: "2.5rem",
  },
  sectionTitle: {
    marginTop: "3rem",
    marginBottom: "1.5rem",
    color: "#fff",
    fontSize: "1.75rem",
  },
  paragraph: {
    marginTop: "1rem",
    color: "#fff",
    lineHeight: "1.5",
  },
  list: {
    marginTop: "1.5rem",
    color: "#fff",
    lineHeight: "1.5",
  },
  title: {
    marginBottom: "2rem",
    textAlign: "center",
    color: "#fff",
    fontSize: "2.5rem",
    fontWeight: "bold",
  },
};

const TermsAndConditions = () => {
  return (
    <div className="scroll-container">
      <div style={styles.container}>
        <div style={styles.content}>
          <h1 style={styles.title}>Terms and Conditions</h1>

          <div>
            <p style={styles.paragraph}>
              Welcome to Index, the app created by Index Network, Inc. By using our service, you agree to
              the following terms and conditions:
            </p>
          </div>

          <h2 style={styles.sectionTitle}>1. Content Guidelines</h2>
          <p style={styles.paragraph}>
            You are solely responsible for the content you send through Index. You may not use the app to
            send any content that is illegal, offensive, abusive, defamatory, or otherwise objectionable.
            Index Network, Inc reserves the right to stop displaying any content that violates these
            guidelines or terminate your access to the app without notice.
          </p>

          <h2 style={styles.sectionTitle}>2. Prohibited Conduct</h2>
          <p style={styles.paragraph}>
            You may not use Index to:
          </p>
          <ul style={styles.list}>
            <li>Harass, stalk, or threaten any other user</li>
            <li>Impersonate any person or entity or falsely state or otherwise misrepresent your affiliation with a person or entity</li>
            <li>Send unsolicited messages or spam</li>
            <li>Collect or store personal data about other users without their consent</li>
            <li>Engage in any illegal activity or violate any laws or regulations</li>
          </ul>

          <h2 style={styles.sectionTitle}>3. Termination</h2>
          <p style={styles.paragraph}>
            Index Network, Inc may terminate your access to the app at any time and for any reason, without notice.
          </p>

          <h2 style={styles.sectionTitle}>4. Disclaimer of Warranties</h2>
          <p style={styles.paragraph}>
            Index is provided "as is" and "as available" without warranty of any kind, express or implied,
            including but not limited to the warranties of merchantability, fitness for a particular
            purpose, and non-infringement.
          </p>

          <h2 style={styles.sectionTitle}>5. Limitation of Liability</h2>
          <p style={styles.paragraph}>
            In no event shall Index Network, Inc be liable for any damages (including, without limitation,
            damages for loss of data or profit, or due to business interruption) arising out of the use or
            inability to use Index, even if Index Network, Inc has been notified orally or in writing of
            the possibility of such damage.
          </p>

          <p style={styles.paragraph}>
            By using Index, you agree to these terms and conditions. If you do not agree to these terms,
            you may not use the app.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TermsAndConditions;
