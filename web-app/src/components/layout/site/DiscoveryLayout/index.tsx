import ConfirmTransaction from "@/components/site/modal/Common/ConfirmTransaction";
import CreateModal from "@/components/site/modal/CreateModal";
import EditProfileModal from "@/components/site/modal/EditProfileModal";
import { useApp } from "@/context/AppContext";
import cc from "classcat";
import AppLeft from "components/sections/AppLeft";
import AppRight from "components/sections/AppRight";
import { ReactNode } from "react";
import Col from "../../base/Grid/Col";
import Container from "../../base/Grid/Container";
import FlexRow from "../../base/Grid/FlexRow";
import AppHeader from "../AppHeader";

export interface DiscoveryLayoutProps {
  children: ReactNode;
}

const DiscoveryLayout = ({ children }: DiscoveryLayoutProps) => {
  const {
    leftSidebarOpen,
    setLeftSidebarOpen,
    rightSidebarOpen,
    setRightSidebarOpen,
    setEditProfileModalVisible,
    editProfileModalVisible,
    transactionApprovalWaiting,
    handleTransactionCancel,
    createModalVisible,
    setCreateModalVisible,
    handleCreate,
  } = useApp();

  const closeSidebars = () => {
    setLeftSidebarOpen(false);
    setRightSidebarOpen(false);
  };

  return (
    <div
      style={{
        maxHeight: "100dvh",
        overflow: "hidden",
      }}
    >
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

          <Col className={cc(["main-panel"])}>{children}</Col>

          <AppRight />
        </FlexRow>
      </Container>
      {editProfileModalVisible && (
        <EditProfileModal
          visible={editProfileModalVisible}
          onClose={() => setEditProfileModalVisible(false)}
        />
      )}
      {createModalVisible && (
        <CreateModal
          visible={createModalVisible}
          onClose={() => setCreateModalVisible(false)}
          onCreate={handleCreate}
        />
      )}
      {transactionApprovalWaiting && (
        <ConfirmTransaction
          backdropClose={false}
          handleCancel={handleTransactionCancel}
          visible={transactionApprovalWaiting}
        />
      )}
    </div>
  );
};

export default DiscoveryLayout;
