import Avatar from "components/base/Avatar";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import SearchIndexes from "components/site/indexes/SearchIndexes";
import Header from "components/base/Header";
import Button from "components/base/Button";
import { maskDID } from "utils/helper";
import IconClose from "components/base/Icon/IconClose";
import { useApi } from "components/site/context/APIContext";
import { Tabs } from "components/base/Tabs";
import TabPane from "components/base/Tabs/TabPane";
import Soon from "components/site/indexes/Soon";
import cc from "classcat";
import { useApp } from "hooks/useApp";


const AppRight = () => {
  const {
    setRightSidebarOpen,
    rightSidebarOpen,
    rightTabKey,
    setRightTabKey,
  } = useApp();

  return (
    <Col className={cc([
      "sidebar-right",
      rightSidebarOpen ? "sidebar-open" : "sidebar-closed",
    ])}>
      <Flex justifyContent={"left"} className={"navbar-sidebar-handlers ml-6 mt-6 idxflex-grow-1"}>
        <Button onClick={() => setRightSidebarOpen(false)} iconButton theme="clear">
          <IconClose width={32} />
        </Button>
      </Flex>
      <Flex className={"pl-6 scrollable-container idxflex-grow-1"} flexDirection={"column"}>
        <FlexRow wrap={false} className={"mt-6 idxflex-grow-1"}>
          <Tabs activeKey={"history"} onTabChange={setRightTabKey}>
            <TabPane enabled={true} tabKey={"history"} title={`History`} />
            <TabPane enabled={false} tabKey={"discover"} title={``} />
          </Tabs>
        </FlexRow>
        {rightTabKey === "history" && <Flex className={"scrollable-area px-5 idxflex-grow-1"} >
          <div className={"ml-3"}><Soon section={"chat_history"}></Soon></div>
        </Flex>}
      </Flex>
    </Col>
  )

}

export default AppRight;