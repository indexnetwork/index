import React, { useState, useEffect, useCallback } from "react";
import AskIndexes from "@/components/site/indexes/AskIndexes";
import NoLinks from "@/components/site/indexes/NoLinks";
import { useApi } from "@/components/site/context/APIContext";
import { useApp } from "@/components/site/context/AppContext";
import { useRouteParams } from "@/hooks/useRouteParams";
import { useRole } from "@/hooks/useRole";
import { IndexLink } from "@/types/entity";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import Col from "@/components/layout/base/Grid/Col";
import Soon from "@/components/site/indexes/Soon";
import { useIndexConversation } from "../IndexConversationContext";

export default function AccessControlTabSection() {
  const { id: indexID } = useRouteParams();
  // const [links, setLinks] = useState<IndexLink[]>([]);
  const { isOwner } = useRole();
  const { apiService: api } = useApi();
  const { viewedIndex } = useApp();
  const { itemsState } = useIndexConversation();

  // const loadLinks = useCallback(async () => {
  //   // Logic to load chat links and update state
  //   // Example:
  //   try {
  //     const response = await api.searchLink({ index_id: indexID });
  //     setLinks(response.records);
  //   } catch (error) {
  //     console.error("Error fetching chat links", error);
  //   }
  // }, [api, indexID]);

  // useEffect(() => {
  //   loadLinks();
  // }, [loadLinks]);

  return (
    <FlexRow justify="center" align="center" fullHeight>
      <Col>
        <Soon section={"access_control"}></Soon>
      </Col>
    </FlexRow>
  );
}
