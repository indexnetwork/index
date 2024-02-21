"use client";

import HeroSection from "@/components/sections/landing/Hero";
import { AuthStatus, useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import "./globals.css";

const Landing = () => {
  const router = useRouter();

  const { status, session } = useAuth();

  useEffect(() => {
    if (status === AuthStatus.CONNECTED) {
      router.push(`/${session?.did.parent}`);
    }
  }, [status, session, router]);

  return (
    <div className="bg-mainDark text-primary font-primary">
      <div className="bg-primary text-secondary h-12">header nav</div>
      <HeroSection />
    </div>
  );
};
export default Landing;
