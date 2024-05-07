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
import "./landing.css";

const Landing = () => {
  const router = useRouter();

  const { status, session } = useAuth();

  useEffect(() => {
    if (status === AuthStatus.CONNECTED) {
      router.push(`/${session?.did.parent}`);
    }
  }, [status, session, router]);

  useEffect(() => {
    const nextStyles = document.querySelectorAll("[data-precedence]");

    let len = 3;

    if (process.env.NODE_ENV === "development") {
      len++;
    }

    console.log("nextStyles", nextStyles);
    if (nextStyles.length === len) {
      console.log("nextStyles", nextStyles);
      nextStyles[len - 1].remove();
    }

    if (typeof window !== "undefined") {
      if (window.location.pathname === "/") {
        document.getElementsByTagName("body")[0].setAttribute("id", "landing");
      } else {
        document.getElementsByTagName("body")[0].removeAttribute("id");
      }
    }
  }, []);

  return (
    <Suspense>
      <div className="min-h-screen bg-mainDark font-primary text-primary">
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
