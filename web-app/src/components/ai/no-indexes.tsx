import { useApp } from "@/context/AppContext";
import Button from "components/base/Button";
import Flex from "components/layout/base/Grid/Flex";
import Image from "next/image";
import Text from "../base/Text";

export default function NoIndexesChat({ isSelfDid }: { isSelfDid?: boolean }) {
  const { setCreateModalVisible } = useApp();

  return (
    <div
      style={{
        textAlign: "center",
        flexDirection: "column",
        alignItems: "center",
        padding: "4rem 0",
      }}
    >
      <Image
        src="/images/no-indexes-screen-new.png"
        height={202}
        width={202}
        alt="illustration"
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: "48px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Text fontFamily="freizeit" size="xl" fontWeight={700}>
            {isSelfDid
              ? "You don't have any index yet."
              : "There are no indexes here, yet."}
          </Text>
          {isSelfDid && (
            <Text fontFamily="freizeit" size="xl" fontWeight={700}>
              Please create or star an index to enable chat functionality.
            </Text>
          )}
        </div>

        {isSelfDid && (
          <Button
            style={{
              borderRadius: "2px",
            }}
            onClick={() => {
              setCreateModalVisible(true);
            }}
          >
            Create your first index
          </Button>
        )}
      </div>
    </div>
  );
}
