import Image from "next/image";
import Flex from "components/layout/base/Grid/Flex";
import Button from "components/base/Button";
import { useApp } from "hooks/useApp";
import Text from "../base/Text";

export default function NoIndexesChat() {
  const { setCreateModalVisible } = useApp();
  return (
    <Flex
      flexDirection="column"
      alignItems="center"
      gap="4rem"
      style={{ margin: "auto", padding: "4rem 0" }}
    >
      <Image
        src="/images/no-indexes-screen-new.png"
        height={202}
        width={202}
        alt="illustration"
        unoptimized
      />
      <Flex flexDirection="column" alignItems="center">
        <Text fontFamily="freizeit" size="xl" fontWeight={700}>
          You don&apos;t have any index yet.
        </Text>
        <Text fontFamily="freizeit" size="xl" fontWeight={700}>
          Please create or star an index to enable chat functionality.
        </Text>
      </Flex>
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
    </Flex>
  );
}
