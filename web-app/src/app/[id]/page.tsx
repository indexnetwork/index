"use client";

import { useApp } from "@/context/AppContext";
import { DiscoveryType } from "@/types";
import DiscoveryLayout from "components/layout/site/DiscoveryLayout";
import IndexConversationSection from "components/sections/IndexConversation";
import UserConversationSection from "components/sections/UserConversation";
import "./app.css";
import { useEffect, useMemo, memo } from "react";
import IndexList from "@/components/sections/IndexList";

const Discovery = () => {
  const { discoveryType } = useApp();

  const conversationSection = useMemo(() => {
    return discoveryType === DiscoveryType.DID ? (
      <UserConversationSection />
    ) : (
      <IndexConversationSection />
    );
  }, [discoveryType]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const htmlID = document
        .getElementsByTagName("html")[0]
        .getAttribute("id");

      console.log("[id] rendered", htmlID);
      if (window.location.pathname !== "/") {
        if (htmlID !== "app") {
          document.getElementsByTagName("html")[0].setAttribute("id", "app");
        }
      } else {
        document.getElementsByTagName("html")[0].setAttribute("id", "landing");
        console.log("html changed");
      }
    }
  }, []);

  return <IndexList />;

  return (
    <DiscoveryLayout>
      {/* {discoveryType === DiscoveryType.DID && <UserConversationSection />}
      {discoveryType === DiscoveryType.INDEX && <IndexConversationSection />} */}
      {conversationSection}
    </DiscoveryLayout>
  );
};

export default memo(Discovery);
