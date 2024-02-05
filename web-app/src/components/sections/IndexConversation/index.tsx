import { useEffect } from "react";

import Flex from "components/layout/base/Grid/Flex";
import { useApp } from "@/context/AppContext";
import Head from "next/head";
import { IndexConversationProvider } from "./IndexConversationContext";
import { IndexConversationHeader } from "./IndexConversationHeader";
import TabContainer from "./TabContainer";

const IndexConversationSection = () => {
  const { viewedIndex, fetchIndex } = useApp();

  // const handleCollabActionChange = async (CID: string) => {
  //   if (!viewedIndex) return;
  //   const litContracts = new LitContracts();
  //   await litContracts.connect();
  //   const pubKeyHash = ethers.keccak256(viewedIndex.pkpPublicKey!);
  //   const tokenId = BigInt(pubKeyHash);
  //   const newCollabAction = litContracts.utils.getBytesFromMultihash(CID);
  //   const previousCollabAction = litContracts.utils.getBytesFromMultihash(viewedIndex.collabAction!);
  //   const addPermissionTx = await litContracts.pkpPermissionsContract.write.addPermittedAction(tokenId, newCollabAction, []);
  //   const removePermissionTx = await litContracts.pkpPermissionsContract.write.removePermittedAction(tokenId, previousCollabAction);
  // };
  //

  useEffect(() => {
    fetchIndex();
  }, [fetchIndex]);

  return (
    <IndexConversationProvider>
      <Flex
        className={"px-md-10 px-0 pt-6"}
        flexdirection={"column"}
        style={{
          maxHeight: "90dvh",
          overflowY: "hidden",
        }}
      >
        <Flex flexdirection={"column"}>
          <IndexConversationHeader />
          <TabContainer />
        </Flex>
      </Flex>
      {viewedIndex && (
        <Head>
          <title>{viewedIndex.title} - Index Network</title>
          <meta name="title" content={`${viewedIndex.title} - Index Network`} />
          <meta
            name="description"
            content="The human bridge between context and content."
          />
        </Head>
      )}
    </IndexConversationProvider>
  );
};

export default IndexConversationSection;
