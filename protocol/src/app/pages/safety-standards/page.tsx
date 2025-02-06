import React from 'react';

export default function SafetyStandards() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <h1 className="text-4xl font-bold mb-8">Safety Standards</h1>
      
      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Our Commitment to Safety</h2>
        <p className="mb-4">
          At Index, we are committed to maintaining a safe environment and preventing any form of child sexual abuse and exploitation (CSAE). 
          We have implemented comprehensive measures and standards to protect all users, with a particular focus on preventing harm to minors.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Key Safety Measures</h2>
        <ul className="list-disc pl-6 space-y-3">
          <li>Strict content moderation policies and automated detection systems</li>
          <li>Zero-tolerance policy for any CSAE-related content or behavior</li>
          <li>Immediate reporting of violations to relevant authorities</li>
          <li>Regular system audits and safety reviews</li>
          <li>Collaboration with safety experts and organizations</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Reporting Concerns</h2>
        <p className="mb-4">
          If you encounter any concerning content or behavior, please immediately:
        </p>
        <ul className="list-disc pl-6 space-y-3">
          <li>Report it through our in-app reporting system</li>
          <li>Contact our safety team at safety@index.dev</li>
          <li>For emergencies, contact your local law enforcement</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Continuous Improvement</h2>
        <p>
          We regularly update our safety measures and standards based on emerging threats, best practices, and feedback from our community and safety experts. 
          Our commitment to safety is ongoing and evolving.
        </p>
      </section>
    </div>
  );
} 