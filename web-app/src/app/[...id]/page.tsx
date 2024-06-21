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
import { selectDID } from "@/store/slices/didSlice";

const Discovery = () => {
  const { api: apiService, ready: apiReady } = useApi();
  const { session } = useAuth();
  const view = useAppSelector(selectView);
  const index = useAppSelector(selectIndex);
  const did = useAppSelector(selectDID);

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
      {JSON.stringify(view)}
      <br />
      {JSON.stringify(index.data)}
      <br />
      {JSON.stringify(did.data)}
      {view.discoveryType === DiscoveryType.DID && <UserConversationSection />}
      {view.discoveryType === DiscoveryType.INDEX && (
        <IndexConversationSection />
      )}
    </DiscoveryLayout>
  );
};

export default Discovery;
