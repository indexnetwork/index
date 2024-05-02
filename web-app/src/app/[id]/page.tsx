"use client";

import { useApp } from "@/context/AppContext";
import { DiscoveryType } from "@/types";
import DiscoveryLayout from "components/layout/site/DiscoveryLayout";
import IndexConversationSection from "components/sections/IndexConversation";
import UserConversationSection from "components/sections/UserConversation";
import { useRouteParams } from "hooks/useRouteParams";
import { useEffect } from "react";
import "../../styles/main.scss";

const Discovery = () => {
  const { discoveryType, indexes } = useApp();
  const { id } = useRouteParams();

  // TODO: that's a workaround, remove later
  useEffect(() => {
    document.querySelectorAll(`link[href*="/_next/static/css/app/page.css"]`).forEach((e) => e.remove());
  }, []);

  return (
    <DiscoveryLayout>
      {discoveryType === DiscoveryType.DID && <UserConversationSection />}
      {discoveryType === DiscoveryType.INDEX && <IndexConversationSection />}
    </DiscoveryLayout>
  );
};

export default Discovery;
