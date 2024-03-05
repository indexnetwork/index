import Image from "next/image";
import Button from "@/components/base/Button";
import { FC } from "react";

interface WaitingForTransactionProps {
  onCancel: () => void;
  onSubmit?: () => void;
}

const WaitingForTransaction: FC<WaitingForTransactionProps> = ({
  onCancel,
  onSubmit,
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
        <h2>Waiting for transaction</h2>
        <p>
          Please wait while the transaction is being processed. This may take a
          few minutes.
        </p>
      </div>
      <div>
        <Image
          width={"160"}
          height={"160"}
          src={"/images/waiting.png"}
          alt="waiting"
        />
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
          className="mt-7 pl-8 pr-8 "
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
