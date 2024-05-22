import Freizeit from "@/fonts/loader";
import Button from "components/base/Button";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import IndexDetailItemPopup from "components/site/popup/IndexDetailItemPopup";
import { useBreakpoint } from "hooks/useBreakpoint";
import { useRole } from "hooks/useRole";
import moment from "moment";
import React from "react";
import sanitize from "sanitize-html";
import { IndexIndexNodeItem } from "types/entity";
import { BREAKPOINTS } from "utils/constants";

// TODO: data prop will be Index object
export interface IndexIndexItemProps {
  item: IndexIndexNodeItem;
  onChange?(val: IndexIndexNodeItem[]): void;
  search?: boolean;
  handleRemove?(): void;
}

const IndexIndexItem: React.FC<IndexIndexItemProps> = ({
  item,
  search = false,
  handleRemove,
}) => {
  const breakpoint = useBreakpoint(BREAKPOINTS, true);
  const { node } = item;

  const { isCreator } = useRole();

  return (
    <div className="index-detail-list-item-wrapper">
      <FlexRow className="index-detail-list-item py-3">
        <Col xs={12}>
          <FlexRow wrap={false} style={{ height: "24px" }}>
            <Col className="idxflex-grow-1">
              <img
                className="mr-3"
                src={"/images/ic_index_item.svg"}
                alt="favicon"
                width={16}
                height={16}
                onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                  const target = e.target as HTMLImageElement;
                  target.onerror = null; // Prevents infinite loop in case fallback image also fails
                  target.src = "/images/globe.svg";
                }}
                style={{
                  verticalAlign: "middle",
                }}
              />
              <a
                target="_blank"
                rel="noreferrer"
                href={`${window.location.origin}/${node?.id}`}
              >
                <Text
                  className={Freizeit.className}
                  style={{
                    fontSize: "16px",
                  }}
                  fontWeight={700}
                  dangerouslySetInnerHTML={{
                    __html: sanitize(node?.title as string),
                  }}
                ></Text>
                {/* dangerouslySetInnerHTML={{ __html: sanitize((node.highlight && item.highlight["link.title"]) ? item.highlight["link.title"] : node?.title as string) }}></Text> */}
              </a>
            </Col>
            {!search && isCreator ? (
              <Col className="idxflex-shrink-0 index-detail-list-item-buttons ml-3">
                <FlexRow>
                  <Col></Col>
                  <Col>
                    <IndexDetailItemPopup onDelete={handleRemove}>
                      <Button size="xs" iconButton theme="clear" borderless>
                        <IconContextMenu />
                      </Button>
                    </IndexDetailItemPopup>
                  </Col>
                </FlexRow>
              </Col>
            ) : (
              <Col className="idxflex-shrink-0 index-detail-list-item-buttons ml-3">
                <FlexRow>
                  <Col></Col>
                  <Col>
                    <IndexDetailItemPopup onDelete={handleRemove}>
                      {/* <Button size="xs" iconButton theme="clear" borderless>
                        <IconContextMenu />
                      </Button> */}
                    </IndexDetailItemPopup>
                  </Col>
                </FlexRow>
              </Col>
            )}
          </FlexRow>
        </Col>
        <Col xs={12} className="mt-2">
          <Text size="sm" theme="disabled">
            {node?.updatedAt
              ? `Updated ${moment(new Date(node.updatedAt)).fromNow()}`
              : ""}
          </Text>
        </Col>
        {/* {
          search && node.highlight && node.highlight["link.content"] && (
            <Col className="mt-5">
              <Text className="listItem" theme="secondary" dangerouslySetInnerHTML={{ __html: sanitize(item.highlight["link.content"]) }}></Text>
            </Col>
          )
        } */}
        {
          <Col xs={12} className="idxflex idxflex-gap-3 idxflex-wrap mt-3">
            {/* {
              node?.tags?.map((t, ind) => (
                <TagIndexDetailItem
                  key={ind}
                  text={t}
                  removable
                  onRemove={handleRemoveTag}
                />))
            } */}
            {/* {
              <TagIndexDetailItem
                theme="clear"
                text=""
                placeholder="New Tag"
                editable={true}
                inputActive
                // onEdit={handleNewTagEdit}
                // onBlur={handleToggleNewTag}
              />
            } */}
          </Col>
        }
      </FlexRow>
    </div>
  );
};
export default IndexIndexItem;
