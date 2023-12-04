import Flex from "components/layout/base/Grid/Flex";
import Button from "components/base/Button";
import { useApp } from "hooks/useApp";
import Text from "../base/Text";

export default function NoIndexesChat({ isSelfDid }: { isSelfDid?: boolean }) {
  const { setCreateModalVisible } = useApp();

  return (
    <Flex
      flexDirection="column"
      alignItems="center"
      gap="4rem"
      style={{ margin: "auto", padding: "4rem 0" }}
    >
      <img
        src="/images/no-indexes-screen-new.png"
        height={202}
        width={202}
        alt="illustration"
      />
      <Flex flexDirection="column" alignItems="center">
        <Text fontFamily="freizeit" size="xl" fontWeight={700}>
          {isSelfDid ?
           "You don't have any index yet." :
            "There are no indexes here, yet."}
        </Text>
        {isSelfDid && (
          <Text fontFamily="freizeit" size="xl" fontWeight={700}>
            Please create or star an index to enable chat functionality.
          </Text>
        )}
      </Flex>
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
    </Flex>
  );
}
