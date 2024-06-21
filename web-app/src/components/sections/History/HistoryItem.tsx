import { useApp } from "@/context/AppContext";
import Button from "components/base/Button";
import moment from "moment";
import { useRouter } from "next/navigation";
import Row from "@/components/layout/base/Grid/Row";
import Col from "@/components/layout/base/Grid/Col";
import Flex from "@/components/layout/base/Grid/Flex";
import Text from "@/components/base/Text";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import HistoryItemOpsPopup from "./HistoryItemOpsPopup";

type HistoryItemProps = {
  id: string;
  summary: string;
  link: string;
  createdAt: string;
};

const HistoryItem = ({ item }: { item: HistoryItemProps }) => {
  const router = useRouter();
  const { deleteConversation } = useApp();

  const handleDelete = (id: string) => {
    deleteConversation(id);
  };

  return (
    <div
      onClick={() => {
        router.push(`/conversation/${item.id}`);
      }}
      style={{
        cursor: "pointer",
      }}
      className="card-item p-6"
    >
      <FlexRow justify={"between"} fullWidth>
        <Col xs={10}>
          <Flex
            className={"idxflex-nowrap"}
            alignitems={"top"}
            flexdirection={"column"}
          >
            <Row>
              <Text
                style={{
                  fontSize: "14px",
                  fontWeight: "bold",
                  margin: 0,
                }}
              >
                {item.summary}
              </Text>
            </Row>
            <Row className={"mt-3"}>
              <Flex alignitems={"left"}>
                <Col>
                  <Text
                    style={{
                      fontSize: "12px",
                      margin: 0,
                    }}
                  >
                    {item?.createdAt
                      ? `Updated ${moment(new Date(item.createdAt)).fromNow()}`
                      : ""}
                  </Text>
                </Col>
              </Flex>
            </Row>
          </Flex>
        </Col>
        <Col pullRight>
          <Button
            onClick={(e: any) => {
              e.stopPropagation();
            }}
            iconHover
            theme="clear"
            borderless
          >
            <HistoryItemOpsPopup
              onDelete={() => {
                handleDelete(item.id);
              }}
            />
          </Button>
        </Col>
      </FlexRow>
    </div>
  );
};

export default HistoryItem;
