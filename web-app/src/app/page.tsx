"use client";

import { AuthStatus, useAuth } from "@/context/AuthContext";
import Flex from "components/layout/base/Grid/Flex";
import AppHeader from "components/layout/site/AppHeader";
import LandingSection1 from "components/site/landing/LandingSection1";
import LandingSection1v2 from "components/site/landing/LandingSection1v2";
import LandingSection2 from "components/site/landing/LandingSection2";
import LandingSection3 from "components/site/landing/LandingSection3";
import LandingSection4 from "components/site/landing/LandingSection4";
import LandingSection5 from "components/site/landing/LandingSection5";
import LandingSection7 from "components/site/landing/LandingSection7";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const Landing = () => {
  const router = useRouter();

  const { status, session } = useAuth();

  useEffect(() => {
    if (status === AuthStatus.CONNECTED) {
      router.push(`/${session?.did.parent}`);
    }
  }, [status, session, router]);

  return (
    <Flex flexdirection="column" alignitems="center">
      <AppHeader />
      <LandingSection1 />
      <LandingSection1v2 />
      <LandingSection2 />
      <LandingSection3 />
      <LandingSection4 />
      <LandingSection5 />
      <LandingSection7 />
    </Flex>
  );
};
export default Landing;
