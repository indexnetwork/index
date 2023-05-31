import React from "react";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Flex from "components/layout/base/Grid/Flex";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Button from "components/base/Button";
import IconContextMenu from "components/base/Icon/IconContextMenu";
import Avatar from "components/base/Avatar";
import CreatorRulePopup from "components/site/popup/CreatorRulePopup";
import IconCopy from "components/base/Icon/IconCopy";

import { copyToClipboard, maskAddress } from "utils/helper";

export interface CreatorRuleProps {
	rule: any;
}
const CreatorRule = (
	{
		rule,
	}: CreatorRuleProps,
) => (<div className="p-6 card-item">
	<FlexRow justify={"between"} fullWidth>
		<Col xs={10}>
			<Flex className={"idxflex-nowrap"} alignItems={"top"} flexDirection={"column"}>
				<Row>
					<Text fontFamily="Freizeit" fontWeight={500}>{rule.ruleType === "nftOwner" ? "NFT OWNER" : "INDIVIDUAL WALLET"}</Text>
				</Row>
				<Row className={"mt-3"}>
					<Flex alignItems={"center"}>
						<Col className={"mr-3"}>
							<Avatar className="site-navbar__avatar" hoverable size={40} randomColor>
								<img src="https://picsum.photos/100/100" alt="profile_img"/>
							</Avatar>
						</Col>
						<Col>
							<Header level={4} className=" mb-1">{rule.chain}</Header>
							<Flex alignItems={"center"}>
								<Text fontFamily={"Freizeit"} fontWeight={500} size={"sm"} className={"mr-1"}>{maskAddress(rule.address || rule.contractAddress)}</Text>
								<Button onClick={() => {
									copyToClipboard(`${rule.address || rule.contractAddress}`);
								}} iconButton
								theme="clear"
								size={"xs"}
								borderless>
									<IconCopy />
								</Button>
							</Flex>
						</Col>
					</Flex>
				</Row>
			</Flex>
		</Col>
		<Col pullRight>
			<CreatorRulePopup>
				<Button
					size="sm"
					borderless
					iconButton
					theme="clear"
				><IconContextMenu /></Button>
			</CreatorRulePopup>
		</Col>
	</FlexRow>

</div>);

export default CreatorRule;
