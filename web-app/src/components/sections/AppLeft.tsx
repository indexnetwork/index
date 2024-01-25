import Avatar from "components/base/Avatar";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Header from "components/base/Header";
import Button from "components/base/Button";
import { maskDID } from "utils/helper";
import IconClose from "components/base/Icon/IconClose";
import { useApi } from "components/site/context/APIContext";
import cc from "classcat";
import { useApp } from "hooks/useApp";
import IndexListSection from "components/site/indexes/SearchIndexes";

const AppLeft = () => {
  const {
    leftSidebarOpen,
    setLeftSidebarOpen,
    viewedProfile,
  } = useApp();

  return (
    <Col className={cc([
      "sidebar-left",
      leftSidebarOpen ? "sidebar-open" : "sidebar-closed",
    ])}>
      <FlexRow>
        <Col xs={12} >
          <Flex flexDirection={"column"} className={"scrollable-container"} >
            <Flex justifyContent={"right"} className={"navbar-sidebar-handlers mr-6 mt-6 "}>
              <Button onClick={() => setLeftSidebarOpen(false)} iconButton theme="clear">
                <IconClose width={32} />
              </Button>
            </Flex>
            <FlexRow wrap={false} className={"my-6 mr-6 p-6"} style={{ background: "var(--gray-7)", borderRadius: "5px" }}>
              <Col>
                <Avatar size={60} placeholder={"black"} user={viewedProfile} />
              </Col>
              <Col className="idxflex-grow-1 ml-6">
                <Flex flexDirection={"column"} >
                  <Header level={4} className={"mb-1"}>{viewedProfile?.name || (viewedProfile?.id ? maskDID(viewedProfile?.id!) : "")}</Header>
                  <Text className={"my-0"} theme="gray6" size="sm" verticalAlign="middle" fontWeight={500} element="p">{viewedProfile?.bio}</Text>
                </Flex>
              </Col>
            </FlexRow>
            <IndexListSection />
          </Flex>
        </Col>
      </FlexRow>
    </Col>
  );

}

export default AppLeft;