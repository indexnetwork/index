import cc from "classcat";
import Button from "components/base/Button";
import IconClose from "components/base/Icon/IconClose";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import { useApp } from "@/context/AppContext";
import Soon from "components/site/indexes/Soon";

const AppRight = () => {
  const { setRightSidebarOpen, rightSidebarOpen, rightTabKey, setRightTabKey } =
    useApp();

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
          <Tabs activeKey={"history"} onTabChange={setRightTabKey}>
            <TabPane enabled={true} tabKey={"history"} title={`History`} />
            <TabPane enabled={false} tabKey={"discover"} title={``} />
          </Tabs>
        </FlexRow>
        {rightTabKey === "history" && (
          <Flex className={"scrollable-area idxflex-grow-1 px-5"}>
            <div className={"ml-3"}>
              <Soon section={"chat_history"}></Soon>
            </div>
          </Flex>
        )}
      </Flex>
    </Col>
  );
};

export default AppRight;
