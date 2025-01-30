'use client';

import React from 'react';
import Image from "next/image";
import Link from "next/link";

export function HeroSection() {
  return (
    <section className="text-center space-y-4">
      <div className="relative w-96 h-96 mx-auto">
        <Image
          src="/hero.png"
          alt="Index Network Logo"
          fill
          className="object-contain"
          priority
        />
      </div>
      <h1 className="text-4xl font-bold">
        Let The Agents Do The Finding
      </h1>
      <p className="text-xl text-gray-400 max-w-2xl mx-auto">
        Index connects you with the right ideas and people. All while respecting your privacy.
      </p>
      <div className="flex justify-center gap-4 mt-0">
        <Link target='_blank' href="https://docs.google.com/forms/d/e/1FAIpQLSfRpjybSA43mJD9K9Gbj2p3fmeSk1MeH1r9fr-VRZrmFI8fGg/viewform" className="border border-white text-white bg-transparent py-2 px-4 rounded">
          Join the waitlist
        </Link>
      </div>
      { false && 
      <div className="flex justify-center gap-4 mt-0">
        <Link href="#" className="">
          <Image
            src="/appstore.png"
            alt="App Store"
            width={150}
            height={50}
          />
        </Link>
        <Link href="#" className="">
          <Image
            src="/googleplay.png"
            alt="Google Play"
            width={150}
            height={50}
          />
        </Link>
      </div>}
    </section>
  );
} 