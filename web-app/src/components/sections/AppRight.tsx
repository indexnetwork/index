import { Tabs } from "@/components/base/Tabs";
import TabPane from "@/components/base/Tabs/TabPane";
import { useApp } from "@/context/AppContext";
import { useRouteParams } from "@/hooks/useRouteParams";
import cc from "classcat";
import Button from "components/base/Button";
import IconClose from "components/base/Icon/IconClose";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import { useRouter } from "next/navigation";
import ConversationHistory from "./History";
import NewChatButton from "./NewChatButton";

const AppRight = () => {
  const {
    conversations,
    setRightSidebarOpen,
    rightSidebarOpen,
    rightTabKey,
    setRightTabKey,
    setViewedConversation,
    viewedConversation,
  } = useApp();

  const { isConversation } = useRouteParams();

  const router = useRouter();

  const handleRightTabChange = (tabKey: string) => {
    setRightTabKey(tabKey);
  };

  const handleStartChat = () => {
    setViewedConversation(undefined);
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
      <Flex
        className={"idxflex-grow-1 pl-6"}
        flexdirection={"column"}
        style={{
          position: "relative",
        }}
      >
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
            overflow: "scroll",
            maxHeight: "calc(100dvh - 144px)",
            marginTop: "12px",
          }}
        >
          <Tabs
            headerType="sticky"
            activeKey={rightTabKey}
            onTabChange={handleRightTabChange}
          >
            <TabPane enabled={true} tabKey={"history"} title={`History`}>
              <ConversationHistory items={conversations} />
            </TabPane>
            <></>
            {/* <TabPane enabled={true} tabKey={"discover"} title={`Discovery`}>
              <div
                style={{
                  marginTop: "48px",
                }}
              >
                <Soon section={"chat_history"}></Soon>
              </div>
            </TabPane> */}
          </Tabs>
        </FlexRow>
      </Flex>
    </Col>
  );
};

export default AppRight;
