"use client";

import { useApi } from "@/context/APIContext";
import { DiscoveryType } from "@/types";
import DiscoveryLayout from "components/layout/site/DiscoveryLayout";
import IndexConversationSection from "components/sections/IndexConversation";
import UserConversationSection from "components/sections/UserConversation";
import "./app.css";
import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAppSelector } from "@/store/store";
import { selectView } from "@/store/slices/appViewSlice";
import { selectIndex } from "@/store/slices/indexSlice";
import { selectConversation } from "@/store/slices/conversationSlice";
import { selectDID } from "@/store/slices/didSlice";

const Discovery = () => {
  const { api: apiService, ready: apiReady } = useApi();
  const { session } = useAuth();
  const view = useAppSelector(selectView);
  const index = useAppSelector(selectIndex);
  const did = useAppSelector(selectDID);
  const conversation = useAppSelector(selectConversation);

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
          "kjzl6kcym7w8y6b1fncbo7p7h2v6tei9llby5ai9n7wj09oy1aeae7hqsc1io0j",
          true,
        );
        apiService?.starIndex(
          "kjzl6kcym7w8y63ksezbl4z1frr3xd0d9fg6nfmuwr1n0ue2xc4j7dtejvl4527",
          true,
        );
        apiService?.starIndex(
          "kjzl6kcym7w8y8lefkkbpl44q6jh1zu78gaq2zp18we4wdgz1tz9vxyx213ochh",
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
