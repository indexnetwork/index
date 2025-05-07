"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Database, Target, Zap, Shield } from "lucide-react";
import Link from "next/link";
import { LoginButton } from "@/components/LoginButton";

export default function LandingPage() {
  const [isHovered, setIsHovered] = useState("");
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50 dark:from-gray-900 dark:to-gray-800">
      {/* Hero Section */}
      <section className="relative pt-20 pb-32 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-5xl md:text-6xl font-bold text-gray-900 dark:text-white mb-6">
              The Protocol for{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-amber-500 to-amber-600">
                Discovery
              </span>
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto mb-8">
              Index Protocol enables efficient and decentralized data discovery through intent-driven indexing and semantic search.
            </p>
            <div className="flex justify-center gap-4">
              <LoginButton />
              <Link href="/docs" className="btn-secondary">
                View Documentation
              </Link>
            </div>
          </div>
        </div>

        {/* Background Elements */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-30 dark:opacity-20 blur-3xl bg-gradient-to-r from-amber-200 to-amber-400 rounded-full -z-10" />
      </section>

      {/* Features Section */}
      <section className="py-24 bg-white dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
              Why Choose Index Protocol?
            </h2>
            <p className="text-gray-600 dark:text-gray-300">
              Built for the future of decentralized data discovery
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: Target,
                title: "Intent-Driven",
                description:
                  "Express your data needs through intents and let the protocol handle discovery",
              },
              {
                icon: Database,
                title: "Efficient Indexing",
                description:
                  "Optimized indexing strategies ensure fast and reliable data access",
              },
              {
                icon: Shield,
                title: "Secure & Decentralized",
                description:
                  "Built on blockchain technology for transparent and secure operations",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="card hover:shadow-lg transition-shadow duration-300"
                onMouseEnter={() => setIsHovered(feature.title)}
                onMouseLeave={() => setIsHovered("")}
              >
                <div className="flex flex-col items-center text-center p-6">
                  <feature.icon
                    className={`w-12 h-12 mb-4 transition-colors duration-300 ${
                      isHovered === feature.title
                        ? "text-amber-500"
                        : "text-gray-700 dark:text-gray-300"
                    }`}
                  />
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-r from-amber-500 to-amber-600 rounded-2xl p-8 md:p-12 shadow-xl">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-white mb-4">
                Ready to Get Started?
              </h2>
              <p className="text-amber-50 mb-8 max-w-2xl mx-auto">
                Join the future of decentralized data discovery and start building with Index Protocol today.
              </p>
              <button
                onClick={() => router.push("/indexes")}
                className="bg-white text-amber-600 px-8 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                Launch App
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
