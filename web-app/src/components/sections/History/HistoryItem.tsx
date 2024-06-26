import Button from "components/base/Button";
import moment from "moment";
import { useRouter } from "next/navigation";
import Row from "@/components/layout/base/Grid/Row";
import Col from "@/components/layout/base/Grid/Col";
import Flex from "@/components/layout/base/Grid/Flex";
import Text from "@/components/base/Text";
import FlexRow from "@/components/layout/base/Grid/FlexRow";
import { deleteConversation } from "@/store/api/conversation";
import toast from "react-hot-toast";
import { useCallback } from "react";
import { useApi } from "@/context/APIContext";
import { useAppDispatch } from "@/store/store";
import HistoryItemOpsPopup from "./HistoryItemOpsPopup";

type HistoryItemProps = {
  id: string;
  summary: string;
  link: string;
  createdAt: string;
};

const HistoryItem = ({ item }: { item: HistoryItemProps }) => {
  const router = useRouter();
  const { api, ready: apiReady } = useApi();
  const dispatch = useAppDispatch();
  const handleDelete = useCallback(
    async (id: string) => {
      if (!apiReady || !api) return;
      try {
        await dispatch(deleteConversation({ id, api }));
        toast.success("Conversation deleted");
      } catch (error) {
        console.error("Error deleting conversation", error);
        toast.error("Error deleting conversation, please refresh the page");
      }
    },
    [apiReady, api],
  );

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
