"use client";

import { useApp } from "@/context/AppContext";
import { DiscoveryType } from "@/types";
import DiscoveryLayout from "components/layout/site/DiscoveryLayout";
import IndexConversationSection from "components/sections/IndexConversation";
import UserConversationSection from "components/sections/UserConversation";
import { useRouteParams } from "hooks/useRouteParams";
import "../../styles/main.scss";
import { useEffect } from "react";

const Discovery = () => {
  const { discoveryType, indexes } = useApp();
  const { id } = useRouteParams();

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (window.location.pathname !== "/") {
        document.getElementsByTagName("body")[0].removeAttribute("id");
      } else {
        document.getElementsByTagName("body")[0].setAttribute("id", "landing");
      }
    }
  }, []);

  return (
    <DiscoveryLayout>
      {discoveryType === DiscoveryType.DID && <UserConversationSection />}
      {discoveryType === DiscoveryType.INDEX && <IndexConversationSection />}
    </DiscoveryLayout>
  );
};

export default Discovery;
