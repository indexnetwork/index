import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import Text from "components/base/Text";
import Button from "components/base/Button";
import cc from "classcat";
import cm from "./style.module.scss";
import LandingSection from "../LandingSection";

const LandingSection1v2: React.VFC = () => (
	<LandingSection>
		<Flex
			alignItems="center"
			style={{
				position: "relative",
			}}
			className="lnd-card"
			gap={"32px"}
		>
			<Flex flex="1" className={cc(["lnd-img", cm.ttlContainer])} >
				<Header className={cm.title}>It is the scarcity of context rather than the abundance of information.</Header>
			</Flex>
			<Flex flex="1" flexDirection="column" className="lnd-desc">
				<Text theme="secondary" size="xl">
				The solution lies in human curation, which will allow us to map the web.
				It should include collaboration at any level with monetization options. This is what we believe and what we do.
				</Text>
				<br />
				<Text theme="secondary" size="xl">
				Together, let’s make Web3 discoverable by prioritizing human tastes, motivations and perspective.
				</Text>
				<Button fontWeight={700} theme="link" className="px-0 mt-3" size="md">Read our full story &#x2192;</Button>
			</Flex>
		</Flex>
	</LandingSection >
);

export default LandingSection1v2;
