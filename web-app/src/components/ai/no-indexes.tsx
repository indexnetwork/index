import { useApp } from "@/context/AppContext";
import { useRouteParams } from "@/hooks/useRouteParams";
import Button from "components/base/Button";
import Image from "next/image";
import Text from "../base/Text";

export default function NoIndexesChat({ isSelfDid }: { isSelfDid?: boolean }) {
  const { setCreateModalVisible } = useApp();
  const { isDID } = useRouteParams();

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
            fontFamily: "freizeit",
          }}
        >
          <Text size="xl" fontWeight={700}>
            {isSelfDid
              ? "You don't have any items yet."
              : "There are no items here, yet."}
          </Text>
          {isSelfDid && isDID && (
            <Text size="xl" fontWeight={700}>
              Please create or star an index to enable chat functionality.
            </Text>
          )}
        </div>

        {isSelfDid && isDID && (
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
