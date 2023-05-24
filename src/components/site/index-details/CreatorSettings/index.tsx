import React, { useEffect, useState } from "react";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Button from "components/base/Button";

import api, { LitActionConditions } from "services/api-service";

import NewCreatorModal from "../../modal/NewCreatorModal";
import { AccessControlCondition } from "../../../../types/entity";
import ConfirmTransaction from "../../modal/Common/ConfirmTransaction";

export interface CreatorSettingsProps {
    collabAction: string;
	onChange: (value: string) => void;
}

const CreatorSettings: React.VFC<CreatorSettingsProps> = ({ onChange, collabAction }) => {
	const [loading, setLoading] = useState(false);
	const [newCreatorModalVisible, setNewCreatorModalVisible] = useState(false);
	const [transactionApprovalWaiting, setTransactionApprovalWaiting] = useState(true);
	const [conditions, setConditions] = useState<any>([]);
	const loadAction = async (action: string) => {
		const litAction = await api.getLITAction(action);
		setConditions(litAction);
	};
	const handleCancel = () => {
		setTransactionApprovalWaiting(false);
	};
	const handleCreate = async (condition: AccessControlCondition) => {
		const newAction = await api.postLITAction([
			condition,
			{ operator: "or" },
			...conditions,
		] as LitActionConditions);
		setNewCreatorModalVisible(false);
		setTransactionApprovalWaiting(true);
		await onChange(newAction!);
		console.log("haha");
		setTransactionApprovalWaiting(false);
	};

	const handleToggleNewCreatorModal = () => {
		console.log(newCreatorModalVisible);
		setNewCreatorModalVisible(true);
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
							<Button onClick={handleToggleNewCreatorModal}>+ Add New</Button>
						</Col>
					</Flex>
				</Col>
			</Row>
			<Row className={"mt-4"}>
				<Text fontFamily="freizeit" fontWeight={500}>Control write access to your index through NFTs. Creators will be able to add items, add tags to theirs and delete them.</Text>
			</Row>
			<FlexRow className={"mt-6"} rowGutter={2} rowSpacing={2} colSpacing={2}>
				{
					conditions && conditions
						.filter((c: { conditionType: string; }) => c.conditionType === "evmBasic")
						.map((c: any, index: any) => <Col key={index} lg={6} xs={12}>
							{c.metadata && c.metadata.ruleType === "wallet" &&
                                <div className="p-4 card-item">
                                	<Text theme="gray9">Individual Wallet</Text>
                                	<Header level={4} className="mt-3 mb-1">{c.metadata.chain}</Header>
                                	<Text size={"sm"}>{c.metadata.address}</Text>
                                </div>
							}
							{c.metadata && c.metadata.ruleType === "nftOwner" &&
                                <div className="p-4 card-item">
                                	<Text theme="gray9">NFT Owner</Text>
                                	<Header level={4} className="mt-3 mb-1">{c.metadata.title} {c.metadata.tokenId ? `#${c.metadata.tokenId}` : ""} </Header>
                                	<Text size={"sm"}>{c.metadata.contractAddress}</Text>
                                </div>
							}
						</Col>)
				}
			</FlexRow>
			{/* eslint-disable-next-line max-len */}
			{newCreatorModalVisible ? <NewCreatorModal handleCreate={handleCreate} visible={newCreatorModalVisible} onClose={handleToggleNewCreatorModal}></NewCreatorModal> : <></>}
			{transactionApprovalWaiting ? <ConfirmTransaction handleCancel={handleCancel} visible={transactionApprovalWaiting}></ConfirmTransaction> : <></>}
		</>

	);
};

export default CreatorSettings;
