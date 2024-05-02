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
    const nextStyles = document.querySelectorAll("[data-precedence]");
    if (nextStyles.length === 3) {
      document.querySelectorAll("[data-precedence]")[1].remove();
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
