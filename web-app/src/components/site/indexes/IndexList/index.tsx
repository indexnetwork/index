// import React, { useCallback, useEffect, useMemo } from "react";
// import { useApi } from "@/components/site/context/APIContext";
// import { useApp } from "@/components/site/context/AppContext";
// import { useRouteParams } from "hooks/useRouteParams";
// import Col from "components/layout/base/Grid/Col";
// import FlexRow from "components/layout/base/Grid/FlexRow";
// import Text from "components/base/Text";
// import { Tabs } from "components/base/Tabs";
// import TabPane from "components/base/Tabs/TabPane";
// import IndexItem from "components/site/indexes/IndexItem";
// import List from "components/base/List";
// import { Indexes } from "types/entity";
// import { isDIDPath } from "app/discovery/[id]/page";
// import { IndexListTabKey } from "@/components/sections/IndexList";

// const IndexListSection: React.FC = () => {
//   const { id } = useRouteParams();
//   const { viewedProfile, indexes, setIndexes, setLeftTabKey, leftTabKey } = useApp();
//   const { apiService: api } = useApi();

//   const fetchIndexes = useCallback(async (did: string) => {
//     try {
//       const fetchedIndexes = await api?.getAllIndexes(did);
//       if (!fetchedIndexes) return;
//       setIndexes(fetchedIndexes);
//     } catch (error) {
//       console.error("Error fetching indexes", error);
//     }
//   }, [api, setIndexes]);

//   useEffect(() => {
//     const targetDid = isDIDPath(id) ? id : viewedProfile?.id;
//     if (targetDid) {
//       fetchIndexes(targetDid);
//     }
//   }, [fetchIndexes, id, viewedProfile]);

//   const handleTabChange = useCallback((tabKey: IndexListTabKey) => {
//     setLeftTabKey(tabKey);
//   }, [setLeftTabKey]);

//   const sectionIndexes = useMemo(() => {
//     switch (leftTabKey) {
//       case IndexListTabKey.ALL:
//         return indexes;
//       case IndexListTabKey.OWNER:
//         return indexes.filter(i => i.ownerDID.id === viewedProfile?.id);
//       case IndexListTabKey.STARRED:
//         return indexes.filter(i => i.did.starred);
//       default:
//         return [];
//     }
//   }, [indexes, leftTabKey, viewedProfile]);

//   const countIndexesByType = (type: IndexListTabKey) => {
//     console.log("77 countIndexesByType", type);
//     switch (type) {
//       case IndexListTabKey.OWNER:
//         return indexes.filter(i => i.ownerDID.id === viewedProfile?.id).length;
//       case IndexListTabKey.STARRED:
//         return indexes.filter(i => i.did.starred).length;
//       default:
//         return indexes.length;
//     }
//   };

//   return (
//     <>
//       <FlexRow className={"mr-6 pb-4"}>
//         <Col className="idxflex-grow-1">
//           <Tabs destroyInactiveTabPane={false} theme={"rounded"} activeKey={leftTabKey} onTabChange={handleTabChange}>
//             <TabPane enabled={true} tabKey={IndexListTabKey.ALL} title={`All Indexes (${countIndexesByType(IndexListTabKey.ALL)})`} />
//             <TabPane enabled={true} tabKey={IndexListTabKey.OWNER} title={`Owned (${countIndexesByType(IndexListTabKey.OWNER)})`} />
//             <TabPane enabled={true} tabKey={IndexListTabKey.STARRED} title={`Starred (${countIndexesByType(IndexListTabKey.STARRED)})`} />
//           </Tabs>
//         </Col>
//       </FlexRow>
//       <FlexRow className={"scrollable-area index-list pr-6 idxflex-grow-1"}>
//         {sectionIndexes.length > 0 ? (
//           <List
//             data={sectionIndexes}
//             render={(itm: Indexes) => <IndexItem index={itm} selected={itm.id === id} />}
//             divided={false}
//           />
//         ) : (
//           <Text fontWeight={500} style={{ color: "var(--gray-4)", textAlign: "center", padding: "4rem 0", margin: "auto" }}>
//             There are no indexes yet
//           </Text>
//         )}
//       </FlexRow>
//     </>
//   );
// };

// export default IndexListSection;
