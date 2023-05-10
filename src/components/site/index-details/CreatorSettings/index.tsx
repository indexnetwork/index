import React, { useEffect, useState } from "react";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Button from "components/base/Button";

import api from "services/api-service";

export interface CreatorSettingsProps {
    collabAction: string;
}

const CreatorSettings: React.VFC<CreatorSettingsProps> = ({ collabAction }) => {
	const [loading, setLoading] = useState(false);
	const [conditions, setConditions] = useState<any>([]);
	const loadAction = async (action: string) => {
		const litAction = await api.getLITAction("QmR2ym9KcvKMZntiyzc9dHMtpV5U3G2gfrMrf4XVuS7bHa");
		console.log(litAction);
		setConditions(litAction);
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

						<Col >
							<Button>+ Add New</Button>
						</Col>
					</Flex>
				</Col>
			</Row>
			<Row className={"mt-4"}>
				<Col>
					<Text fontFamily="freizeit" fontWeight={500}>Control write access to your index through NFTs. Creators will be able to add items, add tags to theirs and delete them.</Text>
				</Col>
			</Row>

			<FlexRow className={"mt-6"} rowGutter={2} rowSpacing={2} colSpacing={2}>

				{
					conditions && conditions
						.filter((c: { conditionType: string; }) => c.conditionType === "evmBasic")
						.map((c: any, index: any) => <Col key={index} lg={6} xs={12}>
							{c.metadata.ruleType === "wallet" &&
                                <div className="p-4 card-item">
                                	<Text theme="gray9">Individual Wallet</Text>
                                	<Header level={4} className="mt-3 mb-1">{c.metadata.chain}</Header>
                                	<Text size={"sm"}>{c.metadata.address}</Text>
                                </div>
							}
							{c.metadata.ruleType === "nftOwner" &&
                                <div className="p-4 card-item">
                                	<Text theme="gray9">NFT Owner</Text>
                                	<Header level={4} className="mt-3 mb-1">{c.metadata.title} {c.metadata.tokenId ? `#${c.metadata.tokenId}` : ""} </Header>
                                	<Text size={"sm"}>{c.metadata.contractAddress}</Text>
                                </div>
							}
						</Col>)
				}
			</FlexRow>
		</>

	);
};

export default CreatorSettings;
