import Button from "components/base/Button";
import { ModalProps } from "components/base/Modal";
import { memo } from "react";

export interface AskConnectModalContentProps
  extends Omit<ModalProps, "header" | "footer" | "body"> {
  tryGuest: () => void;
  connect: () => void;
}

const AskConnectModalContent = ({
  tryGuest,
  connect,
  ...modalProps
}: AskConnectModalContentProps) => {
  const handleClose = () => {
    modalProps.onClose?.();
  };

  const allowed = localStorage.getItem("allowed");

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
      }}
    >
      <p
        style={{
          margin: "0",
          padding: "0",
        }}
      >
        Index is currently in a testing phase with a limited number of users. If
        you're interested in joining, apply for the beta—we'd love to hear from
        you!
      </p>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "0 0 2.4rem 0",
        }}
      >
        <video
          autoPlay
          loop
          muted
          playsInline
          className={"p-0"}
          style={{
            width: "60%",
            margin: "auto",
          }}
        >
          <source src="/video/sequence.mp4" type="video/mp4" />
        </video>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexDirection: "row",
          gap: "1rem",
          width: "100%",
        }}
      >
        <div>
          <Button
            size="lg"
            className="mt-7 pl-8 pr-8"
            theme="clear"
            onClick={tryGuest}
          >
            Chat as guest
          </Button>
        </div>
        <div>
          {allowed ? (
            <Button
              onClick={connect}
              theme="primary"
              size="lg"
              className="mt-7 pl-8 pr-8"
            >
              Connect
            </Button>
          ) : (
            <Button
              onClick={() => {
                window.open("https://sjxy3b643r8.typeform.com/to/phuRF52O");
              }}
              theme="primary"
              size="lg"
              className="mt-7 pl-8 pr-8"
            >
              Apply for beta
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(AskConnectModalContent);
