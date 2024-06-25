import { Tabs } from "@/components/base/Tabs";
import TabPane from "@/components/base/Tabs/TabPane";
import { useApp } from "@/context/AppContext";
import { useRouteParams } from "@/hooks/useRouteParams";
import { selectDID } from "@/store/slices/didSlice";
import { useAppSelector } from "@/store/store";
import cc from "classcat";
import Button from "components/base/Button";
import IconClose from "components/base/Icon/IconClose";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import { useRouter } from "next/navigation";
import { selectConversation } from "@/store/slices/conversationSlice";
import ConversationHistory from "./History";
import NewChatButton from "./NewChatButton";

const AppRight = () => {
  const { setRightSidebarOpen, rightSidebarOpen, rightTabKey, setRightTabKey } =
    useApp();

  const { isConversation } = useRouteParams();
  const { conversations } = useAppSelector(selectDID);
  const { data: viewedConversation } = useAppSelector(selectConversation);
  const router = useRouter();

  const handleRightTabChange = (tabKey: string) => {
    setRightTabKey(tabKey);
  };

  const handleStartChat = () => {
    router.push(`/${viewedConversation?.sources[0]}`);
  };

  return (
    <Col
      className={cc([
        "sidebar-right",
        rightSidebarOpen ? "sidebar-open" : "sidebar-closed",
      ])}
    >
      <Flex
        alignitems={"left"}
        className={"navbar-sidebar-handlers idxflex-grow-1 ml-6 mt-6"}
      >
        <Button
          onClick={() => setRightSidebarOpen(false)}
          iconButton
          theme="clear"
        >
          <IconClose width={32} />
        </Button>
      </Flex>
      <Flex className={"idxflex-grow-1 pl-6"} flexdirection={"column"}>
        <div
          style={{
            marginBottom: "12px",
          }}
        >
          <NewChatButton
            onClick={isConversation ? handleStartChat : undefined}
          />
        </div>

        <FlexRow
          wrap={false}
          className={"idxflex-grow-1"}
          style={{
            width: "100%",
            marginTop: "12px",
          }}
        >
          <Tabs activeKey={rightTabKey} onTabChange={handleRightTabChange}>
            <TabPane enabled={true} tabKey={"history"} title={`History`}>
              <div className={"scrollable-container pb-11"} style={{}}>
                <ConversationHistory items={conversations} />
              </div>
            </TabPane>
            <></>
          </Tabs>
        </FlexRow>
      </Flex>
    </Col>
  );
};

export default AppRight;
