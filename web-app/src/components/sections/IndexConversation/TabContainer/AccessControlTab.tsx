import Col from "@/components/layout/base/Grid/Col";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import Soon from "@/components/site/indexes/Soon";
import { useRole } from "@/hooks/useRole";
import { useRouteParams } from "@/hooks/useRouteParams";
import React from "react";
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
