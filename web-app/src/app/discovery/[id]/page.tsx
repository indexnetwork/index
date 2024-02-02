"use client";

import { useEffect } from "react";
import { DiscoveryType, useApp } from "@/components/site/context/AppContext";
import DiscoveryLayout from "components/layout/site/DiscoveryLayout";
import { useRouteParams } from "hooks/useRouteParams";
import IndexConversationSection from "components/sections/IndexConversation";
import UserConversationSection from "components/sections/UserConversation";
import LoadingSection from "@/components/sections/Loading";

const Discovery = () => {
  const { discoveryType, indexes, loading } = useApp();
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

      {discoveryType === DiscoveryType.did && <UserConversationSection />}

      {discoveryType === DiscoveryType.index && <IndexConversationSection />}
    </DiscoveryLayout>
  );
};

export default Discovery;
