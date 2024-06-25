import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import React from "react";
import { useAppSelector } from "@/store/store";
import { selectIndex } from "@/store/slices/indexSlice";

export interface NoLinksProps {
  search?: string;
  isOwner?: boolean;
  tabKey: string;
}

const NoLinks: React.FC<NoLinksProps> = ({
  search,
  isOwner = false,
  tabKey,
}) => {
  const { data: viewedIndex } = useAppSelector(selectIndex);
  return (
    <>
      <Row rowSpacing={5} fullWidth>
        <Col
          xs={12}
          className="mb-7"
          centerBlock
          style={{
            height: 166,
            display: "grid",
            placeItems: "center",
          }}
        >
          <img src="/images/no_indexes.png" alt="No Indexes" />
        </Col>
        <Col className="text-center" centerBlock>
          {search ? (
            <Header level={4}>
              {`Your search "${search}" did not match any items.`}
            </Header>
          ) : (
            <Header level={4}>
              {tabKey === "chat" ? (
                isOwner ? (
                  <>
                    <div>
                      You don&apos;t have any items in {viewedIndex?.title} yet.
                    </div>
                    <div>Add an item to the index to chat.</div>
                  </>
                ) : (
                  <div>
                    {viewedIndex?.title} doesn&apos;t have any items to chat
                    with.
                  </div>
                )
              ) : isOwner ? (
                `You don't have any items in ${viewedIndex?.title} yet.`
              ) : (
                `${viewedIndex?.title} index doesn't have any items yet.`
              )}
            </Header>
          )}
        </Col>
      </Row>
    </>
  );
};

export default NoLinks;
