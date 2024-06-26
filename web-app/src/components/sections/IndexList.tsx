import { IndexListTabKey, useApp } from "@/context/AppContext";
import { selectConversation } from "@/store/slices/conversationSlice";
import { selectDID, selectIndexes } from "@/store/slices/didSlice";
import { useAppSelector } from "@/store/store";
import List from "components/base/List";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import IndexItem from "components/site/indexes/IndexItem";
import { useRouteParams } from "hooks/useRouteParams";
import { useRouter, useSearchParams } from "next/navigation";
import { FC, useCallback, useEffect, useMemo, useRef } from "react";
import { Indexes } from "types/entity";

const TAB_QUERY = "tab";

const IndexListSection: FC = () => {
  const { id, isDID } = useRouteParams();
  const router = useRouter();
  const query = useSearchParams();
  const indexes = useAppSelector(selectIndexes);

  const { setLeftTabKey, leftTabKey } = useApp();

  const { data: did } = useAppSelector(selectDID);
  const { data: viewedConversation } = useAppSelector(selectConversation);

  const prevProfileID = useRef(did?.id);

  const leftSectionIndexes = useMemo(
    () =>
      indexes?.filter((i: Indexes) => {
        if (leftTabKey === IndexListTabKey.OWNED) {
          return i.did.owned;
        }
        if (leftTabKey === IndexListTabKey.STARRED) {
          return i.did.starred;
        }
        if (leftTabKey === IndexListTabKey.ALL) {
          return i.did.starred || i.did.owned;
        }
        return true;
      }),
    [indexes, leftTabKey],
  );

  const handleTabChange = useCallback(
    (tabKey: IndexListTabKey) => {
      // if (!viewedProfile) return;

      setLeftTabKey(tabKey);
      if (tabKey !== IndexListTabKey.ALL) {
        router.push(`/${did?.id}?${TAB_QUERY}=${tabKey}`);
      } else {
        router.push(`/${did?.id}`);
      }
    },
    [setLeftTabKey, router, did],
  );

  useEffect(() => {
    const tab = query.get(TAB_QUERY) as IndexListTabKey;
    if (tab && isDID) {
      setLeftTabKey(tab);
    } else if (did?.id !== prevProfileID.current) {
      setLeftTabKey(IndexListTabKey.ALL);
    }
  }, [isDID, query, did?.id, setLeftTabKey]);

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
              total={
                indexes ? indexes.filter((i: any) => i.did.owned).length : 0
              }
              title={`Owned`}
            />
            <TabPane
              enabled={true}
              tabKey={IndexListTabKey.STARRED}
              total={
                indexes ? indexes.filter((i: any) => i.did.starred).length : 0
              }
              title={`Starred`}
            />
          </Tabs>
        </Col>
      </FlexRow>
      <FlexRow className={"scrollable-area index-list idxflex-grow-1 pr-6"}>
        {leftSectionIndexes && leftSectionIndexes.length > 0 ? (
          <div className={"idxflex-grow-1"}>
            <List
              data={leftSectionIndexes}
              render={(itm: Indexes) => (
                <>
                  <IndexItem
                    index={itm}
                    selected={
                      itm.id === id ||
                      (viewedConversation?.sources &&
                        viewedConversation?.sources.length > 0 &&
                        itm.id === viewedConversation?.sources[0])
                    }
                  />
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
