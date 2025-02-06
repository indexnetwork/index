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
    backgroundColor: "#dc3545",
    color: "#ffffff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    transition: "background-color 0.3s ease",
    "&:hover": {
      backgroundColor: "#c82333",
    },
  },
};

const AccountDeletionRequest = () => {
  const handleDeleteRequest = () => {
    // TODO: Implement account deletion logic
    console.log("Account deletion requested");
  };

  return (
    <div className="scroll-container">
      <div style={styles.container}>
        <div style={styles.content}>
          <h1 style={styles.title}>Account Deletion Request</h1>

          <p style={styles.paragraph}>
            We're sorry to see you go. Before you proceed with deleting your account, please read the following information carefully:
          </p>

          <h2 style={styles.sectionTitle}>What Happens When You Delete Your Account</h2>
          <ul style={styles.list}>
            <li>All your personal information will be permanently deleted</li>
            <li>Your profile and content will be removed from Index</li>
            <li>This action cannot be undone</li>
            <li>Any active subscriptions will be cancelled</li>
          </ul>

          <h2 style={styles.sectionTitle}>Data Retention</h2>
          <p style={styles.paragraph}>
            In accordance with our Privacy Policy and legal obligations, some information may be retained for a limited period after account deletion. This typically includes:
          </p>
          <ul style={styles.list}>
            <li>Transaction records for legal and accounting purposes</li>
            <li>Data required for legal compliance</li>
            <li>Anonymized usage statistics</li>
          </ul>

          <h2 style={styles.sectionTitle}>Need Help?</h2>
          <p style={styles.paragraph}>
            If you're experiencing issues with Index, we'd love to help. Please contact our support team at support@index.network before proceeding with account deletion.
          </p>

          <button 
            style={styles.button}
            onClick={handleDeleteRequest}
          >
            Request Account Deletion
          </button>

          <p style={styles.paragraph}>
            By clicking "Request Account Deletion", you confirm that you understand this action is permanent and cannot be undone.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AccountDeletionRequest;
