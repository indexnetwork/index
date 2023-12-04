import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import React from "react";
import { useIndex } from "hooks/useIndex";

export interface NoLinksProps {
  search?: string;
  isOwner?: boolean;
  tabKey: string;
}

const NoLinks: React.VFC<NoLinksProps> = ({ search, tabKey }) => {
  const { index, roles } = useIndex();
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
                      {`Your search "${search}" did not match any links.`}
                  </Header>
              ) : (
                  <Header level={4}>
                      {tabKey === "chat" ? (
                          index?.isOwner ? (
                              <>
                                  <div>You don&apos;t have any items in {index?.title} yet.</div>
                                  <div>Add an item to the index to chat.</div>
                              </>
                          ) : (
                              <div>{index?.title} doesn&apos;t have any items to chat with.</div>
                          )
                      ) : (
                          index?.isOwner ?
                              `You don't have any items in ${index?.title} yet.` :
                              `${index?.title} index doesn't have any items yet.`
                      )}
                  </Header>
              )}
          </Col>
      </Row>
    </>
  );
};

export default NoLinks;
