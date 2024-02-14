import Col from "@/components/layout/base/Grid/Col";
import Flex from "@/components/layout/base/Grid/Flex";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import CreatorSettings from "@/components/site/index-details/CreatorSettings";
import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { ethers } from "ethers";
import { CID } from "multiformats/cid";
import { useCallback } from "react";

export default function CreatorsTabSection() {
  const { api, ready: apiReady } = useApi();
  const { viewedIndex, setViewedIndex } = useApp();

  const handleCollabActionChange = useCallback(
    async (cid: string) => {
      if (!viewedIndex || !apiReady) return;

      try {
        const litContracts = new LitContracts();
        await litContracts.connect();
        const signerFunctionV0 = CID.parse(viewedIndex.signerFunction)
          .toV0()
          .toString();
        const pubKeyHash = ethers.keccak256(viewedIndex.signerPublicKey!);
        const tokenId = BigInt(pubKeyHash);
        const newCollabAction = litContracts.utils.getBytesFromMultihash(cid);
        const previousCollabAction =
          litContracts.utils.getBytesFromMultihash(signerFunctionV0);

        await litContracts.pkpPermissionsContract.write.addPermittedAction(
          tokenId,
          newCollabAction,
          [],
        );
        await litContracts.pkpPermissionsContract.write.removePermittedAction(
          tokenId,
          previousCollabAction,
        );
        const updatedIndex = await api!.updateIndex(viewedIndex?.id, {
          signerFunction: cid,
        });
        setViewedIndex(updatedIndex);
      } catch (error) {
        console.error("Error creating rule", error);
      }
    },
    [api, viewedIndex],
  );

  return (
    <Flex flexdirection={"column"}>
      <FlexRow className={"scrollable-container mt-6"}>
        <Col className="idxflex-grow-1">
          <CreatorSettings
            onChange={handleCollabActionChange}
            collabAction={viewedIndex?.signerFunction!}
          />
        </Col>
      </FlexRow>
    </Flex>
  );
}
