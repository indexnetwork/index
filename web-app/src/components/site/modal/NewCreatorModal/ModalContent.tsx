import FlexRow from "@/components/layout/base/Grid/FlexRow";
import Col from "components/layout/base/Grid/Col";
import Button from "components/base/Button";
import IconClock from "@/components/base/Icon/IconClock";
import Header from "components/base/Header";
import Text from "components/base/Text";
import IconGreenAdd from "@/components/base/Icon/IconGreenAdd";
import IconWallet from "@/components/base/Icon/IconWallet";

const ModalContent = ({
  handleFormState,
}: {
  handleFormState(state: string): void;
}) => (
  <FlexRow rowGutter={4} rowSpacing={0} rowGap={6} colSpacing={3}>
    <Col xs={4}>
      <Button
        textAlign={"left"}
        theme={"card"}
        onClick={() => handleFormState("nft-options")}
        className={"px-4 py-6"}
      >
        <IconClock width={24} height={24}></IconClock>
        <Header level={4} className={"my-4"}>
          NFT Owners
        </Header>
        <Text theme={"gray4"} size={"sm"}>
          Add existing token as a creator rule
        </Text>
      </Button>
    </Col>
    <Col xs={8}>
      <Button textAlign={"left"} theme={"card"} className={"px-4 py-6"}>
        <IconGreenAdd width={24} height={24}></IconGreenAdd>
        <Header theme={"gray9"} level={4} className={"my-4"}>
          Create New NFT{" "}
          <Text size={"xs"} className={"tag tag-soon tag-circle "}>
            SOON
          </Text>
        </Header>

        <Text theme={"gray4"} size={"sm"}>
          Create a new token, use as a creator rule, mint NFTs to your creators
          as you like.
        </Text>
      </Button>
    </Col>
    <Col xs={4}>
      <Button
        textAlign={"left"}
        theme={"card"}
        onClick={() => handleFormState("individual-wallet")}
        className={"px-4 py-6"}
      >
        <IconWallet width={24} height={24}></IconWallet>
        <Header level={4}>Individual Wallet</Header>
      </Button>
    </Col>
    <Col xs={4}>
      <Button textAlign={"left"} theme={"card"} className={"px-4 py-6"}>
        <Header className={"mb-4"} theme={"gray9"} level={4}>
          DAO Members
        </Header>
        <Text size={"xs"} className={"tag tag-soon tag-circle tag-outlined"}>
          SOON
        </Text>
      </Button>
    </Col>
    <Col xs={4}>
      <Button textAlign={"left"} theme={"card"} className={"px-4 py-6 "}>
        <Header className="mb-4" theme={"gray9"} level={4}>
          POAP Collector
        </Header>
        <Text size={"xs"} className={"tag tag-soon tag-circle tag-outlined"}>
          SOON
        </Text>
      </Button>
    </Col>
  </FlexRow>
);

export default ModalContent;
