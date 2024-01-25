import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React, { useCallback, useContext, useEffect, useMemo } from "react";
import List from "components/base/List";
import { useParams } from "next/navigation";
import { Indexes } from "types/entity";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";

import IndexItem from "components/site/indexes/IndexItem";
import { useApp } from "hooks/useApp";
import Text from "components/base/Text";
import { useApi } from "components/site/context/APIContext";
import { useRouteParams } from "hooks/useRouteParams";
import { isDIDPath } from "app/discovery/[did]/page";
import { AuthContext } from "components/site/context/AuthContext";


const IndexListSection: React.FC = () => {
  const { did } = useRouteParams();

  const {
    viewedProfile,
    indexes,
    setIndexes,
    setLeftTabKey,
    leftTabKey,
  } = useApp();

  const {session} = useContext(AuthContext);

  const { apiService: api } = useApi();

  const fetchIndexes = useCallback(() => {
    return async () => {
      try {
        const fetchedIndexes = await api.getAllIndexes(did);
        console.log("fetchedIndexes", fetchedIndexes);
        setIndexes(fetchedIndexes);
      } catch (error) {
        console.error("Error fetching indexes", error);
        // TODO: Handle error appropriately
      }
    };
  }, [api, did]);

  useEffect(() => {
    if (isDIDPath(did)) {
      fetchIndexes();
    }
  }, [fetchIndexes]);

  const handleTabChange = useCallback((tabClickValue: string) => {
    // console.log("tabClickValue", tabClickValue, params);
    // if (viewedProfile && tabClickValue) {
    // 	const url = tabClickValue === "all" ?
    // 		`/${viewedProfile.id}` :
    // 		`/${viewedProfile.id}?section=${tabClickValue}`;
    // 	router.push(`/discovery/${did}`);
    // }
    setLeftTabKey(tabClickValue);
  }, [viewedProfile]);

  const sectionIndexes = useMemo(() => {
    if (leftTabKey === 'all') {
      return indexes;
    } else {
      return indexes.filter(
        leftTabKey === 'owner' ? i => i.id === session?.did.parent : i => i.isStarred === true
      );
    }
  }, [indexes, leftTabKey]);

  return <>
    <FlexRow className={"mr-6 pb-4"}>
      <Col className="idxflex-grow-1">
        <Tabs destroyInactiveTabPane={false} theme={"rounded"} activeKey={leftTabKey} onTabChange={handleTabChange}>
          <TabPane enabled={true} tabKey={"all"} title={`All Indexes`} />
          <TabPane enabled={true} tabKey={"owner"} total={indexes.filter(i => i.id === session?.did.parent)?.length} title={`Owned`} />
          <TabPane enabled={true} tabKey={"starred"} total={indexes.filter(i => i.isStarred === true)?.length} title={`Starred`} />
        </Tabs>
      </Col>
    </FlexRow>
    <FlexRow className={"scrollable-area index-list pr-6 idxflex-grow-1"}>
      {(sectionIndexes.length > 0) ? <div className={"idxflex-grow-1"}>
        
        <List
          data={sectionIndexes}
          render={(itm: Indexes) =><>
          <p>{itm.id + " "+  did}</p>
          {console.log("itm, did, ",itm, did)}
           <IndexItem
            index={itm}
            selected={itm.id === did}
          /></>}
          divided={false}
        />
      </div> :
        <Text fontWeight={500} style={{
          color: "var(--gray-4)",
          textAlign: "center",
          padding: "4rem 0",
          margin: "auto",
        }}>
          There are no indexes yet
        </Text>}
    </FlexRow>
  </>;
};

export default IndexListSection;
