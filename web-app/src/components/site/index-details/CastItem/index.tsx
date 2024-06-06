import Freizeit from "@/fonts/loader";
import { shortStr } from "@/utils/helper";
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
import { CastIndexNodeItem, DefaultIndexNodeItem } from "types/entity";
import { BREAKPOINTS } from "utils/constants";

// TODO: data prop will be Index object
export interface CastItemProps {
  item: CastIndexNodeItem;
  onChange?(val: DefaultIndexNodeItem[]): void;
  search?: boolean;
  handleRemove?(): void;
}

const CastItem: React.FC<CastItemProps> = ({
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
                src={"/images/ic_farcaster.svg"}
                alt="favicon"
                width={16}
                height={16}
                onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                  const target = e.target as HTMLImageElement;
                  target.onerror = null; // Prevents infinite loop in case fallback image also fails
                  target.src = "/images/ic_farcaster.svg";
                }}
                style={{
                  verticalAlign: "middle",
                }}
              />
              <a
                href={`https://warpcast.com/${item.node.author.username}/${item.node.thread_hash.substring(0, 10)}`}
                target="_blank"
              >
                <Text
                  className={Freizeit.className}
                  style={{
                    fontSize: "16px",
                  }}
                  fontWeight={700}
                  dangerouslySetInnerHTML={{
                    __html: sanitize(shortStr(node?.text)),
                  }}
                />
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
                    <IndexDetailItemPopup onDelete={handleRemove} />
                  </Col>
                </FlexRow>
              </Col>
            )}
          </FlexRow>
        </Col>
        <Col xs={12} className="mt-2">
          <Text size="sm" theme="gray5">
            {item.type}
            {" • "}
            <a
              href={`https://warpcast.com/${item.node.author.username}`}
              target="_blank"
              style={{
                color: "#475569",
              }}
            >
              {item.node.author?.username}
            </a>
            {" • "}
          </Text>

          <Text size="sm" theme="gray5">
            {node?.timestamp
              ? `Updated ${moment(new Date(node.timestamp)).fromNow()}`
              : ""}
          </Text>
        </Col>
      </FlexRow>
    </div>
  );
};
export default CastItem;
