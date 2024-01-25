'use client';
import AskIndexes from "components/site/indexes/AskIndexes";
import React, {
  useCallback, useEffect, useState,
} from "react";
import { NextPageWithLayout } from "types";
import { DiscoveryType, useApp } from "hooks/useApp";
import { useApi } from "components/site/context/APIContext";
import FlexRow from "components/layout/base/Grid/FlexRow";
import NotFound from "components/site/indexes/NotFound";
import Col from "components/layout/base/Grid/Col";
import DiscoveryLayout from "components/layout/site/DiscoveryLayout";
import { useRouteParams } from "hooks/useRouteParams";
import IndexConversationSection from "components/sections/IndexConversation";
import { UserConversationSection } from "components/sections/UserConversation";
import Flex from "components/layout/base/Grid/Flex";

enum Tab {
  chat = "chat",
  index = "index",
  creators = "creators",
  access_control = "access_control",
  settings = "settings",
}

export const isDIDPath = (path: string) => {
  return path.includes("did");
}

const Discovery: NextPageWithLayout = () => {
  // const { did } = router.query;
  const { did } = useRouteParams();
  const [tabKey, setTabKey] = useState<Tab>(Tab.chat);
  const { apiService: api } = useApi(); // Consume ApiContext
  const [loading, setLoading] = useState(true);

  const {
    discoveryType,
    setDiscoveryType,
    viewedProfile,
    setViewedProfile,
    setViewedIndex
  } = useApp();

  const fetchViewedProfile = useCallback(async (did: string) => {
    setLoading(true);
    try {
      const profile = await api.getProfile(did);
      if (profile) {
        setViewedProfile(profile);
        setDiscoveryType(DiscoveryType.did);
      } else {
        setDiscoveryType(DiscoveryType.invalid);
      }
    } catch (err) {
      console.error("Couldn't fetch profile", err);
      setDiscoveryType(DiscoveryType.invalid);
    }
    setLoading(false);
  }, [api, setViewedProfile]);

  const fetchIndex = useCallback(async (did: string) => {
    setLoading(true);
    try {
      const index = await api.getIndex(did);
      if (index) {
        setViewedIndex(index);
        setDiscoveryType(DiscoveryType.index);
        if(!viewedProfile) {
          setViewedProfile(index.ownerDID);
        }
      } else {
        setViewedIndex(undefined);
        setDiscoveryType(DiscoveryType.invalid);
      }
    } catch (err) {
      console.error("Couldn't fetch index", err);
      setDiscoveryType(DiscoveryType.invalid);
    }
    setLoading(false);
  }, [api, setViewedIndex]);

  useEffect(() => {
    if (isDIDPath(did)) {
      fetchViewedProfile(did);
    } else {
      fetchIndex(did);
    }
  }, [did, fetchViewedProfile, fetchIndex]);

  const getUserProfile = async (viewedDid: string) => {
    try {
      const { apiService } = useApi();

      // const profile = await apiService!.getProfile();
      // if (profile) {
      // 	setViewedProfile(profile);
      // }
      // const suggested = localStorage.getItem("suggestIndex");
      // if (!suggested) {
      // 	setTimeout(async () => {
      // 		// const suggestedIndex = await apiService!.getIndexById("kjzl6kcym7w8y7zvi7lvn12vioylmcbv0awup1xj9in1qb4kxp94569hjhx93s5");
      // 		if (suggestedIndex) {
      // 			localStorage.setItem("suggestIndex", "true");
      // 			suggestedIndex.isStarred = true;
      // 			// personalCeramic.addUserIndex(suggestedIndex.id, "starred");
      // 			updateUserIndexState({ ...suggestedIndex } as Indexes, "starred", "add");
      // 		}
      // 	}, 500);
      // }
    } catch (err) {
      // profile error
    }
  };


  // if (discoveryType === DiscoveryType.invalid) {
  //   return (
  //     <FlexRow>
  //       <Col className="idxflex-grow-1">
  //         <NotFound active={true} />
  //       </Col>
  //     </FlexRow>
  //   )
  // }

  // useEffect(() => {
  // 	did && getUserProfile(did.toString());
  // }, [did]);
  // useEffect(() => {
  // 	const suffix = crypto.createHash("sha256").update(router.asPath).digest("hex");
  // 	setChatId(`${localStorage.getItem("chatterID")}-${suffix}`);
  // }, [router.asPath]);

  // return <DiscoveryLayout>;
  // 	<div className={"scrollable-container"}>
  // 		{/* <AskIndexes id={chatId} did={did!.toString()} /> */}

  // 	</div>
  // 	{/* { viewedProfile && viewedProfile.id && <Head>
  // 		<title>{viewedProfile.name || maskDID(viewedProfile.id!)} - Index Network</title>
  // 		<meta name="title" content={`${viewedProfile.name || maskDID(viewedProfile.id!)} - Index Network`} />
  // 		<meta name="description" content="The human bridge between context and content." />
  // 	</Head>} */}
  // </DiscoveryLayout>;

  if (loading) {
    return (
      <DiscoveryLayout>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            flexDirection: "column",
            height: "100%",
            textAlign: "center",
            margin: "auto",
          }}>
          <div>
            <video
              autoPlay
              loop
              muted
              playsInline
              className={"p-0"}
              style={{
                width: "30%",
                margin: "auto",
              }}
            >
              <source src="/video/loadingPerspective.mp4" type="video/mp4" />
            </video>
            <p>Loading...</p>
          </div>

        </div>
      </DiscoveryLayout>
    )
  }

  return <DiscoveryLayout>
    {discoveryType === DiscoveryType.did &&
      <UserConversationSection />
    }

    {discoveryType === DiscoveryType.index &&
      <IndexConversationSection />
    }

    {discoveryType === DiscoveryType.invalid &&
      <NotFound />
    }
  </DiscoveryLayout >;

};

export default Discovery;
