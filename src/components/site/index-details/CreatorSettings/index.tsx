import React, { useEffect, useState } from "react";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Button from "components/base/Button";
import api, { LitActionConditions } from "services/api-service";
import { AccessControlCondition } from "types/entity";
import NewCreatorModal from "../../modal/NewCreatorModal";
import ConfirmTransaction from "../../modal/Common/ConfirmTransaction";

import CreatorRule from "./CreatorRule";
import IconAdd from "../../../base/Icon/IconAdd";

export interface CreatorSettingsProps {
    collabAction: string;
	onChange: (value: string) => void;
}

const CreatorSettings: React.VFC<CreatorSettingsProps> = ({ onChange, collabAction }) => {
	const [loading, setLoading] = useState(false);
	const [newCreatorModalVisible, setNewCreatorModalVisible] = useState(false);
	const [transactionApprovalWaiting, setTransactionApprovalWaiting] = useState(false);
	const [conditions, setConditions] = useState<any>([]);
	const loadAction = async (action: string) => {
		const litAction = await api.getLITAction(action);
		setConditions(litAction);
	};
	const handleCancel = () => {
		setTransactionApprovalWaiting(false);
	};
	const handleCreate = async (condition: AccessControlCondition) => {
		setNewCreatorModalVisible(false);
		setTransactionApprovalWaiting(true);
		const newAction = await api.postLITAction([
			condition,
			{ operator: "or" },
			...conditions,
		] as LitActionConditions);
		await onChange(newAction!);
		setTransactionApprovalWaiting(false);
	};

	const handleToggleNewCreatorModal = () => {
		setNewCreatorModalVisible(!newCreatorModalVisible);
	};

	useEffect(() => {
		loadAction(collabAction);
	}, [collabAction]);

	return (
		<>
			<Row>
				<Col xs={12} >
					<Flex>
						<Col className={"idxflex-grow-1"}>
							<Header className="mb-4">Creator Rules</Header>
						</Col>
						<Col>
							<Button size={"md"} onClick={handleToggleNewCreatorModal}>+ Add New</Button>
						</Col>
					</Flex>
				</Col>
			</Row>
			<Row className={"mt-0"}>
				<Col xs={9}>
					<Text fontFamily="freizeit" size={"lg"} fontWeight={500}>Control write access to your index through NFTs. Creators will be able to add items, add tags to theirs and delete them.</Text>
				</Col>
			</Row>
			<FlexRow className={"mt-6"} rowGutter={2} rowSpacing={2} colSpacing={2}>
				{
					conditions && conditions
						.filter((c: { conditionType: string; }) => c.conditionType === "evmBasic")
						.map((c: any, index: any) => <Col key={index} lg={6} xs={12}>
							<CreatorRule rule={c.metadata}></CreatorRule>
						</Col>)
				}
			</FlexRow>
			{newCreatorModalVisible ? <NewCreatorModal handleCreate={handleCreate} visible={newCreatorModalVisible} onClose={handleToggleNewCreatorModal}></NewCreatorModal> : <></>}
			{transactionApprovalWaiting ? <ConfirmTransaction handleCancel={handleCancel} visible={transactionApprovalWaiting}></ConfirmTransaction> : <></>}
		</>

	);
};

export default CreatorSettings;
