import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import Button from "components/base/Button";
import Header from "components/base/Header";
import IconAdd from "components/base/Icon/IconAdd";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Row from "components/layout/base/Grid/Row";
import NewCreatorModal from "components/site/modal/NewCreatorModal";
import { useRole } from "hooks/useRole";
import { FC, useCallback, useEffect, useState } from "react";
import { AccessControlCondition } from "types/entity";
import CreatorRule from "./CreatorRule";

export interface CreatorSettingsProps {
  collabAction: string;
  onChange: (value: string) => void;
}

const CreatorSettings: FC<CreatorSettingsProps> = ({
  onChange,
  collabAction,
}) => {
  const { isOwner } = useRole();

  const { api, ready: apiReady } = useApi();
  const [newCreatorModalVisible, setNewCreatorModalVisible] = useState(false);
  const { setTransactionApprovalWaiting } = useApp();
  const [conditions, setConditions] = useState<any>([]);
  const addOrStatements = (c: AccessControlCondition[]) =>
    c.flatMap((el, i) => (i === c.length - 1 ? el : [el, { operator: "or" }]));

  const loadAction = useCallback(async (action: string) => {
    if (!apiReady) return;

    const litAction = (await api!.getLITAction(action)) as [any];
    if (litAction && litAction.length > 0) {
      setConditions(litAction.filter((item: any, i: number) => i % 2 === 0));
    }
  }, []);

  const handleRemove = useCallback(
    async (i: number) => {
      if (!apiReady) return;
      setNewCreatorModalVisible(false);
      setTransactionApprovalWaiting(true);
      const newConditions = [
        ...conditions.slice(0, i),
        ...conditions.slice(i + 1),
      ];
      const newAction = await api!.postLITAction(
        addOrStatements(newConditions),
      );
      onChange(newAction!);
      setTransactionApprovalWaiting(false);
    },
    [apiReady],
  );

  const handleCreate = useCallback(
    async (condition: AccessControlCondition) => {
      if (!apiReady) return;
      setNewCreatorModalVisible(false);
      setTransactionApprovalWaiting(true);
      const newConditions = [condition, ...conditions];
      const newAction = await api!.postLITAction(
        addOrStatements(newConditions),
      );
      onChange(newAction!);
      setTransactionApprovalWaiting(false);
    },
    [apiReady],
  );

  const handleToggleNewCreatorModal = useCallback(() => {
    setNewCreatorModalVisible(!newCreatorModalVisible);
  }, [newCreatorModalVisible]);

  useEffect(() => {
    loadAction(collabAction);
  }, [collabAction]);

  return (
    <>
      <Row noGutters>
        <Col pullLeft>
          <Header className="mb-4" theme="gray6">
            Creators
          </Header>
        </Col>
        {isOwner && (
          <Col pullRight>
            <Button
              addOnBefore
              className={"mr-0"}
              size="sm"
              onClick={handleToggleNewCreatorModal}
            >
              <IconAdd width={12} stroke="white" strokeWidth={"1.5"} /> Add New
            </Button>
          </Col>
        )}
      </Row>
      <Row className={"mt-0"}>
        <Col xs={10}>
          <Text fontFamily="freizeit" size={"lg"} fontWeight={500}>
            {isOwner && (
              <>
                Control write access to your index through NFTs.
                <br />
              </>
            )}
            Creators can add items, add tags to theirs and delete them.
          </Text>
        </Col>
      </Row>
      <FlexRow className={"mt-6"} rowGutter={0} rowSpacing={2} colSpacing={2}>
        {conditions &&
          conditions.map((c: any, i: any) => (
            <Col key={i} lg={6} xs={12}>
              <CreatorRule
                handleRemove={() => handleRemove(i)}
                rule={c.metadata}
              ></CreatorRule>
            </Col>
          ))}
        {conditions.length === 0 && (
          <>
            <Col
              className={"mt-4"}
              xs={12}
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
              <Header
                level={4}
                style={{
                  maxWidth: 350,
                }}
              >
                No creators, yet.
              </Header>
            </Col>
          </>
        )}
      </FlexRow>
      {newCreatorModalVisible && (
        <NewCreatorModal
          handleCreate={handleCreate}
          visible={newCreatorModalVisible}
          onClose={handleToggleNewCreatorModal}
        ></NewCreatorModal>
      )}
    </>
  );
};

export default CreatorSettings;
