import { Tabs } from "@/components/base/Tabs";
import TabPane from "@/components/base/Tabs/TabPane";
import Col from "@/components/layout/base/Grid/Col";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import { useRole } from "@/hooks/useRole";
import { useCallback, useRef, useState } from "react";
import AccessControlTab from "./AccessControlTab";
import ChatTab from "./ChatTab";
import CreatorsTab from "./CreatorsTab";
import IndexItemsTab from "./IndexItemsTab";
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
  const [tabKey, setTabKey] = useState<string>(TabKey.Chat);
  const { isOwner, isCreator } = useRole();
  const { viewedIndex, setViewedIndex } = useApp();
  const { api, ready: apiReady } = useApi();
  const fetchRef = useRef(false);

  // const fetchIsCreator = useCallback(async () => {
  //   if (!apiReady || !viewedIndex || fetchRef.current) return;
  //   fetchRef.current = true;
  //   try {
  //     const result = await api!.getIndexWithIsOwner(viewedIndex.id);
  //     if (!result) throw new Error("result is undefined");

  //     setViewedIndex(result);
  //   } catch (error) {
  //     console.error("Failed to fetch creator status", error);
  //   } finally {
  //     fetchRef.current = false;
  //   }
  // }, [apiReady]);

  // useEffect(() => {
  //   fetchIsCreator();
  // }, [fetchIsCreator]);

  const renderTabContent = useCallback(() => {
    switch (tabKey) {
      case TabKey.Chat:
        return <ChatTab />;
      case TabKey.Index:
        return <IndexItemsTab />;
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
    <div
      style={{
        flex: 1,
        display: "flex",
        height: "100%",
        overflow: "hidden",
        flexDirection: "column",
      }}
    >
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
