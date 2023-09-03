import Header from "components/base/Header";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React from "react";
import LandingSection from "../LandingSection";

const LandingSection5: React.VFC = () => (
	<LandingSection>
		<Flex
			flexDirection="column"
			gap={"32px"}
			className="lnd-card"
			style={{
				alignItems: "flex-start",
			}}
		>
			<Header className="lnd-5-title text-left">Built with open protocols</Header>
			<FlexRow
				className="lnd-5-list mt-4"
				colSpacing={6}
				rowGutter={6}
			>
				<Col lg={4} xs={12}>
					<img className="lnd-5-img" alt="ceramic-img" src="/images/ceramic.png" />
					<div>
						<Text className="lnd-5-text" theme="secondary">Ceramic is a decentralized data network that brings unlimited data composability to Web3 applications.</Text>
					</div>
				</Col>
				<Col lg={4} xs={12}>
					<img className="lnd-5-img" alt="lit-img" src="/images/lit.png" />
					<div>
						<Text className="lnd-5-text" theme="secondary">Lit Protocol is decentralized access control infrastructure designed to bring more utility to the web.</Text>
					</div>
				</Col>
				<Col lg={4} xs={12}>
					<img className="lnd-5-img" alt="ipfs-img" src="/images/ipfs.png" />
					<div>
						<Text className="lnd-5-text" theme="secondary">A peer-to-peer hypermedia protocol designed to preserve and grow humanity&apos;s knowledge by making the web upgradeable, resilient, and more open.</Text>
					</div>
				</Col>
			</FlexRow>
		</Flex>
	</LandingSection>
);

export default LandingSection5;
