import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import Text from "components/base/Text";
import LandingSection from "../LandingSection";

const LandingSection1v2: React.VFC = () => (
	<LandingSection dark>
		<Flex
			alignItems="center"
			style={{
				width: "100%",
			}}
			className="lnd-card lnd-reorder"
		>
			<Flex alignItems={"center"} flexDirection="column" className="lnd-title mb-2">
				<Header className="lnd-section-title">Discovery as a Network</Header>
				<Text style={{
					textAlign: "center", fontWeight: 300, fontSize: "1.8rem", lineHeight: 1.3,
				}} className={"mt-5"}>Index is the discovery protocol in web3, which enables composable<br />queries across interoperable discovery engines. </Text>
				<Text style={{
					textAlign: "center", fontWeight: 300, fontSize: "1.8rem", lineHeight: 1.3,
				}} className={"mt-5 mb-0"} >Creating a discovery ecosystem as a network promotes greater participation in<br /> decentralized discovery and contributes to a diverse and inclusive web.</Text>
				<img className={"px-lg-10"} style={{
					width: "100%",
					textAlign: "center",
					margin: "auto",
				}} alt="landing-2-img" src="/images/composability.png" />
			</Flex>

		</Flex>
	</LandingSection>
);

export default LandingSection1v2;
