"use client";

import React from "react";

import { CSSProperties } from "react";

const styles: { [key: string]: CSSProperties } = {
  container: {
    alignItems: "center",
    padding: "2rem",
    maxWidth: "800px",
    margin: "0 auto",
  },
  content: {},
  title: {
    marginBottom: "2rem",
    textAlign: "center",
    color: "#fff",
    fontSize: "2.5rem",
    fontWeight: "bold",
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
  button: {
    marginTop: "2rem",
    padding: "0.75rem 1.5rem",
    fontSize: "1rem",
    backgroundColor: "#007bff",
    color: "#ffffff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    transition: "background-color 0.3s ease",
  },
};

const PrivacyPolicy = () => {
  return (
    <div className="scroll-container">
      <div style={styles.container}>
        <div style={styles.content}>
          <h1 style={styles.title}>Privacy Policy</h1>

          <div>
            <p style={styles.paragraph}>
              Index Network, Inc built the Index app as a free app. This SERVICE is provided by
              Index Network, Inc at no cost and is intended for use as is.
            </p>
          </div>

          <p style={styles.paragraph}>
            This page is used to inform visitors regarding our policies with the collection, use,
            and disclosure of Personal Information if anyone decides to use our Service.
          </p>

          <p style={styles.paragraph}>
            If you choose to use our Service, you agree to the collection and use of information
            in relation to this policy. The Personal Information that we collect is used for
            providing and improving the Service. We will not use or share your information with
            anyone except as described in this Privacy Policy.
          </p>

          <p style={styles.paragraph}>
            The terms used in this Privacy Policy have the same meanings as in our Terms and
            Conditions unless otherwise defined in this Privacy Policy.
          </p>

          <h2 style={styles.sectionTitle}>Information Collection and Use</h2>
          <p style={styles.paragraph}>
            For a better experience, while using our Service, we may require you to provide us
            with certain personally identifiable information. The information that we request
            will be retained by us and used as described in this privacy policy.
          </p>
          <p style={styles.paragraph}>
            The app does use third-party services that may collect information used to identify you:
          </p>
          <ul style={styles.list}>
            <li>
              <a href="https://expo.dev/privacy" target="_blank" rel="noopener noreferrer">
                Expo
              </a>
            </li>
            <li>
              <a href="https://sentry.io/privacy/" target="_blank" rel="noopener noreferrer">
                Sentry
              </a>
            </li>
            <li>
              <a href="https://getstream.io/legal/privacy/" target="_blank" rel="noopener noreferrer">
                Stream.io
              </a>
            </li>
          </ul>

          <h2 style={styles.sectionTitle}>Log Data</h2>
          <p style={styles.paragraph}>
            We want to inform you that whenever you use our Service, in a case of an error in the
            app, we collect data and information (through third-party products) on your phone
            called Log Data. This Log Data may include information such as your device Internet
            Protocol ("IP") address, device name, operating system version, the configuration of
            the app when utilizing our Service, the time and date of your use of the Service, and
            other statistics.
          </p>

          <h2 style={styles.sectionTitle}>Security</h2>
          <p style={styles.paragraph}>
            We value your trust in providing us with your Personal Information, thus we are
            striving to use commercially acceptable means of protecting it. However, please
            remember that no method of transmission over the internet or method of electronic
            storage is 100% secure and reliable, and we cannot guarantee its absolute security.
          </p>

          <h2 style={styles.sectionTitle}>Links to Other Sites</h2>
          <p style={styles.paragraph}>
            This Service may contain links to other sites. If you click on a third-party link,
            you will be directed to that site. Please note that these external sites are not
            operated by us. Therefore, we strongly advise you to review the Privacy Policy of
            these websites. We have no control over and assume no responsibility for the content,
            privacy policies, or practices of any third-party sites or services.
          </p>

          <h2 style={styles.sectionTitle}>Children's Privacy</h2>
          <p style={styles.paragraph}>
            These Services do not address anyone under the age of 13. We do not knowingly collect
            personally identifiable information from children under 13 years of age. If we
            discover that a child under 13 has provided us with personal information, we
            immediately delete this from our servers. If you are a parent or guardian and you are
            aware that your child has provided us with personal information, please contact us so
            that we can take necessary actions.
          </p>

          <h2 style={styles.sectionTitle}>Changes to This Privacy Policy</h2>
          <p style={styles.paragraph}>
            We may update our Privacy Policy from time to time. Thus, you are advised to review
            this page periodically for any changes. We will notify you of any changes by posting
            the new Privacy Policy on this page.
          </p>
          <p style={styles.paragraph}>
            This policy is effective as of 2024-10-04.
          </p>

          <h2 style={styles.sectionTitle}>Contact Us</h2>
          <p style={styles.paragraph}>
            If you have any questions or suggestions about our Privacy Policy, do not hesitate to
            contact us at privacy@index.network
          </p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
