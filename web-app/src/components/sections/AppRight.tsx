import { Tabs } from "@/components/base/Tabs";
import TabPane from "@/components/base/Tabs/TabPane";
import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import cc from "classcat";
import Button from "components/base/Button";
import IconClose from "components/base/Icon/IconClose";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Soon from "components/site/indexes/Soon";
import { useCallback, useEffect, useState } from "react";
import ConversationHistory from "./History";
import { useAuth } from "@/context/AuthContext";

const AppRight = () => {
  const {
    conversations,
    setRightSidebarOpen,
    rightSidebarOpen,
    rightTabKey,
    setRightTabKey,
  } = useApp();

  const handleRightTabChange = (tabKey: string) => {
    setRightTabKey(tabKey);
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
        className={"scrollable-container idxflex-grow-1 pl-6"}
        flexdirection={"column"}
      >
        <FlexRow wrap={false} className={"idxflex-grow-1 mt-6"}>
          <Tabs activeKey={rightTabKey} onTabChange={handleRightTabChange}>
            <TabPane enabled={true} tabKey={"history"} title={`History`}>
              <ConversationHistory items={conversations} />
            </TabPane>
            <TabPane enabled={true} tabKey={"discover"} title={`Discovery`}>
              <div
                style={{
                  marginTop: "48px",
                }}
              >
                <Soon section={"chat_history"}></Soon>
              </div>
            </TabPane>
          </Tabs>
        </FlexRow>
      </Flex>
    </Col>
  );
};

export default AppRight;
