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
import { DefaultIndexNodeItem } from "types/entity";
import { BREAKPOINTS } from "utils/constants";
import cm from "./style.module.scss";

// TODO: data prop will be Index object
export interface DefaultIndexItemProps {
  item: DefaultIndexNodeItem;
  onChange?(val: DefaultIndexNodeItem[]): void;
  search?: boolean;
  handleRemove?(): void;
}

const DefaultIndexItem: React.FC<DefaultIndexItemProps> = ({
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
          <FlexRow wrap={false}>
            <Col className="idxflex-grow-1">
              <img
                className="mr-3"
                src={"/images/ic_default_index_item.svg"}
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
              <Text
                className={cm.title}
                fontWeight={700}
                dangerouslySetInnerHTML={{
                  __html: sanitize(node?.id as string),
                }}
              ></Text>
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
                    <IndexDetailItemPopup onDelete={handleRemove} />
                  </Col>
                </FlexRow>
              </Col>
            )}
          </FlexRow>
        </Col>
        <Col xs={12} className="mt-2">
          <Text size="md" theme="gray5">
            {item.type}
            {" • "}
          </Text>

          <Text size="md" theme="gray5">
            {node?.updatedAt
              ? `Updated ${moment(new Date(node.updatedAt)).fromNow()}`
              : ""}
          </Text>
        </Col>
      </FlexRow>
    </div>
  );
};
export default DefaultIndexItem;
