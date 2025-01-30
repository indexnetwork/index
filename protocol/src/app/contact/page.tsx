import React from 'react'
import Link from 'next/link'

export default function Contact() {
  return (
    <div className="max-w-4xl mx-auto space-y-12">
      <Link href="/" className="text-blue-400 hover:text-blue-300">
        ← Back to home
      </Link>

      <section className="space-y-8">
        <h1 className="text-4xl font-bold">Contact & Privacy</h1>
        
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-2xl font-bold mb-4">Privacy Policy</h2>
            <p className="text-gray-400">
              We take your privacy seriously. Index Network is designed to protect your data while providing powerful discovery features:
            </p>
            <ul className="list-disc list-inside mt-4 text-gray-400 space-y-2">
              <li>Your data remains private and encrypted</li>
              <li>No tracking or unnecessary data collection</li>
              <li>Transparent data handling practices</li>
              <li>You control what you share</li>
            </ul>
          </div>

          <div className="card">
            <h2 className="text-2xl font-bold mb-4">Contact Us</h2>
            <p className="text-gray-400 mb-4">
              Have questions or feedback? We'd love to hear from you.
            </p>
            <div className="space-y-2">
              <p className="text-gray-400">
                Email: <a href="mailto:contact@indexnetwork.ai" className="text-blue-400 hover:text-blue-300">contact@indexnetwork.ai</a>
              </p>
              <p className="text-gray-400">
                Twitter: <a href="https://twitter.com/indexnetwork" className="text-blue-400 hover:text-blue-300">@indexnetwork</a>
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
} 