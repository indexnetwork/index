//indexconversationheader section 

import Avatar from "components/base/Avatar";
import Button from "components/base/Button";
import IconStar from "components/base/Icon/IconStar";
import Text from "components/base/Text";
import Tooltip from "components/base/Tooltip";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import IndexTitleInput from "components/site/input/IndexTitleInput";
import IndexOperationsPopup from "components/site/popup/IndexOperationsPopup";
import moment from "moment";
import Link from "next/link";
import { Indexes } from "types/entity";
import { maskDID } from "utils/helper";

type IndexConversationHeaderProps = {
  index: Indexes;
}

export const IndexConversationHeader: React.FC<IndexConversationHeaderProps> = ({
  index,
}) => {

  return (
    <Flex flexDirection={"column"}>
      <FlexRow>
        <Col centerBlock className="idxflex-grow-1">
          {index && (
            <Link href="/[did]" as={`/${index.ownerDID?.id!}`}>
              <Avatar size={20} user={index.ownerDID} />
              <Text
                className="ml-3"
                size="sm"
                verticalAlign="middle"
                fontWeight={500}
                element="span"
              >
                {index.ownerDID?.name ||
                  (index.ownerDID &&
                    maskDID(index.ownerDID?.id!)) ||
                  ""}
              </Text>
            </Link>
          )}
        </Col>
      </FlexRow>

      <FlexRow className="pt-3">
        <Col className="idxflex-grow-1 mr-5">
          <IndexTitleInput
            defaultValue={index?.title || ""}
            onChange={handleTitleChange}
            disabled={!roles.owner()}
            loading={titleLoading}
          />
        </Col>
        <Col className="mr-2 mb-3">
          <Tooltip content="Add to Starred Index">
            <Button
              iconHover
              theme="clear"
              onClick={() => handleUserIndexToggle(index as Indexes, "starred", index?.isStarred ? "remove" : "add")}
              borderless
            >
              <IconStar
                fill={
                  index?.isStarred ? "var(--main)" : "var(--white)"
                }
                width={20}
                height={20}
              />
            </Button>
          </Tooltip>
        </Col>
        <Col className="ml-2 mb-3">
          <Button iconHover theme="clear" borderless>
            <IndexOperationsPopup
              isOwner={roles.owner()}
              index={index as Indexes}
              userIndexToggle={handleUserIndexToggle}
            ></IndexOperationsPopup>
          </Button>
        </Col>
      </FlexRow>
      <FlexRow>
        <Text size="sm" theme="disabled">
          {index?.updatedAt ? `Updated ${moment(index?.updatedAt).fromNow()}` : ""}{" "}
        </Text>
      </FlexRow>

    </Flex>
  );

}