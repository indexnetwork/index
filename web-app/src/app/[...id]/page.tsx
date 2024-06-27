"use client";

import { useApi } from "@/context/APIContext";
import { DiscoveryType } from "@/types";
import DiscoveryLayout from "components/layout/site/DiscoveryLayout";
import IndexConversationSection from "components/sections/IndexConversation";
import UserConversationSection from "components/sections/UserConversation";
import "./app.css";
import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/store";
import { selectView } from "@/store/slices/appViewSlice";
import { toggleUserIndex } from "@/store/api";

const Discovery = () => {
  const { api: apiService, ready: apiReady } = useApi();
  const view = useAppSelector(selectView);

  const dispatch = useAppDispatch();

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
      if (!apiReady || !apiService) return;
      const isFirstLogin = localStorage.getItem("isFirstLogin") === null;
      const isMainnet =
        process.env.NEXT_PUBLIC_API_URL === "https://index.network/api";

      if (isMainnet && isFirstLogin) {
        localStorage.setItem("isFirstLogin", "false");
        const indexes = [
          "kjzl6kcym7w8y6b1fncbo7p7h2v6tei9llby5ai9n7wj09oy1aeae7hqsc1io0j",
          "kjzl6kcym7w8y63ksezbl4z1frr3xd0d9fg6nfmuwr1n0ue2xc4j7dtejvl4527",
          "kjzl6kcym7w8y8lefkkbpl44q6jh1zu78gaq2zp18we4wdgz1tz9vxyx213ochh",
        ];
        indexes.forEach((indexID) => {
          dispatch(
            toggleUserIndex({
              indexID,
              api: apiService,
              toggleType: "star",
              value: true,
            }),
          );
        });
      }
    }
  }, [apiService, apiReady, dispatch]);

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
