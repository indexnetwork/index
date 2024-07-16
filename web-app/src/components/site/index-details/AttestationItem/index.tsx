import Freizeit from "@/fonts/loader";
import { shortStr } from "@/utils/helper";
import Button from "components/base/Button";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import IndexDetailItemPopup from "components/site/popup/IndexDetailItemPopup";
import { useRole } from "hooks/useRole";
import moment from "moment";
import React from "react";
import sanitize from "sanitize-html";
import { AttestationIndexNodeItem, DefaultIndexNodeItem } from "types/entity";

export interface AttestationItemProps {
  item: AttestationIndexNodeItem;
  onChange?(val: DefaultIndexNodeItem[]): void;
  search?: boolean;
  handleRemove?(): void;
}

const AttestationItem: React.FC<AttestationItemProps> = ({
  item,
  search = false,
  handleRemove,
}) => {
  const { node } = item;

  const { isCreator } = useRole();

  return (
    <div className="index-detail-list-item-wrapper">
      <FlexRow className="index-detail-list-item py-3">
        <Col xs={12}>
          <FlexRow wrap={false} style={{ height: "24px" }}>
            <Col className="idxflex-grow-1">
              <img
                className="mt-0 mr-3"
                src={"/images/article.svg"}
                alt="favicon"
                width={16}
                height={16}
                onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                  const target = e.target as HTMLImageElement;
                  target.onerror = null; // Prevents infinite loop in case fallback image also fails
                  target.src = "/images/article.svg";
                }}
                style={{
                  verticalAlign: "middle",
                }}
              />
              <a
                href={`https://explorer.ver.ax/linea/attestations/${node.attestationID}`}
                target="_blank"
              >
                <Text
                  className={Freizeit.className}
                  style={{
                    fontSize: "16px",
                  }}
                  fontWeight={700}
                  dangerouslySetInnerHTML={{
                    __html: sanitize(shortStr(node?.schema.name)),
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
              href={`https://explorer.ver.ax/linea/attestations/${node.attestationID}`}
              target="_blank"
              style={{
                color: "#475569",
              }}
            >
              {shortStr(node.subject, 60)}
            </a>
          </Text>
          {" • "}
          <Text size="sm" theme="gray5">
            {node?.attestedDate
              ? `Attested ${moment(new Date(node.attestedDate)).fromNow()}`
              : ""}
          </Text>
        </Col>
      </FlexRow>
    </div>
  );
};
export default AttestationItem;
