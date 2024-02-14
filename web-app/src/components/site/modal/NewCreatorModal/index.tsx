import { useMergedState } from "@/hooks/useMergedState";
import Header from "components/base/Header";
import Modal, { ModalProps } from "components/base/Modal";
import Text from "components/base/Text";
import React, { useState } from "react";
import { AccessControlCondition, Indexes } from "types/entity";
import IndividualWallet from "./IndividualWallet";
import ModalContent from "./ModalContent";
import NFTOptions from "./NFTOptions";

export interface NewCreatorModalProps
  extends Omit<ModalProps, "header" | "footer" | "body"> {
  handleCreate(condition: AccessControlCondition): void;
}

const NewCreatorModal = ({
  handleCreate,
  ...modalProps
}: NewCreatorModalProps) => {
  const handleClose = () => {
    modalProps.onClose?.();
  };

  const [activeForm, setActiveForm] = useState("initial");

  const [crawling, setCrawling] = useState(false);

  const [stream, setStream] = useMergedState<Partial<Indexes>>({
    title: "",
  });

  const [loading, setLoading] = useState(false);

  const handleFormState = async (value: string) => {
    setActiveForm(value);
  };

  const renderModalContent = () => {
    switch (activeForm) {
      case "initial":
        return <ModalContent handleFormState={handleFormState} />;
      case "nft-options":
        return (
          <NFTOptions
            handleCreate={handleCreate}
            handleBack={() => handleFormState("initial")}
          ></NFTOptions>
        );
      case "individual-wallet":
        return (
          <IndividualWallet
            handleCreate={handleCreate}
            handleBack={() => handleFormState("initial")}
          ></IndividualWallet>
        );
      default:
        return <></>;
    }
  };

  return (
    <Modal
      {...modalProps}
      size={"fit"}
      onClose={handleClose}
      body={renderModalContent()}
      header={
        <>
          <Header level={2}>Add New Creators</Header>
          <Text className={"mt-4"} element={"p"}>
            Creators will be able to add items, and delete theirs.
          </Text>
        </>
      }
    ></Modal>
  );
};

export default NewCreatorModal;
