import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Row from "components/layout/base/Grid/Row";
import Image from "next/image";
import React from "react";


const NotFound: React.FC = ({
}) => (
  <Flex
    className="not-found"
    style={{
      height: "100%",
    }}
  >
    <div
      style={{
        width: "100%",
        paddingTop: "8em",
      }}
    >

      <Col xs={12} centerBlock style={{
        height: 166,
      }}>
        <Image src="/images/notfound.png" alt="Not found" layout="fill" objectFit='contain' />
      </Col>
      <Col className="text-center" centerBlock>
        <Header level={4} style={{
          maxWidth: 350,
        }}>{`Page not found.`}</Header>
      </Col>
    </div>
  </Flex>
);

export default NotFound;
