import Col from "@/components/layout/base/Grid/Col";
import Flex from "@/components/layout/base/Grid/Flex";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import CreatorSettings from "@/components/site/index-details/CreatorSettings";

export default function CreatorsTabSection() {
  return (
    <Flex flexdirection={"column"}>
      <FlexRow className={"scrollable-container mt-6"}>
        <Col className="idxflex-grow-1">
          <CreatorSettings />
        </Col>
      </FlexRow>
    </Flex>
  );
}
