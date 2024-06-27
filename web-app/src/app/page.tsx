"use client";

import AppHeader from "@/components/new/AppHeader";
import BigTextSection from "@/components/sections/landing/BigText";
import FooterSection from "@/components/sections/landing/Footer";
import HeroSection from "@/components/sections/landing/Hero";
import PartnersSection from "@/components/sections/landing/Partners";
import SubscribeSection from "@/components/sections/landing/Subscribe";
import { AuthStatus, useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import "./globals.css";
// import "./landing.css";
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

        <div
          style={{
            background: "rgba(110, 191, 244, 0.07)",
            borderTop: "1px solid rgba(110, 191, 244, 0.2)",
            borderBottom: "1px solid rgba(110, 191, 244, 0.2)",
          }}
        >
          {true && <UseCasesSection />}
        </div>
        <HowItWorksSection />
        <div
          style={{
            background: "rgba(110, 191, 244, 0.07)",
            borderTop: "1px solid rgba(110, 191, 244, 0.2)",
            borderBottom: "1px solid rgba(110, 191, 244, 0.2)",
          }}
        >
          <BigTextSection />
          {/* <TestimonialsSection /> */}
        </div>
        <PartnersSection />
        <SubscribeSection />
        <FooterSection />
      </div>
    </Suspense>
  );
};
export default Landing;
