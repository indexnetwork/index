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

  useEffect(() => {
    console.log("discoveryType in page.tsx:", discoveryType, id);
    console.log("indexes in page.tsx:", indexes);

    // if (typeof window !== "undefined") {
    //   window.ethereum.on("message", (message: any) => {
    //     console.log("eth: ", message);
    //   });
    // }
  }, [id, discoveryType, indexes]);

  return (
    <DiscoveryLayout>
      {discoveryType === DiscoveryType.DID && <UserConversationSection />}
      {discoveryType === DiscoveryType.INDEX && <IndexConversationSection />}
    </DiscoveryLayout>
  );
};

export default Discovery;
