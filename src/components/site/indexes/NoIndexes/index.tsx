import Button from "components/base/Button";
import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import Image from "next/image";
import React, { useState } from "react";
import { useRouter } from "next/router";
import CreateModal from "components/site/modal/CreateModal";
import { useOwner } from "../../../../hooks/useOwner";

export interface NoIndexesProps {
	hasIndex?: boolean;
	search?: string;
	tabKey?: string;
}

const NoIndexes: React.VFC<NoIndexesProps> = ({
	hasIndex,
	search,
	tabKey,
}) => {
	const router = useRouter();
	const { isOwner } = useOwner();
	const [createModalVisible, setCreateModalVisible] = useState(false);
	const handleToggleCreateModal = () => {
		setCreateModalVisible((oldVal) => !oldVal);
	 };
	const handleCreate = () => {
		router.push("/create");
	};

	return (
		<>
			<Row rowSpacing={5} >
				<Col xs={12} centerBlock style={{
					height: 166,
				}}>
					<Image src="/images/no_indexes.png" alt="No Indexes" layout="fill" objectFit='contain' />
				</Col>
				<Col className="text-center" centerBlock>
					{
						search && (
							<Header level={4} style={{
								maxWidth: 350,
							}}>{`Your search "${search}" did not match any indexes.`}</Header>
						)
					}
					{
						!search && !hasIndex && (
							isOwner ? (
								<Header style={{
									maxWidth: 350,
								}} level={4}>{`You have no ${tabKey === "starred" ? "starred" : ""} indexes yet. Create an index to get started.`}</Header>
							) : (
								<Header style={{
									maxWidth: 350,
								}} level={4}>{`There are no indexes yet...`}</Header>
							)
						)
					}
				</Col>
				{
					(!search && isOwner && !hasIndex && tabKey === "my_indexes") && (
						<>
							<Col centerBlock>
								<Button onClick={() => { setCreateModalVisible(true); }}>Create a new index</Button>
								<CreateModal visible={createModalVisible} onClose={handleToggleCreateModal}></CreateModal>
							</Col>
						</>
					)
				}

			</Row>
		</>
	);
};

export default NoIndexes;
