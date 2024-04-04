import Button from "@/components/base/Button";
import CopyInput from "@/components/base/CopyInput";
import Text from "@/components/base/Text";
import { FC } from "react";

interface SaveYourKeyProps {
  secretKey: string | undefined;
  onDone: () => void;
}

const SaveYourKey: FC<SaveYourKeyProps> = ({ secretKey, onDone }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "start",
      gap: "1.5rem",
    }}
  >
    {/* <h2>Save Your Key</h2> */}
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "start",
        gap: "2rem",
      }}
    >
      <div
        style={{
          display: "flex",
          width: "100%",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <Text>Your key:</Text>
        <CopyInput value={secretKey} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "end",
          width: "100%",
        }}
      >
        <Button
          theme="primary"
          type="submit"
          size="lg"
          className="mt-7 pl-8 pr-8"
          onClick={onDone}
        >
          Done
        </Button>
      </div>
    </div>
  </div>
);

export default SaveYourKey;
