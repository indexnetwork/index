import { IndexListTabKey, useApp } from "@/context/AppContext";
import List from "components/base/List";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import IndexItem from "components/site/indexes/IndexItem";
import { useRouteParams } from "hooks/useRouteParams";
import { useRouter, useSearchParams } from "next/navigation";
import { FC, useCallback, useEffect, useRef } from "react";
import { Indexes } from "types/entity";

const TAB_QUERY = "tab";

const IndexListSection: FC = () => {
  const { id, isIndex, isDID } = useRouteParams();
  const router = useRouter();
  const query = useSearchParams();

  const {
    indexes,
    leftSectionIndexes,
    setLeftTabKey,
    leftTabKey,
    viewedProfile,
  } = useApp();

  const prevProfileID = useRef(viewedProfile?.id);

  const handleTabChange = useCallback(
    (tabKey: IndexListTabKey) => {
      if (!viewedProfile) return;

      setLeftTabKey(tabKey);
      if (tabKey !== IndexListTabKey.ALL) {
        router.push(`/${viewedProfile?.id}?${TAB_QUERY}=${tabKey}`);
      }
    },
    [setLeftTabKey, router, viewedProfile, isIndex],
  );

  useEffect(() => {
    const tab = query.get(TAB_QUERY) as IndexListTabKey;
    if (tab && isDID) {
      setLeftTabKey(tab);
    } else if (viewedProfile?.id !== prevProfileID.current) {
      setLeftTabKey(IndexListTabKey.ALL);
    }
  }, [query, viewedProfile?.id, setLeftTabKey]);

  return (
    <>
      <FlexRow className={"mr-6 pb-4"}>
        <Col className="idxflex-grow-1">
          <Tabs
            destroyInactiveTabPane={false}
            theme={"rounded"}
            activeKey={leftTabKey}
            onTabChange={handleTabChange}
          >
            <TabPane
              enabled={true}
              tabKey={IndexListTabKey.ALL}
              title={`All Indexes`}
            />
            <TabPane
              enabled={true}
              tabKey={IndexListTabKey.OWNED}
              total={indexes.filter((i) => i.did.owned).length}
              title={`Owned`}
            />
            <TabPane
              enabled={true}
              tabKey={IndexListTabKey.STARRED}
              total={indexes.filter((i) => i.did.starred).length}
              title={`Starred`}
            />
          </Tabs>
        </Col>
      </FlexRow>
      <FlexRow className={"scrollable-area index-list idxflex-grow-1 pr-6"}>
        {leftSectionIndexes.length > 0 ? (
          <div className={"idxflex-grow-1"}>
            <List
              data={leftSectionIndexes}
              render={(itm: Indexes) => (
                <>
                  <IndexItem index={itm} selected={itm.id === id} />
                </>
              )}
              divided={false}
            />
          </div>
        ) : (
          <Text
            fontWeight={500}
            style={{
              color: "var(--gray-4)",
              textAlign: "center",
              padding: "4rem 0",
              margin: "auto",
            }}
          >
            There are no indexes yet
          </Text>
        )}
      </FlexRow>
    </>
  );
};

export default IndexListSection;
