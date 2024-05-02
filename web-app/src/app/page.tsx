"use client";

import AppHeader from "@/components/new/AppHeader";
import FeatureSection1 from "@/components/sections/landing/Feature1";
import FeatureSection2 from "@/components/sections/landing/Feature2";
import FeatureSection3 from "@/components/sections/landing/Feature3";
import FooterSection from "@/components/sections/landing/Footer";
import HeroSection from "@/components/sections/landing/Hero";
import PartnersSection from "@/components/sections/landing/Partners";
import SubscribeSection from "@/components/sections/landing/Subscribe";
import { AuthStatus, useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import "./globals.css";

const Landing = () => {
  const router = useRouter();

  const { status, session } = useAuth();

  useEffect(() => {
    if (status === AuthStatus.CONNECTED) {
      router.push(`/${session?.did.parent}`);
    }
  }, [status, session, router]);

  useEffect(() => {
    document.querySelectorAll(`link[href*="/_next/static/css/app/%5Bid%5D/page.css"]`).forEach((e) => e.remove());
  }, []);

  return (
    <Suspense>
      <div className="bg-mainDark text-primary font-primary min-h-screen">
        <AppHeader />
        <HeroSection />
        <PartnersSection />
        <div className="mb-16 flex flex-col gap-24 md:mb-32 md:gap-48">
          <FeatureSection1 />
          <FeatureSection2 />
          <FeatureSection3 />
        </div>
        <SubscribeSection />
        <FooterSection />
      </div>
    </Suspense>
  );
};
export default Landing;
