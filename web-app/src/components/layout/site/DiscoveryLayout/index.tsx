import React from "react";
import AppLeft from "components/sections/AppLeft";
import AppRight from "components/sections/AppRight";
import { useApp } from "components/site/context/AppContext";
import cc from "classcat";
import FlexRow from "../../base/Grid/FlexRow";
import Col from "../../base/Grid/Col";
import Container from "../../base/Grid/Container";
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
    </div>
  );
};

export default DiscoveryLayout;
