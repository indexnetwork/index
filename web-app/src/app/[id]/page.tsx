"use client";

import { useApp } from "@/context/AppContext";
import { DiscoveryType } from "@/types";
import DiscoveryLayout from "components/layout/site/DiscoveryLayout";
import IndexConversationSection from "components/sections/IndexConversation";
import UserConversationSection from "components/sections/UserConversation";
import { useRouteParams } from "hooks/useRouteParams";
import { useEffect } from "react";
import "../../styles/main.scss";
import { useRouter } from "next/navigation";

const Discovery = () => {
  const { discoveryType, indexes } = useApp();
  const { id } = useRouteParams();
  const router = useRouter();

  useEffect(() => {
    console.log("discoveryType in page.tsx:", discoveryType, id);
    console.log("indexes in page.tsx:", indexes);

    // if (typeof window !== "undefined") {
    //   window.ethereum.on("message", (message: any) => {
    //     console.log("eth: ", message);
    //   });
    // }
  }, [id, discoveryType, indexes]);

  // TODO: that's a workaround, remove later
  useEffect(() => {
    const isReloaded = sessionStorage.getItem("isReloaded");
    if (!isReloaded) {
      sessionStorage.setItem("isReloaded", "true");

      window.location.reload();
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
