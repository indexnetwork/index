"use client";

// import LoadingSection from "@/components/sections/Loading";
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
  }, [id, discoveryType, indexes]);

  // if (loading) {
  //   return (
  //     <DiscoveryLayout>
  //       <LoadingSection />
  //     </DiscoveryLayout>
  //   );
  // }

  return (
    <DiscoveryLayout>
      {/* {!discoveryType && <LoadingSection />} */}

      {discoveryType === DiscoveryType.DID && <UserConversationSection />}

      {discoveryType === DiscoveryType.INDEX && <IndexConversationSection />}
    </DiscoveryLayout>
  );
};

export default Discovery;
