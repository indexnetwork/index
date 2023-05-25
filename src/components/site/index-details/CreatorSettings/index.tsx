import React, { useEffect, useState } from "react";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Button from "components/base/Button";
import api, { LitActionConditions } from "services/api-service";
import { AccessControlCondition } from "types/entity";
import Image from "next/image";
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
	useEffect(() => {
		console.log(conditions)
	}, [conditions]);

	return (
		<>
			<Row>
				<Col xs={12} >
					<Row noGutters>
						<Col pullLeft >
							<Header className="mb-4">Creators</Header>
						</Col>
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
					</Row>
				</Col>
			</Row>
			<Row className={"mt-0"}>
				<Col xs={10}>
					<Text fontFamily="freizeit" size={"lg"} fontWeight={500}>Control write access to your index through NFTs.<br /> Creators will be able to add items, add tags to theirs and delete them.</Text>
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
				{
					conditions.length === 0 && <><Col className={"mt-4"} xs={12} centerBlock style={{
						height: 166,
					}}>
						<Image src="/images/no_indexes.png" alt="No Indexes" layout="fill" objectFit='contain' />
					</Col>
					<Col className="text-center" centerBlock>
						<Header level={4} style={{
							maxWidth: 350,
						}}>No creators, yet.</Header>

					</Col></>

				}

			</FlexRow>
			// @ts-ignore
			{newCreatorModalVisible ? <NewCreatorModal handleCreate={handleCreate} visible={newCreatorModalVisible} onClose={handleToggleNewCreatorModal}></NewCreatorModal> : <></>}
			// @ts-ignore
			{transactionApprovalWaiting ? <ConfirmTransaction handleCancel={handleCancel} visible={transactionApprovalWaiting}></ConfirmTransaction> : <></>}
		</>

	);
};

export default CreatorSettings;
