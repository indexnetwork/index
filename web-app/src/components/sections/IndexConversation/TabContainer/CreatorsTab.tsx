import Col from "@/components/layout/base/Grid/Col";
import Flex from "@/components/layout/base/Grid/Flex";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import CreatorSettings from "@/components/site/index-details/CreatorSettings";
import { useRole } from "@/hooks/useRole";
import { useRouteParams } from "@/hooks/useRouteParams";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { ethers } from "ethers";
import React from "react";

export default function CreatorsTabSection({ noLinks }: { noLinks?: boolean }) {
  const { id: indexID } = useRouteParams();
  // const [links, setLinks] = useState<IndexLink[]>([]);
  const { isOwner } = useRole();
  const { api, ready: apiReady } = useApi();
  const { viewedIndex } = useApp();

  const handleCollabActionChange = async (CID: string) => {
    if (!viewedIndex) return;
    const litContracts = new LitContracts();
    await litContracts.connect();
    const pubKeyHash = ethers.keccak256(viewedIndex.pkpPublicKey!);
    const tokenId = BigInt(pubKeyHash);
    const newCollabAction = litContracts.utils.getBytesFromMultihash(CID);
    const previousCollabAction = litContracts.utils.getBytesFromMultihash(
      viewedIndex.collabAction!,
    );
    const addPermissionTx = await litContracts.pkpPermissionsContract.write.addPermittedAction(
        tokenId,
        newCollabAction,
        [],
      );
    const removePermissionTx = await litContracts.pkpPermissionsContract.write.removePermittedAction(
        tokenId,
        previousCollabAction,
      );
    // const result = await pkpCeramic.updateIndex(viewedIndex, {
    // 	collabAction: CID,
    // });
    // setViewedProfile(result);
  };

  return (
    <Flex flexdirection={"column"}>
      <FlexRow className={"scrollable-container mt-6"}>
        <Col className="idxflex-grow-1">
          <CreatorSettings
            onChange={handleCollabActionChange}
            collabAction={viewedIndex?.collabAction!}
          />
        </Col>
      </FlexRow>
    </Flex>
  );
}
