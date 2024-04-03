import Button from "@/components/base/Button";
import { FC } from "react";

interface WaitingForTransactionProps {
  onCancel: () => void;
  onSubmit?: () => void;
}

const WaitingForTransaction: FC<WaitingForTransactionProps> = ({
  onCancel,
}) => (
  <div>
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
      }}
    >
      <div className="">
        <p>
          Please wait while the transaction is being processed. This may take a
          few minutes.
        </p>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "2rem 0",
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
          <source src="/video/loadingPerspective.mp4" type="video/mp4" />
        </video>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <Button
          onClick={onCancel}
          className="pl-6 pr-6"
          size="lg"
          theme="clear"
        >
          Cancel
        </Button>
        <Button
          theme="primary"
          size="lg"
          className="pl-6 pr-6"
          loading={true}
          disabled={true}
        >
          Loading
        </Button>
      </div>
    </div>
  </div>
);

export default WaitingForTransaction;
