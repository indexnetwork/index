import React, { useEffect, useState } from "react";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Button from "components/base/Button";
import api from "services/api-service";
import { AccessControlCondition } from "types/entity";
import Image from "next/image";
import NewCreatorModal from "components/site/modal/NewCreatorModal";
import { useApp } from "hooks/useApp";
import IconAdd from "components/base/Icon/IconAdd";
import { useIndex } from "hooks/useIndex";
import CreatorRule from "./CreatorRule";

export interface CreatorSettingsProps {
    collabAction: string;
	onChange: (value: string) => void;
}

const CreatorSettings: React.VFC<CreatorSettingsProps> = ({ onChange, collabAction }) => {
	const [loading, setLoading] = useState(false);
	const [newCreatorModalVisible, setNewCreatorModalVisible] = useState(false);
	const { setTransactionApprovalWaiting } = useApp();
	const { index, roles } = useIndex();
	const [conditions, setConditions] = useState<any>([]);
	const addOrStatements = (c: AccessControlCondition[]) => c.flatMap((el, i) => (i === c.length - 1 ? el : [el, { operator: "or" }]));
	const loadAction = async (action: string) => {
		const litAction = await api.getLITAction(action) as [any];
		if (litAction) {
			setConditions(litAction.filter((item: any, i: number) => i % 2 === 0));
		}
	};

	const handleRemove = async (i: number) => {
		setNewCreatorModalVisible(false);
		setTransactionApprovalWaiting(true);
		const newConditions = [...conditions.slice(0, i), ...conditions.slice(i + 1)];
		const newAction = await api.postLITAction(addOrStatements(newConditions));
		await onChange(newAction!);
		setTransactionApprovalWaiting(false);
	};

	const handleCreate = async (condition: AccessControlCondition) => {
		setNewCreatorModalVisible(false);
		setTransactionApprovalWaiting(true);
		const newConditions = [condition, ...conditions];
		const newAction = await api.postLITAction(addOrStatements(newConditions));
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
			<Row noGutters>
				<Col pullLeft>
					<Header className="mb-4">Creators</Header>
				</Col>
				{roles.owner() && <Col pullRight>
					<Button
						addOnBefore
						className={"mr-0"}
						size="sm"
						onClick={handleToggleNewCreatorModal}
					>
						<IconAdd width={12} stroke="white" strokeWidth={"1.5"} /> Add New
					</Button>
				</Col>}
			</Row>
			<Row className={"mt-0"}>
				<Col xs={10}>
					<Text fontFamily="freizeit" size={"lg"} fontWeight={500}>
						{roles.owner() && <>Control write access to your index through NFTs.<br /></>}
						Creators can add items, add tags to theirs and delete them.</Text>
				</Col>
			</Row>
			<FlexRow className={"mt-6"} rowGutter={0} rowSpacing={2} colSpacing={2}>
				{
					conditions && conditions
						.map((c: any, i: any) => <Col key={i} lg={6} xs={12}>
							<CreatorRule handleRemove={() => handleRemove(i)} rule={c.metadata}></CreatorRule>
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
			{/* eslint-disable-next-line max-len */}
			{newCreatorModalVisible ? <NewCreatorModal handleCreate={handleCreate} visible={newCreatorModalVisible} onClose={handleToggleNewCreatorModal}></NewCreatorModal> : <></> }
		</>

	);
};

export default CreatorSettings;
