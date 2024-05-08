import Button from "components/base/Button";
import Header from "components/base/Header";
import Modal, { ModalProps } from "components/base/Modal";
import Col from "components/layout/base/Grid/Col";

export interface WaitBetaModalProps
  extends Omit<ModalProps, "header" | "footer" | "body"> {
  onCreate: (title: string) => void;
}

const WaitBetaModal = ({ onCreate, ...modalProps }: WaitBetaModalProps) => {
  const handleClose = () => {
    modalProps.onClose?.();
  };

  return (
    <Modal
      {...modalProps}
      size={"xs"}
      body={
        <>
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
              Index is currently in a testing phase with a limited number of
              users. If you're interested in joining, apply for the beta—we'd
              love to hear from you!
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
          </div>
        </>
      }
      header={<Header level={2}>Apply for beta</Header>}
      footer={
        <>
          <Col pullLeft>
            <Button
              size="lg"
              className="mt-7 pl-8 pr-8"
              theme="clear"
              onClick={handleClose}
            >
              Cancel
            </Button>
          </Col>
          <Col pullRight>
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
          </Col>
        </>
      }
    />
  );
};

export default WaitBetaModal;
