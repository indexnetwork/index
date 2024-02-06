import EditProfileModal from "@/components/site/modal/EditProfileModal";
import { useApp } from "@/context/AppContext";
import cc from "classcat";
import AppLeft from "components/sections/AppLeft";
import AppRight from "components/sections/AppRight";
import React from "react";
import Col from "../../base/Grid/Col";
import Container from "../../base/Grid/Container";
import FlexRow from "../../base/Grid/FlexRow";
import AppHeader from "../AppHeader";

export interface DiscoveryLayoutProps {
  children: React.ReactNode;
  page?: string;
}
const DiscoveryLayout = ({ children, page }: DiscoveryLayoutProps) => {
  const {
    leftSidebarOpen,
    setLeftSidebarOpen,
    rightSidebarOpen,
    setRightSidebarOpen,
    setEditProfileModalVisible,
    editProfileModalVisible,
  } = useApp();

  const closeSidebars = () => {
    setLeftSidebarOpen(false);
    setRightSidebarOpen(false);
  };

  return (
    <div className={"scrollable-container"}>
      <AppHeader />
      <Container fluid className={"app-container"}>
        {(rightSidebarOpen || leftSidebarOpen) && (
          <div
            onClick={closeSidebars}
            className={"sidebar-open-backdrop"}
          ></div>
        )}
        <FlexRow>
          <AppLeft />

          <Col className={cc(["main-panel", `page-${page}`])}>{children}</Col>

          <AppRight />
        </FlexRow>
      </Container>
      {editProfileModalVisible && (
        <EditProfileModal
          visible={editProfileModalVisible}
          onClose={() => setEditProfileModalVisible(false)}
        />
      )}
    </div>
  );
};

export default DiscoveryLayout;
