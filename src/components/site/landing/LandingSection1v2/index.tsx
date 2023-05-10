import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import Text from "components/base/Text";
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
		>
			<Flex flex="1" className={cc(["lnd-img", cm.ttlContainer, "mb-6", "mb-sm-7"])}>
				<Header className="lnd-section-title text-left">It is the scarcity of context rather than the abundance
                    of information.</Header>
			</Flex>
			<Flex flex="1" className="lnd-2-container lnd-desc" flexDirection="column">
				<Text className="lnd-desc-text text-left" theme="secondary" size="xl">
					We allow creators to make contextual discovery engines from their information.
					<br /><br />
					We enable data-ownership and interoperability to form discovery ecosystem as a network.
					<br /><br />
					We make web3 discoverable by prioritizing human tastes, motivations and perspective.
				</Text>

			</Flex>
		</Flex>
	</LandingSection>
);

export default LandingSection1v2;
