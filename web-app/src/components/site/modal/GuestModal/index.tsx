import Header from "components/base/Header";
import Modal, { ModalProps } from "components/base/Modal";
import { memo } from "react";
import WaitBetaModalContent from "./WaitBetaModalContent";

export interface GuestModalProps
  extends Omit<ModalProps, "header" | "footer" | "body"> {}

const GuestModal = ({ ...modalProps }: GuestModalProps) => {
  const renderModalContent = () => {
    return <WaitBetaModalContent {...modalProps} />;
  };

  return (
    <Modal
      {...modalProps}
      size={"fit"}
      visible={modalProps?.visible}
      backdropClose={true}
      onClose={modalProps?.onClose}
      body={renderModalContent()}
      header={
        <>
          <Header level={2}>Try Index</Header>
        </>
      }
    ></Modal>
  );
};

export default memo(GuestModal);
