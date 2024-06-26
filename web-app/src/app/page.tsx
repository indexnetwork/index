"use client";

import AppHeader from "@/components/new/AppHeader";
import BigTextSection from "@/components/sections/landing/BigText";
import FeatureSection1 from "@/components/sections/landing/Feature1";
import FeatureSection2 from "@/components/sections/landing/Feature2";
import FeatureSection3 from "@/components/sections/landing/Feature3";
import FooterSection from "@/components/sections/landing/Footer";
import HeroSection from "@/components/sections/landing/Hero";
import PartnersSection from "@/components/sections/landing/Partners";
import SubscribeSection from "@/components/sections/landing/Subscribe";
import TestimonialsSection from "@/components/sections/landing/Testimonials";
import { AuthStatus, useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import "./globals.css";
import "./landing.css";
import HowItWorksSection from "@/components/sections/landing/HowItWorks";
import UseCasesSection from "@/components/sections/landing/UseCases";

const Landing = () => {
  const router = useRouter();

  const { status, session } = useAuth();

  useEffect(() => {
    if (status === AuthStatus.CONNECTED) {
      router.push(`/${session?.did.parent}`);
    }
  }, [status, session, router]);

  // useEffect(() => {
  //   if (typeof window !== "undefined") {
  //     if (window.location.pathname === "/") {
  //       document.getElementsByTagName("html")[0].setAttribute("id", "landing");
  //     } else {
  //       document.getElementsByTagName("html")[0].setAttribute("id", "app");
  //     }
  //   }
  // }, []);

  return (
    <Suspense>
      <div className="min-h-screen bg-mainDark font-primary text-primary">
        <AppHeader />
        <HeroSection />
        <BigTextSection />
        <TestimonialsSection />
        <HowItWorksSection />
        <UseCasesSection />
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
