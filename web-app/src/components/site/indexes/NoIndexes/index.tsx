import Button from "components/base/Button";
import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import React from "react";
import { useOwner } from "hooks/useOwner";
import { useApp } from "components/site/context/AppContext";

export interface NoIndexesProps {
	tabKey?: string;
}

const NoIndexes: React.VFC<NoIndexesProps> = ({
	tabKey,
}) => {
	const { isOwner } = useOwner();
	const { setCreateModalVisible } = useApp();

	return (
		<>
			<Row fullWidth rowSpacing={5} >
				<Col xs={12} centerBlock style={{
					height: 166,
				}}>
					<img src="/images/no_indexes.png" alt="No Indexes" />
				</Col>
				<Col className="text-center" centerBlock>
					{
						isOwner ? (
							tabKey === "starred" ? (
								<Header style={{
									maxWidth: 350,
								}} level={4}>{`You have no starred indexes yet.`}</Header>
							) : (
								<Header style={{
									maxWidth: 350,
								}} level={4}>{`You have no indexes yet. Create an index to get started.`}</Header>
							)
						) : (
							<Header style={{
								maxWidth: 350,
							}} level={4}>{`There are no indexes yet...`}</Header>
						)
					}
				</Col>
				{
					(isOwner && tabKey !== "starred") && (
						<Col centerBlock>
							<Button onClick={() => { setCreateModalVisible(true); }} >Create a new index</Button>
						</Col>
					)
				}
			</Row>
		</>
	);
};

export default NoIndexes;
