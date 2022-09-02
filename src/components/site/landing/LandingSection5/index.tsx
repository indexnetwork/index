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
				className="lnd-5-list"
			>
				<Col lg={6} xs={12}>
					<Flex
						flexDirection="column"
						gap={"16px"}
						className="py-3"
						alignItems="flex-start"
					>
						<img className="lnd-5-img" alt="ceramic-img" src="/images/ceramic.png" />
						<Text theme="secondary">Ceramic is a decentralized data network that brings unlimited data composability to Web3 applications.</Text>
					</Flex>
				</Col>
				<Col lg={6} xs={12}>
					<Flex
						flexDirection="column"
						gap={"16px"}
						className="py-3"
						alignItems="flex-start"
					>
						<img className="lnd-5-img" alt="lit-img" src="/images/lit.png" />
						<Text theme="secondary">Lit Protocol is decentralized access control infrastructure designed to bring more utility to the web.</Text>
					</Flex>
				</Col>
				<Col lg={6} xs={12}>
					<Flex
						flexDirection="column"
						gap={"16px"}
						className="py-3"
						alignItems="flex-start"
					>
						<img className="lnd-5-img" alt="ipfs-img" src="/images/ipfs.png" />
						<Text theme="secondary">A peer-to-peer hypermedia protocol designed to preserve and grow humanity&apos;s knowledge by making the web upgradeable, resilient, and more open.</Text>
					</Flex>
				</Col>
				<Col lg={6} xs={12}>
					<Flex
						flexDirection="column"
						gap={"16px"}
						className="py-3"
						alignItems="flex-start"
					>
						<img className="lnd-5-img" alt="gnosis-img" src="/images/gnosis.png" />
						<Text theme="secondary">The most trusted platform to manage digital assets on Ethereum.</Text>
					</Flex>
				</Col>
			</FlexRow>
		</Flex>
	</LandingSection>
);

export default LandingSection5;
