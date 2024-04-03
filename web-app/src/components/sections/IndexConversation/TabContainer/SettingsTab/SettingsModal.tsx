import Modal from "@/components/base/Modal";
import { FC } from "react";
import WaitingForTransaction from "./WaitingForTransaction";
import SaveYourKey from "./SaveYourKey";

export type SettingsModalStep = "waiting" | "done";

interface SettingsModalProps {
  visible: boolean;
  secretKey: string | undefined;
  onCancel: () => void;
  onDone: () => void;
  step: SettingsModalStep;
}

const SettingsModal: FC<SettingsModalProps> = ({
  visible,
  secretKey,
  onCancel,
  onDone,
  step,
}) => {
  const renderStep = () => {
    switch (step) {
      case "waiting":
        return <WaitingForTransaction onCancel={onCancel} />;
      case "done":
        return <SaveYourKey secretKey={secretKey} onDone={onDone} />;
      default:
        return <></>;
    }
  };

  let header;
  if (step === "waiting") {
    header = <h2>Waiting for transaction</h2>;
  } else if (step === "done") {
    header = <h2>Save your key</h2>;
  }
  return (
    visible && (
      <Modal
        onClose={onCancel}
        header={header}
        visible={visible}
        body={renderStep()}
      />
    )
  );
};

export default SettingsModal;
