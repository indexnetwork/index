import Header from "components/base/Header";
import Modal, { ModalProps } from "components/base/Modal";
import { memo, useState } from "react";
import AskConnectModalContent from "./AskConnectModalContent";
import WaitBetaModalContent from "./WaitBetaModalContent";

export interface GuestModalProps
  extends Omit<ModalProps, "header" | "footer" | "body"> {
  tryGuest: () => void;
  connect: () => void;
}

const GuestModal = ({ tryGuest, connect, ...modalProps }: GuestModalProps) => {
  const [activeForm, setActiveForm] = useState("ask");
  const renderModalContent = () => {
    if (activeForm === "ask") {
      return (
        <AskConnectModalContent
          tryGuest={tryGuest}
          connect={connect}
          {...modalProps}
        />
      );
    }

    return (
      <WaitBetaModalContent
        visible={activeForm === "beta"}
        onCloseHandler={() => setActiveForm("ask")}
      />
    );
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
