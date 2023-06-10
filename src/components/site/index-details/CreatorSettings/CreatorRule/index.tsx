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
	handleRemove: () => void;
}
const CreatorRule = (
	{
		rule,
		handleRemove,
	}: CreatorRuleProps,
) => (<div className="p-6 card-item">
	<FlexRow justify={"between"} fullWidth>
		<Col xs={10}>
			<Flex className={"idxflex-nowrap"} alignItems={"top"} flexDirection={"column"}>
				<Row>
					<Text fontFamily="Freizeit" fontWeight={500}>{rule.ruleType === "nftOwner" ? (rule.standardContractType === "ERC721" && rule.tokenId ? "NFT OWNER" : "NFT OWNERS") : "INDIVIDUAL WALLET"}</Text>
				</Row>
				<Row className={"mt-3"}>
					<Flex alignItems={"center"}>
						<Col >
							{
								(rule.symbol || rule.image) && (<Avatar className={"site-navbar__avatar mr-3"} contentRatio={rule.symbol ? 0.3 : 0.4} maxLetters={rule.symbol ? 4 : 2} hoverable size={40}>{
									rule.image ?
										<img src={rule.image} alt="profile_img"/> : (
											rule.symbol || rule.ensName
										)}</Avatar>)
							}
						</Col>
						<Col>
							<Header level={4} className=" mb-1">{rule.name || rule.ensName || maskAddress(rule.walletAddress)}</Header>
							<Flex alignItems={"center"}>
								<Text fontFamily={"Freizeit"} fontWeight={500} size={"sm"} className={"mr-1"}>{maskAddress(rule.walletAddress || rule.contractAddress)}</Text>
								<Button onClick={() => {
									copyToClipboard(`${rule.walletAddress || rule.contractAddress}`);
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
			<CreatorRulePopup rule={rule} onRemove={handleRemove}>
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
