import { Tabs } from "@/components/base/Tabs";
import TabPane from "@/components/base/Tabs/TabPane";
import Col from "@/components/layout/base/Grid/Col";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import { useCallback, useEffect, useState } from "react";
import { selectIndex } from "@/store/slices/indexSlice";
import { useAppSelector } from "@/store/store";
import AccessControlTab from "./AccessControlTab";
import ChatTab from "./ChatTab";
import IndexItemsTab from "./IndexItemsTab";
import IndexSettingsTab from "./SettingsTab";

enum TabKey {
  Chat = "chat",
  Index = "index",
  // Creators = "creators",
  AccessControl = "access_control",
  Settings = "settings",
}

const TAB_TITLES = {
  [TabKey.Chat]: "Chat",
  [TabKey.Index]: "Index",
  // [TabKey.Creators]: "Creators",
  [TabKey.AccessControl]: "Access Control",
  [TabKey.Settings]: "Developers",
};

export default function TabContainer() {
  const [tabKey, setTabKey] = useState<string>(TabKey.Chat);
  const { data: indexData, loading } = useAppSelector(selectIndex);

  useEffect(() => {
    if (!indexData) return;

    if (loading) {
      return;
    }

    if (!indexData.hasItems) {
      setTabKey(TabKey.Index);
    }
  }, [loading, indexData]);

  const renderTabContent = useCallback(() => {
    switch (tabKey) {
      case TabKey.Chat:
        return <ChatTab />;
      case TabKey.Index:
        return <IndexItemsTab />;
      case TabKey.AccessControl:
        return <AccessControlTab />;
      case TabKey.Settings:
        return <IndexSettingsTab />;
      default:
        return <ChatTab />;
    }
  }, [tabKey]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        height: "100%",
        flexDirection: "column",
      }}
    >
      <FlexRow>
        <Col className="idxflex-grow-1 mt-3">
          {!loading && (
            <Tabs activeKey={tabKey} onTabChange={setTabKey}>
              {Object.values(TabKey).map((key) => (
                <TabPane
                  key={key}
                  enabled={true}
                  hidden={false}
                  tabKey={key}
                  title={TAB_TITLES[key]}
                />
              ))}
            </Tabs>
          )}
        </Col>
      </FlexRow>
      <FlexRow>
        <div
          style={{
            flex: 1,
          }}
        >
          {renderTabContent()}
        </div>
      </FlexRow>
    </div>
  );
}
