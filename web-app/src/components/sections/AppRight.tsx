import { Tabs } from "@/components/base/Tabs";
import TabPane from "@/components/base/Tabs/TabPane";
import { useApp } from "@/context/AppContext";
import cc from "classcat";
import Button from "components/base/Button";
import IconClose from "components/base/Icon/IconClose";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Soon from "components/site/indexes/Soon";

const AppRight = () => {
  const { setRightSidebarOpen, rightSidebarOpen, rightTabKey, setRightTabKey } =
    useApp();

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
              <div
                className={"scrollable-area idxflex-grow-1"}
                style={{
                  display: "flex",
                }}
              >
                {/* <div className={"ml-3"}>
                <Soon section={"chat_history"}></Soon>
              </div> */}

                <div
                  style={{
                    padding: "24px 16px",
                    display: "flex",
                    gap: "24px",
                    flexDirection: "column",
                    alignItems: "flex-start",
                  }}
                >
                  <div
                    style={{
                      borderRadius: "4px",
                      padding: "16px",
                      border: "1px solid var(--gray-2)",
                      height: "fit-content",
                      display: "flex",
                      flexDirection: "column",
                      gap: "16px",
                    }}
                  >
                    <p
                      style={{
                        fontSize: "14px",
                        fontWeight: "bold",
                        margin: 0,
                      }}
                    >
                      Found a new AI-based Web3 protocol, Space Protocol, which
                      simplifies data sorting on decentralized networks{" "}
                    </p>

                    <p
                      style={{
                        margin: 0,
                      }}
                    >
                      Last message 10 days ago
                    </p>
                  </div>
                  <div
                    style={{
                      borderRadius: "4px",
                      padding: "16px",
                      border: "1px solid var(--gray-2)",
                      height: "fit-content",
                      display: "flex",
                      flexDirection: "column",
                      gap: "16px",
                    }}
                  >
                    <p
                      style={{
                        fontSize: "14px",
                        fontWeight: "bold",
                        margin: 0,
                      }}
                    >
                      Found a new AI-based Web3 protocol, Space Protocol, which
                      simplifies data sorting on decentralized networks{" "}
                    </p>

                    <p
                      style={{
                        margin: 0,
                      }}
                    >
                      Last message 10 days ago
                    </p>
                  </div>
                </div>
              </div>
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
