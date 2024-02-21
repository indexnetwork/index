"use client";

import FeatureSection1 from "@/components/sections/landing/Feature1";
import FeatureSection2 from "@/components/sections/landing/Feature2";
import FeatureSection3 from "@/components/sections/landing/Feature3";
import HeroSection from "@/components/sections/landing/Hero";
import PartnersSection from "@/components/sections/landing/Partners";
import { AuthStatus, useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import "./globals.css";
import AppHeader from "@/components/new/AppHeader";
import FooterSection from "@/components/sections/landing/Footer";

const Landing = () => {
  const router = useRouter();

  const { status, session } = useAuth();

  useEffect(() => {
    if (status === AuthStatus.CONNECTED) {
      router.push(`/${session?.did.parent}`);
    }
  }, [status, session, router]);

  return (
    <div className="bg-mainDark text-primary font-primary min-h-screen">
      <AppHeader />
      <HeroSection />
      <PartnersSection />
      <div className="flex flex-col gap-16 md:gap-32">
        <FeatureSection1 />
        <FeatureSection2 />
        <FeatureSection3 />
      </div>
      <FooterSection />
    </div>
  );
};
export default Landing;
