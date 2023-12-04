import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import React from "react";
import { Indexes } from "types/entity";

export interface NoLinksProps {
  search?: string;
  isOwner?: boolean;
  index?: Indexes;
}

const NoLinks: React.VFC<NoLinksProps> = ({ search, isOwner, index }) => {
  console.log(index, "index");
  console.log(isOwner, "isOwner");
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
            <Header
              level={4}
              style={{
                maxWidth: 350,
              }}
            >{`Your search "${search}" did not match any links.`}</Header>
          ) : (
            <Header
              level={4}
              style={{
                maxWidth: 350,
              }}
            >
              {" "}
              {isOwner ?
               `You don't have any items in ${index?.title} yet. Please add an items in the 'index' tab to enable chat functionality.` :
               `${index?.title} doesn't have any items yet`}
            </Header>
          )}
        </Col>
      </Row>
    </>
  );
};

export default NoLinks;
