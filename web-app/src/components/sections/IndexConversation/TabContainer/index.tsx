import { Tabs } from "@/components/base/Tabs";
import TabPane from "@/components/base/Tabs/TabPane";
import Col from "@/components/layout/base/Grid/Col";
import Flex from "@/components/layout/base/Grid/Flex";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import { useRole } from "@/hooks/useRole";
import React, { useCallback } from "react";
import AccessControlTab from "./AccessControlTab";
import ChatTab from "./ChatTab";
import CreatorsTab from "./CreatorsTab";
import IndexTab from "./IndexTab";
import IndexSettingsTab from "./SettingsTab";

enum TabKey {
  Chat = "chat",
  Index = "index",
  Creators = "creators",
  AccessControl = "access_control",
  Settings = "settings",
}

const TAB_TITLES = {
  [TabKey.Chat]: "Chat",
  [TabKey.Index]: "Index",
  [TabKey.Creators]: "Creators",
  [TabKey.AccessControl]: "Access Control",
  [TabKey.Settings]: "Settings",
};

export default function TabContainer() {
  const [tabKey, setTabKey] = React.useState<string>(TabKey.Chat);
  const { isOwner } = useRole();

  const renderTabContent = useCallback(() => {
    switch (tabKey) {
      case TabKey.Chat:
        return <ChatTab />;
      case TabKey.Index:
        return <IndexTab />;
      case TabKey.Creators:
        return <CreatorsTab />;
      case TabKey.AccessControl:
        return <AccessControlTab />;
      case TabKey.Settings:
        return <IndexSettingsTab />;
      default:
        return null;
    }
  }, [tabKey]);

  return (
    <Flex flexdirection={"column"}>
      <FlexRow>
        <Col className="idxflex-grow-1 mt-3">
          <Tabs activeKey={tabKey} onTabChange={setTabKey}>
            {Object.values(TabKey).map((key) => (
              <TabPane
                key={key}
                enabled={true}
                hidden={key === TabKey.Settings && !isOwner}
                tabKey={key}
                title={TAB_TITLES[key]}
              />
            ))}
          </Tabs>
        </Col>
      </FlexRow>
      <FlexRow>
        <Flex flexdirection={"column"} className={"idxflex-grow-1"}>
          {renderTabContent()}
        </Flex>
      </FlexRow>
    </Flex>
  );
}
