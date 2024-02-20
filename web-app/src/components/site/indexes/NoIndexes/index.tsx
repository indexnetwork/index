import Button from "components/base/Button";
import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import { FC } from "react";
import { IndexListTabKey, useApp } from "@/context/AppContext";
import { useRole } from "@/hooks/useRole";

export interface NoIndexesProps {
  tabKey?: string;
}

const NoIndexes: FC<NoIndexesProps> = ({ tabKey }) => {
  const { isOwner } = useRole();
  const { setCreateModalVisible } = useApp();

  return (
    <>
      <Row fullWidth rowSpacing={5}>
        <div
          style={{
            height: 166,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            marginTop: "8rem",
          }}
        >
          <img src="/images/no_indexes.png" alt="No Indexes" />
        </div>
        <Col className="text-center" centerBlock>
          {isOwner ? (
            tabKey === IndexListTabKey.STARRED ? (
              <Header
                style={{
                  maxWidth: 350,
                }}
                level={4}
              >{`You have no starred indexes yet.`}</Header>
            ) : (
              <Header
                style={{
                  maxWidth: 350,
                }}
                level={4}
              >{`You have no indexes yet. Create an index to get started.`}</Header>
            )
          ) : (
            <Header
              style={{
                maxWidth: 350,
              }}
              level={4}
            >{`There are no indexes yet...`}</Header>
          )}
        </Col>
        {isOwner && tabKey !== IndexListTabKey.STARRED && (
          <Col centerBlock>
            <Button
              onClick={() => {
                setCreateModalVisible(true);
              }}
            >
              Create a new index
            </Button>
          </Col>
        )}
      </Row>
    </>
  );
};

export default NoIndexes;
