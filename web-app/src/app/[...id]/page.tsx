"use client";

import { useApp } from "@/context/AppContext";
import { useApi } from "@/context/APIContext";
import { DiscoveryType } from "@/types";
import DiscoveryLayout from "components/layout/site/DiscoveryLayout";
import IndexConversationSection from "components/sections/IndexConversation";
import UserConversationSection from "components/sections/UserConversation";
import "./app.css";
import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";

const Discovery = () => {
  const { view } = useApp();
  const { api: apiService, ready: apiReady } = useApi();
  const { session } = useAuth();

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (window.location.pathname !== "/") {
        document.getElementsByTagName("html")[0].setAttribute("id", "app");
      } else {
        document.getElementsByTagName("html")[0].setAttribute("id", "landing");
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (!apiReady || !session) return;

      const isFirstLogin = localStorage.getItem("isFirstLogin") === null;
      const isMainnet =
        process.env.NEXT_PUBLIC_API_URL === "https://index.network/api";

      if (isFirstLogin) {
        localStorage.setItem("isFirstLogin", "false");
      } else {
        return;
      }

      if (isMainnet) {
        apiService?.starIndex(
          session.did.parent,
          "kjzl6kcym7w8yanw06ihwgpo49rl37g6eq4xc753g5phjs5f2vjcmcp3vvuhhkk",
          true,
        );
        apiService?.starIndex(
          session.did.parent,
          "kjzl6kcym7w8y88qolfxxr74n51tb91xi36flwrxwah9yt5q8y0hh2odx96etmj",
          true,
        );
      }
    }
  }, [session, apiReady]);

  return (
    <DiscoveryLayout>
      {view.discoveryType === DiscoveryType.DID && <UserConversationSection />}
      {view.discoveryType === DiscoveryType.INDEX && (
        <IndexConversationSection />
      )}
    </DiscoveryLayout>
  );
};

export default Discovery;
